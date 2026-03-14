import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomState } from '../src/cluster/types'
import { REDIS_KEYS } from '../src/cluster/types'
import { SessionStateManager } from '../src/domain/session/sessionStateManager'

function createActiveRoomState(playerId: string, sessionId: string): RoomState {
  return {
    id: 'room-1',
    status: 'active',
    sessions: [sessionId],
    sessionPlayers: {
      [sessionId]: playerId,
    },
    instanceId: 'instance-a',
    lastActive: Date.now(),
    battleState: undefined,
    spectators: [],
    metadata: {
      createdAt: Date.now(),
      ruleSetId: 'casual_standard_ruleset',
    },
  }
}

function createRedisClientStub() {
  const kv = new Map<string, string>()
  const sets = new Map<string, Set<string>>()
  const hashes = new Map<string, Record<string, string>>()

  const patternToRegExp = (pattern: string): RegExp => {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    const regexText = `^${escaped.replaceAll('*', '.*')}$`
    return new RegExp(regexText)
  }

  const ensureSet = (key: string): Set<string> => {
    const existing = sets.get(key)
    if (existing) {
      return existing
    }
    const created = new Set<string>()
    sets.set(key, created)
    return created
  }

  const client = {
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    setex: vi.fn(async (key: string, _seconds: number, value: string) => {
      kv.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (...keys: string[]) => {
      let removed = 0
      for (const key of keys) {
        if (sets.delete(key)) {
          removed += 1
        }
        if (hashes.delete(key)) {
          removed += 1
        }
        if (kv.delete(key)) {
          removed += 1
        }
      }
      return removed
    }),
    keys: vi.fn(async (pattern: string) => {
      const regex = patternToRegExp(pattern)
      return Array.from(kv.keys()).filter(key => regex.test(key))
    }),
    smembers: vi.fn(async (key: string) => Array.from(sets.get(key) ?? [])),
    sismember: vi.fn(async (key: string, member: string) => (sets.get(key)?.has(member) ? 1 : 0)),
    srem: vi.fn(async (key: string, member: string) => {
      const set = sets.get(key)
      if (!set) {
        return 0
      }
      const existed = set.has(member)
      set.delete(member)
      if (set.size === 0) {
        sets.delete(key)
      }
      return existed ? 1 : 0
    }),
    sadd: vi.fn(async (key: string, member: string) => {
      const set = ensureSet(key)
      const before = set.size
      set.add(member)
      return set.size - before
    }),
    hgetall: vi.fn(async (key: string) => ({ ...(hashes.get(key) ?? {}) })),
    hset: vi.fn(async (key: string, value: Record<string, string>) => {
      const existing = hashes.get(key) ?? {}
      hashes.set(key, {
        ...existing,
        ...value,
      })
      return Object.keys(value).length
    }),
  }

  return { client, kv, sets, hashes }
}

describe('SessionStateManager self-healing', () => {
  const playerId = 'player-1'
  const sessionId = 'session-1'
  let redis: ReturnType<typeof createRedisClientStub>
  let stateManagerStub: any
  let manager: SessionStateManager

  beforeEach(() => {
    redis = createRedisClientStub()
    stateManagerStub = {
      redisManager: {
        getClient: () => redis.client,
      },
      getRoomState: vi.fn(async () => null),
      getInstance: vi.fn(async () => ({ id: 'instance-a', status: 'healthy' })),
    }
    manager = new SessionStateManager(stateManagerStub)
  })

  it('auto-heals stale battle state and allows entering matchmaking', async () => {
    await manager.setSessionState(playerId, sessionId, 'battle', { battleRoomId: 'room-1' })
    await redis.client.sadd(REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId), 'room-1')

    const result = await manager.canEnterMatchmaking(playerId, sessionId)
    const healedState = await manager.getSessionState(playerId, sessionId)

    expect(result).toEqual({ allowed: true })
    expect(healedState?.state).toBe('idle')
    expect(redis.client.srem).toHaveBeenCalledWith(REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId), 'room-1')
  })

  it('keeps battle state when session is still bound to an active battle room', async () => {
    await manager.setSessionState(playerId, sessionId, 'battle', { battleRoomId: 'room-1' })
    await redis.client.sadd(REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId), 'room-1')
    stateManagerStub.getRoomState.mockResolvedValueOnce(createActiveRoomState(playerId, sessionId))

    const result = await manager.canEnterPrivateRoom(playerId, sessionId)
    const currentState = await manager.getSessionState(playerId, sessionId)

    expect(result).toEqual({ allowed: false, reason: '当前在战斗中' })
    expect(currentState?.state).toBe('battle')
  })

  it('accepts hinted battle room id in session context even when mapping is temporarily empty', async () => {
    await manager.setSessionState(playerId, sessionId, 'battle', { battleRoomId: 'room-1' })
    stateManagerStub.getRoomState.mockResolvedValueOnce(createActiveRoomState(playerId, sessionId))

    const result = await manager.canEnterMatchmaking(playerId, sessionId)
    const currentState = await manager.getSessionState(playerId, sessionId)

    expect(result).toEqual({ allowed: false, reason: '当前在战斗中' })
    expect(currentState?.state).toBe('battle')
  })

  it('auto-heals battle state when owner instance is unavailable and ownership lease is inactive', async () => {
    await manager.setSessionState(playerId, sessionId, 'battle', { battleRoomId: 'room-1' })
    await redis.client.sadd(REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId), 'room-1')
    stateManagerStub.getRoomState.mockResolvedValueOnce(createActiveRoomState(playerId, sessionId))
    stateManagerStub.getInstance.mockResolvedValueOnce(null)

    const result = await manager.canEnterMatchmaking(playerId, sessionId)
    const healedState = await manager.getSessionState(playerId, sessionId)

    expect(result).toEqual({ allowed: true })
    expect(healedState?.state).toBe('idle')
  })

  it('keeps battle lock when owner instance is unavailable but ownership lease is still active', async () => {
    await manager.setSessionState(playerId, sessionId, 'battle', { battleRoomId: 'room-1' })
    await redis.client.sadd(REDIS_KEYS.SESSION_ROOM_MAPPING(playerId, sessionId), 'room-1')
    await redis.client.setex(
      REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP('room-1'),
      30,
      JSON.stringify({
        roomId: 'room-1',
        ownerInstanceId: 'instance-z',
        status: 'active',
        leaseExpireAt: Date.now() + 30_000,
        lastUpdatedAt: Date.now(),
      }),
    )
    stateManagerStub.getRoomState.mockResolvedValueOnce(createActiveRoomState(playerId, sessionId))
    stateManagerStub.getInstance.mockResolvedValueOnce(null)

    const result = await manager.canEnterPrivateRoom(playerId, sessionId)
    const currentState = await manager.getSessionState(playerId, sessionId)

    expect(result).toEqual({ allowed: false, reason: '当前在战斗中' })
    expect(currentState?.state).toBe('battle')
  })

  it('auto-heals stale matchmaking state and allows joining queue again', async () => {
    await manager.setSessionState(playerId, sessionId, 'matchmaking', { queueId: 'standard' })

    const result = await manager.canEnterMatchmaking(playerId, sessionId)
    const healedState = await manager.getSessionState(playerId, sessionId)

    expect(result).toEqual({ allowed: true })
    expect(healedState?.state).toBe('idle')
  })

  it('keeps matchmaking lock when session is still in an active queue', async () => {
    await manager.setSessionState(playerId, sessionId, 'matchmaking', { queueId: 'standard' })

    const sessionKey = `${playerId}:${sessionId}`
    const queueKey = `${REDIS_KEYS.MATCHMAKING_QUEUE}:standard`
    const activeRuleSetsKey = `${REDIS_KEYS.MATCHMAKING_QUEUE}:active_rulesets`
    await redis.client.sadd(activeRuleSetsKey, 'standard')
    await redis.client.sadd(queueKey, sessionKey)

    const result = await manager.canEnterMatchmaking(playerId, sessionId)
    const currentState = await manager.getSessionState(playerId, sessionId)

    expect(result).toEqual({ allowed: false, reason: '已在匹配队列中' })
    expect(currentState?.state).toBe('matchmaking')
  })
})
