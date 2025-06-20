import { EventEmitter } from 'events'
import pino from 'pino'
import type { RedisClientManager } from './redisClient'
import type { DistributedLockManager } from './distributedLock'
import type {
  ClusterConfig,
  ServiceInstance,
  PlayerConnection,
  RoomState,
  MatchmakingEntry,
  SessionData,
  AuthBlacklistEntry,
  ClusterEvent,
  ClusterStats,
} from './types'
import { REDIS_KEYS, ClusterError } from './types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export class ClusterStateManager extends EventEmitter {
  private redisManager: RedisClientManager
  private _lockManager: DistributedLockManager
  private config: ClusterConfig
  private currentInstance: ServiceInstance
  private heartbeatTimer?: NodeJS.Timeout
  private healthCheckTimer?: NodeJS.Timeout

  constructor(redisManager: RedisClientManager, lockManager: DistributedLockManager, config: ClusterConfig) {
    super()
    this.redisManager = redisManager
    this._lockManager = lockManager
    this.config = config

    this.currentInstance = {
      id: config.instance.id,
      host: config.instance.host,
      port: config.instance.port,
      rpcPort: config.instance.grpcPort,
      rpcAddress: config.instance.grpcPort ? `${config.instance.host}:${config.instance.grpcPort}` : undefined,
      region: config.instance.region,
      status: 'starting',
      lastHeartbeat: Date.now(),
      connections: 0,
      load: 0,
      metadata: {
        isFlyIo: config.instance.isFlyIo || false,
      },
    }
  }

  async initialize(): Promise<void> {
    try {
      logger.info({ instanceId: this.currentInstance.id }, 'Initializing cluster state manager')

      // 注册当前实例
      await this.registerInstance()

      // 设置事件监听
      this.setupEventListeners()

      // 启动心跳和健康检查
      this.startHeartbeat()
      this.startHealthCheck()

      // 发布实例加入事件
      await this.publishEvent({
        type: 'instance:join',
        data: this.currentInstance,
      })

      // 重建活跃玩家索引（确保数据一致性）
      await this.rebuildActivePlayersIndex()

      logger.info({ instanceId: this.currentInstance.id }, 'Cluster state manager initialized')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize cluster state manager')
      throw error
    }
  }

  // === 服务实例管理 ===

  async registerInstance(): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      this.currentInstance.status = 'healthy'
      this.currentInstance.lastHeartbeat = Date.now()

      // 添加到实例集合
      await client.sadd(REDIS_KEYS.SERVICE_INSTANCES, this.currentInstance.id)

      // 存储实例详细信息
      await client.hset(
        REDIS_KEYS.SERVICE_INSTANCE(this.currentInstance.id),
        this.serializeInstance(this.currentInstance),
      )

      logger.info({ instance: this.currentInstance }, 'Instance registered successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to register instance')
      throw new ClusterError('Failed to register instance', 'REGISTRATION_ERROR', error)
    }
  }

  async unregisterInstance(): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      this.currentInstance.status = 'stopping'

      // 从实例集合中移除
      await client.srem(REDIS_KEYS.SERVICE_INSTANCES, this.currentInstance.id)

      // 删除实例详细信息
      await client.del(REDIS_KEYS.SERVICE_INSTANCE(this.currentInstance.id))

      // 发布实例离开事件
      await this.publishEvent({
        type: 'instance:leave',
        data: { instanceId: this.currentInstance.id },
      })

      logger.info({ instanceId: this.currentInstance.id }, 'Instance unregistered successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to unregister instance')
      throw new ClusterError('Failed to unregister instance', 'UNREGISTRATION_ERROR', error)
    }
  }

  async getInstances(): Promise<ServiceInstance[]> {
    const client = this.redisManager.getClient()

    try {
      const instanceIds = await client.smembers(REDIS_KEYS.SERVICE_INSTANCES)
      if (instanceIds.length === 0) {
        return []
      }

      // 使用 pipeline 批量获取实例数据，避免 N+1 查询问题
      const pipeline = client.pipeline()
      for (const instanceId of instanceIds) {
        pipeline.hgetall(REDIS_KEYS.SERVICE_INSTANCE(instanceId))
      }

      const results = await pipeline.exec()
      const instances: ServiceInstance[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, instanceData] = results[i]
          if (!err && instanceData && Object.keys(instanceData).length > 0) {
            instances.push(this.deserializeInstance(instanceData as Record<string, string>))
          }
        }
      }

      return instances
    } catch (error) {
      logger.error({ error }, 'Failed to get instances')
      throw new ClusterError('Failed to get instances', 'GET_INSTANCES_ERROR', error)
    }
  }

  async getInstance(instanceId: string): Promise<ServiceInstance | null> {
    const client = this.redisManager.getClient()

    try {
      const instanceData = await client.hgetall(REDIS_KEYS.SERVICE_INSTANCE(instanceId))

      if (Object.keys(instanceData).length === 0) {
        return null
      }

      return this.deserializeInstance(instanceData)
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to get instance')
      return null
    }
  }

  async updateInstanceLoad(connections: number, load: number): Promise<void> {
    this.currentInstance.connections = connections
    this.currentInstance.load = load
    this.currentInstance.lastHeartbeat = Date.now()

    const client = this.redisManager.getClient()

    try {
      await client.hset(
        REDIS_KEYS.SERVICE_INSTANCE(this.currentInstance.id),
        this.serializeInstance(this.currentInstance),
      )

      // 发布实例更新事件
      await this.publishEvent({
        type: 'instance:update',
        data: this.currentInstance,
      })
    } catch (error) {
      logger.error({ error }, 'Failed to update instance load')
    }
  }

  // === 玩家连接管理 - 支持多会话 ===

  async setPlayerConnection(playerId: string, connection: PlayerConnection): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      // sessionId是必需的
      if (!connection.sessionId) {
        throw new ClusterError('SessionId is required for player connection', 'MISSING_SESSION_ID')
      }

      // 只存储基于session的连接
      const sessionConnection = {
        playerId,
        sessionId: connection.sessionId,
        instanceId: connection.instanceId,
        socketId: connection.socketId,
        lastSeen: connection.lastSeen,
        status: connection.status,
        metadata: connection.metadata,
      }

      await client.hset(
        REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, connection.sessionId),
        this.serializeSessionConnection(sessionConnection),
      )

      // 添加到玩家的会话连接集合
      await client.sadd(REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId), connection.sessionId)

      // 添加到活跃玩家索引
      await client.sadd(REDIS_KEYS.ACTIVE_PLAYERS, playerId)

      // 清除相关缓存
      this.invalidatePlayerConnectionsCache()

      // 发布玩家连接事件
      await this.publishEvent({
        type: 'player:connect',
        data: { playerId, connection },
      })

      logger.debug({ playerId, sessionId: connection.sessionId, connection }, 'Player connection set')
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to set player connection')
      throw new ClusterError('Failed to set player connection', 'SET_CONNECTION_ERROR', error)
    }
  }

  /**
   * 根据session获取玩家连接
   */
  async getPlayerConnectionBySession(playerId: string, sessionId: string): Promise<PlayerConnection | null> {
    const client = this.redisManager.getClient()

    try {
      const redisKey = REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, sessionId)
      logger.debug({ playerId, sessionId, redisKey }, 'Looking up player connection by session')

      const connectionData = await client.hgetall(redisKey)
      logger.debug(
        { playerId, sessionId, connectionData, hasData: Object.keys(connectionData).length > 0 },
        'Redis connection data retrieved',
      )

      if (Object.keys(connectionData).length === 0) {
        logger.debug({ playerId, sessionId, redisKey }, 'No connection data found for session')
        return null
      }

      const sessionConnection = this.deserializeSessionConnection(connectionData)
      const result = {
        instanceId: sessionConnection.instanceId,
        socketId: sessionConnection.socketId,
        lastSeen: sessionConnection.lastSeen,
        status: sessionConnection.status,
        sessionId: sessionConnection.sessionId,
        metadata: sessionConnection.metadata,
      }

      logger.debug({ playerId, sessionId, result }, 'Player connection found and deserialized')
      return result
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to get player connection by session')
      return null
    }
  }

  /**
   * 获取玩家的所有连接
   */
  async getAllPlayerConnections(playerId: string): Promise<PlayerConnection[]> {
    try {
      const sessionConnections = await this.getPlayerSessionConnections(playerId)
      return sessionConnections.map(conn => ({
        instanceId: conn.instanceId,
        socketId: conn.socketId,
        lastSeen: conn.lastSeen,
        status: conn.status,
        sessionId: conn.sessionId,
        metadata: conn.metadata,
      }))
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to get all player connections')
      return []
    }
  }

  async getPlayerSessionConnections(playerId: string): Promise<any[]> {
    const client = this.redisManager.getClient()

    try {
      const sessionIds = await client.smembers(REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId))
      if (sessionIds.length === 0) {
        return []
      }

      // 使用 pipeline 批量获取连接数据
      const pipeline = client.pipeline()
      for (const sessionId of sessionIds) {
        pipeline.hgetall(REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, sessionId))
      }

      const results = await pipeline.exec()
      const connections: any[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, connectionData] = results[i]
          if (!err && connectionData && Object.keys(connectionData).length > 0) {
            connections.push(this.deserializeSessionConnection(connectionData as Record<string, string>))
          }
        }
      }

      return connections
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to get player session connections')
      return []
    }
  }

  async removePlayerConnection(playerId: string, sessionId: string): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      // 删除特定会话的连接
      await client.del(REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, sessionId))
      await client.srem(REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId), sessionId)

      // 检查玩家是否还有其他连接，如果没有则从活跃玩家索引中移除
      const remainingConnections = await client.scard(REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId))
      if (remainingConnections === 0) {
        await client.srem(REDIS_KEYS.ACTIVE_PLAYERS, playerId)
        // 清理空的连接集合
        await client.del(REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId))
      }

      // 清除相关缓存
      this.invalidatePlayerConnectionsCache()

      logger.debug({ playerId, sessionId, remainingConnections }, 'Player session connection removed')

      // 发布玩家断开事件
      await this.publishEvent({
        type: 'player:disconnect',
        data: { playerId, sessionId, instanceId: this.currentInstance.id },
      })
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to remove player connection')
    }
  }

  // === 房间状态管理 ===

  async setRoomState(roomState: RoomState): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      await client.hset(REDIS_KEYS.ROOM(roomState.id), this.serializeRoomState(roomState))

      // 添加到房间集合
      await client.sadd(REDIS_KEYS.ROOMS, roomState.id)

      // 发布房间事件
      const eventType = (await client.exists(REDIS_KEYS.ROOM(roomState.id))) > 1 ? 'room:update' : 'room:create'
      await this.publishEvent({
        type: eventType as 'room:create' | 'room:update',
        data: roomState,
      })

      // 清除集群统计缓存（房间状态变化会影响统计）
      this.invalidateClusterStatsCache()

      logger.debug({ roomId: roomState.id, status: roomState.status }, 'Room state set')
    } catch (error) {
      logger.error({ error, roomId: roomState.id }, 'Failed to set room state')
      throw new ClusterError('Failed to set room state', 'SET_ROOM_ERROR', error)
    }
  }

  async getRoomState(roomId: string): Promise<RoomState | null> {
    const client = this.redisManager.getClient()

    try {
      const roomData = await client.hgetall(REDIS_KEYS.ROOM(roomId))

      if (Object.keys(roomData).length === 0) {
        return null
      }

      return this.deserializeRoomState(roomData)
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to get room state')
      return null
    }
  }

  async removeRoomState(roomId: string): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      await client.del(REDIS_KEYS.ROOM(roomId))
      await client.srem(REDIS_KEYS.ROOMS, roomId)

      // 发布房间销毁事件
      await this.publishEvent({
        type: 'room:destroy',
        data: { roomId },
      })

      // 清除集群统计缓存（房间状态变化会影响统计）
      this.invalidateClusterStatsCache()

      logger.debug({ roomId }, 'Room state removed')
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to remove room state')
    }
  }

  // === 匹配队列管理 ===

  async addToMatchmakingQueue(entry: MatchmakingEntry): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      // sessionId是必需的
      if (!entry.sessionId) {
        throw new ClusterError('SessionId is required for matchmaking', 'MISSING_SESSION_ID')
      }

      // 使用session作为队列的唯一标识
      const sessionKey = `${entry.playerId}:${entry.sessionId}`

      // 添加到队列集合
      await client.sadd(REDIS_KEYS.MATCHMAKING_QUEUE, sessionKey)

      // 存储会话匹配数据
      await client.hset(REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey), this.serializeMatchmakingEntry(entry))

      // 发布匹配加入事件
      await this.publishEvent({
        type: 'matchmaking:join',
        data: entry,
      })

      logger.debug({ playerId: entry.playerId, sessionId: entry.sessionId }, 'Session added to matchmaking queue')
    } catch (error) {
      logger.error(
        { error, playerId: entry.playerId, sessionId: entry.sessionId },
        'Failed to add session to matchmaking queue',
      )
      throw new ClusterError('Failed to add to matchmaking queue', 'MATCHMAKING_ADD_ERROR', error)
    }
  }

  async removeFromMatchmakingQueue(playerId: string, sessionId?: string): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      if (sessionId) {
        // 移除特定session
        const sessionKey = `${playerId}:${sessionId}`
        await client.srem(REDIS_KEYS.MATCHMAKING_QUEUE, sessionKey)
        await client.del(REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey))

        logger.debug({ playerId, sessionId }, 'Session removed from matchmaking queue')
      } else {
        // 移除该playerId的所有session（向后兼容）
        const allSessionKeys = await client.smembers(REDIS_KEYS.MATCHMAKING_QUEUE)
        const playerSessionKeys = allSessionKeys.filter(key => key.startsWith(`${playerId}:`))

        if (playerSessionKeys.length > 0) {
          await client.srem(REDIS_KEYS.MATCHMAKING_QUEUE, ...playerSessionKeys)

          // 删除所有相关的匹配数据
          for (const sessionKey of playerSessionKeys) {
            await client.del(REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey))
          }

          logger.debug(
            { playerId, removedSessions: playerSessionKeys.length },
            'All player sessions removed from matchmaking queue',
          )
        }
      }

      // 发布匹配离开事件
      await this.publishEvent({
        type: 'matchmaking:leave',
        data: { playerId, sessionId },
      })
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to remove from matchmaking queue')
    }
  }

  async getMatchmakingQueue(): Promise<MatchmakingEntry[]> {
    const client = this.redisManager.getClient()

    try {
      const sessionKeys = await client.smembers(REDIS_KEYS.MATCHMAKING_QUEUE)
      if (sessionKeys.length === 0) {
        return []
      }

      // 使用 pipeline 批量获取匹配队列数据
      const pipeline = client.pipeline()
      for (const sessionKey of sessionKeys) {
        pipeline.hgetall(REDIS_KEYS.MATCHMAKING_PLAYER(sessionKey))
      }

      const results = await pipeline.exec()
      const entries: MatchmakingEntry[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, entryData] = results[i]
          if (!err && entryData && Object.keys(entryData).length > 0) {
            entries.push(this.deserializeMatchmakingEntry(entryData as Record<string, string>))
          }
        }
      }

      return entries.sort((a, b) => a.joinTime - b.joinTime) // 按加入时间排序
    } catch (error) {
      logger.error({ error }, 'Failed to get matchmaking queue')
      return []
    }
  }

  async getMatchmakingQueueSize(): Promise<number> {
    const client = this.redisManager.getClient()

    try {
      return await client.scard(REDIS_KEYS.MATCHMAKING_QUEUE)
    } catch (error) {
      logger.error({ error }, 'Failed to get matchmaking queue size')
      return 0
    }
  }

  // === 会话管理 - 支持多会话 ===

  async setSession(playerId: string, session: SessionData): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      // 存储具体的会话数据
      await client.hset(REDIS_KEYS.SESSION(playerId, session.sessionId), this.serializeSession(session))

      // 将会话ID添加到玩家的会话列表中
      await client.sadd(REDIS_KEYS.PLAYER_SESSIONS(playerId), session.sessionId)

      // 添加到全局会话索引（用于清理）
      await client.zadd(REDIS_KEYS.SESSION_INDEX, session.createdAt, `${playerId}:${session.sessionId}`)

      // 设置过期时间（如果有的话）
      if (session.expiry) {
        const ttl = session.expiry - Date.now()
        if (ttl > 0) {
          await client.pexpire(REDIS_KEYS.SESSION(playerId, session.sessionId), ttl)
        }
      }

      logger.debug({ playerId, sessionId: session.sessionId }, 'Session set')
    } catch (error) {
      logger.error({ error, playerId, sessionId: session.sessionId }, 'Failed to set session')
      throw new ClusterError('Failed to set session', 'SET_SESSION_ERROR', error)
    }
  }

  async getSession(playerId: string, sessionId?: string): Promise<SessionData | null> {
    const client = this.redisManager.getClient()

    try {
      // 如果指定了sessionId，直接获取该会话
      if (sessionId) {
        const sessionData = await client.hgetall(REDIS_KEYS.SESSION(playerId, sessionId))
        if (Object.keys(sessionData).length === 0) {
          return null
        }
        return this.deserializeSession(sessionData)
      }

      // 如果没有指定sessionId，获取最新的会话（向后兼容）
      const sessionIds = await client.smembers(REDIS_KEYS.PLAYER_SESSIONS(playerId))
      if (sessionIds.length === 0) {
        return null
      }

      // 使用 pipeline 批量获取所有会话数据，然后找到最新的
      const pipeline = client.pipeline()
      for (const sid of sessionIds) {
        pipeline.hgetall(REDIS_KEYS.SESSION(playerId, sid))
      }

      const results = await pipeline.exec()
      let latestSession: SessionData | null = null
      let latestTime = 0

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, sessionData] = results[i]
          if (!err && sessionData && Object.keys(sessionData).length > 0) {
            const session = this.deserializeSession(sessionData as Record<string, string>)
            if (session.lastAccessed > latestTime) {
              latestTime = session.lastAccessed
              latestSession = session
            }
          }
        }
      }

      return latestSession
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to get session')
      return null
    }
  }

  async getAllSessions(playerId: string): Promise<SessionData[]> {
    const client = this.redisManager.getClient()

    try {
      const sessionIds = await client.smembers(REDIS_KEYS.PLAYER_SESSIONS(playerId))
      if (sessionIds.length === 0) {
        return []
      }

      // 使用 pipeline 批量获取会话数据
      const pipeline = client.pipeline()
      for (const sessionId of sessionIds) {
        pipeline.hgetall(REDIS_KEYS.SESSION(playerId, sessionId))
      }

      const results = await pipeline.exec()
      const sessions: SessionData[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, sessionData] = results[i]
          if (!err && sessionData && Object.keys(sessionData).length > 0) {
            sessions.push(this.deserializeSession(sessionData as Record<string, string>))
          }
        }
      }

      // 按最后访问时间排序
      return sessions.sort((a, b) => b.lastAccessed - a.lastAccessed)
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to get all sessions')
      return []
    }
  }

  async removeSession(playerId: string, sessionId?: string): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      if (sessionId) {
        // 删除指定会话
        await client.del(REDIS_KEYS.SESSION(playerId, sessionId))
        await client.srem(REDIS_KEYS.PLAYER_SESSIONS(playerId), sessionId)
        await client.zrem(REDIS_KEYS.SESSION_INDEX, `${playerId}:${sessionId}`)
        logger.debug({ playerId, sessionId }, 'Session removed')
      } else {
        // 删除玩家的所有会话
        const sessionIds = await client.smembers(REDIS_KEYS.PLAYER_SESSIONS(playerId))

        for (const sid of sessionIds) {
          await client.del(REDIS_KEYS.SESSION(playerId, sid))
          await client.zrem(REDIS_KEYS.SESSION_INDEX, `${playerId}:${sid}`)
        }

        await client.del(REDIS_KEYS.PLAYER_SESSIONS(playerId))
        logger.debug({ playerId, sessionCount: sessionIds.length }, 'All sessions removed')
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to remove session')
    }
  }

  // === 认证黑名单管理 ===

  async addToAuthBlacklist(entry: AuthBlacklistEntry): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      await client.hset(REDIS_KEYS.AUTH_BLACKLIST(entry.jti), this.serializeAuthBlacklistEntry(entry))

      // 设置过期时间
      const ttl = entry.expiry - Date.now()
      if (ttl > 0) {
        await client.pexpire(REDIS_KEYS.AUTH_BLACKLIST(entry.jti), ttl)
      }

      logger.debug({ jti: entry.jti }, 'Token added to blacklist')
    } catch (error) {
      logger.error({ error, jti: entry.jti }, 'Failed to add token to blacklist')
      throw new ClusterError('Failed to add to blacklist', 'BLACKLIST_ADD_ERROR', error)
    }
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    const client = this.redisManager.getClient()

    try {
      const exists = await client.exists(REDIS_KEYS.AUTH_BLACKLIST(jti))
      return exists === 1
    } catch (error) {
      logger.error({ error, jti }, 'Failed to check token blacklist')
      return false
    }
  }

  async removeFromAuthBlacklist(jti: string): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      await client.del(REDIS_KEYS.AUTH_BLACKLIST(jti))
      logger.debug({ jti }, 'Token removed from blacklist')
    } catch (error) {
      logger.error({ error, jti }, 'Failed to remove token from blacklist')
    }
  }

  // === 私有方法 ===

  private setupEventListeners(): void {
    const subscriber = this.redisManager.getSubscriber()

    subscriber.subscribe(REDIS_KEYS.CLUSTER_EVENTS, err => {
      if (err) {
        logger.error({ error: err }, 'Failed to subscribe to cluster events')
      } else {
        logger.debug('Subscribed to cluster events')
      }
    })

    subscriber.on('message', (channel, message) => {
      if (channel === REDIS_KEYS.CLUSTER_EVENTS) {
        try {
          const event: ClusterEvent = JSON.parse(message)
          this.emit('clusterEvent', event)
        } catch (error) {
          logger.error({ error, message }, 'Failed to parse cluster event')
        }
      }
    })
  }

  private async publishEvent(event: ClusterEvent): Promise<void> {
    const publisher = this.redisManager.getPublisher()

    try {
      await publisher.publish(REDIS_KEYS.CLUSTER_EVENTS, JSON.stringify(event))
    } catch (error) {
      logger.error({ error, event }, 'Failed to publish cluster event')
    }
  }

  private startHeartbeat(): void {
    // 根据环境调整心跳频率：开发环境更频繁，生产环境适中
    const defaultInterval = process.env.NODE_ENV === 'development' ? 30000 : 45000 // 开发30秒，生产45秒
    const interval = this.config.cluster.heartbeatInterval || defaultInterval

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.updateInstanceLoad(this.currentInstance.connections, this.currentInstance.load)
      } catch (error) {
        logger.error({ error }, 'Heartbeat failed')
      }
    }, interval)

    logger.info({ interval: interval / 1000 }, 'Heartbeat started')
  }

  private startHealthCheck(): void {
    const interval = this.config.cluster.healthCheckInterval || 60000 // 60秒

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck()
      } catch (error) {
        logger.error({ error }, 'Health check failed')
      }
    }, interval)
  }

  private async performHealthCheck(): Promise<void> {
    // 检查Redis连接
    const isRedisHealthy = await this.redisManager.ping()

    if (!isRedisHealthy) {
      logger.error('Redis health check failed')
      this.currentInstance.status = 'unhealthy'
    } else {
      this.currentInstance.status = 'healthy'
    }

    // 使用优化的清理过期实例方法
    await this.cleanupExpiredInstancesOptimized()
  }

  // 序列化/反序列化方法
  private serializeInstance(instance: ServiceInstance): Record<string, string> {
    return {
      id: instance.id,
      host: instance.host,
      port: instance.port.toString(),
      rpcPort: instance.rpcPort?.toString() || '',
      rpcAddress: instance.rpcAddress || '',
      region: instance.region || '',
      status: instance.status,
      lastHeartbeat: instance.lastHeartbeat.toString(),
      connections: instance.connections.toString(),
      load: instance.load.toString(),
      metadata: JSON.stringify(instance.metadata || {}),
    }
  }

  private deserializeInstance(data: Record<string, string>): ServiceInstance {
    return {
      id: data.id,
      host: data.host,
      port: parseInt(data.port),
      rpcPort: data.rpcPort ? parseInt(data.rpcPort) : undefined,
      rpcAddress: data.rpcAddress || undefined,
      region: data.region || undefined,
      status: data.status as ServiceInstance['status'],
      lastHeartbeat: parseInt(data.lastHeartbeat),
      connections: parseInt(data.connections),
      load: parseFloat(data.load),
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    }
  }

  private serializeSessionConnection(connection: any): Record<string, string> {
    return {
      playerId: connection.playerId,
      sessionId: connection.sessionId,
      instanceId: connection.instanceId,
      socketId: connection.socketId,
      lastSeen: connection.lastSeen.toString(),
      status: connection.status,
      metadata: JSON.stringify(connection.metadata || {}),
    }
  }

  private deserializeSessionConnection(data: Record<string, string>): any {
    return {
      playerId: data.playerId,
      sessionId: data.sessionId,
      instanceId: data.instanceId,
      socketId: data.socketId,
      lastSeen: parseInt(data.lastSeen),
      status: data.status,
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    }
  }

  private serializeRoomState(room: RoomState): Record<string, string> {
    return {
      id: room.id,
      status: room.status,
      sessions: JSON.stringify(room.sessions),
      sessionPlayers: JSON.stringify(room.sessionPlayers || {}),
      instanceId: room.instanceId,
      lastActive: room.lastActive.toString(),
      battleState: JSON.stringify(room.battleState || null),
      metadata: JSON.stringify(room.metadata || {}),
    }
  }

  private deserializeRoomState(data: Record<string, string>): RoomState {
    return {
      id: data.id,
      status: data.status as RoomState['status'],
      sessions: JSON.parse(data.sessions),
      sessionPlayers: data.sessionPlayers ? JSON.parse(data.sessionPlayers) : {},
      instanceId: data.instanceId,
      lastActive: parseInt(data.lastActive),
      battleState: data.battleState ? JSON.parse(data.battleState) : undefined,
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    }
  }

  private serializeMatchmakingEntry(entry: MatchmakingEntry): Record<string, string> {
    return {
      playerId: entry.playerId,
      sessionId: entry.sessionId || '',
      joinTime: entry.joinTime.toString(),
      playerData: JSON.stringify(entry.playerData),
      preferences: JSON.stringify(entry.preferences || {}),
      metadata: JSON.stringify(entry.metadata || {}),
    }
  }

  private deserializeMatchmakingEntry(data: Record<string, string>): MatchmakingEntry {
    return {
      playerId: data.playerId,
      sessionId: data.sessionId || undefined,
      joinTime: parseInt(data.joinTime),
      playerData: JSON.parse(data.playerData),
      preferences: data.preferences ? JSON.parse(data.preferences) : undefined,
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    }
  }

  private serializeSession(session: SessionData): Record<string, string> {
    return {
      playerId: session.playerId,
      sessionId: session.sessionId,
      accessToken: session.accessToken || '',
      refreshToken: session.refreshToken || '',
      expiry: session.expiry?.toString() || '',
      instanceId: session.instanceId || '',
      createdAt: session.createdAt.toString(),
      lastAccessed: session.lastAccessed.toString(),
      metadata: JSON.stringify(session.metadata || {}),
    }
  }

  private deserializeSession(data: Record<string, string>): SessionData {
    return {
      playerId: data.playerId,
      sessionId: data.sessionId,
      accessToken: data.accessToken || undefined,
      refreshToken: data.refreshToken || undefined,
      expiry: data.expiry ? parseInt(data.expiry) : undefined,
      instanceId: data.instanceId || undefined,
      createdAt: parseInt(data.createdAt),
      lastAccessed: parseInt(data.lastAccessed),
      metadata: data.metadata ? JSON.parse(data.metadata) : undefined,
    }
  }

  private serializeAuthBlacklistEntry(entry: AuthBlacklistEntry): Record<string, string> {
    return {
      jti: entry.jti,
      expiry: entry.expiry.toString(),
      reason: entry.reason || '',
      revokedAt: entry.revokedAt.toString(),
    }
  }

  // === 缓存优化 ===

  private instanceCache = new Map<string, { instance: ServiceInstance; timestamp: number }>()
  private readonly CACHE_TTL = 30000 // 30秒缓存

  // 集群统计缓存
  private clusterStatsCache: { stats: ClusterStats; timestamp: number } | null = null
  private readonly CLUSTER_STATS_CACHE_TTL = 15000 // 15秒缓存，比实例缓存更短

  // 玩家连接索引缓存
  private playerConnectionsCache: { connections: PlayerConnection[]; timestamp: number } | null = null
  private readonly PLAYER_CONNECTIONS_CACHE_TTL = 10000 // 10秒缓存

  /**
   * 带缓存的获取实例信息
   */
  async getInstanceCached(instanceId: string): Promise<ServiceInstance | null> {
    const now = Date.now()
    const cached = this.instanceCache.get(instanceId)

    // 检查缓存是否有效
    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.instance
    }

    // 缓存失效或不存在，从 Redis 获取
    const instance = await this.getInstance(instanceId)

    if (instance) {
      this.instanceCache.set(instanceId, { instance, timestamp: now })
    } else {
      // 如果实例不存在，从缓存中删除
      this.instanceCache.delete(instanceId)
    }

    return instance
  }

  /**
   * 清理过期的缓存条目
   */
  private cleanupCache(): void {
    const now = Date.now()
    for (const [instanceId, cached] of this.instanceCache.entries()) {
      if (now - cached.timestamp >= this.CACHE_TTL) {
        this.instanceCache.delete(instanceId)
      }
    }
  }

  /**
   * 清除玩家连接缓存
   */
  private invalidatePlayerConnectionsCache(): void {
    this.playerConnectionsCache = null
  }

  /**
   * 清除集群统计缓存
   */
  private invalidateClusterStatsCache(): void {
    this.clusterStatsCache = null
  }

  /**
   * 重建活跃玩家索引（用于初始化或修复）
   */
  async rebuildActivePlayersIndex(): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      logger.info('Rebuilding active players index...')

      // 清空现有索引
      await client.del(REDIS_KEYS.ACTIVE_PLAYERS)

      // 使用SCAN命令遍历所有玩家连接键，避免KEYS命令
      const stream = client.scanStream({
        match: REDIS_KEYS.PLAYER_SESSION_CONNECTIONS('*'),
        count: 100,
      })

      const activePlayerIds = new Set<string>()

      for await (const keys of stream) {
        for (const key of keys) {
          // 从key中提取playerId: arcadia:player:sessions:connections:playerId
          const playerId = key.split(':').pop()
          if (playerId) {
            // 检查该玩家是否有活跃连接
            const connectionCount = await client.scard(key)
            if (connectionCount > 0) {
              activePlayerIds.add(playerId)
            }
          }
        }
      }

      // 批量添加到活跃玩家索引
      if (activePlayerIds.size > 0) {
        await client.sadd(REDIS_KEYS.ACTIVE_PLAYERS, ...Array.from(activePlayerIds))
      }

      logger.info({ activePlayersCount: activePlayerIds.size }, 'Active players index rebuilt')
    } catch (error) {
      logger.error({ error }, 'Failed to rebuild active players index')
    }
  }

  /**
   * 优化的清理过期实例方法，使用缓存减少 Redis 查询
   */
  private async cleanupExpiredInstancesOptimized(): Promise<void> {
    try {
      // 先清理内存缓存
      this.cleanupCache()

      const instanceIds = await this.redisManager.getClient().smembers(REDIS_KEYS.SERVICE_INSTANCES)
      if (instanceIds.length === 0) {
        return
      }

      // 批量获取实例信息
      const instances = await this.getInstancesBatch(instanceIds)
      const now = Date.now()
      const timeout = this.config.cluster.failoverTimeout || 120000 // 2分钟

      const expiredInstanceIds: string[] = []

      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i]
        if (instance && now - instance.lastHeartbeat > timeout) {
          expiredInstanceIds.push(instance.id)
          // 从缓存中删除过期实例
          this.instanceCache.delete(instance.id)
        }
      }

      // 批量删除过期实例
      if (expiredInstanceIds.length > 0) {
        const client = this.redisManager.getClient()
        const pipeline = client.pipeline()

        for (const instanceId of expiredInstanceIds) {
          logger.warn({ instanceId }, 'Removing expired instance')
          pipeline.srem(REDIS_KEYS.SERVICE_INSTANCES, instanceId)
          pipeline.del(REDIS_KEYS.SERVICE_INSTANCE(instanceId))
        }

        await pipeline.exec()
      }
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup expired instances')
    }
  }

  // === 批量操作优化方法 ===

  /**
   * 批量获取多个实例信息
   */
  async getInstancesBatch(instanceIds: string[]): Promise<(ServiceInstance | null)[]> {
    if (instanceIds.length === 0) {
      return []
    }

    const client = this.redisManager.getClient()

    try {
      const pipeline = client.pipeline()
      for (const instanceId of instanceIds) {
        pipeline.hgetall(REDIS_KEYS.SERVICE_INSTANCE(instanceId))
      }

      const results = await pipeline.exec()
      const instances: (ServiceInstance | null)[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, instanceData] = results[i]
          if (!err && instanceData && Object.keys(instanceData).length > 0) {
            instances.push(this.deserializeInstance(instanceData as Record<string, string>))
          } else {
            instances.push(null)
          }
        }
      }

      return instances
    } catch (error) {
      logger.error({ error, instanceIds }, 'Failed to get instances batch')
      return instanceIds.map(() => null)
    }
  }

  /**
   * 批量获取多个房间状态
   */
  async getRoomStatesBatch(roomIds: string[]): Promise<(RoomState | null)[]> {
    if (roomIds.length === 0) {
      return []
    }

    const client = this.redisManager.getClient()

    try {
      const pipeline = client.pipeline()
      for (const roomId of roomIds) {
        pipeline.hgetall(REDIS_KEYS.ROOM(roomId))
      }

      const results = await pipeline.exec()
      const rooms: (RoomState | null)[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, roomData] = results[i]
          if (!err && roomData && Object.keys(roomData).length > 0) {
            rooms.push(this.deserializeRoomState(roomData as Record<string, string>))
          } else {
            rooms.push(null)
          }
        }
      }

      return rooms
    } catch (error) {
      logger.error({ error, roomIds }, 'Failed to get room states batch')
      return roomIds.map(() => null)
    }
  }

  /**
   * 批量检查多个 token 是否在黑名单中
   */
  async areTokensBlacklisted(jtis: string[]): Promise<boolean[]> {
    if (jtis.length === 0) {
      return []
    }

    const client = this.redisManager.getClient()

    try {
      const pipeline = client.pipeline()
      for (const jti of jtis) {
        pipeline.exists(REDIS_KEYS.AUTH_BLACKLIST(jti))
      }

      const results = await pipeline.exec()
      const blacklistStatus: boolean[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, exists] = results[i]
          blacklistStatus.push(!err && exists === 1)
        }
      }

      return blacklistStatus
    } catch (error) {
      logger.error({ error, jtis }, 'Failed to check tokens blacklist batch')
      return jtis.map(() => false)
    }
  }

  // === 统计信息 ===

  async getClusterStats(): Promise<ClusterStats> {
    try {
      // 检查缓存
      const now = Date.now()
      if (this.clusterStatsCache && now - this.clusterStatsCache.timestamp < this.CLUSTER_STATS_CACHE_TTL) {
        return this.clusterStatsCache.stats
      }

      // 缓存失效，重新计算
      const [instances, playerConnections, rooms, queueSize] = await Promise.all([
        this.getInstances(),
        this.getPlayerConnectionsOptimized(),
        this.getRooms(),
        this.getMatchmakingQueueSize(),
      ])

      const healthyInstances = instances.filter(i => i.status === 'healthy').length
      const connectedPlayers = playerConnections.filter(p => p.status === 'connected').length
      const activeRooms = rooms.filter(r => r.status === 'active').length
      const waitingRooms = rooms.filter(r => r.status === 'waiting').length
      const endedRooms = rooms.filter(r => r.status === 'ended').length

      // 计算平均等待时间
      const queue = await this.getMatchmakingQueue()
      const averageWaitTime =
        queue.length > 0 ? queue.reduce((sum, entry) => sum + (now - entry.joinTime), 0) / queue.length : 0

      const stats: ClusterStats = {
        instances: {
          total: instances.length,
          healthy: healthyInstances,
          unhealthy: instances.length - healthyInstances,
        },
        players: {
          total: playerConnections.length,
          connected: connectedPlayers,
          disconnected: playerConnections.length - connectedPlayers,
        },
        rooms: {
          total: rooms.length,
          waiting: waitingRooms,
          active: activeRooms,
          ended: endedRooms,
        },
        matchmaking: {
          queueSize,
          averageWaitTime,
        },
      }

      // 更新缓存
      this.clusterStatsCache = { stats, timestamp: now }
      return stats
    } catch (error) {
      logger.error({ error }, 'Failed to get cluster stats')
      throw new ClusterError('Failed to get cluster stats', 'GET_STATS_ERROR', error)
    }
  }

  /**
   * 优化的获取玩家连接方法，使用缓存和索引避免KEYS命令
   */
  private async getPlayerConnectionsOptimized(): Promise<PlayerConnection[]> {
    try {
      // 检查缓存
      const now = Date.now()
      if (
        this.playerConnectionsCache &&
        now - this.playerConnectionsCache.timestamp < this.PLAYER_CONNECTIONS_CACHE_TTL
      ) {
        return this.playerConnectionsCache.connections
      }

      const client = this.redisManager.getClient()

      // 使用全局玩家连接索引，避免KEYS命令
      const activePlayerIds = await client.smembers(REDIS_KEYS.ACTIVE_PLAYERS)

      if (activePlayerIds.length === 0) {
        // 缓存空结果
        this.playerConnectionsCache = { connections: [], timestamp: now }
        return []
      }

      const connections: PlayerConnection[] = []

      // 批量获取玩家连接，使用pipeline优化
      const pipeline = client.pipeline()
      for (const playerId of activePlayerIds) {
        pipeline.smembers(REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId))
      }

      const sessionResults = await pipeline.exec()

      // 收集所有需要获取的连接数据
      const connectionPipeline = client.pipeline()
      const playerSessionMap: Array<{ playerId: string; sessionIds: string[] }> = []

      if (sessionResults) {
        for (let i = 0; i < sessionResults.length; i++) {
          const [err, sessionIds] = sessionResults[i]
          if (!err && Array.isArray(sessionIds) && sessionIds.length > 0) {
            const playerId = activePlayerIds[i]
            playerSessionMap.push({ playerId, sessionIds })

            // 为每个会话添加获取连接数据的命令
            for (const sessionId of sessionIds) {
              connectionPipeline.hgetall(REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, sessionId))
            }
          }
        }
      }

      // 批量获取连接数据
      const connectionResults = await connectionPipeline.exec()

      if (connectionResults) {
        let resultIndex = 0
        for (const { sessionIds } of playerSessionMap) {
          for (let i = 0; i < sessionIds.length; i++) {
            const [err, connectionData] = connectionResults[resultIndex++]
            if (!err && connectionData && Object.keys(connectionData).length > 0) {
              const connection = this.deserializeSessionConnection(connectionData as Record<string, string>)
              connections.push({
                instanceId: connection.instanceId,
                socketId: connection.socketId,
                lastSeen: connection.lastSeen,
                status: connection.status,
                sessionId: connection.sessionId,
                metadata: connection.metadata,
              })
            }
          }
        }
      }

      // 更新缓存
      this.playerConnectionsCache = { connections, timestamp: now }

      return connections
    } catch (error) {
      logger.error({ error }, 'Failed to get optimized player connections')
      return []
    }
  }

  /**
   * 原始的获取玩家连接方法（保留作为备用）
   * @deprecated 使用 getPlayerConnectionsOptimized 替代
   */
  private async getPlayerConnections(): Promise<PlayerConnection[]> {
    const client = this.redisManager.getClient()

    try {
      // 避免使用 keys() 命令，改为维护一个玩家连接索引
      // 这里我们需要重构为使用一个专门的索引集合来跟踪活跃的玩家连接
      // 暂时保留原逻辑，但添加警告日志
      logger.warn('getPlayerConnections() uses KEYS command which may impact performance in production')

      // 获取所有玩家的session连接
      const allSessionKeys = await client.keys(REDIS_KEYS.PLAYER_SESSION_CONNECTIONS('*'))
      const connections: PlayerConnection[] = []

      // 使用 Set 来避免重复处理同一个 playerId
      const processedPlayerIds = new Set<string>()

      for (const sessionKey of allSessionKeys) {
        // 从key中提取playerId: arcadia:player:sessions:connections:playerId
        const playerId = sessionKey.split(':').pop()
        if (playerId && !processedPlayerIds.has(playerId)) {
          processedPlayerIds.add(playerId)
          const playerConnections = await this.getAllPlayerConnections(playerId)
          connections.push(...playerConnections)
        }
      }

      return connections
    } catch (error) {
      logger.error({ error }, 'Failed to get player connections')
      return []
    }
  }

  private async getRooms(): Promise<RoomState[]> {
    const client = this.redisManager.getClient()

    try {
      const roomIds = await client.smembers(REDIS_KEYS.ROOMS)
      if (roomIds.length === 0) {
        return []
      }

      // 使用 pipeline 批量获取房间数据，避免 N+1 查询问题
      const pipeline = client.pipeline()
      for (const roomId of roomIds) {
        pipeline.hgetall(REDIS_KEYS.ROOM(roomId))
      }

      const results = await pipeline.exec()
      const rooms: RoomState[] = []

      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [err, roomData] = results[i]
          if (!err && roomData && Object.keys(roomData).length > 0) {
            rooms.push(this.deserializeRoomState(roomData as Record<string, string>))
          }
        }
      }

      return rooms
    } catch (error) {
      logger.error({ error }, 'Failed to get rooms')
      return []
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up cluster state manager')

      // 停止定时器
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer)
      }

      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer)
      }

      // 清理内存缓存
      this.instanceCache.clear()
      this.clusterStatsCache = null
      this.playerConnectionsCache = null

      // 注销实例
      await this.unregisterInstance()

      logger.info('Cluster state manager cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during cluster state manager cleanup')
    }
  }
}
