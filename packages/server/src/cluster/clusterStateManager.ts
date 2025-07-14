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
import { dedupRedisCall } from './redisCallDeduplicator'
import { TTLHelper } from './ttlConfig'
import { RuleBasedQueueManager } from './ruleBasedQueueManager'
import type { InstancePerformanceData } from './performanceTracker'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export class ClusterStateManager extends EventEmitter {
  public redisManager: RedisClientManager
  private _lockManager: DistributedLockManager
  private config: ClusterConfig
  public currentInstance: ServiceInstance
  private heartbeatTimer?: NodeJS.Timeout
  private healthCheckTimer?: NodeJS.Timeout
  private ruleBasedQueueManager: RuleBasedQueueManager
  private isPerformingHealthCheck = false // 防止重复健康检查

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
      performance: {
        cpuUsage: 0,
        memoryUsage: 0,
        memoryUsedMB: 0,
        memoryTotalMB: 0,
        activeBattles: 0,
        queuedPlayers: 0,
        avgResponseTime: 0,
        errorRate: 0,
        lastUpdated: Date.now(),
      },
      metadata: {
        isFlyIo: config.instance.isFlyIo || false,
      },
    }

    // 初始化基于规则的队列管理器
    this.ruleBasedQueueManager = new RuleBasedQueueManager(this.redisManager)
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

      // 获取实例数据 TTL
      const instanceDataTTL = TTLHelper.getTTLForDataType('serviceInstance', 'data')
      const heartbeatTTL = TTLHelper.getTTLForDataType('serviceInstance', 'heartbeat')

      const instanceKey = REDIS_KEYS.SERVICE_INSTANCE(this.currentInstance.id)

      // 使用 pipeline 批量执行操作
      const pipeline = client.pipeline()

      // 添加到实例集合并设置 TTL
      pipeline.sadd(REDIS_KEYS.SERVICE_INSTANCES, this.currentInstance.id)
      if (heartbeatTTL > 0) {
        pipeline.pexpire(REDIS_KEYS.SERVICE_INSTANCES, heartbeatTTL)
      }

      // 存储实例详细信息并设置 TTL
      pipeline.hset(instanceKey, this.serializeInstance(this.currentInstance))
      if (instanceDataTTL > 0) {
        pipeline.pexpire(instanceKey, instanceDataTTL)
      }

      // 执行批量操作
      await pipeline.exec()

      logger.info({ instance: this.currentInstance, ttl: instanceDataTTL }, 'Instance registered successfully with TTL')
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
    return dedupRedisCall('cluster:getInstances', async () => {
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
        const now = Date.now()

        // 计算实例过期时间阈值
        const isProduction = process.env.NODE_ENV === 'production'
        const heartbeatInterval = this.config.cluster.heartbeatInterval || (isProduction ? 300000 : 120000)
        const staleTimeout = heartbeatInterval * 2 // 2倍心跳间隔作为超时时间

        if (results) {
          for (let i = 0; i < results.length; i++) {
            const [err, instanceData] = results[i]
            if (!err && instanceData && Object.keys(instanceData).length > 0) {
              const instance = this.deserializeInstance(instanceData as Record<string, string>)

              // 检查实例是否过期
              const timeSinceLastHeartbeat = now - instance.lastHeartbeat
              if (timeSinceLastHeartbeat <= staleTimeout) {
                instances.push(instance)
              } else {
                // 记录过期实例但不返回
                logger.debug(
                  {
                    instanceId: instance.id,
                    timeSinceLastHeartbeat: Math.floor(timeSinceLastHeartbeat / 1000),
                    staleTimeoutSeconds: Math.floor(staleTimeout / 1000),
                  },
                  'Filtering out stale instance from getInstances result',
                )
              }
            }
          }
        }

        return instances
      } catch (error) {
        logger.error({ error }, 'Failed to get instances')
        throw new ClusterError('Failed to get instances', 'GET_INSTANCES_ERROR', error)
      }
    })
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
      // 获取实例数据 TTL
      const instanceDataTTL = TTLHelper.getTTLForDataType('serviceInstance', 'data')
      const heartbeatTTL = TTLHelper.getTTLForDataType('serviceInstance', 'heartbeat')

      const instanceKey = REDIS_KEYS.SERVICE_INSTANCE(this.currentInstance.id)

      // 使用 pipeline 批量执行操作
      const pipeline = client.pipeline()

      // 更新实例信息并刷新 TTL
      pipeline.hset(instanceKey, this.serializeInstance(this.currentInstance))
      if (instanceDataTTL > 0) {
        pipeline.pexpire(instanceKey, instanceDataTTL)
      }

      // 刷新实例集合的 TTL
      if (heartbeatTTL > 0) {
        pipeline.pexpire(REDIS_KEYS.SERVICE_INSTANCES, heartbeatTTL)
      }

      // 执行批量操作
      await pipeline.exec()

      // 异步发布实例更新事件，不阻塞主流程
      this.publishEvent({
        type: 'instance:update',
        data: this.currentInstance,
      }).catch(error => {
        logger.error({ error }, 'Failed to publish instance update event')
      })
    } catch (error) {
      logger.error({ error }, 'Failed to update instance load')
    }
  }

  /**
   * 更新实例性能数据
   */
  async updateInstancePerformance(performanceData: Partial<InstancePerformanceData>): Promise<void> {
    try {
      // 更新性能数据
      this.currentInstance.performance = {
        ...this.currentInstance.performance,
        ...performanceData,
        lastUpdated: Date.now(),
      }

      this.currentInstance.lastHeartbeat = Date.now()

      const client = this.redisManager.getClient()

      // 获取实例数据 TTL
      const instanceDataTTL = TTLHelper.getTTLForDataType('serviceInstance', 'data')
      const heartbeatTTL = TTLHelper.getTTLForDataType('serviceInstance', 'heartbeat')

      const instanceKey = REDIS_KEYS.SERVICE_INSTANCE(this.currentInstance.id)

      // 使用 pipeline 批量执行操作
      const pipeline = client.pipeline()

      // 更新实例信息并刷新 TTL
      pipeline.hset(instanceKey, this.serializeInstance(this.currentInstance))
      if (instanceDataTTL > 0) {
        pipeline.pexpire(instanceKey, instanceDataTTL)
      }

      // 刷新实例集合的 TTL
      if (heartbeatTTL > 0) {
        pipeline.pexpire(REDIS_KEYS.SERVICE_INSTANCES, heartbeatTTL)
      }

      // 执行批量操作
      await pipeline.exec()

      // 异步发布实例更新事件，不阻塞主流程
      this.publishEvent({
        type: 'instance:update',
        data: this.currentInstance,
      }).catch(error => {
        logger.error({ error }, 'Failed to publish instance performance update event')
      })

      logger.debug(
        {
          instanceId: this.currentInstance.id,
          performance: this.currentInstance.performance,
        },
        'Instance performance data updated',
      )
    } catch (error) {
      logger.error({ error, performanceData }, 'Failed to update instance performance')
    }
  }

  // === 玩家连接管理 - 支持多会话 ===

  async setPlayerConnection(playerId: string, connection: PlayerConnection): Promise<void> {
    try {
      await this.setPlayerConnectionInternal(playerId, connection)
    } catch (error) {
      logger.warn({ error, playerId, sessionId: connection.sessionId }, 'Failed to set player connection, no retry')
      // 不重试，直接抛出错误
      throw new ClusterError('Failed to set player connection', 'SET_CONNECTION_ERROR', error)
    }
  }

  private async setPlayerConnectionInternal(playerId: string, connection: PlayerConnection): Promise<void> {
    const client = this.redisManager.getClient()

    // sessionId是必需的
    if (!connection.sessionId) {
      throw new ClusterError('SessionId is required for player connection', 'MISSING_SESSION_ID')
    }

    // 获取连接相关的 TTL
    const connectionTTL = TTLHelper.getTTLForDataType('playerConnection')
    const indexTTL = TTLHelper.getTTLForDataType('playerConnection', 'index')

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

    // 使用事务确保原子性操作，添加超时保护
    const multi = client.multi()

    // 存储会话连接并设置 TTL
    const connectionKey = REDIS_KEYS.PLAYER_SESSION_CONNECTION(playerId, connection.sessionId)
    multi.hset(connectionKey, this.serializeSessionConnection(sessionConnection))
    multi.expire(connectionKey, Math.floor(connectionTTL / 1000))

    // 添加到玩家的会话连接集合并设置 TTL
    const connectionsKey = REDIS_KEYS.PLAYER_SESSION_CONNECTIONS(playerId)
    multi.sadd(connectionsKey, connection.sessionId)
    multi.expire(connectionsKey, Math.floor(connectionTTL / 1000))

    // 添加到活跃玩家索引并设置 TTL
    multi.sadd(REDIS_KEYS.ACTIVE_PLAYERS, playerId)
    multi.expire(REDIS_KEYS.ACTIVE_PLAYERS, Math.floor(indexTTL / 1000))

    // 执行事务，添加超时保护
    const results = (await Promise.race([
      multi.exec(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Player connection transaction timeout')), 5000)),
    ])) as any[]

    // 检查事务执行结果
    if (!results || results.some((result: any) => result[0] !== null)) {
      const errors = results
        ? results.filter((result: any) => result[0] !== null).map((result: any) => result[0])
        : ['Transaction failed']
      throw new Error(`Player connection transaction failed: ${errors.map(e => e.message || e).join(', ')}`)
    }

    // 异步发布玩家连接事件，不阻塞主流程
    this.publishEvent({
      type: 'player:connect',
      data: { playerId, connection },
    }).catch(error => {
      logger.error({ error, playerId, sessionId: connection.sessionId }, 'Failed to publish player connect event')
    })

    logger.debug({ playerId, sessionId: connection.sessionId, connectionTTL }, 'Player connection set with TTL')
  }

  /**
   * 强制刷新连接状态（用于重连场景）
   */
  async forceRefreshPlayerConnection(playerId: string, sessionId: string): Promise<PlayerConnection | null> {
    try {
      // 先从Redis直接获取最新状态，绕过任何缓存
      const connection = await this.getPlayerConnectionBySession(playerId, sessionId)

      if (connection) {
        // 更新lastSeen时间戳以确保连接活跃
        const refreshedConnection: PlayerConnection = {
          ...connection,
          lastSeen: Date.now(),
          metadata: {
            ...connection.metadata,
            lastRefresh: Date.now(),
          },
        }

        await this.setPlayerConnection(playerId, refreshedConnection)
        logger.debug({ playerId, sessionId }, 'Player connection force refreshed')
        return refreshedConnection
      }

      return null
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to force refresh player connection')
      return null
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

      // 移除缓存失效逻辑

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
    const maxRetries = 3
    let lastError: any

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.setRoomStateInternal(roomState)
        return // 成功则直接返回
      } catch (error) {
        lastError = error
        logger.warn(
          { error, roomId: roomState.id, attempt, maxRetries },
          `Failed to set room state, attempt ${attempt}/${maxRetries}`,
        )

        // 如果不是最后一次尝试，等待后重试
        if (attempt < maxRetries) {
          const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000) // 指数退避，最大1秒
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    // 所有重试都失败，抛出错误
    logger.error({ error: lastError, roomId: roomState.id }, 'Failed to set room state after all retries')
    throw new ClusterError('Failed to set room state', 'SET_ROOM_ERROR', lastError)
  }

  private async setRoomStateInternal(roomState: RoomState): Promise<void> {
    const client = this.redisManager.getClient()

    // 根据房间状态获取相应的 TTL
    const roomTTL = TTLHelper.getDynamicTTL('room', roomState.status, roomState.lastActive)
    const indexTTL = TTLHelper.getTTLForDataType('room', 'index')

    const roomKey = REDIS_KEYS.ROOM(roomState.id)

    // 首先检查房间是否已存在，以确定事件类型
    const roomExists = await client.exists(roomKey)
    const eventType = roomExists > 0 ? 'room:update' : 'room:create'

    // 使用 pipeline 批量执行 Redis 操作，减少网络往返
    const pipeline = client.pipeline()

    // 存储房间状态并设置 TTL
    pipeline.hset(roomKey, this.serializeRoomState(roomState))
    if (roomTTL > 0) {
      pipeline.pexpire(roomKey, roomTTL)
    }

    // 添加到房间集合并设置 TTL
    pipeline.sadd(REDIS_KEYS.ROOMS, roomState.id)
    if (indexTTL > 0) {
      pipeline.pexpire(REDIS_KEYS.ROOMS, indexTTL)
    }

    // 执行批量操作，添加超时保护
    const results = (await Promise.race([
      pipeline.exec(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Pipeline execution timeout')), 8000)),
    ])) as any[]

    // 检查pipeline执行结果
    if (results && results.some((result: any) => result[0] !== null)) {
      const errors = results.filter((result: any) => result[0] !== null).map((result: any) => result[0])
      throw new Error(`Pipeline execution failed: ${errors.map(e => e.message).join(', ')}`)
    }

    // 异步发布房间事件，不阻塞主流程
    this.publishEvent({
      type: eventType as 'room:create' | 'room:update',
      data: roomState,
    }).catch(error => {
      logger.error({ error, roomId: roomState.id }, 'Failed to publish room event')
    })

    logger.debug({ roomId: roomState.id, status: roomState.status, roomTTL }, 'Room state set with TTL')
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

      // 移除缓存失效逻辑

      logger.debug({ roomId }, 'Room state removed')
    } catch (error) {
      logger.error({ error, roomId }, 'Failed to remove room state')
    }
  }

  // === 匹配队列管理 ===

  async getMatchmakingQueueSize(): Promise<number> {
    return dedupRedisCall('cluster:getMatchmakingQueueSize', async () => {
      try {
        // 获取所有规则集队列的总大小
        const activeRuleSetIds = await this.ruleBasedQueueManager.getActiveRuleSetIds()
        let totalSize = 0

        for (const ruleSetId of activeRuleSetIds) {
          const queue = await this.ruleBasedQueueManager.getRuleBasedQueue(ruleSetId)
          totalSize += queue.length
        }

        return totalSize
      } catch (error) {
        logger.error({ error }, 'Failed to get matchmaking queue size')
        return 0
      }
    })
  }

  /**
   * 添加玩家到匹配队列
   * @param entry 匹配条目（包含游戏模式和规则集信息）
   */
  async addToMatchmakingQueue(entry: MatchmakingEntry): Promise<void> {
    // 添加到基于规则的队列
    await this.ruleBasedQueueManager.addToRuleBasedQueue(entry)

    // 发布匹配加入事件，触发匹配逻辑
    this.publishEvent({
      type: 'matchmaking:join',
      data: entry,
    }).catch(error => {
      logger.error(
        { error, playerId: entry.playerId, sessionId: entry.sessionId },
        'Failed to publish matchmaking join event',
      )
    })
  }

  /**
   * 从匹配队列中移除玩家
   * @param playerId 玩家ID
   * @param sessionId 会话ID
   */
  async removeFromMatchmakingQueue(playerId: string, sessionId?: string): Promise<void> {
    // 从基于规则的队列中移除
    await this.ruleBasedQueueManager.removeFromRuleBasedQueue(playerId, sessionId)
  }

  /**
   * 获取匹配队列（为了向后兼容，返回所有规则集的队列）
   * @returns 匹配条目列表
   */
  async getMatchmakingQueue(): Promise<MatchmakingEntry[]> {
    const activeRuleSetIds = await this.ruleBasedQueueManager.getActiveRuleSetIds()
    const allEntries: MatchmakingEntry[] = []

    for (const ruleSetId of activeRuleSetIds) {
      const queue = await this.ruleBasedQueueManager.getRuleBasedQueue(ruleSetId)
      allEntries.push(...queue)
    }

    return allEntries.sort((a, b) => a.joinTime - b.joinTime)
  }

  /**
   * 获取所有活跃的规则集ID
   * @returns 活跃的规则集ID列表
   */
  async getActiveRuleSetIds(): Promise<string[]> {
    return this.ruleBasedQueueManager.getActiveRuleSetIds()
  }

  /**
   * 获取特定规则集的队列
   * @param ruleSetId 规则集ID
   * @returns 匹配条目列表
   */
  async getRuleBasedQueue(ruleSetId: string = 'standard'): Promise<MatchmakingEntry[]> {
    return this.ruleBasedQueueManager.getRuleBasedQueue(ruleSetId)
  }

  /**
   * 获取所有活跃的队列信息
   * @returns 队列信息列表
   */
  async getAllActiveQueues(): Promise<
    Array<{
      ruleSetId: string
      queueKey: string
      playerCount: number
    }>
  > {
    return this.ruleBasedQueueManager.getAllActiveQueues()
  }

  // === 会话管理 - 支持多会话 ===

  async setSession(playerId: string, session: SessionData): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      // 获取会话相关的 TTL
      const sessionDataTTL = TTLHelper.getTTLForDataType('session')
      const sessionIndexTTL = TTLHelper.getTTLForDataType('session', 'index')

      // 计算实际的 TTL（使用配置的 TTL 或会话的过期时间，取较小值）
      let actualTTL = sessionDataTTL
      if (session.expiry) {
        const sessionTTL = session.expiry - Date.now()
        if (sessionTTL > 0) {
          actualTTL = Math.min(actualTTL, sessionTTL)
        }
      }

      // 存储具体的会话数据并设置 TTL
      const sessionKey = REDIS_KEYS.SESSION(playerId, session.sessionId)
      await client.hset(sessionKey, this.serializeSession(session))
      await TTLHelper.setKeyTTL(client, sessionKey, actualTTL)

      // 将会话ID添加到玩家的会话列表中并设置 TTL
      const playerSessionsKey = REDIS_KEYS.PLAYER_SESSIONS(playerId)
      await client.sadd(playerSessionsKey, session.sessionId)
      await TTLHelper.setKeyTTL(client, playerSessionsKey, sessionDataTTL)

      // 添加到全局会话索引（用于清理）并设置 TTL
      await client.zadd(REDIS_KEYS.SESSION_INDEX, session.createdAt, `${playerId}:${session.sessionId}`)
      await TTLHelper.setKeyTTL(client, REDIS_KEYS.SESSION_INDEX, sessionIndexTTL)

      logger.debug({ playerId, sessionId: session.sessionId, actualTTL }, 'Session set with TTL')
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
      // 获取认证黑名单的默认 TTL
      const defaultTTL = TTLHelper.getTTLForDataType('auth')

      // 计算实际的 TTL（使用条目的过期时间或默认 TTL，取较小值）
      const entryTTL = entry.expiry - Date.now()
      const actualTTL = entryTTL > 0 ? Math.min(entryTTL, defaultTTL) : defaultTTL

      // 存储黑名单条目并设置 TTL
      const blacklistKey = REDIS_KEYS.AUTH_BLACKLIST(entry.jti)
      await client.hset(blacklistKey, this.serializeAuthBlacklistEntry(entry))

      if (actualTTL > 0) {
        await TTLHelper.setKeyTTL(client, blacklistKey, actualTTL)
      }

      logger.debug({ jti: entry.jti, actualTTL }, 'Token added to blacklist with TTL')
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
    // 大幅延长心跳频率以节约 Redis 命令：开发环境2分钟，生产环境5分钟
    const defaultInterval = process.env.NODE_ENV === 'development' ? 120000 : 300000 // 开发2分钟，生产5分钟
    const interval = this.config.cluster.heartbeatInterval || defaultInterval

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.updateInstanceLoad(this.currentInstance.connections, this.currentInstance.load)
      } catch (error) {
        logger.error({ error }, 'Heartbeat failed')
      }
    }, interval)

    logger.info({ interval: interval / 1000 }, 'Heartbeat started (optimized for cost reduction)')
  }

  private startHealthCheck(): void {
    // 延长健康检查间隔以节约 Redis 命令：10分钟检查一次
    const interval = this.config.cluster.healthCheckInterval || 600000 // 10分钟

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.performHealthCheck()
      } catch (error) {
        logger.error({ error }, 'Health check failed')
      }
    }, interval)

    logger.info({ interval: interval / 1000 }, 'Health check started (optimized for cost reduction)')
  }

  private async performHealthCheck(): Promise<void> {
    // 防止重复健康检查
    if (this.isPerformingHealthCheck) {
      logger.debug('Health check already in progress, skipping')
      return
    }

    this.isPerformingHealthCheck = true
    try {
      // 检查Redis连接
      const isRedisHealthy = await this.redisManager.ping()

      if (!isRedisHealthy) {
        logger.error('Redis health check failed')
        this.currentInstance.status = 'unhealthy'
      } else {
        this.currentInstance.status = 'healthy'
      }

      // 主动清理过期和不健康的实例
      await this.cleanupStaleInstances()

      // 清理本地缓存
      this.cleanupCache()
    } finally {
      this.isPerformingHealthCheck = false
    }
  }

  /**
   * 主动清理过期和不健康的实例
   * 这个方法会检查所有实例的心跳时间，并清理那些长时间没有心跳的实例
   */
  private async cleanupStaleInstances(): Promise<void> {
    const client = this.redisManager.getClient()
    const now = Date.now()

    // 使用较短的超时时间来快速检测崩溃的实例
    // 生产环境：心跳间隔5分钟，超时时间设为10分钟（2倍心跳间隔）
    // 开发环境：心跳间隔2分钟，超时时间设为5分钟
    const isProduction = process.env.NODE_ENV === 'production'
    const heartbeatInterval = this.config.cluster.heartbeatInterval || (isProduction ? 300000 : 120000)
    const staleTimeout = heartbeatInterval * 2 // 2倍心跳间隔作为超时时间

    try {
      const instanceIds = await client.smembers(REDIS_KEYS.SERVICE_INSTANCES)
      const staleBatch: string[] = []

      for (const instanceId of instanceIds) {
        // 跳过当前实例
        if (instanceId === this.currentInstance.id) {
          continue
        }

        const instanceData = await client.hgetall(REDIS_KEYS.SERVICE_INSTANCE(instanceId))

        if (Object.keys(instanceData).length === 0) {
          // 实例数据不存在，从集合中移除
          staleBatch.push(instanceId)
          continue
        }

        const instance = this.deserializeInstance(instanceData)
        const timeSinceLastHeartbeat = now - instance.lastHeartbeat

        if (timeSinceLastHeartbeat > staleTimeout) {
          logger.warn(
            {
              instanceId,
              timeSinceLastHeartbeat: Math.floor(timeSinceLastHeartbeat / 1000),
              staleTimeoutSeconds: Math.floor(staleTimeout / 1000),
            },
            'Detected stale instance, marking for cleanup',
          )
          staleBatch.push(instanceId)
        }
      }

      // 批量清理过期实例
      if (staleBatch.length > 0) {
        await this.cleanupInstancesBatch(staleBatch)
        logger.info({ cleanedInstances: staleBatch.length, instanceIds: staleBatch }, 'Cleaned up stale instances')
      }
    } catch (error) {
      logger.error({ error }, 'Error during stale instance cleanup')
    }
  }

  /**
   * 批量清理实例
   */
  private async cleanupInstancesBatch(instanceIds: string[]): Promise<void> {
    const client = this.redisManager.getClient()

    try {
      const pipeline = client.pipeline()

      for (const instanceId of instanceIds) {
        // 从实例集合中移除
        pipeline.srem(REDIS_KEYS.SERVICE_INSTANCES, instanceId)
        // 删除实例详细信息
        pipeline.del(REDIS_KEYS.SERVICE_INSTANCE(instanceId))
      }

      await pipeline.exec()

      // 清理本地缓存
      for (const instanceId of instanceIds) {
        this.instanceCache.delete(instanceId)
      }

      // 发布实例清理事件
      for (const instanceId of instanceIds) {
        await this.publishEvent({
          type: 'instance:leave',
          data: { instanceId },
        })
      }
    } catch (error) {
      logger.error({ error, instanceIds }, 'Error cleaning up instances batch')
    }
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
      performance: JSON.stringify(instance.performance),
      metadata: JSON.stringify(instance.metadata || {}),
    }
  }

  private deserializeInstance(data: Record<string, string>): ServiceInstance {
    // 默认性能数据（向后兼容）
    const defaultPerformance = {
      cpuUsage: 0,
      memoryUsage: 0,
      memoryUsedMB: 0,
      memoryTotalMB: 0,
      activeBattles: 0,
      queuedPlayers: 0,
      avgResponseTime: 0,
      errorRate: 0,
      lastUpdated: Date.now(),
    }

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
      performance: data.performance ? JSON.parse(data.performance) : defaultPerformance,
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
      // 移除 battleState 存储，避免数据过大导致 Redis 超时
      // battleState: JSON.stringify(room.battleState || null),
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
      // 不再从 Redis 中读取 battleState，避免数据过大
      // battleState: data.battleState ? JSON.parse(data.battleState) : undefined,
      battleState: undefined,
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

  // === 简化缓存 - 只保留实例缓存 ===

  private instanceCache = new Map<string, { instance: ServiceInstance; timestamp: number }>()
  private readonly CACHE_TTL = 30000 // 30秒缓存

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
   * 移除缓存失效方法
   */

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
   * TTL 机制说明：
   * 现在大部分数据清理都通过 Redis TTL 自动处理，包括：
   * - 服务实例数据：心跳停止后自动过期
   * - 玩家连接数据：连接断开后自动过期
   * - 会话数据：根据会话超时自动过期
   * - 房间状态：根据房间状态自动过期
   * - 匹配队列：避免长时间等待自动过期
   * - 认证黑名单：根据 JWT 过期时间自动过期
   *
   * 这大大减少了手动清理的需求和 Redis 命令使用量
   */

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
      const now = Date.now()
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

      return {
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
    } catch (error) {
      logger.error({ error }, 'Failed to get cluster stats')
      throw new ClusterError('Failed to get cluster stats', 'GET_STATS_ERROR', error)
    }
  }

  /**
   * 优化的获取玩家连接方法，使用缓存和索引避免KEYS命令
   */
  private async getPlayerConnectionsOptimized(): Promise<PlayerConnection[]> {
    return dedupRedisCall('cluster:getPlayerConnectionsOptimized', async () => {
      try {
        const client = this.redisManager.getClient()

        // 使用全局玩家连接索引，避免KEYS命令
        const activePlayerIds = await client.smembers(REDIS_KEYS.ACTIVE_PLAYERS)

        if (activePlayerIds.length === 0) {
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

        return connections
      } catch (error) {
        logger.error({ error }, 'Failed to get optimized player connections')
        return []
      }
    })
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

  public async getRooms(): Promise<RoomState[]> {
    return dedupRedisCall('cluster:getRooms', async () => {
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
    })
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

      // 注销实例
      await this.unregisterInstance()

      logger.info('Cluster state manager cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during cluster state manager cleanup')
    }
  }
}
