import { Router } from 'express'
import { z } from 'zod'
import { getContainer, TYPES } from './container'
import type { IAuthService } from './authService'
import { PlayerRepository } from '@arcadia-eternity/database'
import { playerRateLimit } from './smartAuthMiddleware'
import { authenticateToken } from './authMiddleware'
import { nanoid } from 'nanoid'
import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// 请求验证模式
const refreshSchema = z.object({
  refreshToken: z.string().min(1, '刷新令牌不能为空'),
})

/**
 * 创建简化的认证相关的API路由
 * 游客模式不需要token，只有注册用户需要认证
 */
export function createAuthRoutes(): Router {
  const router = Router()
  const container = getContainer()

  // 从DI容器获取服务
  const authService = container.get<IAuthService>(TYPES.AuthService)
  const playerRepo = container.get<PlayerRepository>(TYPES.PlayerRepository)

  // 应用速率限制
  router.use(playerRateLimit(50, 60000)) // 每分钟最多50次请求

  /**
   * POST /auth/create-guest
   * 创建游客玩家 - 不需要认证，返回玩家ID
   */
  router.post('/create-guest', async (_req, res) => {
    try {
      // 生成游客ID（直接使用nanoid，不加前缀）
      const guestId = nanoid()

      // 创建新的匿名玩家
      const player = await playerRepo.createPlayer({
        id: guestId,
        name: `游客-${Date.now().toString(36)}`,
      })

      logger.info(`Guest player created: ${player.id}`)

      res.json({
        success: true,
        message: '游客创建成功',
        data: {
          playerId: player.id,
          playerName: player.name,
          isGuest: true,
          message: '游客模式无需认证，可直接使用所有功能',
        },
      })
    } catch (error) {
      logger.error('Create guest error:', error)
      res.status(500).json({
        success: false,
        message: '创建游客失败',
        code: 'CREATE_GUEST_ERROR',
      })
    }
  })

  /**
   * POST /auth/refresh
   * 刷新访问令牌
   */
  router.post('/refresh', async (req, res) => {
    try {
      const { refreshToken } = refreshSchema.parse(req.body)

      // 使用更新后的refreshAccessToken方法
      const authResult = await authService.refreshAccessToken(refreshToken, playerRepo)

      if (!authResult) {
        res.status(401).json({
          success: false,
          message: '刷新令牌无效或已过期',
          code: 'REFRESH_TOKEN_INVALID',
        })
        return
      }

      logger.info(`Token refreshed for player: ${authResult.player.id}`)

      res.json({
        success: true,
        message: '令牌刷新成功',
        data: authResult,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          message: error.errors[0].message,
          code: 'VALIDATION_ERROR',
        })
        return
      }

      logger.error('Token refresh error:', error)
      res.status(500).json({
        success: false,
        message: '令牌刷新失败',
        code: 'REFRESH_ERROR',
      })
    }
  })

  /**
   * GET /auth/check-player
   * 检查玩家状态（游客 vs 注册用户）
   */
  router.get('/check-player/:playerId', async (req, res) => {
    try {
      const { playerId } = req.params

      const player = await playerRepo.getPlayerById(playerId)
      if (!player) {
        res.status(404).json({
          success: false,
          message: '玩家不存在',
          code: 'PLAYER_NOT_FOUND',
        })
        return
      }

      res.json({
        success: true,
        data: {
          playerId: player.id,
          playerName: player.name,
          isRegistered: player.is_registered || false,
          requiresAuth: player.is_registered || false,
          email: player.email,
          createdAt: player.created_at,
        },
      })
    } catch (error) {
      logger.error('Check player error:', error)
      res.status(500).json({
        success: false,
        message: '检查玩家状态失败',
        code: 'CHECK_PLAYER_ERROR',
      })
    }
  })

  /**
   * POST /auth/logout
   * 登出并撤销token
   */
  router.post('/logout', authenticateToken, async (req, res) => {
    try {
      const token = req.headers.authorization?.split(' ')[1]
      if (token) {
        // 撤销token
        authService.revokeToken(token)
      }

      res.json({
        success: true,
        message: '登出成功',
      })
    } catch (error) {
      logger.error('Logout error:', error)
      res.status(500).json({
        success: false,
        message: '登出失败',
        code: 'LOGOUT_ERROR',
      })
    }
  })

  /**
   * GET /auth/verify
   * 验证当前访问令牌的有效性
   */
  router.get('/verify', authenticateToken, async (req, res) => {
    try {
      // 如果通过了authenticateToken，说明token有效
      res.json({
        success: true,
        valid: true,
        data: {
          playerId: req.user?.playerId,
          isRegistered: req.user?.isRegistered,
          email: req.user?.email,
        },
      })
    } catch (error) {
      logger.error('Token verification error:', error)
      res.status(500).json({
        success: false,
        valid: false,
        message: '令牌验证失败',
        code: 'TOKEN_VERIFICATION_ERROR',
      })
    }
  })

  return router
}
