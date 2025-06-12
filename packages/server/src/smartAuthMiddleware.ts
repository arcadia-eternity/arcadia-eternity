import type { Request, Response, NextFunction } from 'express'
import { getContainer, TYPES } from './container'
import type { IAuthService, JWTPayload } from './authService'
import { PlayerRepository } from '@arcadia-eternity/database'
import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// 扩展Express Request接口以包含用户信息
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
      playerId?: string
      isRegisteredPlayer?: boolean
      requiresAuth?: boolean
    }
  }
}

/**
 * 智能认证中间件
 * - 如果玩家ID已注册，则要求JWT认证
 * - 如果是游客，则直接放行
 * - 自动从请求中提取playerId（支持body、query、params）
 */
export function smartAuth(req: Request, res: Response, next: NextFunction): void {
  // 提取玩家ID（优先级：body > query > params）
  const playerId = req.body?.playerId || req.query?.playerId || req.params?.playerId

  if (!playerId) {
    logger.debug('No playerId found in request')
    res.status(400).json({
      success: false,
      message: '缺少玩家ID',
      code: 'PLAYER_ID_MISSING',
    })
    return
  }

  // 异步处理认证检查
  handleSmartAuth(req, res, next, playerId as string).catch(error => {
    logger.error('Smart auth error:', error)
    res.status(500).json({
      success: false,
      message: '认证检查失败',
      code: 'AUTH_CHECK_ERROR',
    })
  })
}

async function handleSmartAuth(req: Request, res: Response, next: NextFunction, playerId: string): Promise<void> {
  try {
    const container = getContainer()
    const playerRepo = container.get<PlayerRepository>(TYPES.PlayerRepository)
    const authService = container.get<IAuthService>(TYPES.AuthService)

    // 检查玩家是否存在且已注册
    const player = await playerRepo.getPlayerById(playerId)

    if (!player) {
      logger.debug(`Player not found: ${playerId}`)
      res.status(404).json({
        success: false,
        message: '玩家不存在',
        code: 'PLAYER_NOT_FOUND',
      })
      return
    }

    const isRegistered = player.is_registered || false
    req.playerId = playerId
    req.isRegisteredPlayer = isRegistered

    if (!isRegistered) {
      // 游客用户，直接放行
      logger.debug(`Guest user access granted: ${playerId}`)
      req.requiresAuth = false
      next()
      return
    }

    // 注册用户，需要JWT认证
    req.requiresAuth = true
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) {
      logger.debug(`Registered user missing token: ${playerId}`)
      res.status(401).json({
        success: false,
        message: '注册用户需要提供访问令牌',
        code: 'TOKEN_REQUIRED_FOR_REGISTERED_USER',
      })
      return
    }

    // 验证JWT token
    const payload = authService.verifyAccessToken(token)
    if (!payload) {
      logger.debug(`Invalid token for registered user: ${playerId}`)
      res.status(401).json({
        success: false,
        message: '访问令牌无效或已过期',
        code: 'TOKEN_INVALID',
      })
      return
    }

    // 验证token中的玩家ID是否匹配
    if (payload.playerId !== playerId) {
      logger.warn(`Player ID mismatch: token=${payload.playerId}, request=${playerId}`)
      res.status(403).json({
        success: false,
        message: '令牌与请求的玩家ID不匹配',
        code: 'PLAYER_ID_TOKEN_MISMATCH',
      })
      return
    }

    // 认证成功
    req.user = payload
    logger.debug(`Registered user authenticated: ${playerId}`)
    next()
  } catch (error) {
    logger.error('Smart auth handler error:', error)
    res.status(500).json({
      success: false,
      message: '认证处理失败',
      code: 'AUTH_HANDLER_ERROR',
    })
  }
}

/**
 * 强制要求注册用户的中间件
 * 只允许已注册且已认证的用户访问
 */
export function requireRegisteredUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.isRegisteredPlayer) {
    res.status(403).json({
      success: false,
      message: '此功能仅限注册用户使用',
      code: 'REGISTERED_USER_REQUIRED',
    })
    return
  }

  if (!req.user) {
    res.status(401).json({
      success: false,
      message: '注册用户需要身份验证',
      code: 'AUTH_REQUIRED_FOR_REGISTERED_USER',
    })
    return
  }

  next()
}

/**
 * 游客用户专用中间件
 * 只允许游客用户访问
 */
export function guestOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.isRegisteredPlayer) {
    res.status(403).json({
      success: false,
      message: '此功能仅限游客用户使用',
      code: 'GUEST_USER_REQUIRED',
    })
    return
  }

  next()
}

/**
 * 速率限制中间件 - 基于玩家ID的简单限流
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

export function playerRateLimit(maxRequests: number = 100, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const identifier = req.playerId || req.ip || 'unknown'
    const now = Date.now()

    const record = rateLimitMap.get(identifier)

    if (!record || now > record.resetTime) {
      // 新的时间窗口
      rateLimitMap.set(identifier, {
        count: 1,
        resetTime: now + windowMs,
      })
      next()
      return
    }

    if (record.count >= maxRequests) {
      logger.warn(`Rate limit exceeded for player: ${identifier}`)
      res.status(429).json({
        success: false,
        message: '请求过于频繁，请稍后重试',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: Math.ceil((record.resetTime - now) / 1000),
      })
      return
    }

    record.count++
    next()
  }
}

/**
 * 清理过期的速率限制记录
 */
setInterval(() => {
  const now = Date.now()
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(key)
    }
  }
}, 60000) // 每分钟清理一次
