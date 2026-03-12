import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createNetServer, type AddressInfo } from 'node:net'
import { Server as SocketIoServer } from 'socket.io'
import { io as createSocketClient, type Socket as SocketClient } from 'socket.io-client'
import type { RoomState } from '../src/cluster/types'
import { ClusterBattleServer } from '../src/domain/battle/services/clusterBattleServer'
import { BattleRpcServer } from '../src/cluster/communication/rpc/battleRpcServer'
import { BattleRpcClient } from '../src/cluster/communication/rpc/battleRpcClient'
import { ClientRealtimeGateway } from '../src/realtime/clientRealtimeGateway'

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

function createRpcOwnerStateHandlers(state: unknown) {
  return {
    handleLocalGetState: vi.fn(async () => state),
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
}

async function startSocketServer(): Promise<{
  httpServer: HttpServer
  ioServer: SocketIoServer
  endpoint: string
}> {
  const httpServer = createHttpServer()
  const ioServer = new SocketIoServer(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket'],
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(0, '127.0.0.1', () => resolve())
    httpServer.once('error', reject)
  })

  const address = httpServer.address() as AddressInfo
  const endpoint = `http://127.0.0.1:${address.port}`
  return { httpServer, ioServer, endpoint }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
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
    server.once('error', reject)
  })
}

