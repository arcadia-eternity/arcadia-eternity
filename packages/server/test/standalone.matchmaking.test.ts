import { afterEach, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import type { BattleState, PlayerSelection } from '@arcadia-eternity/const'
import type { PrivateRoomInfo, ServerSession } from '@arcadia-eternity/protocol'
import { createSingleProcessApp, type SingleProcessAppOptions } from '../src/standalone/app'
import { createNpmFixture } from './fixtures/npm'
import input from '../../battle/test/fixtures/official-switch.input.json'

const apps: ReturnType<typeof createSingleProcessApp>[] = []
const sockets: Socket[] = []
afterEach(async () => {
  sockets.splice(0).forEach(socket => socket.disconnect())
  await Promise.all(apps.splice(0).map(app => app.stop()))
})
async function boot(options: SingleProcessAppOptions = {}) {
  const app = createSingleProcessApp({
    port: 0,
    host: '127.0.0.1',
    corsOrigins: ['*'],
    cleanupIntervalMs: 20,
    ...options,
  })
  apps.push(app)
  await app.start()
  const url = `http://127.0.0.1:${app.address!.port}`
  const user = async () => {
    const response = await fetch(`${url}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { id: 'same-local-profile', name: 'Player' } }),
    })
    const session = (await response.json()) as ServerSession
    const socket = io(url, { auth: { token: session.token }, transports: ['websocket'], reconnection: false })
    sockets.push(socket)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
    })
    return { socket, session }
  }
  return { app, user }
}
type Reply = { status: 'SUCCESS'; data: unknown } | { status: 'ERROR'; code: string }
function ack(socket: Socket, event: string, data?: unknown): Promise<Reply> {
  return data === undefined ? socket.timeout(5000).emitWithAck(event) : socket.timeout(5000).emitWithAck(event, data)
}
async function success<T = unknown>(socket: Socket, event: string, data?: unknown): Promise<T> {
  const result = await ack(socket, event, data)
  expect(result.status, JSON.stringify(result)).toBe('SUCCESS')
  return (result as { data: T }).data
}
const team = input.teams[1].team.map(({ maxHp: _maxHp, ...pet }) => ({
  ...pet,
  skills: ['skill_paida', 'skill_shuipao'],
}))
const request = () => ({ playerSchema: { id: 'untrusted-profile', name: 'Ignored', team } })

it('automatically pairs two guests into a playable authoritative battle and supports another match', async () => {
  const { app, user } = await boot()
  const [a, b] = await Promise.all([user(), user()])
  await success(a.socket, 'joinMatchmaking', request())
  expect(await success(a.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1, rooms: 0 })
  await success(a.socket, 'joinMatchmaking', request())
  expect(await success(a.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1 })
  await success(b.socket, 'joinMatchmaking', request())
  const room = await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')
  expect(room).toMatchObject({ matchmaking: true, status: 'started', config: { battleMode: 'server' } })
  expect(room.players.map(player => player.playerId)).toEqual([a.session.seatId, b.session.seatId])
  expect(room.players[1].team).toBeUndefined()
  expect(await success(b.socket, 'getCurrentPrivateRoom')).toMatchObject({ battleRoomId: room.battleRoomId })
  expect(await ack(a.socket, 'cancelMatchmaking')).toMatchObject({ status: 'ERROR', code: 'MATCH_ALREADY_STARTED' })
  await success(a.socket, 'ready')
  await success(b.socket, 'ready')
  const state = await success<BattleState>(a.socket, 'getState')
  for (const [i, player] of [a, b].entries()) {
    const actions = await success<PlayerSelection[]>(player.socket, 'getAvailableSelection')
    await success(player.socket, 'submitPlayerSelection', {
      ...actions.find(action => action.type === 'use-skill'),
      requestId: `turn-${i}`,
      expectedTurn: state.currentTurn,
    })
  }
  const next = await success<BattleState>(a.socket, 'getState')
  expect(next.currentTurn).toBeGreaterThan(state.currentTurn)
  await success(a.socket, 'submitPlayerSelection', {
    type: 'surrender',
    player: a.session.seatId,
    requestId: 'end',
    expectedTurn: next.currentTurn,
  })
  await success(a.socket, 'leavePrivateRoom')
  await success(a.socket, 'joinMatchmaking', request())
  await success(b.socket, 'joinMatchmaking', request())
  expect((await success<PrivateRoomInfo>(b.socket, 'getCurrentPrivateRoom')).battleRoomId).not.toBe(room.battleRoomId)
  expect(app.rooms.size).toBe(1)
}, 20000)

it('cancels without a late pairing, excludes duplicate sockets, and clears a disconnected waiting seat', async () => {
  const { user } = await boot()
  const [a, b, c] = await Promise.all([user(), user(), user()])
  await success(a.socket, 'joinMatchmaking', request())
  expect(await ack(a.socket, 'createPrivateRoom', { config: {} })).toMatchObject({
    status: 'ERROR',
    code: 'ALREADY_QUEUED',
  })
  await success(a.socket, 'cancelMatchmaking')
  await success(b.socket, 'joinMatchmaking', request())
  expect(await success(b.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1, rooms: 0 })
  expect(await success(a.socket, 'getCurrentPrivateRoom')).toBeNull()
  b.socket.disconnect()
  await expect.poll(async () => success(a.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 0 })
  await success(c.socket, 'joinMatchmaking', request())
  expect(await success(c.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1, rooms: 0 })
}, 20000)

it('rejects illegal teams and incompatible environment acceptance without occupying the queue', async () => {
  const { app, user } = await boot()
  const { socket } = await user()
  expect(await ack(socket, 'joinMatchmaking', { playerSchema: { team: [] } })).toMatchObject({
    status: 'ERROR',
    code: 'INVALID_TEAM',
  })
  const environment = app.environments.list()[0]
  expect(await ack(socket, 'joinMatchmaking', { ...request(), environmentId: environment.id })).toMatchObject({
    status: 'ERROR',
    code: 'CLIENT_ENVIRONMENT_REQUIRED',
  })
  const accepted = {
    environmentId: environment.id,
    protocolVersion: 1,
    resourceRevision: environment.resourceRevision,
    resourcesReady: true,
  }
  expect(
    await ack(socket, 'joinMatchmaking', {
      ...request(),
      environmentId: environment.id,
      environment: { ...accepted, protocolVersion: 999 },
    }),
  ).toMatchObject({ status: 'ERROR', code: 'CLIENT_PROTOCOL_MISMATCH' })
  expect(
    await ack(socket, 'joinMatchmaking', { ...request(), environmentId: 'f'.repeat(64), environment: accepted }),
  ).toMatchObject({ status: 'ERROR', code: 'ENVIRONMENT_NOT_FOUND' })
  expect(await success(socket, 'getServerState')).toMatchObject({ matchmakingQueue: 0, rooms: 0 })
  await success(socket, 'joinMatchmaking', { ...request(), environmentId: environment.id, environment: accepted })
  expect(await success(socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1 })
}, 20000)

it('clears admissions when cancellation races an enqueue and when a session is revoked', async () => {
  const { app, user } = await boot()
  const a = await user()
  const pending = ack(a.socket, 'joinMatchmaking', request())
  await success(a.socket, 'cancelMatchmaking')
  await pending
  expect(await success(a.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 0, rooms: 0 })
  await success(a.socket, 'joinMatchmaking', request())
  await app.rooms.revoke(a.session)
  const b = await user()
  expect(await success(b.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 0, rooms: 0 })
}, 20000)

it('allows a trusted namespace/rule policy to reconsider players after waiting without new arrivals', async () => {
  const observed: string[] = []
  const { app, user } = await boot({
    matchmakingPolicy: {
      ratingScope: () => ({ namespace: 'official', ruleId: 'casual' }),
      findMatch: (candidates, context) => {
        expect(context.ratingScope).toEqual({ namespace: 'official', ruleId: 'casual' })
        expect(candidates.every(candidate => candidate.principal.kind === 'guest')).toBe(true)
        observed.push(context.environment.id)
        return context.now - candidates[1].joinedAt >= 80 ? [candidates[0].seatId, candidates[1].seatId] : null
      },
    },
  })
  const [a, b] = await Promise.all([user(), user()])
  await success(a.socket, 'joinMatchmaking', request())
  await success(b.socket, 'joinMatchmaking', request())
  await expect.poll(() => app.rooms.size).toBe(1)
  expect(observed.length).toBeGreaterThan(1)
  expect(await success(a.socket, 'getCurrentPrivateRoom')).toMatchObject({ status: 'started' })
}, 20000)

it('never publishes a canceled pair when an asynchronous trusted selector finishes late', async () => {
  let finish!: (pair: readonly [string, string]) => void
  const { app, user } = await boot({
    cleanupIntervalMs: 10000,
    matchmakingPolicy: {
      findMatch: () =>
        new Promise(resolve => {
          finish = resolve
        }),
    },
  })
  const [a, b] = await Promise.all([user(), user()])
  await success(a.socket, 'joinMatchmaking', request())
  const joining = ack(b.socket, 'joinMatchmaking', request())
  await expect.poll(() => typeof finish).toBe('function')
  await success(a.socket, 'cancelMatchmaking')
  finish([a.session.seatId, b.session.seatId])
  await joining
  expect(app.rooms.size).toBe(0)
  expect(await success(b.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1 })
}, 20000)

it('rolls back both queue seats when room capacity is exhausted and allows a retry', async () => {
  const { app, user } = await boot({ maxRooms: 1 })
  const [owner, a, b] = await Promise.all([user(), user(), user()])
  await success(owner.socket, 'createPrivateRoom', { config: {} })
  await success(a.socket, 'joinMatchmaking', request())
  expect(await ack(b.socket, 'joinMatchmaking', request())).toMatchObject({ status: 'ERROR', code: 'ROOM_CAPACITY' })
  expect(await success(a.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 0, rooms: 1, playersInRooms: 1 })
  await success(owner.socket, 'leavePrivateRoom')
  await success(a.socket, 'joinMatchmaking', request())
  await success(b.socket, 'joinMatchmaking', request())
  expect(app.rooms.size).toBe(1)
}, 20000)

it('isolates exact environments and releases retired waiting environments after refusing new matches', async () => {
  const fixture = await createNpmFixture()
  try {
    const { app, user } = await boot()
    const environment = await app.environments.prepareNpm(fixture.directory)
    const [a, b] = await Promise.all([user(), user()])
    const custom = {
      playerSchema: {
        id: 'ignored',
        name: 'Ignored',
        team: [
          {
            ...team[0],
            species: 'example-slow:pet',
            skills: ['example-slow:strike'],
            ability: undefined,
            emblem: undefined,
          },
        ],
      },
      environmentId: environment.id,
      environment: {
        environmentId: environment.id,
        protocolVersion: 1,
        resourceRevision: environment.resourceRevision,
        resourcesReady: true,
      },
    }
    await success(a.socket, 'joinMatchmaking', request())
    await success(b.socket, 'joinMatchmaking', custom)
    expect(await success(a.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 2, rooms: 0 })
    await app.environments.retire(environment.id)
    await success(b.socket, 'cancelMatchmaking')
    expect(() => app.environments.descriptor(environment.id)).toThrow('ENVIRONMENT_NOT_FOUND')
    expect(await ack(b.socket, 'joinMatchmaking', custom)).toMatchObject({
      status: 'ERROR',
      code: 'ENVIRONMENT_NOT_FOUND',
    })
    expect(await success(a.socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1, rooms: 0 })
  } finally {
    await fixture.dispose()
  }
}, 30000)

it('keeps a seat queued until its last socket disconnects and notifies every socket when canceled', async () => {
  const { app, user } = await boot()
  const a = await user()
  const duplicate = io(`http://127.0.0.1:${app.address!.port}`, {
    auth: { token: a.session.token },
    transports: ['websocket'],
    reconnection: false,
  })
  sockets.push(duplicate)
  await new Promise<void>((resolve, reject) => {
    duplicate.once('connect', resolve)
    duplicate.once('connect_error', reject)
  })
  await success(a.socket, 'joinMatchmaking', request())
  await success(duplicate, 'joinMatchmaking', request())
  a.socket.disconnect()
  expect(await success(duplicate, 'getServerState')).toMatchObject({ matchmakingQueue: 1, rooms: 0 })
  const canceled = new Promise(resolve => duplicate.once('matchmakingError', resolve))
  await success(duplicate, 'cancelMatchmaking')
  expect(await canceled).toEqual({ status: 'ERROR', code: 'MATCHMAKING_CANCELED' })
  expect(await success(duplicate, 'getServerState')).toMatchObject({ matchmakingQueue: 0, rooms: 0 })
}, 20000)

it('bounds a stuck rating policy and recovers on a later admission', async () => {
  let attempts = 0
  let signal: AbortSignal | undefined
  const { user } = await boot({
    cleanupIntervalMs: 10000,
    matchmakingPolicyTimeoutMs: 50,
    matchmakingPolicy: {
      findMatch: (candidates, context) => {
        attempts++
        signal = context.signal
        return attempts === 1 ? new Promise(() => {}) : [candidates[0].seatId, candidates[1].seatId]
      },
    },
  })
  const [a, b, c] = await Promise.all([user(), user(), user()])
  await success(a.socket, 'joinMatchmaking', request())
  expect(await ack(b.socket, 'joinMatchmaking', request())).toMatchObject({
    status: 'ERROR',
    code: 'MATCHMAKING_POLICY_TIMEOUT',
  })
  expect(signal?.aborted).toBe(true)
  await success(c.socket, 'joinMatchmaking', request())
  expect(await success(c.socket, 'getCurrentPrivateRoom')).toMatchObject({ status: 'started' })
}, 20000)
