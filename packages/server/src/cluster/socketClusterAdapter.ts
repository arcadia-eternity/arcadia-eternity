import type { Server } from 'socket.io'
import pino from 'pino'
import type { RedisClientManager } from './redisClient'
import type { ClusterStateManager } from './clusterStateManager'
import type { PerformanceTracker } from './performanceTracker'

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
      logger.info('Initializing Socket.IO adapter with custom broadcast mechanism')

      // 设置连接事件监听
      this.setupConnectionHandlers()

      // 设置广播消息监听器
      this.setupBroadcastMessageListener()

      logger.info('Socket.IO adapter initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Socket.IO adapter')
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

        logger.debug({ playerId, socketId: socket.id }, 'Player connected to cluster adapter')

        // 监听断开连接
        socket.on('disconnect', async reason => {
          try {
            // 更新连接数统计
            this.connectionCount = Math.max(0, this.connectionCount - 1)
            if (this.performanceTracker) {
              this.performanceTracker.updateSocketConnections(this.connectionCount)
            }

            logger.debug({ playerId, socketId: socket.id, reason }, 'Player disconnected from cluster adapter')
          } catch (error) {
            logger.error({ error, playerId, socketId: socket.id }, 'Error handling player disconnect in adapter')
            if (this.performanceTracker) {
              this.performanceTracker.recordError('socket_disconnect_error', 'socketClusterAdapter')
            }
          }
        })
      } catch (error) {
        logger.error({ error, socketId: socket.id }, 'Error handling socket connection in adapter')
      }
    })
  }

  // === 跨实例通信方法 ===

  /**
   * 向特定玩家发送消息（跨实例）- 发送到所有连接的session
   * 使用广播机制处理跨实例通信
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

        if (connection.instanceId === this.instanceId) {
          // 连接在本实例，直接发送
          this.io.to(connection.socketId).emit(event, data)
          sentCount++

          logger.debug(
            {
              playerId,
              sessionId: connection.sessionId,
              event,
              socketId: connection.socketId,
            },
            'Message sent directly to local socket',
          )
        } else {
          // 连接在其他实例，使用广播
          await this.broadcastSessionMessage(playerId, connection.sessionId, event, data)
          sentCount++

          logger.debug(
            {
              playerId,
              sessionId: connection.sessionId,
              event,
              targetInstance: connection.instanceId,
            },
            'Message broadcasted to remote instance',
          )
        }
      }

      logger.debug(
        { playerId, event, totalConnections: connections.length, sentCount },
        'Messages sent to all player sessions',
      )
      return sentCount > 0
    } catch (error) {
      logger.error({ error, playerId, event }, 'Error sending message to player')
      return false
    }
  }

  /**
   * 向特定玩家的特定会话发送消息（跨实例）
   * 优化版本：先检查本实例，如果不在本实例则广播
   */
  async sendToPlayerSession(playerId: string, sessionId: string, event: string, data: any): Promise<boolean> {
    try {
      // sessionId是必需的
      if (!sessionId) {
        logger.error({ playerId, event }, 'SessionId is required for sending messages')
        return false
      }

      // 首先检查本实例是否有对应的session连接
      const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)

      if (connection && connection.instanceId === this.instanceId && connection.status === 'connected') {
        // 连接在本实例，直接发送
        this.io.to(connection.socketId).emit(event, data)

        logger.debug(
          {
            playerId,
            sessionId,
            event,
            socketId: connection.socketId,
            instanceId: this.instanceId,
          },
          'Message sent directly to local socket',
        )
        return true
      } else {
        // 连接不在本实例或不存在，广播到所有实例
        await this.broadcastSessionMessage(playerId, sessionId, event, data)

        logger.debug(
          {
            playerId,
            sessionId,
            event,
            instanceId: this.instanceId,
            connectionExists: !!connection,
            connectionInstanceId: connection?.instanceId,
          },
          'Message broadcasted to all instances for session delivery',
        )
        return true
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId, event }, 'Error sending message to player session')
      return false
    }
  }

  /**
   * 广播会话消息到所有实例
   */
  private async broadcastSessionMessage(playerId: string, sessionId: string, event: string, data: any): Promise<void> {
    try {
      const publisher = this.redisManager.getPublisher()
      const broadcastChannel = 'cluster:session-message'

      const message = {
        playerId,
        sessionId,
        event,
        data,
        timestamp: Date.now(),
        sourceInstanceId: this.instanceId,
      }

      await publisher.publish(broadcastChannel, JSON.stringify(message))

      logger.debug(
        {
          playerId,
          sessionId,
          event,
          sourceInstanceId: this.instanceId,
        },
        'Session message broadcasted to cluster',
      )
    } catch (error) {
      logger.error({ error, playerId, sessionId, event }, 'Error broadcasting session message')
      throw error
    }
  }

  /**
   * 向房间内所有玩家发送消息（跨实例）
   * 基于session的房间管理，通过状态管理器获取房间内的sessions
   */
  async sendToRoom(roomId: string, event: string, data: any): Promise<void> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)

      if (!roomState) {
        logger.debug({ roomId }, 'Room not found, cannot send message')
        return
      }

      // 向房间内的每个session发送消息
      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (playerId) {
          await this.sendToPlayerSession(playerId, sessionId, event, data)
        }
      }

      logger.debug({ roomId, event, sessionCount: roomState.sessions.length }, 'Message sent to room sessions')
    } catch (error) {
      logger.error({ error, roomId, event }, 'Error sending message to room')
    }
  }

  /**
   * 将玩家加入房间（跨实例）
   * 注意：房间管理完全基于session，通过状态管理器维护
   * 这个方法主要用于日志记录，实际的房间状态由状态管理器维护
   */
  async joinPlayerToRoom(playerId: string, roomId: string): Promise<boolean> {
    try {
      const connections = await this.stateManager.getAllPlayerConnections(playerId)

      if (connections.length === 0) {
        logger.debug({ playerId, roomId }, 'Player has no connections, cannot join room')
        return false
      }

      logger.debug(
        { playerId, roomId, connectionCount: connections.length },
        'Player room join processed (room state managed by state manager)',
      )
      return true
    } catch (error) {
      logger.error({ error, playerId, roomId }, 'Error joining player to room')
      return false
    }
  }

  /**
   * 将玩家从房间移除（跨实例）
   * 注意：房间管理完全基于session，通过状态管理器维护
   * 这个方法主要用于日志记录，实际的房间状态由状态管理器维护
   */
  async removePlayerFromRoom(playerId: string, roomId: string): Promise<boolean> {
    try {
      const connections = await this.stateManager.getAllPlayerConnections(playerId)

      if (connections.length === 0) {
        logger.debug({ playerId, roomId }, 'Player has no connections')
        return false
      }

      logger.debug(
        { playerId, roomId, connectionCount: connections.length },
        'Player room leave processed (room state managed by state manager)',
      )
      return true
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

  /**
   * 设置广播消息监听器
   */
  private setupBroadcastMessageListener(): void {
    try {
      const subscriber = this.redisManager.getSubscriber()
      const sessionChannel = 'cluster:session-message'

      // 只订阅会话消息频道，房间管理完全基于状态管理器
      subscriber.subscribe(sessionChannel, err => {
        if (err) {
          logger.error({ error: err, channel: sessionChannel }, 'Failed to subscribe to broadcast channel')
        } else {
          logger.info({ channel: sessionChannel }, 'Subscribed to broadcast channel')
        }
      })

      subscriber.on('message', async (channel, message) => {
        try {
          const broadcastMessage = JSON.parse(message)

          if (channel === sessionChannel) {
            await this.handleBroadcastSessionMessage(broadcastMessage)
          }
        } catch (error) {
          logger.error({ error, message, channel }, 'Failed to parse broadcast message')
        }
      })

      logger.info({ instanceId: this.instanceId }, 'Broadcast message listener setup completed')
    } catch (error) {
      logger.error({ error }, 'Error setting up broadcast message listener')
    }
  }

  /**
   * 处理广播的会话消息
   */
  private async handleBroadcastSessionMessage(broadcastMessage: {
    playerId: string
    sessionId: string
    event: string
    data: any
    timestamp: number
    sourceInstanceId: string
  }): Promise<void> {
    try {
      const { playerId, sessionId, event, data, sourceInstanceId } = broadcastMessage

      // 跳过自己发送的消息
      if (sourceInstanceId === this.instanceId) {
        return
      }

      // 检查本实例是否有对应的session连接
      const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)

      if (!connection) {
        logger.debug(
          { playerId, sessionId, event, sourceInstanceId },
          'No connection found for session in this instance, skipping',
        )
        return
      }

      if (connection.status !== 'connected') {
        logger.debug(
          { playerId, sessionId, event, status: connection.status, sourceInstanceId },
          'Connection not in connected state, skipping',
        )
        return
      }

      // 检查连接是否属于本实例
      if (connection.instanceId !== this.instanceId) {
        logger.debug(
          {
            playerId,
            sessionId,
            event,
            connectionInstanceId: connection.instanceId,
            currentInstanceId: this.instanceId,
          },
          'Connection belongs to different instance, skipping',
        )
        return
      }

      // 发送消息到本地socket
      this.io.to(connection.socketId).emit(event, data)

      logger.debug(
        {
          playerId,
          sessionId,
          event,
          socketId: connection.socketId,
          sourceInstanceId,
          currentInstanceId: this.instanceId,
        },
        'Broadcast session message delivered to local socket',
      )
    } catch (error) {
      logger.error({ error, broadcastMessage }, 'Error handling broadcast session message')
    }
  }

  /**
   * 设置跨实例通信
   * 注意：现在使用自定义的广播机制处理跨实例通信，不再依赖Socket.IO的Redis适配器
   */
  async setupCrossInstanceCommandListener(): Promise<void> {
    logger.info({ instanceId: this.instanceId }, 'Cross-instance communication handled by custom broadcast mechanism')
    // 跨实例通信现在通过Redis pub/sub广播机制处理
    // 广播消息监听器已在 setupBroadcastMessageListener 中设置
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up Socket.IO adapter')

      // 清理广播消息订阅
      const subscriber = this.redisManager.getSubscriber()
      await subscriber.unsubscribe('cluster:session-message')

      logger.info('Socket.IO adapter cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during Socket.IO adapter cleanup')
    }
  }
}
