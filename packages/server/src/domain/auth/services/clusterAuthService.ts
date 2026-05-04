import 'reflect-metadata'
import { injectable } from 'inversify'
import jwt from 'jsonwebtoken'
import { nanoid } from 'nanoid'
import pino from 'pino'
import type { ClusterStateManager } from '../../../cluster/core/clusterStateManager'
import type { AuthBlacklistEntry, SessionData } from '../../../cluster/types'
import type { IAuthService, JWTPayload, AuthConfig, AuthResult } from './authService'
import { DistributedLockManager } from '../../../cluster/redis/distributedLock'
import { SessionManager } from './sessionManager'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

/**
 * 集群感知的认证服务
 * 使用Redis存储JWT黑名单和会话状态，支持跨实例的认证状态同步
 */
@injectable()
export class ClusterAuthService implements IAuthService {
  private config: AuthConfig
  private stateManager: ClusterStateManager
  private sessionManager?: any // 延迟加载SessionManager

  constructor(config: AuthConfig, stateManager: ClusterStateManager) {
    this.config = config
    this.stateManager = stateManager
    logger.info('Cluster auth service initialized')
  }

  private async getSessionManager() {
    if (!this.sessionManager) {
      // 创建一个简单的锁管理器实例
      const lockManager = new DistributedLockManager(this.stateManager.redisManager)
      this.sessionManager = new SessionManager(this.stateManager, lockManager)
    }
    return this.sessionManager
  }

  generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'>): string {
    const jwtPayload: JWTPayload = {
      ...payload,
      jti: nanoid(), // 添加JWT ID用于撤销
    }

