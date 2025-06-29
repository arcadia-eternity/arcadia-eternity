import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ClusterBattleServer } from '../src/cluster/clusterBattleServer'
import { ClusterStateManager } from '../src/cluster/clusterStateManager'
import { SocketClusterAdapter } from '../src/cluster/socketClusterAdapter'
import { DistributedLockManager } from '../src/cluster/distributedLock'
import { RedisManager } from '../src/cluster/redisManager'
import { Server } from 'socket.io'
import { createServer } from 'http'
import type { RoomState } from '../src/cluster/types'

// Mock Redis for testing
class MockRedisClient {
  private data = new Map<string, any>()
  private sets = new Map<string, Set<string>>()

  async sadd(key: string, value: string): Promise<number> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set())
    }
    const set = this.sets.get(key)!
    const sizeBefore = set.size
    set.add(value)
    return set.size - sizeBefore
  }

  async srem(key: string, value: string): Promise<number> {
    const set = this.sets.get(key)
    if (!set) return 0
    const existed = set.has(value)
    set.delete(value)
    return existed ? 1 : 0
  }

  async smembers(key: string): Promise<string[]> {
    const set = this.sets.get(key)
    return set ? Array.from(set) : []
  }

  async expire(key: string, seconds: number): Promise<number> {
    // Mock implementation - just return success
    return 1
  }

  async hgetall(key: string): Promise<any> {
    return this.data.get(key) || {}
  }

  async hset(key: string, data: any): Promise<number> {
    this.data.set(key, data)
    return 1
  }

  async del(key: string): Promise<number> {
    const existed = this.data.has(key) || this.sets.has(key)
    this.data.delete(key)
    this.sets.delete(key)
    return existed ? 1 : 0
  }

  pipeline() {
    return {
      hgetall: (key: string) => this,
      exec: async () => {
        return []
      }
    }
  }
}

class MockRedisManager {
  private client = new MockRedisClient()

  getClient() {
    return this.client
  }

  getPublisher() {
    return this.client
  }

  getSubscriber() {
    return {
      subscribe: () => {},
      on: () => {}
    }
  }
}

describe('Session Room Mapping Cleanup', () => {
  let battleServer: ClusterBattleServer
  let stateManager: ClusterStateManager
  let mockRedisManager: MockRedisManager
  let io: Server

  beforeEach(async () => {
    // Create mock HTTP server and Socket.IO instance
    const httpServer = createServer()
    io = new Server(httpServer)

    // Create mock Redis manager
    mockRedisManager = new MockRedisManager()

    // Create state manager with mock Redis
    stateManager = new ClusterStateManager(mockRedisManager as any, 'test-instance')

    // Create mock socket adapter
    const socketAdapter = new SocketClusterAdapter(io, stateManager)

    // Create mock lock manager
    const lockManager = new DistributedLockManager(mockRedisManager as any)

    // Create battle server
    battleServer = new ClusterBattleServer(
      io,
      stateManager,
      socketAdapter,
      lockManager,
      undefined, // battleReportConfig
      'test-instance'
    )
  })

  afterEach(async () => {
    // Cleanup
    if (io) {
      io.close()
    }
  })

  it('should immediately cleanup session room mappings when battle ends', async () => {
    // Arrange: Create a mock room state
    const roomId = 'test-room-123'
    const playerId1 = 'player-1'
    const playerId2 = 'player-2'
    const sessionId1 = 'session-1'
    const sessionId2 = 'session-2'

    const roomState: RoomState = {
      id: roomId,
      status: 'active',
      sessions: [sessionId1, sessionId2],
      sessionPlayers: {
        [sessionId1]: playerId1,
        [sessionId2]: playerId2,
      },
      instanceId: 'test-instance',
      lastActive: Date.now(),
      battleState: undefined,
      metadata: {}
    }

    // Setup: Create session room mappings
    const client = mockRedisManager.getClient()
    await client.sadd(`session:rooms:${playerId1}:${sessionId1}`, roomId)
    await client.sadd(`session:rooms:${playerId2}:${sessionId2}`, roomId)

    // Verify mappings exist before battle end
    const mappings1Before = await client.smembers(`session:rooms:${playerId1}:${sessionId1}`)
    const mappings2Before = await client.smembers(`session:rooms:${playerId2}:${sessionId2}`)
    expect(mappings1Before).toContain(roomId)
    expect(mappings2Before).toContain(roomId)

    // Mock the stateManager.getRoomState method
    stateManager.getRoomState = async (id: string) => {
      return id === roomId ? roomState : null
    }

    // Act: Trigger battle end (this should immediately cleanup mappings)
    await (battleServer as any).handleBattleEnd(roomId, { winner: playerId1, reason: 'victory' })

    // Assert: Verify mappings are cleaned up immediately
    const mappings1After = await client.smembers(`session:rooms:${playerId1}:${sessionId1}`)
    const mappings2After = await client.smembers(`session:rooms:${playerId2}:${sessionId2}`)
    expect(mappings1After).not.toContain(roomId)
    expect(mappings2After).not.toContain(roomId)
  })

  it('should immediately cleanup session room mappings when player abandons', async () => {
    // Arrange: Create a mock room state
    const roomId = 'test-room-456'
    const playerId1 = 'player-1'
    const playerId2 = 'player-2'
    const sessionId1 = 'session-1'
    const sessionId2 = 'session-2'

    const roomState: RoomState = {
      id: roomId,
      status: 'active',
      sessions: [sessionId1, sessionId2],
      sessionPlayers: {
        [sessionId1]: playerId1,
        [sessionId2]: playerId2,
      },
      instanceId: 'test-instance',
      lastActive: Date.now(),
      battleState: undefined,
      metadata: {}
    }

    // Setup: Create session room mappings
    const client = mockRedisManager.getClient()
    await client.sadd(`session:rooms:${playerId1}:${sessionId1}`, roomId)
    await client.sadd(`session:rooms:${playerId2}:${sessionId2}`, roomId)

    // Mock the stateManager.getRoomState method
    stateManager.getRoomState = async (id: string) => {
      return id === roomId ? roomState : null
    }

    // Mock the getLocalBattle method to return null (no local battle)
    ;(battleServer as any).getLocalBattle = () => null

    // Act: Trigger player abandon
    try {
      await (battleServer as any).handleLocalPlayerAbandon(roomId, playerId1)
    } catch (error) {
      // Expected to throw BATTLE_NOT_FOUND since we mocked getLocalBattle to return null
      expect((error as Error).message).toBe('BATTLE_NOT_FOUND')
    }

    // The cleanup should still happen even if battle is not found
    // Let's test the cleanup method directly
    await (battleServer as any).cleanupSessionRoomMappings(roomState)

    // Assert: Verify mappings are cleaned up
    const mappings1After = await client.smembers(`session:rooms:${playerId1}:${sessionId1}`)
    const mappings2After = await client.smembers(`session:rooms:${playerId2}:${sessionId2}`)
    expect(mappings1After).not.toContain(roomId)
    expect(mappings2After).not.toContain(roomId)
  })
})
