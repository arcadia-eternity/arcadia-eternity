import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nanoid } from 'nanoid'
import type { MatchmakingEntry } from '../src/cluster/types'
import { ClusterMatchmakingService } from '../src/domain/matching/services/clusterMatchmakingService'
import { PrivateRoomService } from '../src/domain/room/services/privateRoomService'
import { REDIS_KEYS } from '../src/cluster/types'
import { ServerRuleIntegration } from '@arcadia-eternity/rules'
import type { PlayerSchemaType, SendPrivateRoomPeerSignalRequest } from '@arcadia-eternity/protocol'
import type { RoomPlayer } from '../src/domain/room/types/PrivateRoom'

class FakeRedisClient {
  private readonly strings = new Map<string, string>()
  private readonly sets = new Map<string, Set<string>>()
  public readonly published: Array<{ channel: string; message: string }> = []

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null
  }

  async setex(key: string, _ttl: number, value: string): Promise<void> {
    this.strings.set(key, value)
  }

  async sadd(key: string, value: string): Promise<void> {
    const set = this.sets.get(key) ?? new Set<string>()
    set.add(value)
    this.sets.set(key, set)
  }

  async srem(key: string, value: string): Promise<void> {
    this.sets.get(key)?.delete(value)
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? new Set<string>())]
  }

  async scard(key: string): Promise<number> {
    return (this.sets.get(key) ?? new Set<string>()).size
  }

  async hset(_key: string, _value: unknown): Promise<void> {
    // no-op for tests
  }

  async hgetall(_key: string): Promise<Record<string, string>> {
    return {}
  }

  async pexpire(_key: string, _ttl: number): Promise<void> {
    // no-op for tests
  }

  async expire(_key: string, _ttl: number): Promise<void> {
    // no-op for tests
  }

  async del(key: string): Promise<void> {
    this.strings.delete(key)
    this.sets.delete(key)
  }

  async keys(pattern: string): Promise<string[]> {
    if (!pattern.includes('*')) {
      return this.strings.has(pattern) ? [pattern] : []
    }
    const prefix = pattern.split('*')[0]
    return [...this.strings.keys()].filter(key => key.startsWith(prefix))
  }

  async publish(channel: string, message: string): Promise<void> {
    this.published.push({ channel, message })
  }

  subscribe(_channel: string, cb?: (err?: Error | null) => void): void {
    cb?.(null)
  }

  psubscribe(_pattern: string): void {
    // no-op for tests
  }

  on(_event: string, _handler: (...args: unknown[]) => void): void {
    // no-op for tests
  }
}

function buildPlayerSchema(playerId: string, trainerName: string): PlayerSchemaType {
  const evs = { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }
  const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
  const species = ['pet_dilan', 'pet_didilan', 'pet_dilante', 'pet_xiuxiu', 'pet_xiuyier', 'pet_xiuluosi']

  return {
    id: playerId,
    name: trainerName,
    team: species.map((petSpecies, index) => ({
      id: nanoid(),
      name: `${trainerName}-${index + 1}`,
      species: petSpecies,
      level: 100,
      evs,
      ivs,
      nature: 'Jolly',
      gender: 'Male',
      skills: [],
      ability: 'mark_ability_zhongjie',
      emblem: 'mark_emblem_zhuiji',
      height: 100,
      weight: 50,
    })),
  }
}

function createRoomPlayer(overrides: Partial<RoomPlayer> = {}): RoomPlayer {
  return {
    playerId: overrides.playerId ?? 'player-1',
    playerName: overrides.playerName ?? 'Player 1',
    sessionId: overrides.sessionId ?? 'session-1',
    isReady: overrides.isReady ?? false,
    joinedAt: overrides.joinedAt ?? Date.now(),
    connectionStatus: overrides.connectionStatus ?? 'online',
    team: overrides.team,
  }
}

