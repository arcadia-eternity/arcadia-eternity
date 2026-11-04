import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { digestJson } from '@arcadia-eternity/pack-loader/native'
import type { PersonalEnvironmentReference, PrivateRoomInfo, ServerSession } from '@arcadia-eternity/protocol'
import { createSingleProcessApp } from '../src/standalone/app'
import input from '../../battle/test/fixtures/official-switch.input.json'

const { maxHp: _maxHp, ...basePet } = input.teams[1].team[0]
const team = [
  {
    ...basePet,
    id: 'p'.repeat(21),
    species: 'unpublished-test:pet',
    skills: ['unpublished-test:skill'],
    ability: '',
    emblem: '',
  },
]
const builtinTeam = input.teams[1].team.map(({ maxHp: _hp, ...pet }) => ({
  ...pet,
  skills: ['skill_paida', 'skill_shuipao'],
}))
const apps: ReturnType<typeof createSingleProcessApp>[] = []
const sockets: Socket[] = []

beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  vi.restoreAllMocks()
  sockets.splice(0).forEach(socket => socket.disconnect())
  await Promise.all(apps.splice(0).map(app => app.stop()))
})

type Reply<T = unknown> = { status: 'SUCCESS'; data: T } | { status: 'ERROR'; code: string }
function ack<T = unknown>(socket: Socket, event: string, data?: unknown): Promise<Reply<T>> {
  return data === undefined ? socket.timeout(30000).emitWithAck(event) : socket.timeout(30000).emitWithAck(event, data)
}
async function success<T = unknown>(socket: Socket, event: string, data?: unknown): Promise<T> {
  const result = await ack<T>(socket, event, data)
  expect(result.status, JSON.stringify(result)).toBe('SUCCESS')
  if (result.status !== 'SUCCESS') throw new Error(result.code)
  return result.data
}
function signalEvent(socket: Socket) {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('privateRoomPeerSignal', receive)
      reject(new Error('Timed out waiting for a forwarded peer signal'))
    }, 3000)
    const receive = (value: unknown) => {
      clearTimeout(timeout)
      socket.off('privateRoomPeerSignal', receive)
      resolve(value)
    }
    socket.on('privateRoomPeerSignal', receive)
  })
}
async function reference(revision = 'personal-content-1'): Promise<PersonalEnvironmentReference> {
  const runtime = {
    kind: 'native-v4' as const,
    contentRevision: revision,
    coreBuildId: 'personal-core',
    registryBuildId: 'personal-registry',
  }
  const peerRevision = `${revision}/effects:${'b'.repeat(64)}`
  const resourceRevision = 'a'.repeat(64)
  const rules = { schemaVersion: 1 as const }
  const packages: PersonalEnvironmentReference['descriptor']['packages'] = []
  return {
    kind: 'personal',
    protocolVersion: 1,
    descriptor: {
      id: await digestJson({ runtime, peerRevision, resourceRevision, rules, packages }),
      protocolVersion: 1,
      executionPolicy: 'peer',
      peerRevision,
      runtime,
      packages,
      resources: [],
      resourceRevision,
    },
    rules,
    source: { kind: 'file', name: 'environment.arcadia.json' },
  }
}
function acceptance(personal: PersonalEnvironmentReference, challengeGeneration = 1) {
  return {
    environmentId: personal.descriptor.id,
    protocolVersion: 1,
    resourceRevision: personal.descriptor.resourceRevision,
    peerRevision: personal.descriptor.peerRevision,
    resourcesReady: true,
    challengeGeneration,
  }
}
async function fixture() {
  const app = createSingleProcessApp({
    port: 0,
    host: '127.0.0.1',
    corsOrigins: [],
    maxConcurrentBattles: 1,
    maxIdleWorkers: 1,
  })
  apps.push(app)
  await app.start()
  const url = `http://127.0.0.1:${app.address!.port}`
  async function user() {
    const response = await fetch(`${url}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { id: 'personal-test-profile', name: 'Personal player' } }),
    })
    expect(response.status).toBe(201)
    const session = (await response.json()) as ServerSession
    const socket = io(url, { auth: { token: session.token }, transports: ['websocket'], reconnection: false })
    sockets.push(socket)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
    })
    return { socket, session }
  }
  async function room(personal?: PersonalEnvironmentReference) {
    personal ??= await reference()
    const [a, b] = await Promise.all([user(), user()])
    const created = await success<{ roomCode: string }>(a.socket, 'createPrivateRoom', {
      config: { battleMode: 'p2p' },
      personalEnvironment: personal,
    })
    await success(b.socket, 'joinPrivateRoom', created)
    return { a, b, created, personal }
  }
  return { app, url, user, room }
}

describe('personal fixed-environment private room signaling', () => {
  it('drains terminal ACKs for the finished round without closing result views and fences stale rematch traffic', async () => {
    const { app, room } = await fixture()
    const { a, b, personal, created } = await room()
    const accepted = acceptance(personal)
    await success(b.socket, 'togglePrivateRoomReady', { team, environment: accepted })
    await success(a.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: accepted })
    const first = await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')
    expect(first.battleRoomId).toBeTruthy()
    const ownerClosed = vi.fn()
    const peerClosed = vi.fn()
    a.socket.on('roomClosed', ownerClosed)
    b.socket.on('roomClosed', peerClosed)
    await success(a.socket, 'finishPrivateRoomBattle', {
      battleRoomId: first.battleRoomId,
      winner: a.session.seatId,
      reason: 'terminal-result',
    })

    const terminalSignal = {
      transport: 'relay',
      kind: 'custom',
      payload: { type: 'p2p-battle-ack', payload: { viewerId: b.session.seatId, sequenceId: 18 } },
    }
    const terminalRequest = {
      targetPlayerId: a.session.seatId,
      targetSessionId: a.session.sessionId,
      battleRoomId: first.battleRoomId,
      signal: terminalSignal,
    }
    const terminalDelivered = signalEvent(a.socket)
    await success(b.socket, 'sendPrivateRoomPeerSignal', terminalRequest)
    expect(await terminalDelivered).toMatchObject({
      battleRoomId: first.battleRoomId,
      roomCode: created.roomCode,
      from: { playerId: b.session.seatId, sessionId: b.session.sessionId },
      to: { playerId: a.session.seatId, sessionId: a.session.sessionId },
      signal: terminalSignal,
    })
    expect(
      await ack(b.socket, 'sendPrivateRoomPeerSignal', {
        ...terminalRequest,
        battleRoomId: undefined,
      }),
    ).toMatchObject({ status: 'ERROR', code: 'INVALID_STATE' })
    expect(
      await ack(b.socket, 'sendPrivateRoomPeerSignal', {
        ...terminalRequest,
        battleRoomId: 'another-round',
      }),
    ).toMatchObject({ status: 'ERROR', code: 'STALE_BATTLE' })
    expect(
      await ack(b.socket, 'sendPrivateRoomPeerSignal', {
        ...terminalRequest,
        signal: { transport: 'webrtc', kind: 'offer', payload: { sdp: 'new-offer' } },
      }),
    ).toMatchObject({ status: 'ERROR', code: 'INVALID_STATE' })
    expect(
      await ack(b.socket, 'sendPrivateRoomPeerSignal', {
        ...terminalRequest,
        signal: {
          transport: 'relay',
          kind: 'custom',
          payload: { type: 'p2p-battle-submit-action', payload: { selection: { type: 'surrender' } } },
        },
      }),
    ).toMatchObject({ status: 'ERROR', code: 'INVALID_STATE' })

    // Observe actual timer cleanup. An absent room also yields undefined here, so the
    // following assertions require the same persistent room and preserved result.
    await expect
      .poll(async () => (await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')).battleRoomId, {
        timeout: 7000,
        interval: 50,
      })
      .toBeUndefined()
    for (const socket of [a.socket, b.socket]) {
      const lobby = await success<PrivateRoomInfo>(socket, 'getCurrentPrivateRoom')
      expect(lobby).toMatchObject({
        id: first.id,
        status: 'waiting',
        config: { roomCode: created.roomCode },
        lastBattleResult: { battleRoomId: first.battleRoomId, winner: a.session.seatId, reason: 'terminal-result' },
      })
      expect(lobby.players).toHaveLength(2)
      expect(lobby.players.every(player => !player.isReady)).toBe(true)
      expect(lobby.battleHost).toBeUndefined()
    }
    expect(ownerClosed).not.toHaveBeenCalled()
    expect(peerClosed).not.toHaveBeenCalled()
    expect(await ack(b.socket, 'sendPrivateRoomPeerSignal', terminalRequest)).toMatchObject({
      status: 'ERROR',
      code: 'INVALID_STATE',
    })

    await success(b.socket, 'togglePrivateRoomReady', { team, environment: accepted })
    await success(a.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: accepted })
    const second = await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')
    expect(second.status).toBe('started')
    expect(second.battleRoomId).not.toBe(first.battleRoomId)
    expect(await ack(b.socket, 'sendPrivateRoomPeerSignal', terminalRequest)).toMatchObject({
      status: 'ERROR',
      code: 'STALE_BATTLE',
    })
    expect(
      await ack(a.socket, 'finishPrivateRoomBattle', {
        battleRoomId: first.battleRoomId,
        winner: null,
        reason: 'late-previous-finish',
      }),
    ).toMatchObject({ status: 'ERROR', code: 'STALE_BATTLE' })
    expect((await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')).status).toBe('started')
    const nextDelivered = signalEvent(a.socket)
    await success(b.socket, 'sendPrivateRoomPeerSignal', { ...terminalRequest, battleRoomId: second.battleRoomId })
    expect(await nextDelivered).toMatchObject({ battleRoomId: second.battleRoomId, signal: terminalSignal })
    await success(a.socket, 'finishPrivateRoomBattle', {
      battleRoomId: second.battleRoomId,
      winner: null,
      reason: 'rematch-finished',
    })
    expect(app.rooms.battleWorkerStats).toMatchObject({ active: 0, queued: 0, workers: 0 })
  }, 15000)

  it('supports two unpublished UGC clients through ready, start, finish and rematch without server materials or Workers', async () => {
    const { app, url, room } = await fixture()
    const catalogBefore = await (await fetch(`${url}/api/v1/environments`)).json()
    const acquire = vi.spyOn(app.environments, 'acquire')
    const materialFetch = vi.spyOn(app.environments, 'peerMaterials')
    const externalReference = await reference()
    const sourceUrl = 'https://unpublished-content.invalid/environment.arcadia.json'
    externalReference.source = { kind: 'https', url: sourceUrl }
    const networkFetch = vi.spyOn(globalThis, 'fetch')
    const { a, b, personal } = await room(externalReference)
    const accepted = acceptance(personal)
    const initial = await success<PrivateRoomInfo>(b.socket, 'getCurrentPrivateRoom')
    expect(initial).toMatchObject({
      personalEnvironment: personal,
      challengeGeneration: 1,
      environment: personal.descriptor,
    })
    expect(initial.config.battleMode).toBe('p2p')
    await success(b.socket, 'togglePrivateRoomReady', { team, environment: accepted })
    await success(a.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: accepted })
    const first = await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')
    expect(first).toMatchObject({
      status: 'started',
      battleHost: { playerId: a.session.seatId },
      challengeGeneration: 1,
    })
    expect(first.players.every(player => player.team?.[0].species === 'unpublished-test:pet')).toBe(true)
    expect(app.rooms.battleWorkerStats).toMatchObject({ active: 0, queued: 0, workers: 0 })
    expect(await ack(a.socket, 'getState')).toMatchObject({ status: 'ERROR', code: 'BATTLE_NOT_FOUND' })
    expect(
      await ack(b.socket, 'finishPrivateRoomBattle', { winner: b.session.seatId, reason: 'forged' }),
    ).toMatchObject({ status: 'ERROR', code: 'NOT_HOST' })
    await success(a.socket, 'finishPrivateRoomBattle', { winner: a.session.seatId, reason: 'personal-finished' })
    const finished = await success<PrivateRoomInfo>(b.socket, 'getCurrentPrivateRoom')
    expect(finished.players.every(player => !player.isReady)).toBe(true)
    expect(finished.lastBattleResult).toMatchObject({ winner: a.session.seatId, reason: 'personal-finished' })
    await success(b.socket, 'togglePrivateRoomReady', { team, environment: accepted })
    await success(a.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: accepted })
    const second = await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')
    expect(second.status).toBe('started')
    expect(second.battleRoomId).not.toBe(first.battleRoomId)
    await success(a.socket, 'finishPrivateRoomBattle', { winner: null, reason: 'rematch-finished' })
    expect(app.rooms.battleWorkerStats).toMatchObject({ active: 0, queued: 0, workers: 0 })
    expect(acquire).not.toHaveBeenCalled()
    expect(materialFetch).not.toHaveBeenCalled()
    expect(
      networkFetch.mock.calls.some(
        ([request]) =>
          (typeof request === 'string' ? request : request instanceof URL ? request.href : request.url) === sourceUrl,
      ),
    ).toBe(false)
    expect(await (await fetch(`${url}/api/v1/environments`)).json()).toEqual(catalogBefore)
  }, 30000)

  it('rejects server execution and personal publication through matchmaking', async () => {
    const { app, user } = await fixture()
    const { socket } = await user()
    const personal = await reference()
    expect(
      await ack(socket, 'createPrivateRoom', { config: { battleMode: 'server' }, personalEnvironment: personal }),
    ).toMatchObject({ status: 'ERROR', code: 'ENVIRONMENT_EXECUTION_POLICY' })
    expect(
      await ack(socket, 'joinMatchmaking', { personalEnvironment: personal, playerSchema: { team: builtinTeam } }),
    ).toMatchObject({ status: 'ERROR', code: 'PERSONAL_ENVIRONMENT_PRIVATE_ONLY' })
    expect(app.rooms.managementStatus).toMatchObject({ rooms: 0, queued: 0 })
    await success(socket, 'createPrivateRoom', { config: { battleMode: 'p2p' }, personalEnvironment: personal })
    expect(await ack(socket, 'updatePrivateRoomConfig', { battleMode: 'server' })).toMatchObject({
      status: 'ERROR',
      code: 'ENVIRONMENT_EXECUTION_POLICY',
    })
    expect((await success<PrivateRoomInfo>(socket, 'getCurrentPrivateRoom')).challengeGeneration).toBe(1)
  })

  it('rejects code, resource bytes, oversized references, path injection, credential URLs and unfixed descriptors', async () => {
    const { app, user } = await fixture()
    const { socket } = await user()
    const personal = await reference()
    const malformed = [
      { ...personal, modules: [{ source: 'globalThis.RUN_AUTHOR_CODE = true' }] },
      { ...personal, descriptor: { ...personal.descriptor, code: 'throw new Error("execute")' } },
      { ...personal, descriptor: { ...personal.descriptor, resources: [{ bytes: 'embedded archive' }] } },
      { ...personal, source: { kind: 'file', name: 'x'.repeat(70_000) } },
      { ...personal, source: { kind: 'file', name: '../../secrets.json' } },
      { ...personal, source: { kind: 'file', name: 'C:\\users\\secrets.json' } },
      { ...personal, source: { kind: 'https', url: 'https://user:secret@example.com/environment.json' } },
      { ...personal, source: { kind: 'https', url: 'http://example.com/environment.json' } },
      { ...personal, source: { kind: 'file', name: 'environment.json', command: 'run-author-code' } },
      { ...personal, descriptor: { ...personal.descriptor, id: 'c'.repeat(64) } },
    ]
    for (const candidate of malformed) {
      expect(
        await ack(socket, 'createPrivateRoom', { config: { battleMode: 'p2p' }, personalEnvironment: candidate }),
      ).toMatchObject({ status: 'ERROR', code: 'PERSONAL_ENVIRONMENT_INVALID' })
    }
    expect(app.rooms.managementStatus.rooms).toBe(0)
    expect(app.rooms.battleWorkerStats.workers).toBe(0)
  })

  it('invalidates old preparation after configuration changes and host transfer', async () => {
    const { room } = await fixture()
    const { a, b, personal } = await room()
    await success(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal) })
    await success(a.socket, 'updatePrivateRoomConfig', { showHidden: true })
    const changed = await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')
    expect(changed.challengeGeneration).toBe(2)
    expect(changed.players.every(player => !player.isReady)).toBe(true)
    expect(await ack(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal) })).toMatchObject({
      status: 'ERROR',
      code: 'CLIENT_PREPARATION_STALE',
    })
    expect(
      await ack(a.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: acceptance(personal) }),
    ).toMatchObject({ status: 'ERROR', code: 'CLIENT_PREPARATION_STALE' })
    await success(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal, 2) })
    await success(a.socket, 'transferPrivateRoomHost', { targetPlayerId: b.session.seatId })
    const transferred = await success<PrivateRoomInfo>(b.socket, 'getCurrentPrivateRoom')
    expect(transferred).toMatchObject({ challengeGeneration: 3, config: { hostPlayerId: b.session.seatId } })
    expect(transferred.players.every(player => !player.isReady)).toBe(true)
    expect(await ack(a.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal, 2) })).toMatchObject(
      { status: 'ERROR', code: 'CLIENT_PREPARATION_STALE' },
    )
    expect(
      await ack(b.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: acceptance(personal, 2) }),
    ).toMatchObject({ status: 'ERROR', code: 'CLIENT_PREPARATION_STALE' })
    await success(a.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal, 3) })
    await success(b.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: acceptance(personal, 3) })
    expect((await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')).battleHost?.playerId).toBe(
      b.session.seatId,
    )
    await success(b.socket, 'finishPrivateRoomBattle', { winner: null, reason: 'transferred-finished' })
  })

  it('replaces only personal room references and requires preparation of the replacement identity', async () => {
    const { room, user } = await fixture()
    const { a, b, personal } = await room()
    await success(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal) })
    const replacement = await reference('personal-content-2')
    await success(a.socket, 'updatePrivateRoomConfig', { personalEnvironment: replacement })
    const current = await success<PrivateRoomInfo>(b.socket, 'getCurrentPrivateRoom')
    expect(current).toMatchObject({
      challengeGeneration: 2,
      personalEnvironment: replacement,
      environment: replacement.descriptor,
    })
    expect(current.players.every(player => !player.isReady)).toBe(true)
    expect(await ack(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal) })).toMatchObject({
      status: 'ERROR',
      code: 'CLIENT_PREPARATION_STALE',
    })
    expect(await ack(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal, 2) })).toMatchObject(
      { status: 'ERROR', code: 'CLIENT_ENVIRONMENT_MISMATCH' },
    )
    expect(
      await ack(b.socket, 'togglePrivateRoomReady', {
        team,
        environment: { ...acceptance(replacement, 2), peerRevision: personal.descriptor.peerRevision },
      }),
    ).toMatchObject({ status: 'ERROR', code: 'CLIENT_PEER_ENVIRONMENT_MISMATCH' })
    await success(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance(replacement, 2) })
    await success(a.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: acceptance(replacement, 2) })
    await success(a.socket, 'finishPrivateRoomBattle', { winner: null, reason: 'replacement-finished' })

    const ordinary = await user()
    await success(ordinary.socket, 'createPrivateRoom', { config: { battleMode: 'p2p' } })
    expect(await ack(ordinary.socket, 'updatePrivateRoomConfig', { personalEnvironment: replacement })).toMatchObject({
      status: 'ERROR',
      code: 'ENVIRONMENT_FIXED',
    })
  })

  it('rejects malformed teams while accepting bounded unpublished UGC IDs without catalog lookup', async () => {
    const { app, room } = await fixture()
    const { b, personal } = await room()
    const malformed = [
      [],
      Array.from({ length: 7 }, () => structuredClone(team[0])),
      [{ ...team[0], maxHp: 999999 }],
      [{ ...team[0], level: 101 }],
      [{ ...team[0], name: 'x'.repeat(300) }],
      [{ ...team[0], evs: { hp: 255, atk: 255, def: 255, spa: 0, spd: 0, spe: 0 } }],
      [team[0], structuredClone(team[0])],
      [{ ...team[0], species: '/absolute/path/instead/of/id' }],
      [{ ...team[0], constructor: { source: 'run code' } }],
    ]
    for (const invalidTeam of malformed) {
      expect(
        await ack(b.socket, 'togglePrivateRoomReady', { team: invalidTeam, environment: acceptance(personal) }),
      ).toMatchObject({ status: 'ERROR', code: 'INVALID_TEAM' })
    }
    const contentLookup = vi.spyOn(app.environments, 'content')
    await success(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance(personal) })
    expect(contentLookup).not.toHaveBeenCalled()
    expect(
      (await success<PrivateRoomInfo>(b.socket, 'getCurrentPrivateRoom')).players.find(
        player => player.playerId === b.session.seatId,
      )?.isReady,
    ).toBe(true)
  })
})
