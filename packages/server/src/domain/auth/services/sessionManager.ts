import pino from 'pino'
import type { ClusterStateManager } from '../../../cluster/core/clusterStateManager'
import type { DistributedLockManager } from '../../../cluster/redis/distributedLock'
import { LOCK_KEYS } from '../../../cluster/redis/distributedLock'
import type { SessionData, AuthBlacklistEntry } from '../../../cluster/types'
import { ClusterError, generateTimestampedSessionId } from '../../../cluster/types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export interface SessionOptions {
  maxSessions?: number // 每个玩家的最大会话数
  sessionTimeout?: number // 会话超时时间（毫秒）
  cleanupInterval?: number // 清理间隔（毫秒）
}

export interface SessionInfo {
  playerId: string
  sessionId: string
  createdAt: number
  lastAccessed: number
  metadata?: Record<string, any>
}

export class SessionManager {
  private stateManager: ClusterStateManager
  private lockManager: DistributedLockManager
  private options: Required<SessionOptions>
  private cleanupTimer?: NodeJS.Timeout

  constructor(stateManager: ClusterStateManager, lockManager: DistributedLockManager, options: SessionOptions = {}) {
    this.stateManager = stateManager
    this.lockManager = lockManager
    this.options = {
      maxSessions: options.maxSessions || 5,
      sessionTimeout: options.sessionTimeout || 24 * 60 * 60 * 1000, // 24小时
      cleanupInterval: options.cleanupInterval || 60 * 60 * 1000, // 1小时
    }

    this.startCleanupTimer()
  }

