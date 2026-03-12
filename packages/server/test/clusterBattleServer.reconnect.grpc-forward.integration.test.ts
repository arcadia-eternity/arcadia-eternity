import { afterEach, describe, expect, it, vi } from 'vitest'
import net from 'node:net'
import type { RoomState } from '../src/cluster/types'
import { ClusterBattleServer } from '../src/domain/battle/services/clusterBattleServer'
import { BattleRpcServer } from '../src/cluster/communication/rpc/battleRpcServer'
import { BattleRpcClient } from '../src/cluster/communication/rpc/battleRpcClient'

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
    id: 'sock-grpc',
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

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate free port'))
        return
      }
      const port = address.port
      server.close(err => {
        if (err) {
          reject(err)
          return
        }
        resolve(port)
      })
    })
    server.on('error', reject)
  })
}

describe('ClusterBattleServer reconnect gRPC-forward integration', () => {
  const cleanupTasks: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    while (cleanupTasks.length > 0) {
      const task = cleanupTasks.pop()
      if (task) {
        await task()
      }
    }
  })

  it('fetches cross-instance reconnect full battle state via real gRPC forwarding', async () => {
    const rpcPort = await getFreePort()
    const expectedState = { source: 'grpc-owner', turn: 17 }

    // Owner instance: real RPC server with local handlers
    const owner = {
      handleLocalGetState: vi.fn(async () => expectedState),
      handleLocalPlayerSelection: vi.fn(async () => ({ status: 'ACTION_ACCEPTED' })),
      handleLocalGetSelection: vi.fn(async () => []),
      handleLocalReady: vi.fn(async () => ({ status: 'READY' })),
      handleLocalPlayerAbandon: vi.fn(async () => ({ status: 'ABANDONED' })),
      handleLocalReportAnimationEnd: vi.fn(async () => ({ status: 'OK' })),
      handleLocalIsTimerEnabled: vi.fn(async () => false),
      handleLocalGetPlayerTimerState: vi.fn(async () => null),
      handleLocalGetAllPlayerTimerStates: vi.fn(async () => []),
      handleLocalGetTimerConfig: vi.fn(async () => ({})),
      handleLocalStartAnimation: vi.fn(async () => ({ status: 'OK' })),
      handleLocalEndAnimation: vi.fn(async () => ({ status: 'OK' })),
      handleLocalBattleTermination: vi.fn(async () => ({ status: 'TERMINATED' })),
      handleLocalCreateBattle: vi.fn(async () => ({ success: true, roomId: 'room-1' })),
      joinSpectateBattle: vi.fn(async () => true),
    }
    const rpcServer = new BattleRpcServer(owner as any, rpcPort)
    await rpcServer.start()
    cleanupTasks.push(async () => {
      await rpcServer.stop()
    })

    // Reconnector instance: execute socket reconnect flow and forward getState by gRPC
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
      getInstance: vi.fn(async () => ({
        id: 'instance-b',
        host: '127.0.0.1',
        status: 'healthy',
        lastHeartbeat: Date.now(),
        rpcAddress: `127.0.0.1:${rpcPort}`,
      })),
    }
    server.instanceId = 'instance-a'
    server.isRoomInCurrentInstance = vi.fn(() => false)
    server.getLocalBattle = vi.fn(() => undefined)
    server.sendToPlayerSession = vi.fn(async () => true)
    server.privateRoomService = undefined
    server.forwardFailureWindows = new Map()
    server.FORWARD_FAILOVER_THRESHOLD = 3
    server.FORWARD_FAILOVER_WINDOW_MS = 60_000
    server.rpcClient = new BattleRpcClient()
    cleanupTasks.push(() => {
      server.rpcClient.closeAllClients()
    })

    ClusterBattleServer.prototype['setupConnectionHandlers'].call(server)
    expect(connectionHandler).toBeDefined()

    const socket = createSocketStub()
    await connectionHandler!(socket)

    expect(owner.handleLocalGetState).toHaveBeenCalledWith('room-1', 'player-1')
    expect(socket.emit).toHaveBeenCalledWith(
      'battleReconnect',
      expect.objectContaining({
        roomId: 'room-1',
        shouldRedirect: true,
        battleState: 'active',
        fullBattleState: expectedState,
      }),
    )
  })

  it('routes reconnect full state to current owner when room ownership switches between two live instances', async () => {
    const rpcPortA = await getFreePort()
    const rpcPortB = await getFreePort()
    const stateA = { source: 'owner-a', turn: 11 }
    const stateB = { source: 'owner-b', turn: 22 }
    let currentOwnerInstanceId: 'instance-a' | 'instance-b' = 'instance-a'

    const ownerA = {
      handleLocalGetState: vi.fn(async () => stateA),
      handleLocalPlayerSelection: vi.fn(async () => ({ status: 'ACTION_ACCEPTED' })),
      handleLocalGetSelection: vi.fn(async () => []),
      handleLocalReady: vi.fn(async () => ({ status: 'READY' })),
      handleLocalPlayerAbandon: vi.fn(async () => ({ status: 'ABANDONED' })),
      handleLocalReportAnimationEnd: vi.fn(async () => ({ status: 'OK' })),
      handleLocalIsTimerEnabled: vi.fn(async () => false),
      handleLocalGetPlayerTimerState: vi.fn(async () => null),
      handleLocalGetAllPlayerTimerStates: vi.fn(async () => []),
      handleLocalGetTimerConfig: vi.fn(async () => ({})),
      handleLocalStartAnimation: vi.fn(async () => ({ status: 'OK' })),
      handleLocalEndAnimation: vi.fn(async () => ({ status: 'OK' })),
      handleLocalBattleTermination: vi.fn(async () => ({ status: 'TERMINATED' })),
      handleLocalCreateBattle: vi.fn(async () => ({ success: true, roomId: 'room-1' })),
      joinSpectateBattle: vi.fn(async () => true),
    }
    const ownerB = {
      handleLocalGetState: vi.fn(async () => stateB),
      handleLocalPlayerSelection: vi.fn(async () => ({ status: 'ACTION_ACCEPTED' })),
      handleLocalGetSelection: vi.fn(async () => []),
      handleLocalReady: vi.fn(async () => ({ status: 'READY' })),
      handleLocalPlayerAbandon: vi.fn(async () => ({ status: 'ABANDONED' })),
      handleLocalReportAnimationEnd: vi.fn(async () => ({ status: 'OK' })),
      handleLocalIsTimerEnabled: vi.fn(async () => false),
      handleLocalGetPlayerTimerState: vi.fn(async () => null),
      handleLocalGetAllPlayerTimerStates: vi.fn(async () => []),
      handleLocalGetTimerConfig: vi.fn(async () => ({})),
      handleLocalStartAnimation: vi.fn(async () => ({ status: 'OK' })),
      handleLocalEndAnimation: vi.fn(async () => ({ status: 'OK' })),
      handleLocalBattleTermination: vi.fn(async () => ({ status: 'TERMINATED' })),
      handleLocalCreateBattle: vi.fn(async () => ({ success: true, roomId: 'room-1' })),
      joinSpectateBattle: vi.fn(async () => true),
    }

    const rpcServerA = new BattleRpcServer(ownerA as any, rpcPortA)
    const rpcServerB = new BattleRpcServer(ownerB as any, rpcPortB)
    await rpcServerA.start()
    await rpcServerB.start()
    cleanupTasks.push(async () => {
      await rpcServerA.stop()
    })
    cleanupTasks.push(async () => {
      await rpcServerB.stop()
    })

    const reconnectServer = Object.create(ClusterBattleServer.prototype) as any
    let connectionHandler: ((socket: any) => Promise<void>) | undefined
    reconnectServer.clientRealtimeGateway = {
      onConnection: vi.fn((handler: (socket: any) => Promise<void>) => {
        connectionHandler = handler
      }),
    }
    reconnectServer.registerPlayerConnection = vi.fn(async () => {})
    reconnectServer.handlePlayerReconnect = vi.fn(async () => ({ isReconnect: true, roomId: 'room-1' }))
    reconnectServer.stateManager = {
      getRoomState: vi.fn(async () => createActiveRoom(currentOwnerInstanceId)),
      getInstance: vi.fn(async (instanceId: string) => {
        if (instanceId === 'instance-a') {
          return {
            id: 'instance-a',
            host: '127.0.0.1',
            status: 'healthy',
            lastHeartbeat: Date.now(),
            rpcAddress: `127.0.0.1:${rpcPortA}`,
          }
        }
        if (instanceId === 'instance-b') {
          return {
            id: 'instance-b',
            host: '127.0.0.1',
            status: 'healthy',
            lastHeartbeat: Date.now(),
            rpcAddress: `127.0.0.1:${rpcPortB}`,
          }
        }
        return null
      }),
    }
    reconnectServer.instanceId = 'instance-c'
    reconnectServer.isRoomInCurrentInstance = vi.fn(() => false)
    reconnectServer.getLocalBattle = vi.fn(() => undefined)
    reconnectServer.sendToPlayerSession = vi.fn(async () => true)
    reconnectServer.privateRoomService = undefined
    reconnectServer.forwardFailureWindows = new Map()
    reconnectServer.FORWARD_FAILOVER_THRESHOLD = 3
    reconnectServer.FORWARD_FAILOVER_WINDOW_MS = 60_000
    reconnectServer.rpcClient = new BattleRpcClient()
    cleanupTasks.push(() => reconnectServer.rpcClient.closeAllClients())

    ClusterBattleServer.prototype['setupConnectionHandlers'].call(reconnectServer)
    expect(connectionHandler).toBeDefined()

    const socketRound1 = createSocketStub()
    await connectionHandler!(socketRound1)
    expect(ownerA.handleLocalGetState).toHaveBeenCalledWith('room-1', 'player-1')
    expect(socketRound1.emit).toHaveBeenCalledWith(
      'battleReconnect',
      expect.objectContaining({
        roomId: 'room-1',
        fullBattleState: stateA,
      }),
    )

    currentOwnerInstanceId = 'instance-b'
    const socketRound2 = createSocketStub()
    await connectionHandler!(socketRound2)
    expect(ownerB.handleLocalGetState).toHaveBeenCalledWith('room-1', 'player-1')
    expect(socketRound2.emit).toHaveBeenCalledWith(
      'battleReconnect',
      expect.objectContaining({
        roomId: 'room-1',
        fullBattleState: stateB,
      }),
    )
  })
})
