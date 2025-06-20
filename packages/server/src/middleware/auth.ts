import type { Request, Response, NextFunction } from 'express'
import pino from 'pino'
import type { ClusterAuthService } from '../cluster/clusterAuthService'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

/**
 * JWT认证中间件
 */
export function authenticateToken(authService: ClusterAuthService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
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

      // 使用异步版本验证token（支持集群黑名单检查）
      const decoded = await authService.verifyAccessTokenAsync(token)

      if (!decoded) {
        res.status(401).json({
          success: false,
          message: '访问令牌无效或已过期',
          code: 'TOKEN_INVALID',
        })
        return
      }

      // 检查是否为管理员（这里可以根据实际需求调整判断逻辑）
      const isAdmin = Boolean(decoded.email && decoded.email.includes('admin')) // 简单的管理员判断逻辑

      req.user = {
        ...decoded,
        isAdmin,
      }

      next()
    } catch (error) {
      logger.error({ error }, 'Authentication middleware error')
      res.status(500).json({
        success: false,
        message: '认证过程中发生错误',
        code: 'AUTH_ERROR',
      })
    }
  }
}

/**
 * 管理员权限中间件
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !req.user.isAdmin) {
    res.status(403).json({
      success: false,
      message: '权限不足，需要管理员权限',
      code: 'ADMIN_REQUIRED',
    })
    return
  }

  next()
}

/**
 * 可选认证中间件（不强制要求token）
 */
export function optionalAuth(authService: ClusterAuthService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization
      const token = authHeader && authHeader.split(' ')[1]

      if (token) {
        const decoded = await authService.verifyAccessTokenAsync(token)
        if (decoded) {
          req.user = {
            ...decoded,
            isAdmin: Boolean(decoded.email && decoded.email.includes('admin')),
          }
        }
      }

      next()
    } catch (error) {
      logger.error({ error }, 'Optional auth middleware error')
      // 可选认证失败时不阻止请求继续
      next()
    }
  }
}