describe('Cluster multi-instance e2e (mock)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(ServerRuleIntegration, 'validateTeamWithRuleSet').mockResolvedValue({
      isValid: true,
      errors: [],
    } as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('matches two players from different instances and emits matchSuccess by session', async () => {
    const playerAId = nanoid()
    const playerBId = nanoid()
    const sessionA = 'session-a'
    const sessionB = 'session-b'

    const queueByRule = new Map<string, MatchmakingEntry[]>()
    const connectionBySession = new Map<
      string,
      { playerId: string; sessionId: string; status: 'connected'; instanceId: string }
    >()

    const addConnection = (playerId: string, sessionId: string, instanceId: string) => {
      connectionBySession.set(`${playerId}:${sessionId}`, {
        playerId,
        sessionId,
        status: 'connected',
        instanceId,
      })
    }

    const stateManager = {
      addToMatchmakingQueue: vi.fn(async (entry: MatchmakingEntry) => {
        const ruleSetId = entry.ruleSetId || 'standard'
        const queue = queueByRule.get(ruleSetId) ?? []
        queue.push(entry)
        queueByRule.set(ruleSetId, queue)
      }),
      getRuleBasedQueue: vi.fn(async (ruleSetId: string) => [...(queueByRule.get(ruleSetId) ?? [])]),
      getActiveRuleSetIds: vi.fn(async () =>
        [...queueByRule.entries()].filter(([, queue]) => queue.length > 0).map(([ruleSetId]) => ruleSetId),
      ),
      removeFromMatchmakingQueue: vi.fn(async (playerId: string, sessionId?: string) => {
        for (const [ruleSetId, queue] of queueByRule.entries()) {
          const nextQueue = queue.filter(entry => !(entry.playerId === playerId && entry.sessionId === sessionId))
          queueByRule.set(ruleSetId, nextQueue)
        }
      }),
      getMatchmakingQueueSize: vi.fn(async () =>
        [...queueByRule.values()].reduce((sum, queue) => sum + queue.length, 0),
      ),
      getPlayerConnectionBySession: vi.fn(async (playerId: string, sessionId: string) => {
        return connectionBySession.get(`${playerId}:${sessionId}`) ?? null
      }),
    }

    const sentBySession = new Map<string, unknown>()
    const callbacks = {
      createClusterBattleRoom: vi.fn(async () => 'battle-room-mock-1'),
      sendToPlayerSession: vi.fn(async (playerId: string, sessionId: string, event: string, payload: unknown) => {
        sentBySession.set(`${playerId}:${sessionId}:${event}`, payload)
        return true
      }),
      getPlayerName: vi.fn(async (playerId: string) => (playerId === playerAId ? 'Alpha' : 'Beta')),
      broadcastServerStateUpdate: vi.fn(),
    }

    const lockManager = {
      withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => await fn()),
    }

    const battleRouting = {
      joinPlayerToRoom: vi.fn(async () => true),
    }

    const resourceLoadingManager = {
      isReady: vi.fn(() => true),
      getProgress: vi.fn(() => ({
        status: 'completed',
        gameDataLoaded: true,
        scriptsLoaded: true,
        validationCompleted: true,
      })),
    }

    const sessionStateManager = {
      canEnterMatchmaking: vi.fn(async () => ({ allowed: true })),
      setSessionState: vi.fn(async () => undefined),
      clearSessionState: vi.fn(async () => undefined),
      batchUpdateSessionStates: vi.fn(async () => undefined),
    }

    const service = new ClusterMatchmakingService(
      stateManager as any,
      battleRouting as any,
      lockManager as any,
      callbacks as any,
      resourceLoadingManager as any,
      'instance-a',
      sessionStateManager as any,
      undefined,
      undefined,
    )

    service.setPeriodicMatchingConfig({ enabled: false })

    const playerA = buildPlayerSchema(playerAId, 'Alpha')
    const playerB = buildPlayerSchema(playerBId, 'Beta')
    addConnection(playerAId, sessionA, 'instance-a')
    addConnection(playerBId, sessionB, 'instance-b')

    const socketA = { id: 'socket-a', data: { playerId: playerAId, sessionId: sessionA } }
    const socketB = { id: 'socket-b', data: { playerId: playerBId, sessionId: sessionB } }

    let ackA: unknown
    let ackB: unknown

    await service.handleJoinMatchmaking(
      socketA as any,
      {
        playerSchema: playerA,
        ruleSetId: 'casual_standard_ruleset',
      },
      response => {
        ackA = response
      },
    )
    await service.handleJoinMatchmaking(
      socketB as any,
      {
        playerSchema: playerB,
        ruleSetId: 'casual_standard_ruleset',
      },
      response => {
        ackB = response
      },
    )

    expect(ackA).toEqual({ status: 'SUCCESS', data: { status: 'QUEUED' } })
    expect(ackB).toEqual({ status: 'SUCCESS', data: { status: 'QUEUED' } })

    const matched = await (service as any).attemptMatchmakingForRuleSet('casual_standard_ruleset')
    expect(matched).toBe(true)
    expect(callbacks.createClusterBattleRoom).toHaveBeenCalledTimes(1)
    expect(battleRouting.joinPlayerToRoom).toHaveBeenCalledTimes(2)
    expect(callbacks.sendToPlayerSession).toHaveBeenCalledTimes(2)

    expect(sentBySession.get(`${playerAId}:${sessionA}:matchSuccess`)).toEqual({
      status: 'SUCCESS',
      data: {
        roomId: 'battle-room-mock-1',
        opponent: { id: playerBId, name: 'Beta' },
      },
    })
    expect(sentBySession.get(`${playerBId}:${sessionB}:matchSuccess`)).toEqual({
      status: 'SUCCESS',
      data: {
        roomId: 'battle-room-mock-1',
        opponent: { id: playerAId, name: 'Alpha' },
      },
    })

    ;(service as any).stopPeriodicMatching?.()
  })

  it('relays p2p private-room peer signal between sessions via Redis event channel', async () => {
    vi.spyOn(PrivateRoomService.prototype as any, 'startRoomCleanup').mockImplementation(() => {})
    vi.spyOn(PrivateRoomService.prototype as any, 'subscribeToBattleFinishedEvents').mockImplementation(() => {})

    const redis = new FakeRedisClient()
    const stateManager = {
      redisManager: {
        getClient: () => redis,
        getPublisher: () => redis,
        getSubscriber: () => redis,
      },
    }
    const lockManager = {
      withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => await fn()),
    }
    const sessionStateManager = {
      canEnterPrivateRoom: vi.fn(async () => ({ allowed: true })),
      setSessionState: vi.fn(async () => undefined),
      clearSessionState: vi.fn(async () => undefined),
    }

    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)

    const host = createRoomPlayer({
      playerId: 'host',
      playerName: 'Host',
      sessionId: 'host-session',
      team: [{ id: 'pet-host' } as any],
    })
    const guest = createRoomPlayer({
      playerId: 'guest',
      playerName: 'Guest',
      sessionId: 'guest-session',
      team: [{ id: 'pet-guest' } as any],
    })

    const roomCode = await service.createRoom(host, { battleMode: 'p2p' })
    await service.joinRoom({ roomCode }, guest, 'player')

    const signalRequest: SendPrivateRoomPeerSignalRequest = {
      targetPlayerId: 'host',
      targetSessionId: 'host-session',
      signal: {
        transport: 'relay',
        kind: 'ready',
        payload: { source: 'mock-cluster-e2e' },
      },
    }

    await service.relayPeerSignal(roomCode, 'guest', 'guest-session', signalRequest)

    const peerSignalEvent = redis.published.find(
      entry => entry.channel === REDIS_KEYS.PRIVATE_ROOM_SIGNAL_EVENTS(roomCode),
    )
    expect(peerSignalEvent).toBeDefined()

    const payload = JSON.parse(peerSignalEvent!.message) as { to: { playerId: string; sessionId: string } }
    expect(payload.to).toEqual({
      playerId: 'host',
      sessionId: 'host-session',
    })
  })
})
