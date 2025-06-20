import { createAdapter } from '@socket.io/redis-adapter'
import type { Server } from 'socket.io'
import pino from 'pino'
import type { RedisClientManager } from './redisClient'
import type { ClusterStateManager } from './clusterStateManager'
import type { PerformanceTracker } from './performanceTracker'
import type { PlayerConnection } from './types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export class SocketClusterAdapter {
  private redisManager: RedisClientManager
  private stateManager: ClusterStateManager
  private io: Server
  private instanceId: string
  private performanceTracker?: PerformanceTracker
  private connectionCount = 0

  constructor(io: Server, redisManager: RedisClientManager, stateManager: ClusterStateManager, instanceId: string) {
    this.io = io
    this.redisManager = redisManager
    this.stateManager = stateManager
    this.instanceId = instanceId
  }

  setPerformanceTracker(tracker: PerformanceTracker): void {
    this.performanceTracker = tracker
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Socket.IO cluster adapter')

      // 创建Redis适配器
      const pubClient = this.redisManager.getPublisher()
      const subClient = this.redisManager.getSubscriber()

      // 获取Redis配置中的键前缀，确保Socket.IO适配器也使用相同的前缀
      const keyPrefix = this.redisManager.getKeyPrefix()
      const socketIOKey = keyPrefix ? `${keyPrefix}socket.io` : 'socket.io'

      const adapter = createAdapter(pubClient, subClient, {
        key: socketIOKey,
        requestsTimeout: 15000, // 增加超时时间到15秒
        // 性能优化选项
        parser: undefined, // 使用默认的高性能解析器
      })

      // 设置适配器
      this.io.adapter(adapter)

      // 设置连接事件监听
      this.setupConnectionHandlers()

      // 设置适配器事件监听
      this.setupAdapterEventHandlers()

      logger.info('Socket.IO cluster adapter initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Socket.IO cluster adapter')
      throw error
    }
  }

  private setupConnectionHandlers(): void {
    this.io.on('connection', async socket => {
      try {
        const playerId = socket.data.playerId as string

        if (!playerId) {
          logger.warn({ socketId: socket.id }, 'Socket connected without playerId')
          return
        }

        // 更新连接数统计
        this.connectionCount++
        if (this.performanceTracker) {
          this.performanceTracker.updateSocketConnections(this.connectionCount)
        }

        // 记录玩家连接到集群状态
        const sessionId = socket.data.sessionId
        if (!sessionId) {
          logger.error({ playerId, socketId: socket.id }, 'SessionId is required for player connection')
          return
        }

        const connection: PlayerConnection = {
          instanceId: this.instanceId,
          socketId: socket.id,
          lastSeen: Date.now(),
          status: 'connected',
          sessionId: sessionId,
          metadata: {
            userAgent: socket.handshake.headers['user-agent'],
            ip: socket.handshake.address,
          },
        }

        await this.stateManager.setPlayerConnection(playerId, connection)

        logger.debug({ playerId, socketId: socket.id }, 'Player connected to cluster')

        // 监听断开连接
        socket.on('disconnect', async reason => {
          try {
            // 更新连接数统计
            this.connectionCount = Math.max(0, this.connectionCount - 1)
            if (this.performanceTracker) {
              this.performanceTracker.updateSocketConnections(this.connectionCount)
            }

            const sessionId = socket.data.sessionId
            await this.stateManager.removePlayerConnection(playerId, sessionId)
            logger.debug({ playerId, socketId: socket.id, reason }, 'Player disconnected from cluster')
          } catch (error) {
            logger.error({ error, playerId, socketId: socket.id }, 'Error handling player disconnect')
            if (this.performanceTracker) {
              this.performanceTracker.recordError('socket_disconnect_error', 'socketClusterAdapter')
            }
          }
        })

        // 定期更新连接状态
        const heartbeatInterval = setInterval(async () => {
          try {
            const updatedConnection: PlayerConnection = {
              ...connection,
              lastSeen: Date.now(),
            }
            await this.stateManager.setPlayerConnection(playerId, updatedConnection)
          } catch (error) {
            logger.error({ error, playerId, sessionId }, 'Error updating player connection heartbeat')
          }
        }, 30000) // 30秒更新一次

        socket.on('disconnect', () => {
          clearInterval(heartbeatInterval)
        })
      } catch (error) {
        logger.error({ error, socketId: socket.id }, 'Error handling socket connection')
      }
    })
  }

  private setupAdapterEventHandlers(): void {
    // 监听适配器事件
    this.io.of('/').adapter.on('create-room', room => {
      logger.debug({ room }, 'Room created in adapter')
    })

    this.io.of('/').adapter.on('join-room', (room, id) => {
      logger.debug({ room, socketId: id }, 'Socket joined room in adapter')
    })

    this.io.of('/').adapter.on('leave-room', (room, id) => {
      logger.debug({ room, socketId: id }, 'Socket left room in adapter')
    })

    this.io.of('/').adapter.on('delete-room', room => {
      logger.debug({ room }, 'Room deleted in adapter')
    })
  }

  // === 跨实例通信方法 ===

  /**
   * 向特定玩家发送消息（跨实例）- 发送到所有连接的session
   * 优化版本：使用Socket.IO内置的跨实例通信
   */
  async sendToPlayer(playerId: string, event: string, data: any): Promise<boolean> {
    try {
      const connections = await this.stateManager.getAllPlayerConnections(playerId)

      if (connections.length === 0) {
        logger.debug({ playerId, event }, 'Player has no connections, cannot send message')
        return false
      }

      let sentCount = 0
      for (const connection of connections) {
        if (connection.status !== 'connected') continue

        // 使用Socket.IO的内置跨实例通信 - 直接通过socketId发送
        // Socket.IO的Redis适配器会自动处理跨实例路由
        this.io.to(connection.socketId).emit(event, data)
        sentCount++

        logger.debug(
          {
            playerId,
            sessionId: connection.sessionId,
            event,
            socketId: connection.socketId,
            targetInstance: connection.instanceId,
            isLocal: connection.instanceId === this.instanceId,
          },
          'Message sent via Socket.IO adapter (auto cross-instance)',
        )
      }

      logger.debug(
        { playerId, event, totalConnections: connections.length, sentCount },
        'Messages sent to all player sessions via Socket.IO adapter',
      )
      return sentCount > 0
    } catch (error) {
      logger.error({ error, playerId, event }, 'Error sending message to player')
      return false
    }
  }

  /**
   * 向特定玩家的特定会话发送消息（跨实例）
   * 优化版本：使用Socket.IO内置的跨实例通信
   */
  async sendToPlayerSession(playerId: string, sessionId: string, event: string, data: any): Promise<boolean> {
    try {
      // sessionId是必需的
      if (!sessionId) {
        logger.error({ playerId, event }, 'SessionId is required for sending messages')
        return false
      }

      const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)

      if (!connection || connection.status !== 'connected') {
        logger.debug({ playerId, sessionId, event }, 'Player session not connected, cannot send message')
        return false
      }

      // 使用Socket.IO的内置跨实例通信 - 直接通过socketId发送
      // Socket.IO的Redis适配器会自动处理跨实例路由
      this.io.to(connection.socketId).emit(event, data)

      logger.debug(
        {
          playerId,
          sessionId,
          event,
          socketId: connection.socketId,
          targetInstance: connection.instanceId,
          isLocal: connection.instanceId === this.instanceId,
        },
        'Message sent via Socket.IO adapter (auto cross-instance)',
      )
      return true
    } catch (error) {
      logger.error({ error, playerId, sessionId, event }, 'Error sending message to player session')
      return false
    }
  }

  /**
   * 向房间内所有玩家发送消息（跨实例）
   */
  async sendToRoom(roomId: string, event: string, data: any): Promise<void> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)

      if (!roomState) {
        logger.debug({ roomId }, 'Room not found, cannot send message')
        return
      }

      // 使用Socket.IO的房间功能（自动处理跨实例）
      this.io.to(roomId).emit(event, data)

      logger.debug({ roomId, event }, 'Message sent to room')
    } catch (error) {
      logger.error({ error, roomId, event }, 'Error sending message to room')
    }
  }

  /**
   * 将玩家加入房间（跨实例）
   * 优化版本：使用Socket.IO内置的跨实例通信
   */
  async joinPlayerToRoom(playerId: string, roomId: string): Promise<boolean> {
    try {
      const connections = await this.stateManager.getAllPlayerConnections(playerId)

      if (connections.length === 0) {
        logger.debug({ playerId, roomId }, 'Player has no connections, cannot join room')
        return false
      }

      let joinedCount = 0
      for (const connection of connections) {
        if (connection.status !== 'connected') continue

        // 使用Socket.IO的内置跨实例通信 - 通过socketId加入房间
        // Socket.IO的Redis适配器会自动处理跨实例路由
        this.io.in(connection.socketId).socketsJoin(roomId)
        joinedCount++

        logger.debug(
          {
            playerId,
            sessionId: connection.sessionId,
            roomId,
            socketId: connection.socketId,
            targetInstance: connection.instanceId,
            isLocal: connection.instanceId === this.instanceId,
          },
          'Player session joined room via Socket.IO adapter (auto cross-instance)',
        )
      }

      logger.debug(
        { playerId, roomId, totalConnections: connections.length, joinedCount },
        'Player sessions joined room via Socket.IO adapter',
      )
      return joinedCount > 0
    } catch (error) {
      logger.error({ error, playerId, roomId }, 'Error joining player to room')
      return false
    }
  }

  /**
   * 将玩家从房间移除（跨实例）
   * 优化版本：使用Socket.IO内置的跨实例通信
   */
  async removePlayerFromRoom(playerId: string, roomId: string): Promise<boolean> {
    try {
      const connections = await this.stateManager.getAllPlayerConnections(playerId)

      if (connections.length === 0) {
        logger.debug({ playerId, roomId }, 'Player has no connections')
        return false
      }

      let leftCount = 0
      for (const connection of connections) {
        // 使用Socket.IO的内置跨实例通信 - 通过socketId离开房间
        // Socket.IO的Redis适配器会自动处理跨实例路由
        this.io.in(connection.socketId).socketsLeave(roomId)
        leftCount++

        logger.debug(
          {
            playerId,
            sessionId: connection.sessionId,
            roomId,
            socketId: connection.socketId,
            targetInstance: connection.instanceId,
            isLocal: connection.instanceId === this.instanceId,
          },
          'Player session left room via Socket.IO adapter (auto cross-instance)',
        )
      }

      logger.debug(
        {
          playerId,
          roomId,
          totalConnections: connections.length,
          leftCount,
        },
        'Player sessions left room via Socket.IO adapter',
      )
      return leftCount > 0
    } catch (error) {
      logger.error({ error, playerId, roomId }, 'Error removing player from room')
      return false
    }
  }

  /**
   * 断开玩家连接（跨实例）
   * 优化版本：使用Socket.IO内置的跨实例通信
   */
  async disconnectPlayer(playerId: string, reason?: string): Promise<boolean> {
    try {
      const connections = await this.stateManager.getAllPlayerConnections(playerId)

      if (connections.length === 0) {
        logger.debug({ playerId }, 'Player has no connections')
        return false
      }

      let disconnectedCount = 0
      for (const connection of connections) {
        // 使用Socket.IO的内置跨实例通信 - 通过socketId断开连接
        // Socket.IO的Redis适配器会自动处理跨实例路由
        this.io.in(connection.socketId).disconnectSockets(true)
        disconnectedCount++

        logger.debug(
          {
            playerId,
            sessionId: connection.sessionId,
            reason,
            socketId: connection.socketId,
            targetInstance: connection.instanceId,
            isLocal: connection.instanceId === this.instanceId,
          },
          'Player session disconnected via Socket.IO adapter (auto cross-instance)',
        )
      }

      logger.debug(
        { playerId, reason, totalConnections: connections.length, disconnectedCount },
        'Player sessions disconnected via Socket.IO adapter',
      )
      return disconnectedCount > 0
    } catch (error) {
      logger.error({ error, playerId }, 'Error disconnecting player')
      return false
    }
  }

  // === 私有方法 ===
  // 注意：跨实例通信现在完全由Socket.IO的Redis适配器处理
  // 不再需要手动的Redis pub/sub实现

  /**
   * 设置跨实例通信
   * 注意：现在完全由Socket.IO的Redis适配器处理，不需要手动设置
   */
  async setupCrossInstanceCommandListener(): Promise<void> {
    logger.info({ instanceId: this.instanceId }, 'Cross-instance communication handled by Socket.IO Redis adapter')
    // Socket.IO的Redis适配器会自动处理所有跨实例通信
    // 包括：emit, join, leave, disconnect等操作
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up Socket.IO cluster adapter')

      // Socket.IO的Redis适配器会自动处理清理工作
      // 不需要手动清理订阅

      logger.info('Socket.IO cluster adapter cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during Socket.IO cluster adapter cleanup')
    }
  }
}
