/**
 * Redis 键空间通知配置
 * 用于启用 TTL 过期事件监听，支持基于 TTL 的断线管理
 */

import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

/**
 * 配置 Redis 键空间通知以支持 TTL 过期事件
 */
export class RedisKeyspaceConfig {
  /**
   * 启用 Redis 键空间通知
   * @param redisClient Redis 客户端实例
   */
  static async enableKeyspaceNotifications(redisClient: any): Promise<void> {
    try {
      // 获取当前的 notify-keyspace-events 配置
      const currentConfig = await redisClient.config('GET', 'notify-keyspace-events')
      const currentValue = currentConfig?.[1] || ''

      logger.info({ currentValue }, 'Current Redis notify-keyspace-events configuration')

      // 检查是否已经包含所需的配置
      let newValue = currentValue

      // 如果当前配置不包含 'E'（keyevent events），添加它
      if (!newValue.includes('E')) {
        newValue += 'E'
      }

      // 如果当前配置不包含 'x'（expired events），添加它
      if (!newValue.includes('x')) {
        newValue += 'x'
      }

      // 如果需要更新配置
      if (newValue !== currentValue) {
        await redisClient.config('SET', 'notify-keyspace-events', newValue)
        logger.info(
          { oldValue: currentValue, newValue },
          'Updated Redis notify-keyspace-events configuration for TTL expiration monitoring'
        )
      } else {
        logger.info('Redis keyspace notifications already properly configured for TTL expiration')
      }

      // 验证配置是否生效
      await this.verifyKeyspaceNotifications(redisClient)
    } catch (error) {
      logger.error({ error }, 'Failed to configure Redis keyspace notifications')
      throw new Error(`Redis keyspace configuration failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 验证键空间通知配置
   * @param redisClient Redis 客户端实例
   */
  private static async verifyKeyspaceNotifications(redisClient: any): Promise<void> {
    try {
      const config = await redisClient.config('GET', 'notify-keyspace-events')
      const value = config?.[1] || ''

      const hasKeyeventSupport = value.includes('E')
      const hasExpiredSupport = value.includes('x')

      if (hasKeyeventSupport && hasExpiredSupport) {
        logger.info({ config: value }, 'Redis keyspace notifications verified successfully')
      } else {
        logger.warn(
          { config: value, hasKeyeventSupport, hasExpiredSupport },
          'Redis keyspace notifications may not be properly configured'
        )
      }
    } catch (error) {
      logger.error({ error }, 'Failed to verify Redis keyspace notifications')
    }
  }

  /**
   * 测试 TTL 过期事件
   * @param redisClient Redis 客户端实例
   * @param subscriberClient Redis 订阅客户端实例
   */
  static async testTTLExpiration(redisClient: any, subscriberClient: any): Promise<boolean> {
    return new Promise((resolve) => {
      const testKey = `test:ttl:${Date.now()}`
      const expiredKeyPattern = '__keyevent@*__:expired'
      let testCompleted = false

      const timeout = setTimeout(() => {
        if (!testCompleted) {
          testCompleted = true
          subscriberClient.punsubscribe(expiredKeyPattern)
          logger.warn('TTL expiration test timed out - keyspace notifications may not be working')
          resolve(false)
        }
      }, 3000) // 3秒超时

      subscriberClient.psubscribe(expiredKeyPattern, (err: Error | null) => {
        if (err) {
          clearTimeout(timeout)
          testCompleted = true
          logger.error({ error: err }, 'Failed to subscribe for TTL test')
          resolve(false)
          return
        }

        // 设置一个短期的测试键
        redisClient.set(testKey, 'test-value', 'PX', 100) // 100ms 过期
      })

      subscriberClient.on('pmessage', (_pattern: string, _channel: string, expiredKey: string) => {
        if (expiredKey.includes(testKey) && !testCompleted) {
          clearTimeout(timeout)
          testCompleted = true
          subscriberClient.punsubscribe(expiredKeyPattern)
          logger.info({ testKey, expiredKey }, 'TTL expiration test successful')
          resolve(true)
        }
      })
    })
  }

  /**
   * 获取推荐的 Redis 配置
   */
  static getRecommendedRedisConfig(): Record<string, string> {
    return {
      'notify-keyspace-events': 'Ex', // E = keyevent, x = expired
      'tcp-keepalive': '60', // TCP keepalive
      'timeout': '0', // 客户端超时时间（0 = 无限制）
      'maxmemory-policy': 'allkeys-lru', // 内存满时的淘汰策略
    }
  }

  /**
   * 应用推荐的 Redis 配置
   * @param redisClient Redis 客户端实例
   */
  static async applyRecommendedConfig(redisClient: any): Promise<void> {
    const config = this.getRecommendedRedisConfig()

    for (const [key, value] of Object.entries(config)) {
      try {
        await redisClient.config('SET', key, value)
        logger.debug({ key, value }, 'Applied Redis configuration')
      } catch (error) {
        logger.warn({ error, key, value }, 'Failed to apply Redis configuration')
      }
    }

    logger.info('Applied recommended Redis configuration for TTL-based disconnect management')
  }
}