async function stopSocketServer(httpServer: HttpServer, ioServer: SocketIoServer): Promise<void> {
  ioServer.close()
  await new Promise<void>((resolve, reject) => {
    httpServer.close(err => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

async function connectClient(endpoint: string): Promise<SocketClient> {
  const client = createSocketClient(endpoint, {
    transports: ['websocket'],
    forceNew: true,
    query: {
      playerId: 'player-1',
      sessionId: 's1',
    },
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 3_000)
    client.once('connect', () => {
      clearTimeout(timer)
      resolve()
    })
    client.once('connect_error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })

  return client
}

async function waitForEvent<T>(client: SocketClient, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 3_000)
    client.once(event, payload => {
      clearTimeout(timer)
      resolve(payload as T)
    })
  })
}

describe('ClusterBattleServer reconnect socket.io e2e', () => {
  const cleanupTasks: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    while (cleanupTasks.length > 0) {
      const task = cleanupTasks.pop()
      if (task) {
        await task()
      }
    }
  })

  it('reconnect emits full battle state through real socket.io client and real gRPC owner', async () => {
    const ownerState = { source: 'owner-rpc', turn: 31 }
    const ownerHandlers = createRpcOwnerStateHandlers(ownerState)
    const ownerRpcPort = await getFreePort()
    const ownerRpcServer = new BattleRpcServer(ownerHandlers as any, ownerRpcPort)
    await ownerRpcServer.start()
    cleanupTasks.push(async () => {
      await ownerRpcServer.stop()
    })

    const { httpServer, ioServer, endpoint } = await startSocketServer()
    cleanupTasks.push(async () => {
      await stopSocketServer(httpServer, ioServer)
    })

    const roomState = createActiveRoom('instance-owner')
    const ownerAddress = `127.0.0.1:${ownerRpcPort}`
    const reconnectServer = Object.create(ClusterBattleServer.prototype) as any
    reconnectServer.clientRealtimeGateway = new ClientRealtimeGateway(ioServer as any)
    reconnectServer.instanceId = 'instance-reconnector'
    reconnectServer.privateRoomService = undefined
    reconnectServer.players = new Map()
    reconnectServer.forwardFailureWindows = new Map()
    reconnectServer.FORWARD_FAILOVER_THRESHOLD = 3
    reconnectServer.FORWARD_FAILOVER_WINDOW_MS = 60_000
    reconnectServer.rpcClient = new BattleRpcClient()
    reconnectServer.registerPlayerConnection = vi.fn(async (socket: any) => {
      socket.data.playerId = 'player-1'
      socket.data.sessionId = 's1'
    })
    reconnectServer.handlePlayerDisconnect = vi.fn(async () => {})
    reconnectServer.handlePlayerReconnect = vi.fn(async () => ({ isReconnect: true, roomId: 'room-1' }))
    reconnectServer.sendToPlayerSession = vi.fn(async () => true)
    reconnectServer.isRoomInCurrentInstance = vi.fn(() => false)
    reconnectServer.getLocalBattle = vi.fn(() => undefined)
    reconnectServer.stateManager = {
      getRoomState: vi.fn(async () => roomState),
      getInstance: vi.fn(async (instanceId: string) => {
        if (instanceId !== 'instance-owner') {
          return null
        }
        return {
          id: 'instance-owner',
          host: '127.0.0.1',
          status: 'healthy',
          lastHeartbeat: Date.now(),
          rpcAddress: ownerAddress,
        }
      }),
    }
    cleanupTasks.push(() => reconnectServer.rpcClient.closeAllClients())

    ClusterBattleServer.prototype['setupConnectionHandlers'].call(reconnectServer)

    const client = await connectClient(endpoint)
    cleanupTasks.push(() => client.close())

    const reconnectPayload = await waitForEvent<any>(client, 'battleReconnect')
    expect(reconnectPayload).toEqual(
      expect.objectContaining({
        roomId: 'room-1',
        shouldRedirect: true,
        battleState: 'active',
        fullBattleState: ownerState,
      }),
    )
    expect(ownerHandlers.handleLocalGetState).toHaveBeenCalledWith('room-1', 'player-1')
  })

  it('reconnect resolves current owner dynamically across two reconnects on real socket transport', async () => {
    const stateA = { source: 'owner-a', turn: 13 }
    const stateB = { source: 'owner-b', turn: 27 }
    const ownerHandlersA = createRpcOwnerStateHandlers(stateA)
    const ownerHandlersB = createRpcOwnerStateHandlers(stateB)
    const ownerRpcPortA = await getFreePort()
    const ownerRpcPortB = await getFreePort()
    const ownerRpcServerA = new BattleRpcServer(ownerHandlersA as any, ownerRpcPortA)
    const ownerRpcServerB = new BattleRpcServer(ownerHandlersB as any, ownerRpcPortB)
    await ownerRpcServerA.start()
    await ownerRpcServerB.start()
    cleanupTasks.push(async () => {
      await ownerRpcServerA.stop()
    })
    cleanupTasks.push(async () => {
      await ownerRpcServerB.stop()
    })

    const { httpServer, ioServer, endpoint } = await startSocketServer()
    cleanupTasks.push(async () => {
      await stopSocketServer(httpServer, ioServer)
    })

    let currentOwner: 'instance-a' | 'instance-b' = 'instance-a'
    const reconnectServer = Object.create(ClusterBattleServer.prototype) as any
    reconnectServer.clientRealtimeGateway = new ClientRealtimeGateway(ioServer as any)
    reconnectServer.instanceId = 'instance-reconnector'
    reconnectServer.privateRoomService = undefined
    reconnectServer.players = new Map()
    reconnectServer.forwardFailureWindows = new Map()
    reconnectServer.FORWARD_FAILOVER_THRESHOLD = 3
    reconnectServer.FORWARD_FAILOVER_WINDOW_MS = 60_000
    reconnectServer.rpcClient = new BattleRpcClient()
    reconnectServer.registerPlayerConnection = vi.fn(async (socket: any) => {
      socket.data.playerId = 'player-1'
      socket.data.sessionId = 's1'
    })
    reconnectServer.handlePlayerDisconnect = vi.fn(async () => {})
    reconnectServer.handlePlayerReconnect = vi.fn(async () => ({ isReconnect: true, roomId: 'room-1' }))
    reconnectServer.sendToPlayerSession = vi.fn(async () => true)
    reconnectServer.isRoomInCurrentInstance = vi.fn(() => false)
    reconnectServer.getLocalBattle = vi.fn(() => undefined)
    reconnectServer.stateManager = {
      getRoomState: vi.fn(async () => createActiveRoom(currentOwner)),
      getInstance: vi.fn(async (instanceId: string) => {
        if (instanceId === 'instance-a') {
          return {
            id: 'instance-a',
            host: '127.0.0.1',
            status: 'healthy',
            lastHeartbeat: Date.now(),
            rpcAddress: `127.0.0.1:${ownerRpcPortA}`,
          }
        }
        if (instanceId === 'instance-b') {
          return {
            id: 'instance-b',
            host: '127.0.0.1',
            status: 'healthy',
            lastHeartbeat: Date.now(),
            rpcAddress: `127.0.0.1:${ownerRpcPortB}`,
          }
        }
        return null
      }),
    }
    cleanupTasks.push(() => reconnectServer.rpcClient.closeAllClients())

    ClusterBattleServer.prototype['setupConnectionHandlers'].call(reconnectServer)

    const clientA = await connectClient(endpoint)
    cleanupTasks.push(() => clientA.close())
    const reconnectPayloadA = await waitForEvent<any>(clientA, 'battleReconnect')
    expect(reconnectPayloadA).toEqual(
      expect.objectContaining({
        roomId: 'room-1',
        fullBattleState: stateA,
      }),
    )
    expect(ownerHandlersA.handleLocalGetState).toHaveBeenCalledWith('room-1', 'player-1')
    clientA.close()

    currentOwner = 'instance-b'
    const clientB = await connectClient(endpoint)
    cleanupTasks.push(() => clientB.close())
    const reconnectPayloadB = await waitForEvent<any>(clientB, 'battleReconnect')
    expect(reconnectPayloadB).toEqual(
      expect.objectContaining({
        roomId: 'room-1',
        fullBattleState: stateB,
      }),
    )
    expect(ownerHandlersB.handleLocalGetState).toHaveBeenCalledWith('room-1', 'player-1')
  })
})
