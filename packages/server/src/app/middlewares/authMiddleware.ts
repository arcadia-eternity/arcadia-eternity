import type { Request, Response, NextFunction } from 'express'
import { getContainer, TYPES } from '../../container'
import type { IAuthService, JWTPayload } from '../../domain/auth/services/authService'
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
