import Redis from 'ioredis'
import pino from 'pino'
import type { ClusterConfig } from '../types'
import type { PerformanceTracker } from '../monitoring/performanceTracker'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

export class RedisClientManager {
  private static instance: RedisClientManager | null = null
  private client: Redis | null = null
  private subscriber: Redis | null = null
  private publisher: Redis | null = null
  private config: ClusterConfig['redis']
  private performanceTracker?: PerformanceTracker

  private constructor(config: ClusterConfig['redis']) {
    this.config = config
  }

  setPerformanceTracker(tracker: PerformanceTracker): void {
    this.performanceTracker = tracker
  }

  static getInstance(config?: ClusterConfig['redis']): RedisClientManager {
    if (!RedisClientManager.instance) {
      if (!config) {
        throw new Error('Redis config is required for first initialization')
      }
      RedisClientManager.instance = new RedisClientManager(config)
    }
    return RedisClientManager.instance
  }

  async initialize(): Promise<void> {
    try {
      // 根据环境调整超时配置
      const isProduction = process.env.NODE_ENV === 'production'
      const connectTimeout = isProduction ? 20000 : 15000 // 生产环境更长连接超时
      const commandTimeout = isProduction ? 15000 : 10000 // 生产环境更长命令超时
      const maxRetries = isProduction ? 15 : 10 // 生产环境更多重试

      // 创建主客户端 - 优化配置
      this.client = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db || 0,
        keyPrefix: this.config.keyPrefix || 'arcadia:',
        maxRetriesPerRequest: this.config.maxRetriesPerRequest || maxRetries,
        enableReadyCheck: this.config.enableReadyCheck !== false,
        lazyConnect: this.config.lazyConnect !== false,
        // TLS配置
        tls: this.config.tls ? {} : undefined,
        // 连接池配置 - 优化性能
        family: 4,
        keepAlive: 30000,
        connectTimeout, // 动态连接超时
        commandTimeout, // 动态命令超时
        // 重连配置 - 更智能的重连策略
        reconnectOnError: err => {
          const reconnectErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']
          return reconnectErrors.some(errorType => err.message.includes(errorType))
        },
      })

