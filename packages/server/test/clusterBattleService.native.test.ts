import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AttributeSystem, setGlobalLogger as setNativeLogger } from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { LocalBattleRoomData } from '../src/domain/battle/runtime/battleRuntimeHost'
import type { RoomState } from '../src/cluster/types'
import { REDIS_KEYS } from '../src/cluster/types'
import { ClusterBattleService } from '../src/domain/battle/services/clusterBattleService'
import { BattleMessageType, BattleStatus, Nature, Gender, type playerId } from '@arcadia-eternity/const'

function createMockRoomState(roomId: string, player1Id: string, player2Id: string): RoomState {
  return {
    id: roomId,
    status: 'active',
    sessions: ['s1', 's2'],
    sessionPlayers: {
      s1: player1Id,
      s2: player2Id,
    },
    instanceId: 'test-instance',
    lastActive: Date.now(),
    battleState: undefined,
    spectators: [],
    metadata: {
      createdAt: Date.now(),
      ruleSetId: 'casual_standard_ruleset',
    },
  }
}

function toNanoIdLike(seed: string): string {
  const sanitized = seed.replace(/[^A-Za-z0-9_-]/g, '')
  if (sanitized.length >= 21) {
    return sanitized.slice(0, 21)
  }
  return (sanitized + 'x'.repeat(21)).slice(0, 21)
}

function createPlayerLike(id: string, name: string, speciesId: string, skillIds: string[]) {
  return {
    id,
    name,
    team: [
      {
        id: toNanoIdLike(`${id}_pet_1`),
        name: `${name}_pet`,
        species: speciesId,
        level: 100,
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        skills: skillIds,
        gender: Gender.Male,
        nature: Nature.Hardy,
        ability: 'mark_ability_zhongjie',
        emblem: 'mark_emblem_zhuiji',
        height: 50,
        weight: 10,
      },
    ],
  }
}

