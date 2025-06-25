import { nanoid } from 'nanoid'
import pino from 'pino'
import type { RedisClientManager } from './redisClient'
import type { DistributedLock, LockOptions } from './types'
import { LockError, REDIS_KEYS } from './types'
import { TTLHelper } from './ttlConfig'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export class DistributedLockManager {
  private redisManager: RedisClientManager
  private defaultOptions: Required<LockOptions>

  constructor(redisManager: RedisClientManager) {
    this.redisManager = redisManager
    this.defaultOptions = {
      ttl: TTLHelper.getTTLForDataType('lock'), // 使用配置的默认锁 TTL
      retryDelay: 100, // 100ms重试延迟
      retryCount: 10, // 最多重试10次
    }
  }

  /**
   * 获取分布式锁
   */
  async acquireLock(key: string, options: LockOptions = {}): Promise<DistributedLock> {
    const opts = { ...this.defaultOptions, ...options }
    const lockKey = REDIS_KEYS.LOCK(key)
    const lockValue = nanoid() // 唯一标识符
    const client = this.redisManager.getClient()

    let retryCount = 0

    while (retryCount < opts.retryCount) {
      try {
        // 使用SET命令的NX和PX选项实现原子性锁获取
        const result = await client.set(
          lockKey,
          lockValue,
          'PX', // 毫秒级过期时间
          opts.ttl,
          'NX', // 只在键不存在时设置
        )

        if (result === 'OK') {
          logger.debug({ key, lockValue, ttl: opts.ttl }, 'Lock acquired successfully')

          return {
            key: lockKey,
            value: lockValue,
            ttl: opts.ttl,
            acquired: true,
          }
        }

        // 锁获取失败，等待后重试
        retryCount++
        if (retryCount < opts.retryCount) {
          await this.sleep(opts.retryDelay)
        }
      } catch (error) {
        logger.error({ error, key, retryCount }, 'Error acquiring lock')
        retryCount++

        if (retryCount < opts.retryCount) {
          await this.sleep(opts.retryDelay)
        }
      }
    }

    throw new LockError(`Failed to acquire lock for key: ${key} after ${opts.retryCount} retries`)
  }

  /**
   * 释放分布式锁
   */
  async releaseLock(lock: DistributedLock): Promise<boolean> {
    if (!lock.acquired) {
      logger.warn({ lock }, 'Attempting to release unacquired lock')
      return false
    }

    const client = this.redisManager.getClient()

    try {
      // 使用Lua脚本确保原子性：只有锁的持有者才能释放锁
      const luaScript = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `

      const result = (await client.eval(luaScript, 1, lock.key, lock.value)) as number

      const released = result === 1

      if (released) {
        logger.debug({ lock }, 'Lock released successfully')
      } else {
        logger.warn({ lock }, 'Lock was not released (may have expired or been released by another process)')
      }

      return released
    } catch (error) {
      logger.error({ error, lock }, 'Error releasing lock')
      throw new LockError(`Failed to release lock: ${lock.key}`, error)
    }
  }

  /**
   * 延长锁的生存时间
   */
  async extendLock(lock: DistributedLock, additionalTtl: number): Promise<boolean> {
    if (!lock.acquired) {
      throw new LockError('Cannot extend unacquired lock')
    }

    const client = this.redisManager.getClient()

    try {
      // 使用Lua脚本确保原子性：只有锁的持有者才能延长锁
      const luaScript = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("PEXPIRE", KEYS[1], ARGV[2])
        else
          return 0
        end
      `

      const result = (await client.eval(luaScript, 1, lock.key, lock.value, additionalTtl.toString())) as number

      const extended = result === 1

      if (extended) {
        lock.ttl = additionalTtl
        logger.debug({ lock, additionalTtl }, 'Lock extended successfully')
      } else {
        logger.warn({ lock }, 'Lock extension failed (may have expired)')
      }

      return extended
    } catch (error) {
      logger.error({ error, lock, additionalTtl }, 'Error extending lock')
      throw new LockError(`Failed to extend lock: ${lock.key}`, error)
    }
  }

  /**
   * 检查锁是否仍然有效
   */
  async isLockValid(lock: DistributedLock): Promise<boolean> {
    if (!lock.acquired) {
      return false
    }

    const client = this.redisManager.getClient()

    try {
      const value = await client.get(lock.key)
      return value === lock.value
    } catch (error) {
      logger.error({ error, lock }, 'Error checking lock validity')
      return false
    }
  }

  /**
   * 获取锁的剩余生存时间
   */
  async getLockTtl(lock: DistributedLock): Promise<number> {
    const client = this.redisManager.getClient()

    try {
      const ttl = await client.pttl(lock.key)
      return ttl
    } catch (error) {
      logger.error({ error, lock }, 'Error getting lock TTL')
      return -1
    }
  }

  /**
   * 使用锁执行操作（自动获取和释放锁）
   */
  async withLock<T>(key: string, operation: () => Promise<T>, options: LockOptions = {}): Promise<T> {
    const lock = await this.acquireLock(key, options)

    try {
      const result = await operation()
      return result
    } finally {
      await this.releaseLock(lock)
    }
  }

  /**
   * 清理过期的锁（维护操作）
   * 注意：Redis TTL 会自动清理过期的锁，这个方法主要用于清理异常情况
   */
  async cleanupExpiredLocks(): Promise<number> {
    const client = this.redisManager.getClient()

    try {
      // 获取所有锁键（限制数量以避免性能问题）
      const lockPattern = REDIS_KEYS.LOCK('*')
      const keys = await client.keys(lockPattern)

      // 只处理少量锁，避免大量 Redis 操作
      const keysToCheck = keys.slice(0, Math.min(50, keys.length))
      let cleanedCount = 0

      for (const key of keysToCheck) {
        const ttl = await client.pttl(key)

        // 如果TTL为-1（永不过期，异常情况），则清理
        if (ttl === -1) {
          await client.del(key)
          cleanedCount++
          logger.warn({ key }, 'Cleaned up lock without TTL (should not happen)')
        }
      }

      if (cleanedCount > 0) {
        logger.info(
          { cleanedCount, totalLocks: keys.length },
          'Cleaned up locks without TTL (TTL handles normal expiration)',
        )
      }

      return cleanedCount
    } catch (error) {
      logger.error({ error }, 'Error cleaning up expired locks')
      throw error
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// 常用锁键常量
export const LOCK_KEYS = {
  MATCHMAKING: 'matchmaking',
  MATCHMAKING_QUEUE: 'matchmaking:queue',
  MATCHMAKING_LEADER_ELECTION: 'matchmaking:leader:election',
  ROOM_CREATE: (roomId: string) => `room:create:${roomId}`,
  PLAYER_ACTION: (playerId: string) => `player:action:${playerId}`,
  SESSION_ACTION: (playerId: string, sessionId: string) => `session:action:${playerId}:${sessionId}`,
  SERVICE_REGISTRY: 'service:registry',
  AUTH_TOKEN: (jti: string) => `auth:token:${jti}`,
} as const