      // 创建发布者客户端 - 优化配置
      this.publisher = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db || 0,
        keyPrefix: this.config.keyPrefix || 'arcadia:',
        tls: this.config.tls ? {} : undefined,
        lazyConnect: true,
        maxRetriesPerRequest: maxRetries,
        connectTimeout,
        commandTimeout,
        family: 4,
        keepAlive: 30000,
        reconnectOnError: err => {
          const reconnectErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']
          return reconnectErrors.some(errorType => err.message.includes(errorType))
        },
      })

      // 创建订阅者客户端 - 优化配置
      this.subscriber = new Redis({
        host: this.config.host,
        port: this.config.port,
        password: this.config.password,
        db: this.config.db || 0,
        keyPrefix: this.config.keyPrefix || 'arcadia:',
        tls: this.config.tls ? {} : undefined,
        lazyConnect: true,
        maxRetriesPerRequest: maxRetries,
        connectTimeout,
        commandTimeout,
        family: 4,
        keepAlive: 30000,
        reconnectOnError: err => {
          const reconnectErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']
          return reconnectErrors.some(errorType => err.message.includes(errorType))
        },
      })

      // 设置事件监听器
      this.setupEventListeners()

      // 连接到Redis
      await Promise.all([this.client.connect(), this.publisher.connect(), this.subscriber.connect()])

      logger.info('Redis clients initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Redis clients')
      throw error
    }
  }

  private setupEventListeners(): void {
    if (!this.client || !this.publisher || !this.subscriber) return

    // 主客户端事件
    this.client.on('connect', () => {
      logger.info('Redis main client connected')
    })

    this.client.on('error', error => {
      logger.error({ error }, 'Redis main client error')
    })

    this.client.on('close', () => {
      logger.warn('Redis main client connection closed')
    })

    // 监控慢查询
    this.client.on('ready', () => {
      logger.info('Redis main client ready')
    })

    // 发布者事件
    this.publisher.on('connect', () => {
      logger.info('Redis publisher connected')
    })

    this.publisher.on('error', error => {
      logger.error({ error }, 'Redis publisher error')
    })

    this.publisher.on('ready', () => {
      logger.info('Redis publisher ready')
    })

    // 订阅者事件
    this.subscriber.on('connect', () => {
      logger.info('Redis subscriber connected')
    })

    this.subscriber.on('error', error => {
      logger.error({ error }, 'Redis subscriber error')
    })

    this.subscriber.on('ready', () => {
      logger.info('Redis subscriber ready')
    })
  }

  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client not initialized')
    }
    return this.client
  }

  getPublisher(): Redis {
    if (!this.publisher) {
      throw new Error('Redis publisher not initialized')
    }
    return this.publisher
  }

  getSubscriber(): Redis {
    if (!this.subscriber) {
      throw new Error('Redis subscriber not initialized')
    }
    return this.subscriber
  }

  getKeyPrefix(): string {
    return this.config.keyPrefix || 'arcadia:'
  }

  /**
   * 执行Redis命令并监控性能
   */
  async executeCommand<T>(commandName: string, fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now()
    try {
      const result = await fn()
      const duration = Date.now() - startTime

      // 记录慢查询（超过100ms）
      if (duration > 100) {
        logger.warn({ commandName, duration }, 'Slow Redis command detected')
      }

      // 记录性能指标
      if (this.performanceTracker) {
        this.performanceTracker.recordRedisOperation(commandName, duration)
      }

      return result
    } catch (error) {
      const duration = Date.now() - startTime

      // 记录错误和操作时间
      if (this.performanceTracker) {
        this.performanceTracker.recordRedisOperation(commandName, duration)
        this.performanceTracker.recordError('redis_error', commandName)
      }

      logger.error({ error, commandName, duration }, 'Redis command failed')
      throw error
    }
  }

  async ping(): Promise<boolean> {
    const startTime = Date.now()
    try {
      if (!this.client) return false
      const result = await this.client.ping()

      // 记录 Redis 操作性能
      if (this.performanceTracker) {
        const duration = Date.now() - startTime
        this.performanceTracker.recordRedisOperation('ping', duration)
      }

      return result === 'PONG'
    } catch (error) {
      // 记录错误和操作时间
      if (this.performanceTracker) {
        const duration = Date.now() - startTime
        this.performanceTracker.recordRedisOperation('ping', duration)
        this.performanceTracker.recordError('redis_error', 'ping')
      }

      logger.error({ error }, 'Redis ping failed')
      return false
    }
  }

  async getInfo(): Promise<Record<string, any>> {
    try {
      if (!this.client) throw new Error('Redis client not initialized')

      const info = await this.client.info()
      const lines = info.split('\r\n')
      const result: Record<string, any> = {}

      for (const line of lines) {
        if (line && !line.startsWith('#')) {
          const [key, value] = line.split(':')
          if (key && value) {
            result[key] = value
          }
        }
      }

      return result
    } catch (error) {
      logger.error({ error }, 'Failed to get Redis info')
      throw error
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up Redis connections')

      const promises: Promise<any>[] = []

      if (this.client) {
        promises.push(Promise.resolve(this.client.disconnect()))
      }

      if (this.publisher) {
        promises.push(Promise.resolve(this.publisher.disconnect()))
      }

      if (this.subscriber) {
        promises.push(Promise.resolve(this.subscriber.disconnect()))
      }

      await Promise.all(promises)

      this.client = null
      this.publisher = null
      this.subscriber = null

      logger.info('Redis connections cleaned up successfully')
    } catch (error) {
      logger.error({ error }, 'Error during Redis cleanup')
      throw error
    }
  }

  // 健康检查
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy'
    details: Record<string, any>
  }> {
    try {
      const startTime = Date.now()
      const pingResult = await this.ping()
      const responseTime = Date.now() - startTime

      if (!pingResult) {
        return {
          status: 'unhealthy',
          details: {
            error: 'Ping failed',
            responseTime,
          },
        }
      }

      const info = await this.getInfo()

      return {
        status: 'healthy',
        details: {
          responseTime,
          connectedClients: info.connected_clients,
          usedMemory: info.used_memory_human,
          uptime: info.uptime_in_seconds,
        },
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      }
    }
  }
}

// 创建配置工厂函数
export function createRedisConfigFromEnv(): ClusterConfig['redis'] {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'arcadia:',
    maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3'),
    retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY || '100'),
    enableReadyCheck: process.env.REDIS_ENABLE_READY_CHECK !== 'false',
    lazyConnect: process.env.REDIS_LAZY_CONNECT !== 'false',
    tls: process.env.REDIS_TLS === 'true',
  }
}
