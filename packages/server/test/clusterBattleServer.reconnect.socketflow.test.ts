import { describe, it, expect, vi } from 'vitest'
import type { RoomState } from '../src/cluster/types'
import { ClusterBattleServer } from '../src/domain/battle/services/clusterBattleServer'

function createActiveRoom(instanceId: string): RoomState {
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

function createSocketStub() {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    id: 'sock-1',
    data: {
      playerId: 'player-1',
      sessionId: 's1',
    },
    emit: vi.fn(),
    join: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
    }),
    _handlers: handlers,
  }
}

describe('ClusterBattleServer reconnect socket flow', () => {
  it('emits battleReconnect with local full battle state on same instance reconnect', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    let connectionHandler: ((socket: any) => Promise<void>) | undefined

    server.clientRealtimeGateway = {
      onConnection: vi.fn((handler: (socket: any) => Promise<void>) => {
        connectionHandler = handler
      }),
    }
    server.registerPlayerConnection = vi.fn(async () => {})
    server.handlePlayerReconnect = vi.fn(async () => ({ isReconnect: true, roomId: 'room-1' }))
    server.stateManager = {
      getRoomState: vi.fn(async () => createActiveRoom('instance-a')),
    }
    server.instanceId = 'instance-a'
    server.isRoomInCurrentInstance = vi.fn(() => true)
    server.getLocalBattle = vi.fn(() => ({
      getState: vi.fn(async () => ({ source: 'local', turn: 3 })),
    }))
    server.forwardPlayerAction = vi.fn(async () => ({ source: 'remote' }))
    server.sendToPlayerSession = vi.fn(async () => true)
    server.privateRoomService = undefined

    ClusterBattleServer.prototype['setupConnectionHandlers'].call(server)
    expect(connectionHandler).toBeDefined()

    const socket = createSocketStub()
    await connectionHandler!(socket)

    expect(socket.emit).toHaveBeenCalledWith(
      'battleReconnect',
      expect.objectContaining({
        roomId: 'room-1',
        shouldRedirect: true,
        battleState: 'active',
        fullBattleState: { source: 'local', turn: 3 },
      }),
    )
    expect(server.forwardPlayerAction).not.toHaveBeenCalled()
  })

  it('emits battleReconnect with forwarded full battle state on cross-instance reconnect', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    let connectionHandler: ((socket: any) => Promise<void>) | undefined

    server.clientRealtimeGateway = {
      onConnection: vi.fn((handler: (socket: any) => Promise<void>) => {
        connectionHandler = handler
      }),
    }
    server.registerPlayerConnection = vi.fn(async () => {})
    server.handlePlayerReconnect = vi.fn(async () => ({ isReconnect: true, roomId: 'room-1' }))
    server.stateManager = {
      getRoomState: vi.fn(async () => createActiveRoom('instance-b')),
    }
    server.instanceId = 'instance-a'
    server.isRoomInCurrentInstance = vi.fn(() => false)
    server.resolveRequestOwnerInstanceId = vi.fn(async () => 'instance-b')
    server.getLocalBattle = vi.fn(() => undefined)
    server.forwardPlayerAction = vi.fn(async () => ({ source: 'remote', turn: 8 }))
    server.readBattleStateSnapshot = vi.fn(async () => null)
    server.sendToPlayerSession = vi.fn(async () => true)
    server.privateRoomService = undefined

    ClusterBattleServer.prototype['setupConnectionHandlers'].call(server)
    expect(connectionHandler).toBeDefined()

    const socket = createSocketStub()
    await connectionHandler!(socket)

    expect(server.forwardPlayerAction).toHaveBeenCalledWith('instance-b', 'getState', 'player-1', { roomId: 'room-1' })
    expect(socket.emit).toHaveBeenCalledWith(
      'battleReconnect',
      expect.objectContaining({
        roomId: 'room-1',
        shouldRedirect: true,
        battleState: 'active',
        fullBattleState: { source: 'remote', turn: 8 },
      }),
    )
  })

  it('uses resolved ownership target for reconnect state fetch when room routing is stale', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    let connectionHandler: ((socket: any) => Promise<void>) | undefined

    server.clientRealtimeGateway = {
      onConnection: vi.fn((handler: (socket: any) => Promise<void>) => {
        connectionHandler = handler
      }),
    }
    server.registerPlayerConnection = vi.fn(async () => {})
    server.handlePlayerReconnect = vi.fn(async () => ({ isReconnect: true, roomId: 'room-1' }))
    server.stateManager = {
      // stale routing says instance-a
      getRoomState: vi.fn(async () => createActiveRoom('instance-a')),
    }
    server.instanceId = 'instance-c'
    server.isRoomInCurrentInstance = vi.fn(() => false)
    // ownership resolution says current owner is instance-b
    server.resolveRequestOwnerInstanceId = vi.fn(async () => 'instance-b')
    server.getLocalBattle = vi.fn(() => undefined)
    server.forwardPlayerAction = vi.fn(async () => ({ source: 'resolved-owner', turn: 12 }))
    server.readBattleStateSnapshot = vi.fn(async () => null)
    server.sendToPlayerSession = vi.fn(async () => true)
    server.privateRoomService = undefined

    ClusterBattleServer.prototype['setupConnectionHandlers'].call(server)
    expect(connectionHandler).toBeDefined()

    const socket = createSocketStub()
    await connectionHandler!(socket)

    expect(server.forwardPlayerAction).toHaveBeenCalledWith('instance-b', 'getState', 'player-1', { roomId: 'room-1' })
    expect(socket.emit).toHaveBeenCalledWith(
      'battleReconnect',
      expect.objectContaining({
        fullBattleState: { source: 'resolved-owner', turn: 12 },
      }),
    )
  })

  it('falls back to redis snapshot when cross-instance reconnect state forwarding fails', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    let connectionHandler: ((socket: any) => Promise<void>) | undefined

    server.clientRealtimeGateway = {
      onConnection: vi.fn((handler: (socket: any) => Promise<void>) => {
        connectionHandler = handler
      }),
    }
    server.registerPlayerConnection = vi.fn(async () => {})
    server.handlePlayerReconnect = vi.fn(async () => ({ isReconnect: true, roomId: 'room-1' }))
    server.stateManager = {
      getRoomState: vi.fn(async () => createActiveRoom('instance-b')),
    }
    server.instanceId = 'instance-a'
    server.isRoomInCurrentInstance = vi.fn(() => false)
    server.resolveRequestOwnerInstanceId = vi.fn(async () => 'instance-b')
    server.getLocalBattle = vi.fn(() => undefined)
    server.forwardPlayerAction = vi.fn(async () => {
      throw new Error('RPC_TIMEOUT')
    })
    server.readBattleStateSnapshot = vi.fn(async () => ({ source: 'snapshot-fallback', turn: 99 }))
    server.sendToPlayerSession = vi.fn(async () => true)
    server.privateRoomService = undefined

    ClusterBattleServer.prototype['setupConnectionHandlers'].call(server)
    expect(connectionHandler).toBeDefined()

    const socket = createSocketStub()
    await connectionHandler!(socket)

    expect(server.forwardPlayerAction).toHaveBeenCalledWith('instance-b', 'getState', 'player-1', { roomId: 'room-1' })
    expect(server.readBattleStateSnapshot).toHaveBeenCalledWith('room-1', 'player-1')
    expect(socket.emit).toHaveBeenCalledWith(
      'battleReconnect',
      expect.objectContaining({
        fullBattleState: { source: 'snapshot-fallback', turn: 99 },
      }),
    )
  })
})
