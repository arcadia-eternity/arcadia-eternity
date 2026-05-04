import express, { type Router, type Request, type Response, type NextFunction } from 'express'
import pino from 'pino'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { ClusterAuthService } from '../../domain/auth/services/clusterAuthService'
import type { SessionManager } from '../../domain/auth/services/sessionManager'

class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

function parseRequest<T extends import('@sinclair/typebox').TSchema>(schema: T, data: unknown): Static<T> {
  const converted = Value.Convert(schema, structuredClone(data))
  const defaulted = Value.Default(schema, converted)
  if (Value.Check(schema, defaulted)) {
    return defaulted as Static<T>
  }
  const errors = [...Value.Errors(schema, defaulted)]
  const message = errors.map(e => `${e.path}: ${e.message}`).join('; ')
  throw new ValidationError(message)
}

// 简单的认证中间件
function authenticateToken(authService: ClusterAuthService) {
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
      const decoded = (await authService.verifyAccessTokenAsync?.(token)) || authService.verifyAccessToken?.(token)

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

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// 验证schemas
const GetSessionsSchema = Type.Object({
  playerId: Type.String({ minLength: 1 }),
})

const RemoveSessionSchema = Type.Object({
  playerId: Type.String({ minLength: 1 }),
  sessionId: Type.String({ minLength: 1 }),
})

const SessionStatsSchema = Type.Object({
  includeDetails: Type.Optional(Type.Boolean({ default: false })),
})

/**
 * 创建会话管理路由
 */
export function createSessionRoutes(authService: ClusterAuthService, sessionManager: SessionManager): Router {
  const router = express.Router()

  /**
   * 获取玩家的所有会话
   * GET /sessions/:playerId
   */
  router.get('/sessions/:playerId', authenticateToken(authService), async (req, res) => {
    try {
      const { playerId } = GetSessionsSchema.parse(req.params)

      // 检查权限：只有管理员或玩家本人可以查看会话
      const user = req.user
      if (!user || (user.playerId !== playerId && !user.isAdmin)) {
        res.status(403).json({
          success: false,
          message: '权限不足',
          code: 'INSUFFICIENT_PERMISSIONS',
        })
        return
      }

      const sessions = await authService.getAllSessions(playerId)

      res.json({
        success: true,
        message: '获取会话列表成功',
        data: {
          playerId,
          sessionCount: sessions.length,
          sessions: sessions.map(session => ({
            sessionId: session.sessionId,
            createdAt: session.createdAt,
            lastAccessed: session.lastAccessed,
            expiry: session.expiry,
            instanceId: session.instanceId,
            isExpired: session.expiry ? Date.now() > session.expiry : false,
            metadata: session.metadata,
          })),
        },
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Validation failed')) {
        res.status(400).json({
          success: false,
          message: error.message,
          code: 'VALIDATION_ERROR',
        })
        return
      }

      logger.error({ error, playerId: req.params.playerId }, 'Failed to get player sessions')
      res.status(500).json({
        success: false,
        message: '获取会话列表失败',
        code: 'GET_SESSIONS_ERROR',
      })
    }
  })

  /**
   * 删除指定会话
   * DELETE /sessions/:playerId/:sessionId
   */
  router.delete('/sessions/:playerId/:sessionId', authenticateToken(authService), async (req, res) => {
    try {
      const { playerId, sessionId } = RemoveSessionSchema.parse(req.params)

      // 检查权限：只有管理员或玩家本人可以删除会话
      const user = req.user
      if (!user || (user.playerId !== playerId && !user.isAdmin)) {
        res.status(403).json({
          success: false,
          message: '权限不足',
          code: 'INSUFFICIENT_PERMISSIONS',
        })
        return
      }

      const success = await sessionManager.removeSession(playerId, sessionId)

      if (success) {
        logger.info({ playerId, sessionId, operatorId: user.playerId }, 'Session removed by user')
        res.json({
          success: true,
          message: '会话删除成功',
          data: { playerId, sessionId },
        })
      } else {
        res.status(404).json({
          success: false,
          message: '会话不存在',
          code: 'SESSION_NOT_FOUND',
        })
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Validation failed')) {
        res.status(400).json({
          success: false,
          message: error.message,
          code: 'VALIDATION_ERROR',
        })
        return
      }

      logger.error({ error, params: req.params }, 'Failed to remove session')
      res.status(500).json({
        success: false,
        message: '删除会话失败',
        code: 'REMOVE_SESSION_ERROR',
      })
    }
  })

  /**
   * 删除玩家的所有会话
   * DELETE /sessions/:playerId
   */
  router.delete('/sessions/:playerId', authenticateToken(authService), async (req, res) => {
    try {
      const { playerId } = GetSessionsSchema.parse(req.params)

      // 检查权限：只有管理员或玩家本人可以删除所有会话
      const user = req.user
      if (!user || (user.playerId !== playerId && !user.isAdmin)) {
        res.status(403).json({
          success: false,
          message: '权限不足',
          code: 'INSUFFICIENT_PERMISSIONS',
        })
        return
      }

      const sessions = await authService.getAllSessions(playerId)
      const sessionCount = sessions.length

      const success = await sessionManager.removeSession(playerId)

      if (success) {
        logger.info({ playerId, sessionCount, operatorId: user.playerId }, 'All sessions removed by user')
        res.json({
          success: true,
          message: '所有会话删除成功',
          data: { playerId, removedSessionCount: sessionCount },
        })
      } else {
        res.status(404).json({
          success: false,
          message: '玩家没有活跃会话',
          code: 'NO_SESSIONS_FOUND',
        })
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Validation failed')) {
        res.status(400).json({
          success: false,
          message: error.message,
          code: 'VALIDATION_ERROR',
        })
        return
      }

      logger.error({ error, playerId: req.params.playerId }, 'Failed to remove all sessions')
      res.status(500).json({
        success: false,
        message: '删除所有会话失败',
        code: 'REMOVE_ALL_SESSIONS_ERROR',
      })
    }
  })

  /**
   * 获取会话统计信息（管理员专用）
   * GET /sessions/stats
   */
  router.get('/sessions/stats', authenticateToken(authService), async (req, res) => {
    try {
      const user = req.user
      if (!user || !user.isAdmin) {
        res.status(403).json({
          success: false,
          message: '权限不足，仅管理员可访问',
          code: 'ADMIN_REQUIRED',
        })
        return
      }

      const { includeDetails } = SessionStatsSchema.parse(req.query)
      const stats = await sessionManager.getSessionStats()

      let responseData: any = stats

      if (includeDetails) {
        // 如果需要详细信息，可以添加更多统计数据
        responseData = {
          ...stats,
          maxSessionsPerPlayer: sessionManager['options'].maxSessions,
          sessionTimeout: sessionManager['options'].sessionTimeout,
          cleanupInterval: sessionManager['options'].cleanupInterval,
        }
      }

      res.json({
        success: true,
        message: '获取会话统计成功',
        data: responseData,
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Validation failed')) {
        res.status(400).json({
          success: false,
          message: error.message,
          code: 'VALIDATION_ERROR',
        })
        return
      }

      logger.error({ error }, 'Failed to get session stats')
      res.status(500).json({
        success: false,
        message: '获取会话统计失败',
        code: 'GET_STATS_ERROR',
      })
    }
  })

  /**
   * 手动触发会话清理（管理员专用）
   * POST /sessions/cleanup
   */
  router.post('/sessions/cleanup', authenticateToken(authService), async (req, res) => {
    try {
      const user = req.user
      if (!user || !user.isAdmin) {
        res.status(403).json({
          success: false,
          message: '权限不足，仅管理员可访问',
          code: 'ADMIN_REQUIRED',
        })
        return
      }

      const cleanedCount = await sessionManager.cleanupExpiredSessions()

      logger.info({ cleanedCount, operatorId: user.playerId }, 'Manual session cleanup triggered')

      res.json({
        success: true,
        message: '会话清理完成',
        data: { cleanedSessionCount: cleanedCount },
      })
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup sessions')
      res.status(500).json({
        success: false,
        message: '会话清理失败',
        code: 'CLEANUP_ERROR',
      })
    }
  })

  return router
}
