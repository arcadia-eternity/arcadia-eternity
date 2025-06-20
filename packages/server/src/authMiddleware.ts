import type { Request, Response, NextFunction } from 'express'
import { getContainer, TYPES } from './container'
import type { IAuthService, JWTPayload } from './authService'
import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// 扩展JWTPayload类型以包含isAdmin属性
interface ExtendedJWTPayload extends JWTPayload {
  isAdmin?: boolean
}

// 扩展Express Request接口以包含用户信息
declare global {
  namespace Express {
    interface Request {
      user?: ExtendedJWTPayload
      playerId?: string
    }
  }
}

/**
 * 认证中间件 - 验证JWT token
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1] // Bearer TOKEN

  if (!token) {
    logger.debug('No token provided')
    res.status(401).json({
      success: false,
      message: '访问令牌缺失',
      code: 'TOKEN_MISSING',
    })
    return
  }

  try {
    const container = getContainer()
    const authService = container.get<IAuthService>(TYPES.AuthService)

    const payload = authService.verifyAccessToken(token)
    if (!payload) {
      logger.debug('Invalid token')
      res.status(401).json({
        success: false,
        message: '访问令牌无效或已过期',
        code: 'TOKEN_INVALID',
      })
      return
    }

    // 将用户信息添加到请求对象
    req.user = payload
    req.playerId = payload.playerId

    logger.debug(`Authenticated user: ${payload.playerId}`)
    next()
  } catch (error) {
    logger.error({ error }, 'Authentication error')
    res.status(500).json({
      success: false,
      message: '认证服务错误',
      code: 'AUTH_ERROR',
    })
  }
}

/**
 * 可选认证中间件 - 如果有token则验证，没有则继续
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    // 没有token，继续处理
    next()
    return
  }

  try {
    const container = getContainer()
    const authService = container.get<IAuthService>(TYPES.AuthService)

    const payload = authService.verifyAccessToken(token)
    if (payload) {
      req.user = payload
      req.playerId = payload.playerId
      logger.debug(`Optional auth success: ${payload.playerId}`)
    } else {
      logger.debug('Optional auth failed, continuing without user')
    }

    next()
  } catch (error) {
    logger.error({ error }, 'Optional authentication error')
    // 即使认证失败也继续处理
    next()
  }
}

/**
 * 玩家ID验证中间件 - 确保请求的playerId与token中的一致
 */
export function validatePlayerId(req: Request, res: Response, next: NextFunction): void {
  const { playerId } = req.body || req.query || req.params

  if (!req.user) {
    res.status(401).json({
      success: false,
      message: '需要身份验证',
      code: 'AUTH_REQUIRED',
    })
    return
  }

  if (!playerId) {
    res.status(400).json({
      success: false,
      message: '玩家ID缺失',
      code: 'PLAYER_ID_MISSING',
    })
    return
  }

  if (req.user.playerId !== playerId) {
    logger.warn(`Player ID mismatch: token=${req.user.playerId}, request=${playerId}`)
    res.status(403).json({
      success: false,
      message: '无权访问其他玩家的数据',
      code: 'PLAYER_ID_MISMATCH',
    })
    return
  }

  next()
}

/**
 * 注册用户验证中间件 - 确保用户已绑定邮箱
 */
export function requireRegisteredUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: '需要身份验证',
      code: 'AUTH_REQUIRED',
    })
    return
  }

  if (!req.user.isRegistered) {
    res.status(403).json({
      success: false,
      message: '此功能需要绑定邮箱',
      code: 'REGISTRATION_REQUIRED',
    })
    return
  }

  next()
}

/**
 * 管理员验证中间件（预留）
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      message: '需要身份验证',
      code: 'AUTH_REQUIRED',
    })
    return
  }

  // 这里可以添加管理员权限检查逻辑
  // 例如检查特定的角色或权限字段

  next()
}

/**
 * 速率限制中间件 - 基于玩家ID的简单限流
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

export function rateLimit(maxRequests: number = 100, windowMs: number = 60000) {
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
      logger.warn(`Rate limit exceeded for ${identifier}`)
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
