import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { RoomState } from '../src/cluster/types'
import { REDIS_KEYS } from '../src/cluster/types'
import { ClusterBattleService } from '../src/domain/battle/services/clusterBattleService'
import type { PlayerSelectionSchemaType } from '@arcadia-eternity/schema'
import { BattleMessageType, BattleStatus, Nature, Gender } from '@arcadia-eternity/const'

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

function createService(roomStateRef: { current: RoomState | null }) {
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

function pickSkillSelection(selections: PlayerSelectionSchemaType[]): PlayerSelectionSchemaType {
  const selection = selections.find(item => item.type === 'use-skill')
  expect(selection).toBeDefined()
  return selection!
}

describe('ClusterBattleService v2 runtime', () => {
  let roomStateRef: { current: RoomState | null }
  const player1Id = 'player_id_00000000001'
  const player2Id = 'player_id_00000000002'

  beforeEach(() => {
    roomStateRef = {
      current: createMockRoomState('room_v2_1', player1Id, player2Id),
    }
  })

  it('creates local battle using v2 and provides selections', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)

    const ownershipRaw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP('room_v2_1'))
    expect(ownershipRaw).toBeTruthy()
    const bootstrapRaw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP('room_v2_1'))
    expect(bootstrapRaw).toBeTruthy()

    const selections = await service.handleLocalGetSelection('room_v2_1', player1Id)
    expect(selections.length).toBeGreaterThan(0)
    expect(selections.some(selection => selection.type === 'surrender')).toBe(true)

    await service.handleLocalGetState('room_v2_1', player1Id)
    const snapshotRaw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_PLAYER_SNAPSHOT('room_v2_1', player1Id))
    expect(snapshotRaw).toBeTruthy()
  })

  it('auto-recovers missing local runtime on getSelection', async () => {
    const { service } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    ;(service as any).runtimeHost.remove('room_v2_1')

    const selections = await service.handleLocalGetSelection('room_v2_1', player1Id)
    expect(selections.length).toBeGreaterThan(0)
    expect(selections.some(selection => selection.type === 'use-skill')).toBe(true)
    expect(service.getLocalRoom('room_v2_1')).toBeDefined()
  })

  it('auto-recovers missing local runtime on submit selection', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    const selections = await service.handleLocalGetSelection('room_v2_1', player1Id)
    const selected = pickSkillSelection(selections)
    ;(service as any).runtimeHost.remove('room_v2_1')

    const result = await service.handleLocalPlayerSelection('room_v2_1', player1Id, selected)
    expect(result.status).toBe('ACTION_ACCEPTED')
    expect(service.getLocalRoom('room_v2_1')).toBeDefined()
    const actionLogEntries = await client.lrange(REDIS_KEYS.BATTLE_RUNTIME_ACTION_LOG('room_v2_1'), 0, -1)
    expect(actionLogEntries.length).toBe(1)
  })

  it('accepts a valid player selection through submitAction path', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)

    const selections = await service.handleLocalGetSelection('room_v2_1', player1Id)
    const selected = pickSkillSelection(selections)

    const result = await service.handleLocalPlayerSelection('room_v2_1', player1Id, selected)
    expect(result.status).toBe('ACTION_ACCEPTED')
    const actionLogEntries = await client.lrange(REDIS_KEYS.BATTLE_RUNTIME_ACTION_LOG('room_v2_1'), 0, -1)
    expect(actionLogEntries.length).toBe(1)
    const firstEntry = JSON.parse(actionLogEntries[0]!)
    expect(firstEntry.seq).toBe(1)
    expect(firstEntry.selection.player).toBe(player1Id)
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ('room_v2_1'))).toBe('1')
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'))).toBe('1')
  })

  it('supports local abandon after at least one real turn and cleans room', async () => {
    const { service, callbacks, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)

    const selectionsA = await service.handleLocalGetSelection('room_v2_1', player1Id)
    const selectionsB = await service.handleLocalGetSelection('room_v2_1', player2Id)
    await service.handleLocalGetState('room_v2_1', player1Id)
    const snapshotBefore = await client.get(REDIS_KEYS.BATTLE_RUNTIME_PLAYER_SNAPSHOT('room_v2_1', player1Id))
    expect(snapshotBefore).toBeTruthy()

    await service.handleLocalPlayerSelection('room_v2_1', player1Id, pickSkillSelection(selectionsA))
    await service.handleLocalPlayerSelection('room_v2_1', player2Id, pickSkillSelection(selectionsB))
    await client.setex(REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT('room_v2_1'), 60, '{"dummy":true}')

    const result = await service.handleLocalPlayerAbandon('room_v2_1', player1Id)
    expect(result.status).toBe('ABANDONED')
    expect(service.getLocalRoom('room_v2_1')).toBeUndefined()
    expect(callbacks.cleanupSessionRoomMappings).toHaveBeenCalled()

    const ownershipRaw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP('room_v2_1'))
    expect(ownershipRaw).toBeNull()

    const snapshotAfter = await client.get(REDIS_KEYS.BATTLE_RUNTIME_PLAYER_SNAPSHOT('room_v2_1', player1Id))
    expect(snapshotAfter).toBeNull()
    const bootstrapAfter = await client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP('room_v2_1'))
    expect(bootstrapAfter).toBeNull()
    const actionLogAfter = await client.lrange(REDIS_KEYS.BATTLE_RUNTIME_ACTION_LOG('room_v2_1'), 0, -1)
    expect(actionLogAfter.length).toBe(0)
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ('room_v2_1'))).toBeNull()
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'))).toBeNull()
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT('room_v2_1'))).toBeNull()
  })

  it('does not abandon when backup checker observes reconnect-cleaned disconnect key', async () => {
    const { service, client, stateManager } = createService(roomStateRef)
    const sessionId = 's1'
    const playerKey = `${player1Id}:${sessionId}`
    const graceTimer = setTimeout(() => {}, 60_000)

    ;(service as any).disconnectedPlayers.set(playerKey, {
      playerId: player1Id,
      sessionId,
      roomId: 'room_v2_1',
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
      roomId: 'room_v2_1',
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

  it('recovers local runtime from bootstrap payload when in-memory runtime is missing', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    ;(service as any).runtimeHost.remove('room_v2_1')
    expect(service.getLocalBattle('room_v2_1')).toBeUndefined()

    const startBattleSpy = vi.spyOn(service as any, 'startBattleAsync').mockResolvedValue(undefined)
    await client.setex(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'), 60, '99')

    const recovered = await service.recoverLocalBattleRuntime('room_v2_1')

    expect(recovered).toBe(true)
    expect(service.getLocalBattle('room_v2_1')).toBeTruthy()
    expect(startBattleSpy).toHaveBeenCalled()

    const bootstrapRaw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP('room_v2_1'))
    expect(bootstrapRaw).toBeTruthy()
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'))).toBe('0')
  })

  it('recovers local runtime from room metadata bootstrap fallback when Redis bootstrap key is missing', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    const bootstrapRaw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP('room_v2_1'))
    expect(bootstrapRaw).toBeTruthy()
    const bootstrap = JSON.parse(bootstrapRaw!)
    ;(roomStateRef.current as RoomState).metadata = {
      ...(roomStateRef.current as RoomState).metadata,
      runtimeBootstrap: {
        player1Data: bootstrap.player1Data,
        player2Data: bootstrap.player2Data,
        createdAt: bootstrap.createdAt,
      },
    }

    await client.del(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP('room_v2_1'))
    ;(service as any).runtimeHost.remove('room_v2_1')

    const recovered = await service.recoverLocalBattleRuntime('room_v2_1')

    expect(recovered).toBe(true)
    expect(service.getLocalBattle('room_v2_1')).toBeTruthy()
    const bootstrapRawAfter = await client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP('room_v2_1'))
    expect(bootstrapRawAfter).toBeTruthy()
  })

  it('preserves runtime artifacts when cleanupLocalRoom is called for ownership handoff', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)

    const bootstrapBefore = await client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP('room_v2_1'))
    expect(bootstrapBefore).toBeTruthy()

    await service.cleanupLocalRoom('room_v2_1', {
      removeRuntimeArtifacts: false,
      publishCleanupEvent: false,
    })

    expect(service.getLocalBattle('room_v2_1')).toBeUndefined()
    const bootstrapAfter = await client.get(REDIS_KEYS.BATTLE_RUNTIME_BOOTSTRAP('room_v2_1'))
    expect(bootstrapAfter).toBeTruthy()
  })

  it('replays persisted action journal during recovery and keeps replay cursor at last seq', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)

    const p1Selections = await service.handleLocalGetSelection('room_v2_1', player1Id)
    const p2Selections = await service.handleLocalGetSelection('room_v2_1', player2Id)
    await service.handleLocalPlayerSelection('room_v2_1', player1Id, pickSkillSelection(p1Selections))
    await service.handleLocalPlayerSelection('room_v2_1', player2Id, pickSkillSelection(p2Selections))

    const actionLogEntries = await client.lrange(REDIS_KEYS.BATTLE_RUNTIME_ACTION_LOG('room_v2_1'), 0, -1)
    expect(actionLogEntries).toHaveLength(2)
    expect(JSON.parse(actionLogEntries[0]!).seq).toBe(1)
    expect(JSON.parse(actionLogEntries[1]!).seq).toBe(2)
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ('room_v2_1'))).toBe('2')
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'))).toBe('2')

    ;(service as any).runtimeHost.remove('room_v2_1')
    const startBattleSpy = vi.spyOn(service as any, 'startBattleAsync').mockResolvedValue(undefined)

    const recovered = await service.recoverLocalBattleRuntime('room_v2_1')
    expect(recovered).toBe(true)
    expect(startBattleSpy).toHaveBeenCalled()
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'))).toBe('2')
  })

  it('uses runtime world snapshot actionSeq as recovery replay baseline when available', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const runtimeSnapshot = {
      format: 'arcadia.battle.v2.world',
      version: 1,
      payload: '{"meta":"test"}',
    }
    const restoreSnapshotSpy = vi.fn(async () => {})
    const originalCreateLocalBattle = service.createLocalBattle.bind(service)
    vi.spyOn(service, 'createLocalBattle').mockImplementation(async (...args: any[]) => {
      const battle = await originalCreateLocalBattle(...args)
      ;(battle as any).createRuntimeSnapshot = vi.fn(async () => runtimeSnapshot)
      ;(battle as any).restoreRuntimeSnapshot = restoreSnapshotSpy
      return battle
    })

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    await client.setex(
      REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT('room_v2_1'),
      60,
      JSON.stringify({
        ...runtimeSnapshot,
        actionSeq: 5,
        capturedAt: Date.now(),
      }),
    )
    await client.setex(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ('room_v2_1'), 60, '5')

    ;(service as any).runtimeHost.remove('room_v2_1')
    const startBattleSpy = vi.spyOn(service as any, 'startBattleAsync').mockResolvedValue(undefined)

    const recovered = await service.recoverLocalBattleRuntime('room_v2_1')
    expect(recovered).toBe(true)
    expect(startBattleSpy).toHaveBeenCalled()
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'))).toBe('5')
    expect(restoreSnapshotSpy).toHaveBeenCalled()
  })

  it('persists runtime world snapshot boundary metadata', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)

    const battle = service.getLocalBattle('room_v2_1')
    expect(battle).toBeTruthy()

    await (service as any).persistBattleRuntimeWorldSnapshot('room_v2_1', battle, BattleMessageType.TurnEnd)

    const raw = await client.get(REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT('room_v2_1'))
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.boundary?.triggerMessageType).toBe(BattleMessageType.TurnEnd)
    expect(typeof parsed.boundary?.battleStatus).toBe('string')
    expect(typeof parsed.boundary?.currentTurn).toBe('number')
  })

  it('clamps snapshot replay baseline to latest action seq when snapshot seq is ahead', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const runtimeSnapshot = {
      format: 'arcadia.battle.v2.world',
      version: 1,
      payload: '{"meta":"test"}',
    }
    const restoreSnapshotSpy = vi.fn(async () => {})
    const originalCreateLocalBattle = service.createLocalBattle.bind(service)
    vi.spyOn(service, 'createLocalBattle').mockImplementation(async (...args: any[]) => {
      const battle = await originalCreateLocalBattle(...args)
      ;(battle as any).createRuntimeSnapshot = vi.fn(async () => runtimeSnapshot)
      ;(battle as any).restoreRuntimeSnapshot = restoreSnapshotSpy
      return battle
    })

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    await client.setex(
      REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT('room_v2_1'),
      60,
      JSON.stringify({
        ...runtimeSnapshot,
        actionSeq: 9,
        capturedAt: Date.now(),
      }),
    )
    await client.setex(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ('room_v2_1'), 60, '3')

    ;(service as any).runtimeHost.remove('room_v2_1')
    const startBattleSpy = vi.spyOn(service as any, 'startBattleAsync').mockResolvedValue(undefined)

    const recovered = await service.recoverLocalBattleRuntime('room_v2_1')
    expect(recovered).toBe(true)
    expect(startBattleSpy).toHaveBeenCalled()
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'))).toBe('3')
    expect(restoreSnapshotSpy).toHaveBeenCalled()
  })

  it('skips battle loop restart when recovered snapshot is already terminal boundary', async () => {
    const { service, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const runtimeSnapshot = {
      format: 'arcadia.battle.v2.world',
      version: 1,
      payload: '{"meta":"test"}',
    }
    const restoreSnapshotSpy = vi.fn(async () => {})
    const originalCreateLocalBattle = service.createLocalBattle.bind(service)
    vi.spyOn(service, 'createLocalBattle').mockImplementation(async (...args: any[]) => {
      const battle = await originalCreateLocalBattle(...args)
      ;(battle as any).createRuntimeSnapshot = vi.fn(async () => runtimeSnapshot)
      ;(battle as any).restoreRuntimeSnapshot = restoreSnapshotSpy
      return battle
    })

    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    await client.setex(
      REDIS_KEYS.BATTLE_RUNTIME_WORLD_SNAPSHOT('room_v2_1'),
      60,
      JSON.stringify({
        ...runtimeSnapshot,
        actionSeq: 4,
        capturedAt: Date.now(),
        boundary: {
          triggerMessageType: BattleMessageType.BattleEnd,
          battleStatus: BattleStatus.Ended,
          currentTurn: 8,
          currentPhase: 'execution',
        },
      }),
    )
    await client.setex(REDIS_KEYS.BATTLE_RUNTIME_ACTION_SEQ('room_v2_1'), 60, '4')

    ;(service as any).runtimeHost.remove('room_v2_1')
    const startBattleSpy = vi.spyOn(service as any, 'startBattleAsync').mockResolvedValue(undefined)

    const recovered = await service.recoverLocalBattleRuntime('room_v2_1')
    expect(recovered).toBe(true)
    expect(startBattleSpy).not.toHaveBeenCalled()
    expect(await client.get(REDIS_KEYS.BATTLE_RUNTIME_REPLAY_CURSOR('room_v2_1'))).toBe('4')
    expect(restoreSnapshotSpy).toHaveBeenCalled()
    expect(service.getLocalRoom('room_v2_1')?.status).toBe('ended')
  })

  it('refreshes ownership lease for local runtime and keeps runtime when ownership unchanged', async () => {
    const { service } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)

    const claimMock = vi.fn(async () => ({
      roomId: 'room_v2_1',
      ownerInstanceId: 'test-instance',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))
    ;(service as any).ownershipCoordinator = {
      claim: claimMock,
      get: vi.fn(),
      markDraining: vi.fn(),
      release: vi.fn(),
    }

    await (service as any).refreshLocalRuntimeOwnershipLeases()
    expect(claimMock).toHaveBeenCalledWith('room_v2_1', 'test-instance')
    expect(service.getLocalBattle('room_v2_1')).toBeTruthy()
  })

  it('preempts stale ownership and keeps local runtime when claimed owner instance is unavailable', async () => {
    const { service, stateManager, client } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    expect(service.getLocalBattle('room_v2_1')).toBeTruthy()

    roomStateRef.current = {
      ...(roomStateRef.current as RoomState),
      instanceId: 'instance-b',
    }

    const claimMock = vi.fn(async () => ({
      roomId: 'room_v2_1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))
    ;(service as any).ownershipCoordinator = {
      claim: claimMock,
      get: vi.fn(),
      markDraining: vi.fn(),
      release: vi.fn(),
    }
    ;(stateManager as any).getInstance = vi.fn(async () => null)

    await (service as any).refreshLocalRuntimeOwnershipLeases()

    expect(service.getLocalBattle('room_v2_1')).toBeTruthy()
    expect(stateManager.setRoomState).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'test-instance' }))
    expect(client.setex).toHaveBeenCalledWith(
      REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP('room_v2_1'),
      expect.any(Number),
      expect.any(String),
    )
  })

  it('drops local runtime when lease refresh detects ownership moved to another instance', async () => {
    const { service, stateManager } = createService(roomStateRef)
    const p1 = createPlayerLike(player1Id, 'P1', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    const p2 = createPlayerLike(player2Id, 'P2', 'pet_dilan', ['skill_paida', 'skill_shuipao'])
    await service.createLocalBattle(roomStateRef.current!, p1 as any, p2 as any)
    expect(service.getLocalBattle('room_v2_1')).toBeTruthy()

    const claimMock = vi.fn(async () => ({
      roomId: 'room_v2_1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))
    ;(service as any).ownershipCoordinator = {
      claim: claimMock,
      get: vi.fn(),
      markDraining: vi.fn(),
      release: vi.fn(),
    }

    await (service as any).refreshLocalRuntimeOwnershipLeases()

    expect(service.getLocalBattle('room_v2_1')).toBeUndefined()
    expect(stateManager.setRoomState).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'instance-b' }))
  })
})