  /**
   * 创建新会话
   */
  async createSession(
    sessionData: Omit<SessionData, 'sessionId' | 'createdAt' | 'lastAccessed'>,
  ): Promise<string | null> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.PLAYER_ACTION(sessionData.playerId), async () => {
        // 检查现有会话数量
        const existingSessions = await this.getPlayerSessions(sessionData.playerId)

        if (existingSessions.length >= this.options.maxSessions) {
          // 移除最旧的会话
          const oldestSession = existingSessions.sort((a, b) => a.lastAccessed - b.lastAccessed)[0]
          await this.removeSession(oldestSession.playerId, oldestSession.sessionId)

          logger.info(
            {
              playerId: sessionData.playerId,
              removedSessionId: oldestSession.sessionId,
            },
            'Removed oldest session due to max sessions limit',
          )
        }

        // 生成新的会话ID和时间戳
        const sessionId = generateTimestampedSessionId()
        const now = Date.now()

        const completeSessionData: SessionData = {
          ...sessionData,
          sessionId,
          createdAt: now,
          lastAccessed: now,
        }

        // 创建新会话
        await this.stateManager.setSession(sessionData.playerId, completeSessionData)

        logger.debug({ playerId: sessionData.playerId, sessionId }, 'Session created successfully')
        return sessionId
      })
    } catch (error) {
      logger.error({ error, playerId: sessionData.playerId }, 'Failed to create session')
      return null
    }
  }

  /**
   * 获取会话（支持指定sessionId）
   */
  async getSession(playerId: string, sessionId?: string): Promise<SessionData | null> {
    try {
      const session = await this.stateManager.getSession(playerId, sessionId)

      if (session) {
        // 更新最后访问时间
        await this.updateSessionAccess(playerId, session.sessionId)
      }

      return session
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to get session')
      return null
    }
  }

  /**
   * 更新会话
   */
  async updateSession(playerId: string, sessionId: string, updates: Partial<SessionData>): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.PLAYER_ACTION(playerId), async () => {
        const existingSession = await this.stateManager.getSession(playerId, sessionId)

        if (!existingSession) {
          logger.debug({ playerId, sessionId }, 'Session not found for update')
          return false
        }

        const updatedSession: SessionData = {
          ...existingSession,
          ...updates,
          lastAccessed: Date.now(), // 更新访问时间
          metadata: {
            ...existingSession.metadata,
            ...updates.metadata,
            lastUpdated: Date.now(),
          },
        }

        await this.stateManager.setSession(playerId, updatedSession)
        logger.debug({ playerId, sessionId }, 'Session updated successfully')
        return true
      })
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to update session')
      return false
    }
  }

  /**
   * 移除会话
   */
  async removeSession(playerId: string, sessionId?: string): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.PLAYER_ACTION(playerId), async () => {
        await this.stateManager.removeSession(playerId)
        logger.debug({ playerId, sessionId }, 'Session removed successfully')
        return true
      })
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to remove session')
      return false
    }
  }

  /**
   * 验证会话是否有效
   */
  async isSessionValid(playerId: string): Promise<boolean> {
    try {
      const session = await this.stateManager.getSession(playerId)

      if (!session) {
        return false
      }

      // 检查是否过期
      if (session.expiry && Date.now() > session.expiry) {
        // 自动清理过期会话
        await this.removeSession(playerId)
        return false
      }

      return true
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to validate session')
      return false
    }
  }

  /**
   * 获取玩家的所有会话
   */
  async getPlayerSessions(playerId: string): Promise<SessionInfo[]> {
    try {
      const sessions = await this.stateManager.getAllSessions(playerId)

      return sessions.map(session => ({
        playerId: session.playerId,
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        lastAccessed: session.lastAccessed,
        metadata: session.metadata,
      }))
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to get player sessions')
      return []
    }
  }

  /**
   * 更新会话访问时间
   */
  private async updateSessionAccess(playerId: string, sessionId: string): Promise<void> {
    try {
      const session = await this.stateManager.getSession(playerId, sessionId)

      if (session) {
        const updatedSession: SessionData = {
          ...session,
          lastAccessed: Date.now(),
          metadata: {
            ...session.metadata,
            lastAccessed: Date.now(),
          },
        }

        await this.stateManager.setSession(playerId, updatedSession)
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to update session access time')
    }
  }

  /**
   * 清理过期会话
   * 注意：大部分会话清理现在通过 TTL 自动处理，这里只处理少量异常情况
   */
  async cleanupExpiredSessions(): Promise<number> {
    try {
      let cleanedCount = 0
      const now = Date.now()
      const timeout = this.options.sessionTimeout || 24 * 60 * 60 * 1000 // 默认24小时

      // 获取Redis客户端
      const client = this.stateManager['redisManager'].getClient()
      const keyPrefix = this.stateManager['redisManager'].getKeyPrefix()

      // 使用全局会话索引进行清理，更高效
      const sessionIndexKey = `${keyPrefix}sessions:index`

      // 只获取少量最旧的会话条目，避免大量 Redis 操作
      const sessionEntries = await client.zrange(sessionIndexKey, 0, 49, 'WITHSCORES') // 最多50个

      for (let i = 0; i < sessionEntries.length; i += 2) {
        const sessionKey = sessionEntries[i] as string // playerId:sessionId
        const createdAt = parseInt(sessionEntries[i + 1] as string)

        try {
          const [playerId, sessionId] = sessionKey.split(':')
          if (!playerId || !sessionId) continue

          // 获取会话数据
          const sessionDataKey = `${keyPrefix}session:${playerId}:${sessionId}`
          const sessionData = await client.hgetall(sessionDataKey)

          if (Object.keys(sessionData).length === 0) {
            // 空会话，直接删除
            await this.cleanupSessionReferences(client, keyPrefix, playerId, sessionId, sessionKey)
            cleanedCount++
            continue
          }

          // 检查会话是否过期
          const expiry = sessionData.expiry ? parseInt(sessionData.expiry) : null
          const lastAccessed = sessionData.lastAccessed ? parseInt(sessionData.lastAccessed) : createdAt

          let shouldCleanup = false

          if (expiry && now > expiry) {
            // 会话已过期
            shouldCleanup = true
          } else if (now - lastAccessed > timeout) {
            // 会话超时未访问
            shouldCleanup = true
          }

          if (shouldCleanup) {
            logger.debug({ playerId, sessionId }, 'Cleaning up expired session')
            await this.cleanupSessionReferences(client, keyPrefix, playerId, sessionId, sessionKey)
            cleanedCount++
          }
        } catch (error) {
          logger.error({ error, sessionKey }, 'Error processing session during cleanup')
        }
      }

      if (cleanedCount > 0) {
        logger.info({ cleanedCount }, 'Session cleanup completed')
      } else {
        logger.debug({ cleanedCount }, 'Session cleanup completed')
      }

      return cleanedCount
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup expired sessions')
      return 0
    }
  }

  /**
   * 清理会话相关的所有引用
   */
  private async cleanupSessionReferences(
    client: any,
    keyPrefix: string,
    playerId: string,
    sessionId: string,
    indexKey: string,
  ): Promise<void> {
    try {
      // 删除会话数据
      await client.del(`${keyPrefix}session:${playerId}:${sessionId}`)

      // 从玩家会话列表中移除
      await client.srem(`${keyPrefix}player:sessions:${playerId}`, sessionId)

      // 从全局索引中移除
      await client.zrem(`${keyPrefix}sessions:index`, indexKey)
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to cleanup session references')
    }
  }

  /**
   * 获取会话统计信息
   */
  async getSessionStats(): Promise<{
    totalSessions: number
    activeSessions: number
    expiredSessions: number
    playerCount: number
  }> {
    try {
      const now = Date.now()
      const timeout = this.options.sessionTimeout || 24 * 60 * 60 * 1000 // 默认24小时

      // 获取Redis客户端
      const client = this.stateManager.redisManager.getClient()
      const keyPrefix = this.stateManager.redisManager.getKeyPrefix()

      // 使用全局会话索引获取统计信息
      const sessionIndexKey = `${keyPrefix}sessions:index`
      const sessionEntries = await client.zrange(sessionIndexKey, 0, -1, 'WITHSCORES')

      let totalSessions = 0
      let activeSessions = 0
      let expiredSessions = 0
      const uniquePlayers = new Set<string>()

      for (let i = 0; i < sessionEntries.length; i += 2) {
        const sessionKey = sessionEntries[i] as string // playerId:sessionId
        const createdAt = parseInt(sessionEntries[i + 1] as string)

        try {
          const [playerId, sessionId] = sessionKey.split(':')
          if (!playerId || !sessionId) continue

          uniquePlayers.add(playerId)

          // 获取会话数据
          const sessionDataKey = `${keyPrefix}session:${playerId}:${sessionId}`
          const sessionData = await client.hgetall(sessionDataKey)

          if (Object.keys(sessionData).length === 0) {
            expiredSessions++
            continue
          }

          totalSessions++

          // 检查会话是否过期
          const expiry = sessionData.expiry ? parseInt(sessionData.expiry) : null
          const lastAccessed = sessionData.lastAccessed ? parseInt(sessionData.lastAccessed) : createdAt

          let isExpired = false

          if (expiry && now > expiry) {
            isExpired = true
          } else if (now - lastAccessed > timeout) {
            isExpired = true
          }

          if (isExpired) {
            expiredSessions++
          } else {
            activeSessions++
          }
        } catch (error) {
          logger.error({ error, sessionKey }, 'Error processing session during stats')
          expiredSessions++
        }
      }

      return {
        totalSessions,
        activeSessions,
        expiredSessions,
        playerCount: uniquePlayers.size,
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get session stats')
      return {
        totalSessions: 0,
        activeSessions: 0,
        expiredSessions: 0,
        playerCount: 0,
      }
    }
  }

  /**
   * 强制注销玩家的所有会话
   */
  async forceLogoutPlayer(playerId: string, reason?: string): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.PLAYER_ACTION(playerId), async () => {
        // 移除会话
        await this.stateManager.removeSession(playerId)

        // 如果有访问令牌，将其加入黑名单
        const session = await this.stateManager.getSession(playerId)
        if (session?.accessToken) {
          // 这里需要解析token获取JTI
          // 简化实现，实际中需要更完善的token处理
        }

        logger.info({ playerId, reason }, 'Player forcefully logged out')
        return true
      })
    } catch (error) {
      logger.error({ error, playerId, reason }, 'Failed to force logout player')
      return false
    }
  }

  /**
   * 启动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupExpiredSessions()
      } catch (error) {
        logger.error({ error }, 'Session cleanup timer error')
      }
    }, this.options.cleanupInterval)

    logger.debug({ interval: this.options.cleanupInterval }, 'Session cleanup timer started (TTL handles most cleanup)')
  }

  /**
   * 停止清理定时器
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
      logger.debug('Session cleanup timer stopped')
    }
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up session manager')

      this.stopCleanupTimer()

      logger.info('Session manager cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during session manager cleanup')
    }
  }
}

/**
 * 黑名单管理器
 */