    return jwt.sign(jwtPayload, this.config.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn,
    } as jwt.SignOptions)
  }

  generateRefreshToken(playerId: string): string {
    return jwt.sign(
      {
        playerId,
        type: 'refresh',
        jti: nanoid(),
      },
      this.config.jwtSecret,
      {
        expiresIn: this.config.refreshTokenExpiresIn,
      } as jwt.SignOptions,
    )
  }

  // 异步版本的verifyAccessToken，支持集群黑名单检查
  async verifyAccessTokenAsync(token: string): Promise<JWTPayload | null> {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as JWTPayload

      // 验证必要字段
      if (!decoded.playerId) {
        logger.debug('Invalid token: missing playerId')
        return null
      }

      // 检查是否在集群黑名单中
      if (decoded.jti) {
        const isBlacklisted = await this.stateManager.isTokenBlacklisted(decoded.jti)
        if (isBlacklisted) {
          logger.debug({ jti: decoded.jti }, 'Token is in cluster blacklist')
          return null
        }
      }

      return decoded
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        logger.debug({ msg: 'Invalid token:', err: error })
      } else if (error instanceof jwt.TokenExpiredError) {
        logger.debug({ msg: 'Token expired' })
      } else {
        logger.error({ error }, 'Token verification error')
      }
      return null
    }
  }

  // 同步版本的verifyAccessToken，实现IAuthService接口
  verifyAccessToken(token: string): JWTPayload | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as JWTPayload

      // 验证必要字段
      if (!decoded.playerId) {
        logger.debug('Invalid token: missing playerId')
        return null
      }

      // 注意：同步版本无法检查Redis黑名单，建议使用异步版本
      logger.warn('Using synchronous token verification - cluster blacklist not checked')

      return decoded
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        logger.debug({
          error,
          msg: 'Invalid token',
        })
      } else if (error instanceof jwt.TokenExpiredError) {
        logger.debug('Token expired')
      } else {
        logger.error({ error }, 'Token verification error')
      }
      return null
    }
  }

  verifyRefreshToken(token: string): { playerId: string } | null {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as any

      if (decoded.type !== 'refresh' || !decoded.playerId) {
        logger.debug('Invalid refresh token')
        return null
      }

      return { playerId: decoded.playerId }
    } catch (error) {
      logger.debug({ msg: 'Refresh token verification failed:', error })
      return null
    }
  }

  async refreshAccessToken(refreshToken: string, playerRepo?: any): Promise<AuthResult | null> {
    const refreshPayload = this.verifyRefreshToken(refreshToken)
    if (!refreshPayload) {
      return null
    }

    try {
      // 检查刷新令牌是否在黑名单中
      const refreshDecoded = jwt.decode(refreshToken) as any
      if (refreshDecoded?.jti) {
        const isBlacklisted = await this.stateManager.isTokenBlacklisted(refreshDecoded.jti)
        if (isBlacklisted) {
          logger.debug({ jti: refreshDecoded.jti }, 'Refresh token is blacklisted')
          return null
        }
      }

      // 如果提供了playerRepo，从数据库获取最新的玩家信息
      if (playerRepo) {
        try {
          const player = await playerRepo.getPlayerById(refreshPayload.playerId)
          if (!player) {
            logger.debug('Player not found during token refresh')
            return null
          }

          const authResult = this.generateAuthForPlayer(
            player.id,
            player.is_registered || false,
            player.email || undefined,
          )

          // 更新会话状态
          await this.updateSession(player.id, authResult)

          return authResult
        } catch (error) {
          logger.error({ error }, 'Failed to fetch player during token refresh')
          return null
        }
      }

      // 回退：假设为未注册用户
      const authResult = this.generateAuthForPlayer(refreshPayload.playerId, false)
      await this.updateSession(refreshPayload.playerId, authResult)

      return authResult
    } catch (error) {
      logger.error({ error }, 'Failed to refresh access token')
      return null
    }
  }

  generateAuthForPlayer(playerId: string, isRegistered: boolean, email?: string): AuthResult {
    const accessToken = this.generateAccessToken({
      playerId,
      isRegistered,
      email,
    })

    const refreshToken = this.generateRefreshToken(playerId)

    // 计算过期时间（秒）
    const expiresIn = this.parseExpiresIn(this.config.jwtExpiresIn)

    return {
      accessToken,
      refreshToken,
      expiresIn,
      player: {
        id: playerId,
        isRegistered,
        email,
      },
    }
  }

  // 同步版本的revokeToken，实现IAuthService接口
  revokeToken(token: string): boolean {
    // 启动异步撤销，但返回同步结果
    this.revokeTokenAsync(token).catch(error => {
      logger.error({ error }, 'Async token revocation failed')
    })
    return true
  }

  // 异步版本的revokeToken，支持集群黑名单
  async revokeTokenAsync(token: string): Promise<boolean> {
    try {
      const decoded = jwt.decode(token) as any

      if (!decoded || !decoded.jti) {
        logger.debug('Cannot revoke token: missing JTI')
        return false
      }

      // 添加到集群黑名单
      const blacklistEntry: AuthBlacklistEntry = {
        jti: decoded.jti,
        expiry: decoded.exp ? decoded.exp * 1000 : Date.now() + 24 * 60 * 60 * 1000, // 默认24小时
        reason: 'manual_revocation',
        revokedAt: Date.now(),
      }

      await this.stateManager.addToAuthBlacklist(blacklistEntry)

      logger.debug({ jti: decoded.jti }, 'Token revoked successfully in cluster')
      return true
    } catch (error) {
      logger.error({ error }, 'Failed to revoke token in cluster')
      return false
    }
  }

  /**
   * 批量撤销玩家的所有令牌
   */
  async revokeAllPlayerTokens(playerId: string): Promise<boolean> {
    try {
      // 移除玩家会话
      await this.stateManager.removeSession(playerId)

      logger.info({ playerId }, 'All player tokens revoked')
      return true
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to revoke all player tokens')
      return false
    }
  }

  /**
   * 创建新会话
   */
  async createSession(playerId: string, authResult: AuthResult, instanceId?: string): Promise<string | null> {
    try {
      const now = Date.now()
      const sessionData = {
        playerId,
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        expiry: now + authResult.expiresIn * 1000,
        instanceId,
        metadata: {
          isRegistered: authResult.player.isRegistered,
          email: authResult.player.email,
          lastUpdated: now,
        },
      }

      // 使用SessionManager创建会话
      const sessionManager = await this.getSessionManager()
      const sessionId = await sessionManager.createSession(sessionData)

      if (sessionId) {
        logger.debug({ playerId, sessionId }, 'Session created in cluster')
      }

      return sessionId
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to create session in cluster')
      return null
    }
  }

  /**
   * 更新玩家会话状态（向后兼容）
   */
  async updateSession(playerId: string, authResult: AuthResult, sessionId?: string): Promise<void> {
    try {
      if (!sessionId) {
        // 如果没有指定sessionId，创建新会话
        await this.createSession(playerId, authResult)
        return
      }

      const sessionData: Partial<SessionData> = {
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        expiry: Date.now() + authResult.expiresIn * 1000,
        metadata: {
          isRegistered: authResult.player.isRegistered,
          email: authResult.player.email,
          lastUpdated: Date.now(),
        },
      }

      // 使用SessionManager更新会话
      const sessionManager = await this.getSessionManager()
      const success = await sessionManager.updateSession(playerId, sessionId, sessionData)

      if (success) {
        logger.debug({ playerId, sessionId }, 'Session updated in cluster')
      } else {
        logger.warn({ playerId, sessionId }, 'Failed to update session - session not found')
      }
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to update session in cluster')
    }
  }

  /**
   * 获取玩家会话状态
   */
  async getSession(playerId: string, sessionId?: string): Promise<SessionData | null> {
    try {
      return await this.stateManager.getSession(playerId, sessionId)
    } catch (error) {
      logger.error({ error, playerId, sessionId }, 'Failed to get session from cluster')
      return null
    }
  }

  /**
   * 获取玩家的所有会话
   */
  async getAllSessions(playerId: string): Promise<SessionData[]> {
    try {
      return await this.stateManager.getAllSessions(playerId)
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to get all sessions from cluster')
      return []
    }
  }

  /**
   * 验证会话是否有效
   */
  async isSessionValid(playerId: string): Promise<boolean> {
    try {
      const session = await this.getSession(playerId)
      if (!session || !session.expiry) {
        return false
      }

      return Date.now() < session.expiry
    } catch (error) {
      logger.error({ error, playerId }, 'Failed to validate session')
      return false
    }
  }

  /**
   * 清理过期的黑名单条目
   */
  async cleanupExpiredBlacklist(): Promise<number> {
    try {
      // 这个方法需要在ClusterStateManager中实现
      // 暂时返回0
      return 0
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup expired blacklist')
      return 0
    }
  }

  private parseExpiresIn(expiresIn: string): number {
    // 简单的时间解析，支持 '1h', '24h', '7d' 等格式
    const match = expiresIn.match(/^(\d+)([hmd])$/)
    if (!match) {
      return 24 * 60 * 60 // 默认24小时
    }

    const value = parseInt(match[1])
    const unit = match[2]

    switch (unit) {
      case 'h':
        return value * 60 * 60
      case 'd':
        return value * 24 * 60 * 60
      case 'm':
        return value * 60
      default:
        return 24 * 60 * 60
    }
  }
}

/**
 * 创建集群认证服务的工厂函数
 */
export function createClusterAuthService(config: AuthConfig, stateManager: ClusterStateManager): ClusterAuthService {
  return new ClusterAuthService(config, stateManager)
}
