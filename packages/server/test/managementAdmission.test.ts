import { afterEach, beforeAll, expect, it } from 'vitest'
import { access } from 'node:fs/promises'
import { io, type Socket } from 'socket.io-client'
import { setGlobalLogger } from '@arcadia-eternity/battle/engine'
import type { BattleState } from '@arcadia-eternity/const'
import type { PrivateRoomInfo, ServerSession } from '@arcadia-eternity/protocol'
import { createSingleProcessApp } from '../src/runtime/app'
import { ServerEnvironmentRegistry } from '../src/runtime/environments'
import input from '../../battle/test/fixtures/official-switch.input.json'
import { createNpmFixture } from './fixtures/npm'

const team = input.teams[1].team.map(({ maxHp: _maxHp, ...pet }) => ({
  ...pet,
  skills: ['skill_paida', 'skill_shuipao'],
}))
const apps: ReturnType<typeof createSingleProcessApp>[] = []
const sockets: Socket[] = []
const registries: ServerEnvironmentRegistry[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  sockets.splice(0).forEach(socket => socket.disconnect())
  await Promise.all(apps.splice(0).map(app => app.stop()))
  await Promise.all(registries.splice(0).map(registry => registry.stop()))
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
async function fixture() {
  const app = createSingleProcessApp({
    port: 0,
    host: '127.0.0.1',
    corsOrigins: [],
    maxConcurrentBattles: 1,
    maxIdleWorkers: 1,
    maxQueuedBattles: 2,
    battleQueueTimeoutMs: 60000,
  })
  apps.push(app)
  await app.start()
  const url = `http://127.0.0.1:${app.address!.port}`
  async function user() {
    const response = await fetch(`${url}/api/v1/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { id: 'same-local-profile', name: 'Player' } }),
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
  async function room() {
    const [a, b] = await Promise.all([user(), user()])
    const created = await success<{ roomCode: string }>(a.socket, 'createPrivateRoom', {
      config: { battleMode: 'server' },
    })
    await success(b.socket, 'joinPrivateRoom', created)
    await success(b.socket, 'togglePrivateRoomReady', { team })
    return { a, b, created }
  }
  return { app, url, user, room }
}

it('restricts new admission and public discovery without invalidating existing environment leases', async () => {
  const registry = new ServerEnvironmentRegistry()
  registries.push(registry)
  await registry.ready()
  const original = registry.descriptor()
  const retained = registry.acquire()
  registry.setPublication([])
  expect(registry.list()).toEqual([])
  expect(() => registry.acquire(original.id)).toThrow('ENVIRONMENT_NOT_PUBLISHED')
  // Private enabled bindings can create rooms but are absent from the public catalog.
  registry.setPublication([{ runtimeId: original.id, enabled: true, public: false, matchmaking: false }], original.id)
  expect(registry.list()).toEqual([])
  const privateLease = registry.acquire(original.id)
  expect(() => registry.acquire(original.id, false, 'matchmaking')).toThrow('ENVIRONMENT_MATCHMAKING_DISABLED')
  registry.setPublication([{ runtimeId: original.id, enabled: true, public: true, matchmaking: true }], original.id)
  const queuedLease = registry.acquire(undefined, false, 'matchmaking')
  expect(registry.list().map(item => item.id)).toEqual([original.id])
  registry.setPublication([])
  expect(retained.descriptor).toEqual(original)
  expect(privateLease.runtime).toBe(retained.runtime)
  expect(queuedLease.descriptor.id).toBe(original.id)
  expect(registry.content(original.id).species.length).toBeGreaterThan(0)
  await Promise.all([retained.release(), privateLease.release(), queuedLease.release()])
})

it('rejects unknown tier policies atomically and captures accepted rules in the room lease', async () => {
  const registry = new ServerEnvironmentRegistry()
  registries.push(registry)
  await registry.ready()
  const id = registry.descriptor().id
  const publication = { runtimeId: id, enabled: true, public: true, matchmaking: true }
  registry.setPublication([{ ...publication, rules: { schemaVersion: 1, team: { maxSize: 2 } } }], id)
  const lease = registry.acquire()
  expect(() =>
    registry.setPublication([{ ...publication, rules: { schemaVersion: 1, tier: 'unknown-tier' } }]),
  ).toThrow('ENVIRONMENT_RULES_UNSUPPORTED')
  expect(registry.list()).toHaveLength(1)
  registry.setPublication([{ ...publication, rules: { schemaVersion: 1, team: { maxSize: 1 } } }])
  expect(lease.rules?.team?.maxSize).toBe(2)
  const next = registry.acquire()
  expect(next.rules?.team?.maxSize).toBe(1)
  await Promise.all([lease.release(), next.release()])
})

it('applies publication and team policy to socket admissions, preserving earlier room rules', async () => {
  const { app, user, room, url } = await fixture()
  const first = await room()
  const id = app.environments.descriptor().id
  app.environments.setPublication(
    [
      {
        runtimeId: id,
        enabled: true,
        public: true,
        matchmaking: false,
        rules: { schemaVersion: 1, deny: { species: [team[0].species] } },
      },
    ],
    id,
  )
  const visitor = await user()
  expect(await ack(visitor.socket, 'joinMatchmaking', { playerSchema: { team } })).toMatchObject({
    status: 'ERROR',
    code: 'ENVIRONMENT_MATCHMAKING_DISABLED',
  })
  await success(visitor.socket, 'createPrivateRoom', { config: {} })
  expect(await ack(visitor.socket, 'togglePrivateRoomReady', { team })).toMatchObject({
    status: 'ERROR',
    code: 'ENVIRONMENT_TEAM_REJECTED',
  })
  // The room created before policy replacement retains its original rule snapshot.
  await success(first.a.socket, 'startPrivateRoomBattle', { hostTeam: team })
  app.environments.setPublication([])
  const catalog = (await (await fetch(`${url}/api/v1/environments`)).json()) as { environments: unknown[] }
  expect(catalog.environments).toEqual([])
  const next = await user()
  expect(await ack(next.socket, 'createPrivateRoom', { config: {}, environmentId: id })).toMatchObject({
    status: 'ERROR',
    code: 'ENVIRONMENT_NOT_PUBLISHED',
  })
  expect((await success<PrivateRoomInfo>(first.b.socket, 'getCurrentPrivateRoom')).status).toBe('started')
}, 30000)

it('drains queued launches and matchmaking while an active battle can finish', async () => {
  const { app, room, user } = await fixture()
  const running = await room()
  const waiting = await room()
  await success(running.a.socket, 'startPrivateRoomBattle', { hostTeam: team })
  const pendingStart = ack(waiting.a.socket, 'startPrivateRoomBattle', { hostTeam: team })
  await expect.poll(() => app.rooms.battleWorkerStats.queued).toBe(1)
  const queued = await user()
  await success(queued.socket, 'joinMatchmaking', { playerSchema: { team } })
  expect(app.rooms.managementStatus).toMatchObject({ draining: false, activeBattles: 1, rooms: 2 })
  await app.rooms.setDraining(true)
  expect(await pendingStart).toMatchObject({ status: 'ERROR', code: 'SERVER_DRAINING' })
  await expect.poll(() => app.rooms.managementStatus.queued).toBe(0)
  expect(app.rooms.managementStatus).toMatchObject({ draining: true, activeBattles: 1 })
  expect(await ack(queued.socket, 'createPrivateRoom', { config: {} })).toMatchObject({
    status: 'ERROR',
    code: 'SERVER_DRAINING',
  })
  expect(await ack(queued.socket, 'joinMatchmaking', { playerSchema: { team } })).toMatchObject({
    status: 'ERROR',
    code: 'SERVER_DRAINING',
  })
  expect(await ack(waiting.a.socket, 'startPrivateRoomBattle', { hostTeam: team })).toMatchObject({
    status: 'ERROR',
    code: 'SERVER_DRAINING',
  })
  await success(running.a.socket, 'ready')
  await success(running.b.socket, 'ready')
  const state = await success<BattleState>(running.a.socket, 'getState')
  await success(running.a.socket, 'submitPlayerSelection', {
    type: 'surrender',
    player: running.a.session.seatId,
    requestId: 'drained-end',
    expectedTurn: state.currentTurn,
  })
  await expect.poll(() => app.rooms.managementStatus.activeBattles).toBe(0)
  await app.rooms.setDraining(false)
  await success(queued.socket, 'createPrivateRoom', { config: {} })
}, 30000)

it('allows managed UGC peer rooms without author execution and rejects mode escalation', async () => {
  const materials = await createNpmFixture({ prebuilt: true, forbidHostExecution: true })
  const marker = materials.executionMarker!
  const { app, user } = await fixture()
  try {
    const environment = await app.environments.prepareNpm(
      materials.directory,
      { policy: { profile: 'official' } },
      { effectPreparation: 'prebuilt-only' },
    )
    app.environments.setPublication(
      [{ runtimeId: environment.id, enabled: true, public: true, matchmaking: true, executionPolicy: 'peer' }],
      environment.id,
    )
    const acceptance = {
      environmentId: environment.id,
      protocolVersion: 1,
      resourceRevision: environment.resourceRevision,
      peerRevision: environment.peerRevision,
      resourcesReady: true,
    }
    const ugcTeam = [
      {
        ...team[0],
        species: 'example-slow:pet',
        skills: ['example-slow:strike'],
        ability: undefined,
        emblem: undefined,
      },
    ]
    const [a, b] = await Promise.all([user(), user()])
    expect(
      await ack(a.socket, 'createPrivateRoom', { environmentId: environment.id, config: { battleMode: 'server' } }),
    ).toMatchObject({ status: 'ERROR', code: 'ENVIRONMENT_EXECUTION_POLICY' })
    // A managed peer default must not silently fall back to the builtin environment.
    const created = await success<{ roomCode: string }>(a.socket, 'createPrivateRoom', {
      config: { battleMode: 'p2p' },
    })
    await success(b.socket, 'joinPrivateRoom', created)
    expect(await ack(a.socket, 'updatePrivateRoomConfig', { battleMode: 'server' })).toMatchObject({
      status: 'ERROR',
      code: 'ENVIRONMENT_EXECUTION_POLICY',
    })
    expect(
      await ack(b.socket, 'togglePrivateRoomReady', {
        team: ugcTeam,
        environment: { ...acceptance, peerRevision: undefined },
      }),
    ).toMatchObject({
      status: 'ERROR',
      code: 'CLIENT_PEER_ENVIRONMENT_MISMATCH',
    })
    await success(b.socket, 'togglePrivateRoomReady', { team: ugcTeam, environment: acceptance })
    await success(a.socket, 'startPrivateRoomBattle', { hostTeam: ugcTeam, environment: acceptance })
    const room = await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')
    expect(room).toMatchObject({
      status: 'started',
      environment: { id: environment.id },
      config: { battleMode: 'p2p' },
    })
    expect(app.rooms.battleWorkerStats).toMatchObject({ active: 0, queued: 0, workers: 0 })
    const delivered = app.environments.peerMaterials(environment.id)
    expect(delivered.environment.revision).toBe(environment.peerRevision)
    expect(JSON.stringify(delivered)).not.toContain(materials.directory)
    expect(JSON.stringify(delivered)).not.toContain(materials.installedDirectory)
    expect(
      delivered.environment.modules.some(module =>
        module.artifact.source.includes('AUTHOR_ARTIFACT_MUST_NOT_EXECUTE_ON_SERVER'),
      ),
    ).toBe(true)
    await expect(access(marker)).rejects.toThrow()
    app.environments.setPublication([])
    expect(app.environments.peerMaterials(environment.id)).toEqual(delivered)
    expect(await ack(a.socket, 'getState')).toMatchObject({ status: 'ERROR', code: 'BATTLE_NOT_FOUND' })
    await success(a.socket, 'finishPrivateRoomBattle', { winner: a.session.seatId, reason: 'peer-finished' })
    expect(app.rooms.managementStatus.activeBattles).toBe(0)
  } finally {
    await app.stop()
    await materials.dispose()
  }
}, 60000)

it('matches published UGC peer environments into peer rooms without allocating server Workers', async () => {
  const materials = await createNpmFixture({ prebuilt: true, forbidHostExecution: true })
  const marker = materials.executionMarker!
  const { app, user } = await fixture()
  try {
    const environment = await app.environments.prepareNpm(
      materials.directory,
      { policy: { profile: 'official' } },
      { effectPreparation: 'prebuilt-only' },
    )
    app.environments.setPublication(
      [{ runtimeId: environment.id, enabled: true, public: true, matchmaking: true, executionPolicy: 'peer' }],
      environment.id,
    )
    const acceptance = {
      environmentId: environment.id,
      protocolVersion: 1,
      resourceRevision: environment.resourceRevision,
      peerRevision: environment.peerRevision,
      resourcesReady: true,
    }
    const ugcTeam = [
      {
        ...team[0],
        species: 'example-slow:pet',
        skills: ['example-slow:strike'],
        ability: undefined,
        emblem: undefined,
      },
    ]
    const [a, b] = await Promise.all([user(), user()])
    const request = { environmentId: environment.id, environment: acceptance, playerSchema: { team: ugcTeam } }
    expect(
      await ack(a.socket, 'joinMatchmaking', {
        ...request,
        environment: { ...acceptance, peerRevision: 'unprepared' },
      }),
    ).toMatchObject({
      status: 'ERROR',
      code: 'CLIENT_PEER_ENVIRONMENT_MISMATCH',
    })
    expect(app.rooms.managementStatus.queued).toBe(0)
    await success(a.socket, 'joinMatchmaking', request)
    await success(b.socket, 'joinMatchmaking', request)
    expect(await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')).toMatchObject({
      matchmaking: true,
      status: 'started',
      config: { battleMode: 'p2p' },
      environment: { id: environment.id },
      battleHost: { playerId: a.session.seatId },
    })
    expect(app.rooms.battleWorkerStats).toMatchObject({ active: 0, queued: 0, workers: 0 })
    await expect(access(marker)).rejects.toThrow()
    expect(
      await ack(b.socket, 'finishPrivateRoomBattle', { winner: b.session.seatId, reason: 'forged' }),
    ).toMatchObject({ status: 'ERROR', code: 'NOT_HOST' })
    await success(a.socket, 'finishPrivateRoomBattle', { winner: null, reason: 'peer-finished' })
  } finally {
    await app.stop()
    await materials.dispose()
  }
}, 60000)

it('partitions queued players by captured execution policy during publication changes', async () => {
  const { app, user } = await fixture()
  const id = app.environments.descriptor().id
  const publication = { runtimeId: id, enabled: true, public: true, matchmaking: true }
  app.environments.setPublication([{ ...publication, executionPolicy: 'peer' }], id)
  const [a, b, c] = await Promise.all([user(), user(), user()])
  const descriptor = app.environments.descriptor(id)
  const request = {
    playerSchema: { team },
    environment: {
      environmentId: id,
      protocolVersion: 1,
      resourceRevision: descriptor.resourceRevision,
      peerRevision: descriptor.peerRevision,
      resourcesReady: true,
    },
  }
  await success(a.socket, 'joinMatchmaking', request)
  app.environments.setPublication([{ ...publication, executionPolicy: 'server' }], id)
  await success(b.socket, 'joinMatchmaking', request)
  expect(app.rooms.managementStatus).toMatchObject({ rooms: 0, queued: 2 })
  app.environments.setPublication([{ ...publication, executionPolicy: 'peer' }], id)
  await success(c.socket, 'joinMatchmaking', request)
  expect(app.rooms.managementStatus).toMatchObject({ rooms: 1, queued: 1 })
  expect(await success(b.socket, 'getCurrentPrivateRoom')).toBeNull()
  expect(await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')).toMatchObject({
    config: { battleMode: 'p2p' },
    status: 'started',
  })
  expect(app.rooms.battleWorkerStats.workers).toBe(0)
})

it('does not match queues captured before and after a rule-only publication change', async () => {
  const { app, user } = await fixture()
  const id = app.environments.descriptor().id
  const publication = {
    runtimeId: id,
    bindingId: 'binding',
    versionId: 'old',
    enabled: true,
    public: true,
    matchmaking: true,
    executionPolicy: 'peer' as const,
    rules: { schemaVersion: 1 as const, team: { maxSize: 6 } },
  }
  app.environments.setPublication([publication], id)
  const [a, b, c] = await Promise.all([user(), user(), user()])
  const descriptor = app.environments.descriptor(id)
  const request = {
    playerSchema: { team },
    environment: {
      environmentId: id,
      protocolVersion: 1,
      resourceRevision: descriptor.resourceRevision,
      peerRevision: descriptor.peerRevision,
      resourcesReady: true,
    },
  }
  await success(a.socket, 'joinMatchmaking', request)
  app.environments.setPublication(
    [{ ...publication, versionId: 'new', rules: { schemaVersion: 1, team: { maxSize: 5 } } }],
    id,
  )
  await success(b.socket, 'joinMatchmaking', request)
  expect(app.rooms.managementStatus).toMatchObject({ rooms: 0, queued: 2 })
  app.environments.setPublication([publication], id)
  await success(c.socket, 'joinMatchmaking', request)
  expect(app.rooms.managementStatus).toMatchObject({ rooms: 1, queued: 1 })
  expect(await success(b.socket, 'getCurrentPrivateRoom')).toBeNull()
  expect((await success<PrivateRoomInfo>(a.socket, 'getCurrentPrivateRoom')).status).toBe('started')
  expect(app.rooms.battleWorkerStats.workers).toBe(0)
})
