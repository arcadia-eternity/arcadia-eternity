import { afterEach, beforeAll, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { AttributeSystem, setGlobalLogger } from '@arcadia-eternity/battle/v4'
import type { ServerSession, PrivateRoomInfo } from '@arcadia-eternity/protocol'
import type { BattleState, PlayerSelection } from '@arcadia-eternity/const'
import { createSingleProcessApp } from '../src/standalone/app'
import input from '../../battle/src/v2/__tests__/fixtures/baseline/official-switch.input.json'

const legalTeam = input.teams[1].team.map(pet => {
  const { maxHp: _maxHp, ...draft } = pet
  return { ...draft, skills: ['skill_paida', 'skill_shuipao'] }
})
const apps: ReturnType<typeof createSingleProcessApp>[] = []
const sockets: Socket[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect()
  await Promise.all(apps.splice(0).map(app => app.stop()))
})
type Reply<T> = { status: 'SUCCESS'; data: T } | { status: 'ERROR'; code: string }
function ack<T = unknown>(socket: Socket, event: string, data?: unknown): Promise<Reply<T>> {
  return new Promise((resolve, reject) => {
    const handler = (error: Error | null, response: Reply<T>) => (error ? reject(error) : resolve(response))
    if (data === undefined) socket.timeout(5000).emit(event, handler)
    else socket.timeout(5000).emit(event, data, handler)
  })
}
async function success<T = unknown>(socket: Socket, event: string, data?: unknown): Promise<T> {
  const result = await ack<T>(socket, event, data)
  expect(result.status, JSON.stringify(result)).toBe('SUCCESS')
  if (result.status !== 'SUCCESS') throw new Error(result.code)
  return result.data
}
async function connect(url: string, session: ServerSession) {
  const socket = io(url, {
    auth: { token: session.token, playerId: 'forged-player' },
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
  })
  sockets.push(socket)
  const connected = new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', reject)
  })
  socket.connect()
  await connected
  return socket
}
async function setup() {
  const app = createSingleProcessApp({
    port: 0,
    host: '127.0.0.1',
    serverId: 'test',
    corsOrigins: ['*'],
    reconnectGraceMs: 2000,
  })
  apps.push(app)
  await app.start()
  const url = `http://127.0.0.1:${app.address!.port}`
  const users = await Promise.all(
    ['A', 'B', 'Spectator'].map(async name => {
      const response = await fetch(`${url}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { id: 'same-profile-id', name } }),
      })
      expect(response.status).toBe(201)
      const session = (await response.json()) as ServerSession
      return { session, socket: await connect(url, session) }
    }),
  )
  return { app, url, users }
}
async function start() {
  const env = await setup(),
    [a, b, spectator] = env.users
  const { roomCode } = await success<{ roomCode: string }>(a.socket, 'createPrivateRoom', {
    config: { battleMode: 'server', timerConfig: { enabled: false } },
  })
  await success(b.socket, 'joinPrivateRoom', { roomCode })
  await success(spectator.socket, 'joinPrivateRoomAsSpectator', { roomCode })
  await success(b.socket, 'togglePrivateRoomReady', { team: legalTeam })
  await success(a.socket, 'startPrivateRoomBattle', { hostTeam: legalTeam })
  await success(a.socket, 'ready')
  await success(b.socket, 'ready')
  return { ...env, a, b, spectator, roomCode }
}
it('runs native rooms using server seats despite identical profile IDs; preserves secrecy and rejects forged actions', async () => {
  const baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
  const { app, a, b, spectator } = await start()
  expect(a.session.seatId).not.toBe(b.session.seatId)
  const info = await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')
  expect(info.players.map(p => p.playerId)).toEqual([a.session.seatId, b.session.seatId])
  expect(info.players[1].team).toBeUndefined()
  const publicJson = JSON.stringify(info)
  expect(publicJson).not.toContain(a.session.token)
  expect(publicJson).not.toContain(b.session.token)
  const aState = await success<BattleState>(a.socket, 'getState')
  expect(aState.players[0].team).toBeTruthy()
  expect(aState.players[1].team?.[1]).toMatchObject({ isUnknown: true, speciesID: '' })
  expect(aState.players[1].team?.[0].skills?.every(skill => skill.isUnknown)).toBe(true)
  const spectatorState = await success<BattleState>(spectator.socket, 'getState')
  expect(spectatorState.players.every(p => p.team?.[1].isUnknown)).toBe(true)
  expect(spectatorState.players.every(p => p.team?.[0].skills?.every(skill => skill.isUnknown))).toBe(true)
  const actions = await success<PlayerSelection[]>(a.socket, 'getAvailableSelection')
  const action = actions.find(selection => selection.type === 'use-skill')!
  const payload = { ...action, requestId: 'a-one', expectedTurn: aState.currentTurn }
  expect(await ack(spectator.socket, 'submitPlayerSelection', payload)).toMatchObject({
    status: 'ERROR',
    code: 'NOT_BATTLE_PLAYER',
  })
  expect(await ack(b.socket, 'submitPlayerSelection', payload)).toMatchObject({
    status: 'ERROR',
    code: 'FORBIDDEN_PLAYER',
  })
  expect(await ack(a.socket, 'submitPlayerSelection', { ...payload, expectedTurn: 999 })).toMatchObject({
    status: 'ERROR',
    code: 'STALE_ACTION',
  })
  await success(a.socket, 'submitPlayerSelection', payload)
  // Retried acknowledgements are idempotent, but conflicting reuse never overwrites a choice.
  await success(a.socket, 'submitPlayerSelection', payload)
  expect(
    await ack(a.socket, 'submitPlayerSelection', {
      ...payload,
      type: 'surrender',
      skill: undefined,
      target: undefined,
    }),
  ).toMatchObject({ status: 'ERROR' })
  expect(
    await ack(b.socket, 'startAnimation', { source: 'test', expectedDuration: 50, ownerId: a.session.seatId }),
  ).toMatchObject({ status: 'ERROR', code: 'FORBIDDEN_PLAYER' })
  const bActions = await success<PlayerSelection[]>(b.socket, 'getAvailableSelection')
  await success(b.socket, 'submitPlayerSelection', {
    ...bActions.find(s => s.type === 'use-skill'),
    requestId: 'b-one',
    expectedTurn: aState.currentTurn,
  })
  // Native runtime settles the previous turn before checking the caller's expected turn.
  expect(await ack(a.socket, 'submitPlayerSelection', { ...payload, requestId: 'late-old-turn' })).toMatchObject({
    status: 'ERROR',
    code: 'STALE_ACTION',
  })
  await app.stop()
  expect(app.rooms.size).toBe(0)
  expect(app.sessions.size).toBe(0)
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
}, 20_000)

it('restores the authorized seat after reload and only treats the last socket disconnect as offline', async () => {
  const { url, a, b } = await start()
  const extra = await connect(url, a.session)
  a.socket.disconnect()
  const room = await success<PrivateRoomInfo>(b.socket, 'getCurrentPrivateRoom')
  expect(room.players.find(p => p.playerId === a.session.seatId)).toMatchObject({ connectionStatus: 'online' })
  extra.disconnect()
  await new Promise(resolve => setTimeout(resolve, 30))
  const resumed = io(url, {
    auth: { token: a.session.token },
    transports: ['websocket'],
    reconnection: false,
    autoConnect: false,
  })
  sockets.push(resumed)
  const restored = new Promise<{ fullBattleState: BattleState }>(resolve => resumed.once('battleReconnect', resolve))
  resumed.connect()
  expect((await restored).fullBattleState.players[0].id).toBe(a.session.seatId)
  expect((await success<PrivateRoomInfo>(resumed, 'getCurrentPrivateRoom')).players[0].playerId).toBe(a.session.seatId)
  const state = await success<BattleState>(resumed, 'getState')
  const finished = new Promise<void>(resolve =>
    b.socket.on('privateRoomEvent', event => {
      if (event.type === 'battleFinished') resolve()
    }),
  )
  await success(resumed, 'submitPlayerSelection', {
    type: 'surrender',
    player: a.session.seatId,
    requestId: 'surrender',
    expectedTurn: state.currentTurn,
  })
  await finished
  const reset = await success<PrivateRoomInfo>(b.socket, 'getCurrentPrivateRoom')
  expect(reset.status).toBe('waiting')
  expect(reset.players.every(p => !p.isReady)).toBe(true)
  expect(reset.lastBattleResult?.winner).toBe(b.session.seatId)
}, 20_000)
