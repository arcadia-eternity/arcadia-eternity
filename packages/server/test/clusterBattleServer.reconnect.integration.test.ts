import { describe, it, expect, vi } from 'vitest'
import type { RoomState } from '../src/cluster/types'
import { REDIS_KEYS } from '../src/cluster/types'
import { ClusterBattleServer } from '../src/domain/battle/services/clusterBattleServer'

type InMemoryRedis = {
  client: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    del: ReturnType<typeof vi.fn>
    sadd: ReturnType<typeof vi.fn>
    srem: ReturnType<typeof vi.fn>
    smembers: ReturnType<typeof vi.fn>
    pipeline: ReturnType<typeof vi.fn>
  }
  kv: Map<string, string>
  sets: Map<string, Set<string>>
}

function createRoomState(instanceId: string): RoomState {
  return {
    id: 'room-1',
    status: 'active',
    sessions: ['s1', 's2'],
    sessionPlayers: {
      s1: 'player-1',
      s2: 'player-2',
    },
    instanceId,
    lastActive: Date.now(),
    battleState: undefined,
    spectators: [],
    metadata: {
      createdAt: Date.now(),
      ruleSetId: 'casual_standard_ruleset',
    },
  }
}

function createInMemoryRedis(): InMemoryRedis {
  const kv = new Map<string, string>()
  const sets = new Map<string, Set<string>>()

  const ensureSet = (key: string): Set<string> => {
    const existing = sets.get(key)
    if (existing) {
      return existing
    }
    const next = new Set<string>()
    sets.set(key, next)
    return next
  }

  const client = {
    get: vi.fn(async (key: string) => kv.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      kv.set(key, value)
      return 'OK'
    }),
    del: vi.fn(async (key: string) => {
      const deleted = kv.delete(key)
      return deleted ? 1 : 0
    }),
    sadd: vi.fn(async (key: string, value: string) => {
      const set = ensureSet(key)
      const before = set.size
      set.add(value)
      return set.size - before
    }),
    srem: vi.fn(async (key: string, value: string) => {
      const set = sets.get(key)
      if (!set) {
        return 0
      }
      const existed = set.has(value)
      set.delete(value)
      if (set.size === 0) {
        sets.delete(key)
      }
      return existed ? 1 : 0
    }),
    smembers: vi.fn(async (key: string) => Array.from(sets.get(key) ?? [])),
    pipeline: vi.fn(() => {
      const pipe = {
        hgetall: vi.fn((_key: string) => pipe),
        exec: vi.fn(async () => []),
      }
      return pipe
    }),
  }

  return { client, kv, sets }
}

function createServer(options: {
  instanceId: string
  redisClient: InMemoryRedis['client']
  roomState: RoomState | null
}) {
  const server = Object.create(ClusterBattleServer.prototype) as any
  const getRoomState = vi.fn(async (roomId: string) => {
    if (!options.roomState || options.roomState.id !== roomId) {
      return null
    }
    return options.roomState
  })
  const setRoomState = vi.fn(async (roomState: RoomState) => roomState)
  server.instanceId = options.instanceId
  server.stateManager = {
    redisManager: {
      getClient: () => options.redisClient,
    },
    getRoomState,
    setRoomState,
  }
  server.battleService = {
    getDisconnectedPlayer: vi.fn(() => undefined),
  }
  server.notifyInstanceCleanupDisconnect = vi.fn(async () => {})
  server.resumeBattle = vi.fn(async () => {})

  return server
}