export class BlacklistManager {
  private stateManager: ClusterStateManager
  private lockManager: DistributedLockManager

  constructor(stateManager: ClusterStateManager, lockManager: DistributedLockManager) {
    this.stateManager = stateManager
    this.lockManager = lockManager
  }

  /**
   * 添加令牌到黑名单
   */
  async addToBlacklist(entry: AuthBlacklistEntry): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.AUTH_TOKEN(entry.jti), async () => {
        await this.stateManager.addToAuthBlacklist(entry)
        logger.debug({ jti: entry.jti, reason: entry.reason }, 'Token added to blacklist')
        return true
      })
    } catch (error) {
      logger.error({ error, jti: entry.jti }, 'Failed to add token to blacklist')
      return false
    }
  }

  /**
   * 检查令牌是否在黑名单中
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    try {
      return await this.stateManager.isTokenBlacklisted(jti)
    } catch (error) {
      logger.error({ error, jti }, 'Failed to check blacklist')
      return false
    }
  }

  /**
   * 从黑名单中移除令牌
   */
  async removeFromBlacklist(jti: string): Promise<boolean> {
    try {
      return await this.lockManager.withLock(LOCK_KEYS.AUTH_TOKEN(jti), async () => {
        await this.stateManager.removeFromAuthBlacklist(jti)
        logger.debug({ jti }, 'Token removed from blacklist')
        return true
      })
    } catch (error) {
      logger.error({ error, jti }, 'Failed to remove token from blacklist')
      return false
    }
  }

  /**
   * 清理过期的黑名单条目
   */
  async cleanupExpiredEntries(): Promise<number> {
    try {
      let cleanedCount = 0
      const now = Date.now()

      // 获取Redis客户端
      const client = this.stateManager['redisManager'].getClient()
      const keyPrefix = this.stateManager['redisManager'].getKeyPrefix()

      // 获取所有黑名单键
      const blacklistPattern = `${keyPrefix}auth:blacklist:*`
      const blacklistKeys = await client.keys(blacklistPattern)

      for (const blacklistKey of blacklistKeys) {
        try {
          const entryData = await client.hgetall(blacklistKey)
          if (Object.keys(entryData).length === 0) {
            // 空条目，直接删除
            await client.del(blacklistKey)
            cleanedCount++
            continue
          }

          // 检查是否过期
          const expiry = entryData.expiry ? parseInt(entryData.expiry) : null
          if (expiry && now > expiry) {
            const jti = blacklistKey.replace(`${keyPrefix}auth:blacklist:`, '')
            logger.debug({ jti, blacklistKey }, 'Cleaning up expired blacklist entry')
            await client.del(blacklistKey)
            cleanedCount++
          }
        } catch (error) {
          logger.error({ error, blacklistKey }, 'Error processing blacklist entry during cleanup')
        }
      }

      if (cleanedCount > 0) {
        logger.info({ cleanedCount }, 'Blacklist cleanup completed')
      } else {
        logger.debug({ cleanedCount }, 'Blacklist cleanup completed')
      }

      return cleanedCount
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup expired blacklist entries')
      return 0
    }
  }
}