function createTestService(roomStateRef: { current: RoomState | null }) {
  const kv = new Map<string, string>()
  const listKv = new Map<string, string[]>()

  const subscriber = {
    subscribe: (_channel: string, cb: (err?: Error | null) => void) => cb(null),
    on: vi.fn(),
  }

  const publisher = {
    publish: vi.fn().mockResolvedValue(1),
  }

  const client = {
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    pttl: vi.fn(async (key: string) => (kv.has(key) ? 1_000 : -2)),
    incr: vi.fn(async (key: string) => {
      const current = Number(kv.get(key) ?? '0')
      const next = current + 1
      kv.set(key, String(next))
      return next
    }),
    set: vi.fn(async (key: string, value: string, ...args: Array<string | number>) => {
      const hasNx = args.includes('NX')
      if (hasNx && kv.has(key)) {
        return null
      }
      kv.set(key, value)
      return 'OK'
    }),
    setex: vi.fn(async (key: string, _seconds: number, value: string) => {
      kv.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (key: string) => {
      const deleted = kv.delete(key)
      listKv.delete(key)
      return deleted ? 1 : 0
    }),
    rpush: vi.fn(async (key: string, value: string) => {
      const current = listKv.get(key) ?? []
      current.push(value)
      listKv.set(key, current)
      return current.length
    }),
    lrange: vi.fn(async (key: string, start: number, stop: number) => {
      const current = listKv.get(key) ?? []
      const normalizedStop = stop === -1 ? current.length - 1 : stop
      return current.slice(start, normalizedStop + 1)
    }),
    expire: vi.fn(async () => 1),
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    smembers: vi.fn(async () => []),
  }

  const stateManager = {
    redisManager: {
      getSubscriber: () => subscriber,
      getPublisher: () => publisher,
      getClient: () => client,
    },
    getRoomState: vi.fn(async (roomId: string) => {
      if (roomStateRef.current?.id !== roomId) return null
      return roomStateRef.current
    }),
    setRoomState: vi.fn(async (roomState: RoomState) => {
      roomStateRef.current = roomState
    }),
    removeRoomState: vi.fn(async () => {}),
    getInstance: vi.fn(async (instanceId: string) => ({
      id: instanceId,
      host: '127.0.0.1',
      port: 0,
      status: 'healthy',
      lastHeartbeat: Date.now(),
      connections: 0,
      load: 0,
      performance: {
        cpuUsage: 0,
        memoryUsage: 0,
        memoryUsedMB: 0,
        memoryTotalMB: 0,
        activeBattles: 0,
        queuedPlayers: 0,
        avgResponseTime: 0,
        errorRate: 0,
        lastUpdated: Date.now(),
      },
    })),
    getPlayerConnectionBySession: vi.fn(async () => null),
  }

  const lockManager = {
    withLock: async (_key: string, fn: () => Promise<any>) => fn(),
  }

  const socketAdapter = {
    getLocalSessionIds: vi.fn(async () => new Set<string>()),
  }

  const callbacks = {
    sendToPlayerSession: vi.fn(async () => true),
    addToBatch: vi.fn(async () => {}),
    cleanupSessionRoomMappings: vi.fn(async () => {}),
    forwardPlayerAction: vi.fn(async () => ({})),
    createSessionRoomMappings: vi.fn(async () => {}),
    joinPlayerToRoom: vi.fn(async () => {}),
  }

  const sessionStateManager = {
    batchUpdateSessionStates: vi.fn(async () => {}),
  }

  const service = new ClusterBattleService(
    stateManager as any,
    lockManager as any,
    socketAdapter as any,
    callbacks as any,
    'test-instance',
    sessionStateManager as any,
    undefined,
    undefined,
  )

  return { service, callbacks, client, stateManager }
}

describe('ClusterBattleService disconnect handling', () => {
  const services: ClusterBattleService[] = []
  function createService(ref: { current: RoomState | null }) {
    const fixture = createTestService(ref)
    services.push(fixture.service)
    return fixture
  }
  afterEach(async () => {
    for (const service of services.splice(0)) await service.cleanup()
  })
  let roomStateRef: { current: RoomState | null }
  const player1Id = 'player_id_00000000001'
  const player2Id = 'player_id_00000000002'

  beforeEach(() => {
    roomStateRef = {
      current: createMockRoomState('room_disconnect_1', player1Id, player2Id),
    }
  })

  it('does not abandon when backup checker observes reconnect-cleaned disconnect key', async () => {
    const { service, client, stateManager } = createService(roomStateRef)
    const sessionId = 's1'
    const playerKey = `${player1Id}:${sessionId}`
    const graceTimer = setTimeout(() => {}, 60_000)

    ;(service as any).disconnectedPlayers.set(playerKey, {
      playerId: player1Id,
      sessionId,
      roomId: 'room_disconnect_1',
      disconnectTime: Date.now(),
      graceTimer,
    })
    ;(client.pttl as any).mockResolvedValueOnce(-2)
    ;(stateManager.getPlayerConnectionBySession as any).mockResolvedValueOnce({
      instanceId: 'instance-b',
      socketId: 'socket-1',
      lastSeen: Date.now(),
      status: 'connected',
      sessionId,
    })

    const abandonSpy = vi.spyOn(service as any, 'handlePlayerAbandonmentAfterTTLExpiry')
    await (service as any).checkAndHandleExpiredPlayer(playerKey)

    expect(abandonSpy).not.toHaveBeenCalled()
    expect((service as any).disconnectedPlayers.has(playerKey)).toBe(false)
  })

  it('does not abandon when disconnect session binding is no longer active', async () => {
    const { service, client, stateManager } = createService(roomStateRef)
    const sessionId = 's1'
    const playerKey = `${player1Id}:${sessionId}`
    const graceTimer = setTimeout(() => {}, 60_000)

    ;(service as any).disconnectedPlayers.set(playerKey, {
      playerId: player1Id,
      sessionId,
      roomId: 'room_disconnect_1',
      disconnectTime: Date.now(),
      graceTimer,
    })
    ;(client.pttl as any).mockResolvedValueOnce(-2)
    ;(stateManager.getPlayerConnectionBySession as any).mockResolvedValueOnce({
      instanceId: 'instance-a',
      socketId: 'socket-2',
      lastSeen: Date.now(),
      status: 'disconnected',
      sessionId,
    })
    ;(stateManager.getRoomState as any).mockResolvedValueOnce(null)

    const abandonSpy = vi.spyOn(service as any, 'handlePlayerAbandonmentAfterTTLExpiry')
    await (service as any).checkAndHandleExpiredPlayer(playerKey)

    expect(abandonSpy).not.toHaveBeenCalled()
    expect((service as any).disconnectedPlayers.has(playerKey)).toBe(false)
  })
})

describe('ClusterBattleService native bootstrap persistence', () => {
  const id = 'room_native_1',
    a = 'player_id_00000000001',
    b = 'player_id_00000000002'
  const services: ClusterBattleService[] = []
  let baseline = 0
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 23))
    setNativeLogger({ debug() {}, info() {}, warn() {}, error() {} })
    baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
  })
  afterEach(async () => {
    for (const service of services.splice(0)) await service.cleanup()
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
  function fixture() {
    const ref = { current: createMockRoomState(id, a, b) as RoomState | null },
      f = createTestService(ref)
    services.push(f.service)
    const players = [a, b].map((player, index) =>
      createPlayerLike(player, `Native${index}`, 'pet_dilan', ['skill_paida', 'skill_shuipao']),
    )
    const create = () => f.service.createLocalBattle(ref.current!, players[0], players[1])
    const internals = f.service as unknown as {
      startBattleAsync(
        roomId: string,
        room: LocalBattleRoomData,
        options?: { preserveReconnectGrace?: boolean },
      ): Promise<void>
      persistBattleRuntimeWorldSnapshot(roomId: string, battle: IBattleSystem, type: BattleMessageType): Promise<void>
      readBattleRuntimeWorldSnapshot(roomId: string): Promise<unknown>
      readRuntimeInflightPhase(roomId: string): Promise<unknown>
    }
    return { ...f, ref, create, internals, players }
  }
  const readBootstrap = async (f: ReturnType<typeof fixture>) =>
    JSON.parse((await f.client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(id)))!)
  const drop = (f: ReturnType<typeof fixture>) =>
    f.service.cleanupLocalRoom(id, { removeRuntimeArtifacts: false, publishCleanupEvent: false })
  function ready(system: IBattleSystem) {
    return new Promise<void>(resolve => {
      const off = system.BattleEvent(message => {
        if (message.type === BattleMessageType.TurnAction) {
          off()
          resolve()
        }
      })
    })
  }
  it('persists the complete native authority before publishing the live instance', async () => {
    const f = fixture(),
      original = f.client.setex.getMockImplementation()!
    f.client.setex.mockImplementation(async (...args) => {
      if (args[0] === REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(id)) expect(f.service.getLocalBattle(id)).toBeUndefined()
      return original(...args)
    })
    const system = await f.create(),
      bootstrap = await readBootstrap(f)
    expect(system).toBeInstanceOf(LocalBattleSystemV4)
    expect(bootstrap.runtime.kind).toBe('native-v4')
    expect(JSON.parse(bootstrap.initial.payload).battle.boundary).toBe('initial')
    const mirrored = f.ref.current!.metadata!.runtimeBootstrap
    expect(JSON.parse(JSON.stringify(mirrored)).initial).toEqual(bootstrap.initial)
    expect(f.service.getLocalRoom(id)?.runtimeIdentity?.kind).toBe('native-v4')
    expect((await system.getState()).status).toBe(BattleStatus.Unstarted)
  })
  it('keeps native metadata through cluster-room activation and recovery without the Redis bootstrap', async () => {
    const f = fixture(),
      writes: RoomState[] = []
    // Redis returns copies. Sharing a mutable fixture object would hide the activation overwrite bug.
    f.stateManager.getRoomState.mockImplementation(async roomId =>
      f.ref.current?.id === roomId ? structuredClone(f.ref.current) : null,
    )
    f.stateManager.setRoomState.mockImplementation(async room => {
      writes.push(structuredClone(room))
      f.ref.current = structuredClone(room)
    })
    const entries = [a, b].map((playerId, index) => ({
        playerId,
        playerData: f.players[index],
        sessionId: `s${index + 1}`,
        joinTime: Date.now(),
      })),
      roomId = await f.service.createClusterBattleRoom(entries[0], entries[1])
    expect(roomId).toBeTruthy()
    if (!roomId) throw new Error('Expected created cluster room')
    expect(writes[0].status).toBe('waiting')
    expect(writes[0].metadata?.runtimeBootstrap).toBeUndefined()
    const active = writes.find(room => room.status === 'active')!
    expect(active.metadata?.runtimeBootstrap).toMatchObject({
      runtime: { kind: 'native-v4' },
      initial: { format: 'arcadia.battle.native.v4', version: 3 },
    })
    const source = f.service.getLocalBattle(roomId)!
    expect(source).toBeInstanceOf(LocalBattleSystemV4)
    const original = await source.getState(undefined, true)
    await f.service.cleanupLocalRoom(roomId, { removeRuntimeArtifacts: false, publishCleanupEvent: false })
    await f.client.del(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(roomId))
    vi.spyOn(f.internals, 'startBattleAsync').mockResolvedValue(undefined)
    expect(await f.service.recoverLocalBattleRuntime(roomId)).toBe(true)
    expect(await f.service.getLocalBattle(roomId)!.getState(undefined, true)).toEqual(original)
  })
  it('abandons a native battle after a real turn and releases its delayed cleanup work', async () => {
    const f = fixture(),
      source = await f.create()
    await f.service.handleLocalReady(id, a)
    await f.service.handleLocalReady(id, b)
    await source.ready()
    const actions = await Promise.all(
      [a, b].map(
        async player =>
          (await source.getAvailableSelection(player as playerId)).find(action => action.type === 'use-skill')!,
      ),
    )
    for (const action of [...actions, actions[0]]) await f.service.handleLocalPlayerSelection(id, action.player, action)
    expect((await source.getState()).currentTurn).toBe(1)
    expect(await f.service.handleLocalPlayerAbandon(id, a)).toEqual({ status: 'ABANDONED' })
    expect(f.service.getLocalBattle(id)).toBeUndefined()
    expect(f.callbacks.cleanupSessionRoomMappings).toHaveBeenCalled()
  })
  for (const mirror of [false, true])
    it(`selects the original native runtime and IDs during recovery, metadata fallback=${mirror}`, async () => {
      const f = fixture(),
        source = await f.create(),
        bootstrap = await readBootstrap(f)
      const originalState = await source.getState(undefined, true)
      expect(originalState.players.flatMap(player => player.team?.flatMap(pet => pet.skills ?? []) ?? [])).toHaveLength(
        4,
      )
      await drop(f)
      if (mirror) await f.client.del(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(id))
      vi.spyOn(f.internals, 'startBattleAsync').mockResolvedValue(undefined)
      expect(await f.service.recoverLocalBattleRuntime(id)).toBe(true)
      const restored = f.service.getLocalBattle(id)!
      expect(restored).toBeInstanceOf(LocalBattleSystemV4)
      expect(await restored.getState(undefined, true)).toEqual(originalState)
      expect((await readBootstrap(f)).initial).toEqual(bootstrap.initial)
    })
  it('refuses publication if both native bootstrap stores fail', async () => {
    const f = fixture()
    f.client.setex.mockRejectedValue(new Error('Storage unavailable'))
    f.stateManager.setRoomState.mockRejectedValue(new Error('Storage unavailable'))
    await expect(f.create()).rejects.toThrow('bootstrap could not be persisted')
    expect(f.service.getLocalBattle(id)).toBeUndefined()
  })
  for (const corruption of ['build', 'missing-initial'])
    it(`does not reinterpret a damaged native bootstrap as V2: ${corruption}`, async () => {
      const f = fixture()
      await f.create()
      const bootstrap = await readBootstrap(f)
      await drop(f)
      if (corruption === 'build') bootstrap.runtime.build.coreBuildId = '0'.repeat(64)
      else delete bootstrap.initial
      const raw = JSON.stringify(bootstrap)
      await f.client.setex(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(id), 60, raw)
      expect(await f.service.recoverLocalBattleRuntime(id)).toBe(false)
      expect(f.service.getLocalBattle(id)).toBeUndefined()
      expect(await f.client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(id))).toBe(raw)
    })
  for (const failure of ['ready', 'getState'] as const)
    it(`retains the original journal if native startup fails at ${failure}`, async () => {
      const f = fixture()
      await f.create()
      const raw = await f.client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(id))
      await drop(f)
      const failing = vi
        .spyOn(LocalBattleSystemV4.prototype, failure)
        .mockRejectedValueOnce(new Error('Startup failed'))
      expect(await f.service.recoverLocalBattleRuntime(id)).toBe(false)
      expect(f.service.getLocalBattle(id)).toBeUndefined()
      expect(await f.client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP(id))).toBe(raw)
      failing.mockRestore()
    })
  it('restores a usable latest native checkpoint without repeating the accepted action', async () => {
    const f = fixture(),
      source = await f.create()
    vi.spyOn(f.internals, 'persistBattleRuntimeWorldSnapshot').mockResolvedValue(undefined)
    const prompt = ready(source)
    await source.ready()
    await prompt
    const action = (await source.getAvailableSelection(a as playerId)).find(
      selection => selection.type === 'use-skill',
    )!
    await f.service.handleLocalPlayerSelection(id, a, action)
    const latest = await source.createRuntimeSnapshot!()
    await f.client.setex(
      REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT(id),
      60,
      JSON.stringify({ ...latest, actionSeq: 1, capturedAt: Date.now() }),
    )
    expect(await f.internals.readBattleRuntimeWorldSnapshot(id)).toMatchObject(latest)
    await drop(f)
    const restoring = vi.spyOn(LocalBattleSystemV4.prototype, 'restoreRuntimeSnapshot')
    expect(await f.service.recoverLocalBattleRuntime(id)).toBe(true)
    expect(restoring).toHaveBeenCalledTimes(1)
    expect(restoring.mock.calls[0][0].payload).toBe(latest.payload)
    const payload = JSON.parse((await f.service.getLocalBattle(id)!.createRuntimeSnapshot!()).payload).battle
    expect(Object.keys(payload.nodes[payload.nodes[payload.root.ref].fields.actionLog.ref].fields)).toHaveLength(1)
    expect(await f.client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR(id))).toBe('1')
    restoring.mockRestore()
  })
  for (const checkpoint of ['initial', 'latest', 'corrupt', 'automatic'] as const)
    it(`replays a real multi-turn native journal from ${checkpoint} with the original state and RNG`, async () => {
      const f = fixture(),
        source = await f.create()
      if (checkpoint !== 'automatic')
        vi.spyOn(f.internals, 'persistBattleRuntimeWorldSnapshot').mockResolvedValue(undefined)
      await f.service.handleLocalReady(id, a)
      await f.service.handleLocalReady(id, b)
      await source.ready()
      const actions = await Promise.all(
        [a, b].map(
          async player =>
            (await source.getAvailableSelection(player as playerId)).find(selection => selection.type === 'use-skill')!,
        ),
      )
      for (let index = 0; index < 5; index++) {
        const action = actions[index % 2]
        await f.service.handleLocalPlayerSelection(id, action.player, action)
        if (index === 2 && (checkpoint === 'latest' || checkpoint === 'corrupt')) {
          const saved = await source.createRuntimeSnapshot!()
          await f.client.setex(
            REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT(id),
            60,
            JSON.stringify({
              ...saved,
              payload: checkpoint === 'corrupt' ? '{' : saved.payload,
              actionSeq: 3,
              capturedAt: Date.now(),
            }),
          )
        }
      }
      const expected = await source.getState(undefined, true),
        expectedFrame = JSON.parse((await source.createRuntimeSnapshot!()).payload).battle
      expect(expected.currentTurn).toBe(2)
      if (checkpoint === 'automatic') {
        await f.internals.persistBattleRuntimeWorldSnapshot(id, source, BattleMessageType.TurnAction)
        expect(await f.internals.readBattleRuntimeWorldSnapshot(id)).toMatchObject({
          format: 'arcadia.battle.native.v4',
          actionSeq: 5,
        })
      }
      await drop(f)
      expect(await f.service.recoverLocalBattleRuntime(id)).toBe(true)
      const restored = f.service.getLocalBattle(id)!,
        frame = JSON.parse((await restored.createRuntimeSnapshot!()).payload).battle
      expect(await restored.getState(undefined, true)).toEqual(expected)
      const expectedRng = expectedFrame.nodes[expectedFrame.nodes[expectedFrame.root.ref].fields.rngState.ref].fields,
        restoredRng = frame.nodes[frame.nodes[frame.root.ref].fields.rngState.ref].fields
      expect(expectedRng).toMatchObject({ algorithm: 'sfc32-v1' })
      expect(restoredRng).toEqual(expectedRng)
      expect(await f.client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR(id))).toBe('5')
      expect(Object.keys(frame.nodes[frame.nodes[frame.root.ref].fields.actionLog.ref].fields)).toHaveLength(5)
    })
  it('uses the initial state before replay when an inflight baseline predates the latest native snapshot', async () => {
    const f = fixture(),
      source = await f.create(),
      initial = (await readBootstrap(f)).initial
    vi.spyOn(f.internals, 'persistBattleRuntimeWorldSnapshot').mockResolvedValue(undefined)
    let prompt = ready(source)
    await source.ready()
    await prompt
    const action = (await source.getAvailableSelection(a as playerId)).find(
      selection => selection.type === 'use-skill',
    )!
    await f.service.handleLocalPlayerSelection(id, a, action)
    const latest = await source.createRuntimeSnapshot!()
    await f.client.setex(
      REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT(id),
      60,
      JSON.stringify({ ...latest, actionSeq: 1, capturedAt: Date.now() }),
    )
    await f.client.setex(
      REDIS_KEYS.BATTLE_RUNTIME_INFLIGHT_PHASE(id),
      60,
      JSON.stringify({
        format: 'arcadia.battle.v2.phase-inflight',
        version: 1,
        roomId: id,
        ownerInstanceId: 'test-instance',
        phaseId: 'native-turn',
        phaseType: 'turn',
        stackDepth: 1,
        replayBaselineSeq: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      }),
    )
    expect(await f.internals.readBattleRuntimeWorldSnapshot(id)).toMatchObject(latest)
    expect(await f.internals.readRuntimeInflightPhase(id)).toMatchObject({ replayBaselineSeq: 0 })
    await drop(f)
    const restoring = vi.spyOn(LocalBattleSystemV4.prototype, 'restoreRuntimeSnapshot')
    vi.spyOn(f.internals, 'startBattleAsync').mockImplementation(async () => {
      const system = f.service.getLocalBattle(id)!
      prompt = ready(system)
      await system.ready()
      await prompt
    })
    expect(await f.service.recoverLocalBattleRuntime(id)).toBe(true)
    expect(restoring.mock.calls[0][0].payload).toBe(initial.payload)
    const payload = JSON.parse((await f.service.getLocalBattle(id)!.createRuntimeSnapshot!()).payload).battle
    expect(Object.keys(payload.nodes[payload.nodes[payload.root.ref].fields.actionLog.ref].fields)).toHaveLength(1)
    restoring.mockRestore()
  })
})