describe('ClusterBattleServer reconnect integration', () => {
  it('reconnects to active room on same instance via session-room mapping lookup', async () => {
    const redis = createInMemoryRedis()
    const sessionRoomKey = REDIS_KEYS.SESSION_ROOM_MAPPING('player-1', 's1')
    redis.sets.set(sessionRoomKey, new Set(['room-1']))
    const roomState = createRoomState('instance-a')
    const server = createServer({
      instanceId: 'instance-a',
      redisClient: redis.client,
      roomState,
    })

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(redis.client.smembers).toHaveBeenCalledWith(sessionRoomKey)
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('reconnects to active room hosted on another instance via session-room mapping lookup', async () => {
    const redis = createInMemoryRedis()
    const sessionRoomKey = REDIS_KEYS.SESSION_ROOM_MAPPING('player-1', 's1')
    redis.sets.set(sessionRoomKey, new Set(['room-1']))
    const roomState = createRoomState('instance-b')
    const server = createServer({
      instanceId: 'instance-a',
      redisClient: redis.client,
      roomState,
    })

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(redis.client.smembers).toHaveBeenCalledWith(sessionRoomKey)
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('reconnects via redis disconnect record on same instance and only clears redis keys', async () => {
    const redis = createInMemoryRedis()
    const disconnectKey = REDIS_KEYS.DISCONNECTED_PLAYER('player-1', 's1')
    redis.kv.set(
      disconnectKey,
      JSON.stringify({
        playerId: 'player-1',
        sessionId: 's1',
        roomId: 'room-1',
        instanceId: 'instance-a',
        disconnectTime: Date.now() - 500,
        expiresAt: Date.now() + 10_000,
      }),
    )
    redis.sets.set(REDIS_KEYS.DISCONNECTED_PLAYERS, new Set([disconnectKey]))
    const server = createServer({
      instanceId: 'instance-a',
      redisClient: redis.client,
      roomState: null,
    })

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(server.notifyInstanceCleanupDisconnect).not.toHaveBeenCalled()
    expect(redis.client.del).toHaveBeenCalledWith(disconnectKey)
    expect(redis.client.srem).toHaveBeenCalledWith(REDIS_KEYS.DISCONNECTED_PLAYERS, disconnectKey)
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('reconnects via redis disconnect record from other instance and requests remote cleanup', async () => {
    const redis = createInMemoryRedis()
    const disconnectKey = REDIS_KEYS.DISCONNECTED_PLAYER('player-1', 's1')
    redis.kv.set(
      disconnectKey,
      JSON.stringify({
        playerId: 'player-1',
        sessionId: 's1',
        roomId: 'room-1',
        instanceId: 'instance-b',
        disconnectTime: Date.now() - 500,
        expiresAt: Date.now() + 10_000,
      }),
    )
    redis.sets.set(REDIS_KEYS.DISCONNECTED_PLAYERS, new Set([disconnectKey]))
    const server = createServer({
      instanceId: 'instance-a',
      redisClient: redis.client,
      roomState: null,
    })

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(server.notifyInstanceCleanupDisconnect).toHaveBeenCalledWith('instance-b', 'player-1', 's1')
    expect(redis.client.del).toHaveBeenCalledWith(disconnectKey)
    expect(redis.client.srem).toHaveBeenCalledWith(REDIS_KEYS.DISCONNECTED_PLAYERS, disconnectKey)
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('self-heals session binding by playerId when battle session id changed after reconnect', async () => {
    const redis = createInMemoryRedis()
    const roomState = createRoomState('instance-a')
    roomState.sessions = ['old-session', 's2']
    roomState.sessionPlayers = {
      'old-session': 'player-1',
      s2: 'player-2',
    }
    redis.sets.set(REDIS_KEYS.ROOMS, new Set(['room-1']))

    const server = createServer({
      instanceId: 'instance-a',
      redisClient: redis.client,
      roomState,
    })

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 'new-session',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(roomState.sessions).toContain('new-session')
    expect(roomState.sessionPlayers['new-session']).toBe('player-1')
    expect(server.stateManager.setRoomState).toHaveBeenCalled()
    expect(redis.client.sadd).toHaveBeenCalledWith(REDIS_KEYS.SESSION_ROOM_MAPPING('player-1', 'new-session'), 'room-1')
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('prefers the most recent active room when session mapping contains stale and fresh rooms', async () => {
    const redis = createInMemoryRedis()
    const sessionRoomKey = REDIS_KEYS.SESSION_ROOM_MAPPING('player-1', 's1')
    redis.sets.set(sessionRoomKey, new Set(['room-old', 'room-new']))

    const staleRoom: RoomState = {
      ...createRoomState('instance-b'),
      id: 'room-old',
      lastActive: Date.now() - 10_000,
      status: 'active',
      sessions: ['s1', 's2'],
      sessionPlayers: { s1: 'player-1', s2: 'player-2' },
    }
    const freshRoom: RoomState = {
      ...createRoomState('instance-a'),
      id: 'room-new',
      lastActive: Date.now(),
      status: 'active',
      sessions: ['s1', 's3'],
      sessionPlayers: { s1: 'player-1', s3: 'player-3' },
    }

    const roomStateById = new Map<string, RoomState>([
      ['room-old', staleRoom],
      ['room-new', freshRoom],
    ])

    const server = Object.create(ClusterBattleServer.prototype) as any
    server.instanceId = 'instance-a'
    server.stateManager = {
      redisManager: { getClient: () => redis.client },
      getRoomState: vi.fn(async (roomId: string) => roomStateById.get(roomId) ?? null),
      setRoomState: vi.fn(async (_roomState: RoomState) => {}),
    }
    server.battleService = {
      getDisconnectedPlayer: vi.fn(() => undefined),
    }
    server.notifyInstanceCleanupDisconnect = vi.fn(async () => {})
    server.resumeBattle = vi.fn(async () => {})

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)
    expect(result).toEqual({ isReconnect: true, roomId: 'room-new' })
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-new')
    expect(redis.client.srem).toHaveBeenCalledWith(sessionRoomKey, 'room-old')
  })
})
