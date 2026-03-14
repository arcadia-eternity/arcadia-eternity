import type { Server } from 'socket.io'
import pino from 'pino'
import type { RedisClientManager } from '../redis/redisClient'
import type { ClusterStateManager } from '../core/clusterStateManager'
import type { PerformanceTracker } from '../monitoring/performanceTracker'
import type { RealtimeTransport } from '../../realtime/realtimeTransport'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export class ClusterRealtimeGateway implements RealtimeTransport {
  private performanceTracker?: PerformanceTracker
  private connectionCount = 0

  constructor(
    private readonly io: Server,
    private readonly redisManager: RedisClientManager,
    private readonly stateManager: ClusterStateManager,
    private readonly instanceId: string,
  ) {}

  setPerformanceTracker(tracker: PerformanceTracker): void {
    this.performanceTracker = tracker
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing cluster realtime gateway')
      this.setupConnectionHandlers()
      this.setupSessionMessageListener()
      logger.info('Cluster realtime gateway initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize cluster realtime gateway')
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

        this.connectionCount++
        this.performanceTracker?.updateSocketConnections(this.connectionCount)

        logger.debug({ playerId, socketId: socket.id }, 'Player connected to cluster realtime gateway')

        socket.on('disconnect', async reason => {
          try {
            this.connectionCount = Math.max(0, this.connectionCount - 1)
            this.performanceTracker?.updateSocketConnections(this.connectionCount)
            logger.debug({ playerId, socketId: socket.id, reason }, 'Player disconnected from cluster realtime gateway')
          } catch (error) {
            logger.error({ error, playerId, socketId: socket.id }, 'Error handling disconnect in realtime gateway')
            this.performanceTracker?.recordError('socket_disconnect_error', 'clusterRealtimeGateway')
          }
        })
      } catch (error) {
        logger.error({ error, socketId: socket.id }, 'Error handling socket connection in realtime gateway')
      }
    })
  }

  async sendToPlayer(playerId: string, event: string, data: unknown): Promise<boolean> {
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
          this.io.to(connection.socketId).emit(event, data)
          sentCount++
        } else {
          await this.publishSessionMessage(playerId, connection.sessionId, event, data)
          sentCount++
        }
      }
      return sentCount > 0
    } catch (error) {
      logger.error({ error, playerId, event }, 'Error sending message to player')
      return false
    }
  }

  async sendToPlayerSession(playerId: string, sessionId: string, event: string, data: unknown): Promise<boolean> {
    try {
      if (!sessionId) {
        logger.error({ playerId, event }, 'SessionId is required for sending messages')
        return false
      }

      const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)
      if (connection && connection.instanceId === this.instanceId && connection.status === 'connected') {
        if (await this.emitToLocalSocket(connection.socketId, event, data)) {
          return true
        }
      }

      const localSocketId = await this.findLocalSocketId(playerId, sessionId)
      if (localSocketId) {
        if (await this.emitToLocalSocket(localSocketId, event, data)) {
          return true
        }
      }

      await this.publishSessionMessage(playerId, sessionId, event, data)
      return true
    } catch (error) {
      logger.error({ error, playerId, sessionId, event }, 'Error sending message to player session')
      return false
    }
  }

  async sendToRoom(roomId: string, event: string, data: unknown): Promise<void> {
    try {
      const roomState = await this.stateManager.getRoomState(roomId)
      if (!roomState) {
        logger.debug({ roomId }, 'Room not found, cannot send message')
        return
      }

      for (const sessionId of roomState.sessions) {
        const playerId = roomState.sessionPlayers[sessionId]
        if (playerId) {
          await this.sendToPlayerSession(playerId, sessionId, event, data)
        }
      }
    } catch (error) {
      logger.error({ error, roomId, event }, 'Error sending message to room')
    }
  }

  async joinPlayerToRoom(playerId: string, roomId: string): Promise<boolean> {
    try {
      const connections = await this.stateManager.getAllPlayerConnections(playerId)
      if (connections.length === 0) {
        logger.debug({ playerId, roomId }, 'Player has no connections, cannot join room')
        return false
      }
      return true
    } catch (error) {
      logger.error({ error, playerId, roomId }, 'Error joining player to room')
      return false
    }
  }

  async getLocalSessionIds(): Promise<Set<string>> {
    const localSockets = await this.io.fetchSockets()
    const sessionIds = new Set<string>()
    for (const socket of localSockets) {
      if (socket.data.sessionId) {
        sessionIds.add(socket.data.sessionId)
      }
    }
    return sessionIds
  }

  async setupCrossInstanceSessionForwarding(): Promise<void> {
    logger.info({ instanceId: this.instanceId }, 'Cross-instance session forwarding handled by Redis pub/sub')
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up cluster realtime gateway')
      const subscriber = this.redisManager.getSubscriber()
      await subscriber.unsubscribe('cluster:session-message')
      logger.info('Cluster realtime gateway cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during realtime gateway cleanup')
    }
  }

  private async publishSessionMessage(playerId: string, sessionId: string, event: string, data: unknown): Promise<void> {
    const publisher = this.redisManager.getPublisher()
    await publisher.publish(
      'cluster:session-message',
      JSON.stringify({
        playerId,
        sessionId,
        event,
        data,
        timestamp: Date.now(),
        sourceInstanceId: this.instanceId,
      }),
    )
  }

  private setupSessionMessageListener(): void {
    try {
      const subscriber = this.redisManager.getSubscriber()
      const sessionChannel = 'cluster:session-message'

      subscriber.subscribe(sessionChannel, err => {
        if (err) {
          logger.error({ error: err, channel: sessionChannel }, 'Failed to subscribe to session channel')
        } else {
          logger.info({ channel: sessionChannel }, 'Subscribed to session channel')
        }
      })

      subscriber.on('message', async (channel, message) => {
        try {
          if (channel !== sessionChannel) return
          await this.handleBroadcastSessionMessage(JSON.parse(message) as {
            playerId: string
            sessionId: string
            event: string
            data: unknown
            sourceInstanceId: string
          })
        } catch (error) {
          logger.error({ error, message, channel }, 'Failed to handle session message')
        }
      })
    } catch (error) {
      logger.error({ error }, 'Error setting up session message listener')
    }
  }

  private async handleBroadcastSessionMessage(broadcastMessage: {
    playerId: string
    sessionId: string
    event: string
    data: unknown
    sourceInstanceId: string
  }): Promise<void> {
    const { playerId, sessionId, event, data } = broadcastMessage

    const connection = await this.stateManager.getPlayerConnectionBySession(playerId, sessionId)
    if (!connection || connection.status !== 'connected' || connection.instanceId !== this.instanceId) {
      const localSocketId = await this.findLocalSocketId(playerId, sessionId)
      if (!localSocketId) {
        return
      }
      await this.emitToLocalSocket(localSocketId, event, data)
      return
    }

    await this.emitToLocalSocket(connection.socketId, event, data)
  }

  private async emitToLocalSocket(socketId: string, event: string, data: unknown): Promise<boolean> {
    const localSockets = await this.io.fetchSockets()
    const targetSocket = localSockets.find(socket => socket.id === socketId)

    if (!targetSocket) {
      logger.warn({ socketId, event }, 'Target local socket not found for session emit')
      return false
    }

    targetSocket.emit(event, data)
    return true
  }

  private async findLocalSocketId(playerId: string, sessionId: string): Promise<string | null> {
    const sockets = await this.io.fetchSockets()
    const matchedSocket = sockets.find(
      socket => socket.data?.playerId === playerId && socket.data?.sessionId === sessionId,
    )
    return matchedSocket?.id ?? null
  }
}
