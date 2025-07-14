import { nanoid } from 'nanoid'
import pino from 'pino'
import { RedisClientManager, createRedisConfigFromEnv } from '../redis/redisClient'
import { DistributedLockManager } from '../redis/distributedLock'
import { ClusterStateManager } from './clusterStateManager'
import type { ClusterConfig, ClusterEvent } from '../types'
import { ClusterError } from '../types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export class ClusterManager {
  private static instance: ClusterManager | null = null
  private config: ClusterConfig
  private redisManager: RedisClientManager
  private lockManager: DistributedLockManager
  private stateManager: ClusterStateManager
  private initialized = false

  private constructor(config: ClusterConfig) {
    this.config = config
    this.redisManager = RedisClientManager.getInstance(config.redis)
    this.lockManager = new DistributedLockManager(this.redisManager)
    this.stateManager = new ClusterStateManager(this.redisManager, this.lockManager, config)
  }

  static getInstance(config?: ClusterConfig): ClusterManager {
    if (!ClusterManager.instance) {
      if (!config) {
        throw new Error('Cluster config is required for first initialization')
      }
      ClusterManager.instance = new ClusterManager(config)
    }
    return ClusterManager.instance
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Cluster manager already initialized')
      return
    }

    try {
      logger.info({ instanceId: this.config.instance.id }, 'Initializing cluster manager')

      // 初始化Redis连接
      await this.redisManager.initialize()

      // 初始化状态管理器
      await this.stateManager.initialize()

      this.initialized = true
      logger.info({ instanceId: this.config.instance.id }, 'Cluster manager initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize cluster manager')
      throw new ClusterError('Failed to initialize cluster manager', 'INITIALIZATION_ERROR', error)
    }
  }

  // === 集群状态管理 ===

  getStateManager(): ClusterStateManager {
    this.ensureInitialized()
    return this.stateManager
  }

  getLockManager(): DistributedLockManager {
    this.ensureInitialized()
    return this.lockManager
  }

  getRedisManager(): RedisClientManager {
    this.ensureInitialized()
    return this.redisManager
  }

  // === 事件监听 ===

  onClusterEvent(listener: (event: ClusterEvent) => void): void {
    this.stateManager.on('clusterEvent', listener)
  }

  offClusterEvent(listener: (event: ClusterEvent) => void): void {
    this.stateManager.off('clusterEvent', listener)
  }

  // === 健康检查 ===

  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy'
    details: Record<string, any>
  }> {
    try {
      if (!this.initialized) {
        return {
          status: 'unhealthy',
          details: { error: 'Cluster manager not initialized' },
        }
      }

      // 检查Redis连接
      const redisHealth = await this.redisManager.healthCheck()

      if (redisHealth.status === 'unhealthy') {
        return {
          status: 'unhealthy',
          details: {
            redis: redisHealth.details,
          },
        }
      }

      // 获取集群统计信息
      const stats = await this.stateManager.getClusterStats()

      return {
        status: 'healthy',
        details: {
          redis: redisHealth.details,
          cluster: stats,
          instance: {
            id: this.config.instance.id,
            host: this.config.instance.host,
            port: this.config.instance.port,
          },
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

  // === 实用方法 ===

  isClusterEnabled(): boolean {
    return this.config.cluster.enabled
  }

  getInstanceId(): string {
    return this.config.instance.id
  }

  getConfig(): ClusterConfig {
    return { ...this.config }
  }

  // === 清理 ===

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up cluster manager')

      if (this.stateManager) {
        await this.stateManager.cleanup()
      }

      if (this.redisManager) {
        await this.redisManager.cleanup()
      }

      this.initialized = false
      ClusterManager.instance = null

      logger.info('Cluster manager cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during cluster manager cleanup')
      throw error
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new ClusterError('Cluster manager not initialized', 'NOT_INITIALIZED')
    }
  }
}

// === 配置工厂函数 ===

export function createClusterConfigFromEnv(): ClusterConfig {
  const instanceId = process.env.CLUSTER_INSTANCE_ID || nanoid()

  // Fly.io 环境检测和配置
  const isFlyIo = Boolean(process.env.FLY_APP_NAME)
  let host: string

  if (isFlyIo) {
    // 在 Fly.io 上使用实例的私有 IPv6 地址
    // Fly.io 会自动设置 FLY_PRIVATE_IP 环境变量
    host = process.env.FLY_PRIVATE_IP || `${instanceId}.internal`
  } else {
    host = process.env.CLUSTER_INSTANCE_HOST || 'localhost'
  }

  const port = parseInt(process.env.PORT || '8102')
  const grpcPort = parseInt(process.env.GRPC_PORT || '50051')

  return {
    redis: createRedisConfigFromEnv(),
    instance: {
      id: instanceId,
      host,
      port,
      grpcPort, // 添加 gRPC 端口
      region: process.env.CLUSTER_INSTANCE_REGION || process.env.FLY_REGION,
      isFlyIo, // 标记是否在 Fly.io 环境
    },
    cluster: {
      enabled: process.env.CLUSTER_ENABLED !== 'false', // 默认启用集群模式，除非明确设置为 false
      heartbeatInterval: parseInt(process.env.CLUSTER_HEARTBEAT_INTERVAL || '30000'),
      healthCheckInterval: parseInt(process.env.CLUSTER_HEALTH_CHECK_INTERVAL || '60000'),
      failoverTimeout: parseInt(process.env.CLUSTER_FAILOVER_TIMEOUT || '120000'),
    },
  }
}

// 集群配置命令行参数接口
export interface ClusterCliOptions {
  redisHost?: string
  redisPort?: string
  redisPassword?: string
  redisDb?: string
  redisKeyPrefix?: string
  redisMaxRetries?: string
  redisRetryDelay?: string
  redisEnableReadyCheck?: boolean
  redisLazyConnect?: boolean
  clusterEnabled?: boolean
  clusterInstanceId?: string
  clusterInstanceHost?: string
  clusterInstanceRegion?: string
  clusterHeartbeatInterval?: string
  clusterHealthCheckInterval?: string
  clusterFailoverTimeout?: string
  port?: string
}

/**
 * 从命令行参数创建集群配置
 */
export function createClusterConfigFromCli(options: ClusterCliOptions): ClusterConfig {
  const instanceId = options.clusterInstanceId || process.env.CLUSTER_INSTANCE_ID || nanoid()
  const host = options.clusterInstanceHost || process.env.CLUSTER_INSTANCE_HOST || 'localhost'
  const port = parseInt(options.port || process.env.PORT || '8102')

  return {
    redis: {
      host: options.redisHost || process.env.REDIS_HOST || 'localhost',
      port: parseInt(options.redisPort || process.env.REDIS_PORT || '6379'),
      password: options.redisPassword || process.env.REDIS_PASSWORD,
      db: parseInt(options.redisDb || process.env.REDIS_DB || '0'),
      keyPrefix: options.redisKeyPrefix || process.env.REDIS_KEY_PREFIX || 'arcadia:',
      maxRetriesPerRequest: parseInt(options.redisMaxRetries || process.env.REDIS_MAX_RETRIES || '3'),
      retryDelayOnFailover: parseInt(options.redisRetryDelay || process.env.REDIS_RETRY_DELAY || '100'),
      enableReadyCheck: options.redisEnableReadyCheck ?? process.env.REDIS_ENABLE_READY_CHECK !== 'false',
      lazyConnect: options.redisLazyConnect ?? process.env.REDIS_LAZY_CONNECT !== 'false',
      tls: process.env.REDIS_TLS === 'true',
    },
    instance: {
      id: instanceId,
      host,
      port,
      region: options.clusterInstanceRegion || process.env.CLUSTER_INSTANCE_REGION,
    },
    cluster: {
      enabled: options.clusterEnabled ?? process.env.CLUSTER_ENABLED !== 'false',
      heartbeatInterval: parseInt(
        options.clusterHeartbeatInterval || process.env.CLUSTER_HEARTBEAT_INTERVAL || '30000',
      ),
      healthCheckInterval: parseInt(
        options.clusterHealthCheckInterval || process.env.CLUSTER_HEALTH_CHECK_INTERVAL || '60000',
      ),
      failoverTimeout: parseInt(options.clusterFailoverTimeout || process.env.CLUSTER_FAILOVER_TIMEOUT || '120000'),
    },
  }
}

// === 单例访问器 ===

export function getClusterManager(): ClusterManager {
  const instance = ClusterManager.getInstance()
  if (!instance) {
    throw new ClusterError('Cluster manager not initialized', 'NOT_INITIALIZED')
  }
  return instance
}

// === 便捷方法 ===

export async function initializeCluster(config?: ClusterConfig): Promise<ClusterManager> {
  const finalConfig = config || createClusterConfigFromEnv()
  const manager = ClusterManager.getInstance(finalConfig)

  // 集群模式现在总是启用
  await manager.initialize()

  return manager
}

export async function cleanupCluster(): Promise<void> {
  const instance = ClusterManager.getInstance()
  if (instance) {
    await instance.cleanup()
  }
}

// === 类型导出 ===
export type { ClusterConfig, ClusterEvent } from '../types'
export { ClusterError } from '../types'
