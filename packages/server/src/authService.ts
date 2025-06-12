import 'reflect-metadata'
import { injectable } from 'inversify'
import jwt from 'jsonwebtoken'
import { nanoid } from 'nanoid'
import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// JWT载荷接口
export interface JWTPayload {
  playerId: string
  isRegistered: boolean
  email?: string
  iat?: number
  exp?: number
  jti?: string // JWT ID，用于token撤销
}

// 认证配置接口
export interface AuthConfig {
  jwtSecret: string
  jwtExpiresIn: string
  refreshTokenExpiresIn: string
}

// 认证结果接口
export interface AuthResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  player: {
    id: string
    isRegistered: boolean
    email?: string
  }
}

// 认证服务接口
export interface IAuthService {
  /**
   * 生成访问令牌
   */
  generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'jti'>): string

  /**
   * 生成刷新令牌
   */
  generateRefreshToken(playerId: string): string

  /**
   * 验证访问令牌
   */
  verifyAccessToken(token: string): JWTPayload | null

  /**
   * 验证刷新令牌
   */
  verifyRefreshToken(token: string): { playerId: string } | null

  /**
   * 刷新访问令牌
   */
  refreshAccessToken(refreshToken: string, playerRepo?: any): Promise<AuthResult | null>

  /**
   * 为玩家生成完整的认证信息
   */
  generateAuthForPlayer(playerId: string, isRegistered: boolean, email?: string): AuthResult

  /**
   * 撤销令牌（将来可扩展为黑名单机制）
   */
  revokeToken(token: string): boolean
}

@injectable()
export class AuthService implements IAuthService {
  private config: AuthConfig
  private revokedTokens: Set<string> = new Set() // 简单的内存黑名单，生产环境应使用Redis

  constructor(config?: AuthConfig) {
    this.config = config || this.createDefaultConfig()
    logger.info('Auth service initialized')
  }

  private createDefaultConfig(): AuthConfig {
    return createAuthConfigFromEnv()
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

  verifyAccessToken(token: string): JWTPayload | null {
    try {
      // 检查是否在黑名单中
      if (this.revokedTokens.has(token)) {
        logger.debug('Token is revoked')
        return null
      }

      const decoded = jwt.verify(token, this.config.jwtSecret) as JWTPayload

      // 验证必要字段
      if (!decoded.playerId) {
        logger.debug('Invalid token: missing playerId')
        return null
      }

      return decoded
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        logger.debug('Invalid token:', error.message)
      } else if (error instanceof jwt.TokenExpiredError) {
        logger.debug('Token expired')
      } else {
        logger.error('Token verification error:', error)
      }
      return null
    }
  }

  verifyRefreshToken(token: string): { playerId: string } | null {
    try {
      if (this.revokedTokens.has(token)) {
        logger.debug('Refresh token is revoked')
        return null
      }

      const decoded = jwt.verify(token, this.config.jwtSecret) as any

      if (decoded.type !== 'refresh' || !decoded.playerId) {
        logger.debug('Invalid refresh token')
        return null
      }

      return { playerId: decoded.playerId }
    } catch (error) {
      logger.debug('Refresh token verification failed:', error)
      return null
    }
  }

  async refreshAccessToken(refreshToken: string, playerRepo?: any): Promise<AuthResult | null> {
    const refreshPayload = this.verifyRefreshToken(refreshToken)
    if (!refreshPayload) {
      return null
    }

    // 如果提供了playerRepo，从数据库获取最新的玩家信息
    if (playerRepo) {
      try {
        const player = await playerRepo.getPlayerById(refreshPayload.playerId)
        if (!player) {
          logger.debug('Player not found during token refresh')
          return null
        }

        return this.generateAuthForPlayer(player.id, player.is_registered || false, player.email || undefined)
      } catch (error) {
        logger.error('Failed to fetch player during token refresh:', error)
        return null
      }
    }

    // 回退：假设为未注册用户
    return this.generateAuthForPlayer(refreshPayload.playerId, false)
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

  revokeToken(token: string): boolean {
    try {
      // 将token添加到黑名单
      this.revokedTokens.add(token)

      // 清理过期的撤销token（简单实现）
      if (this.revokedTokens.size > 10000) {
        this.cleanupRevokedTokens()
      }

      logger.debug('Token revoked successfully')
      return true
    } catch (error) {
      logger.error('Failed to revoke token:', error)
      return false
    }
  }

  private cleanupRevokedTokens(): void {
    // 简单的清理策略：清空所有撤销的token
    // 生产环境应该使用Redis并设置TTL
    this.revokedTokens.clear()
    logger.info('Revoked tokens cleaned up')
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

// 全局JWT密钥，确保所有AuthService实例使用相同的密钥
let globalJwtSecret: string | null = null

function getOrCreateJwtSecret(): string {
  if (!globalJwtSecret) {
    globalJwtSecret = process.env.JWT_SECRET || nanoid(64)
    if (!process.env.JWT_SECRET) {
      logger.warn('Using generated JWT secret. Set JWT_SECRET environment variable for production.')
      logger.debug(`Generated JWT secret: ${globalJwtSecret.substring(0, 20)}...`)
    } else {
      logger.debug(`Using JWT_SECRET from environment: ${globalJwtSecret.substring(0, 20)}...`)
    }
  } else {
    logger.debug(`Reusing existing JWT secret: ${globalJwtSecret.substring(0, 20)}...`)
  }
  return globalJwtSecret
}

/**
 * 从环境变量创建认证配置
 */
export function createAuthConfigFromEnv(): AuthConfig {
  return {
    jwtSecret: getOrCreateJwtSecret(),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '180d', // 默认6个月
    refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '365d', // 默认1年
  }
}

// 导出接口符号用于DI
export const IAuthService = Symbol.for('IAuthService')
