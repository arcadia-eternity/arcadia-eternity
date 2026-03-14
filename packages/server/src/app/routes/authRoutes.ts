import { Router } from 'express'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { getContainer, TYPES } from '../../container'
import type { IAuthService } from '../../domain/auth/services/authService'
import { PlayerRepository } from '@arcadia-eternity/database'
import { playerRateLimit, smartAuth } from '../middlewares/smartAuthMiddleware'
import { authenticateToken } from '../middlewares/authMiddleware'
import { nanoid } from 'nanoid'
import pino from 'pino'

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

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// 请求验证模式
const refreshSchema = Type.Object({
  refreshToken: Type.String({ minLength: 1 }),
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
   * @swagger
   * /api/v1/auth/create-guest:
   *   post:
   *     tags: [Authentication]
   *     summary: 创建游客玩家
   *     description: 创建一个新的游客玩家账户，无需认证
   *     responses:
   *       200:
   *         description: 游客创建成功
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/SuccessResponse'
   *                 - type: object
   *                   properties:
   *                     data:
   *                       type: object
   *                       properties:
   *                         playerId:
   *                           type: string
   *                           description: 游客玩家ID
   *                         playerName:
   *                           type: string
   *                           description: 游客玩家名称
   *                         isGuest:
   *                           type: boolean
   *                           example: true
   *                           description: 是否为游客
   *                         message:
   *                           type: string
   *                           description: 提示信息
   *       500:
   *         description: 服务器内部错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
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
      logger.error({ error }, 'Create guest error')
      res.status(500).json({
        success: false,
        message: '创建游客失败',
        code: 'CREATE_GUEST_ERROR',
      })
    }
  })

  /**
   * @swagger
   * /api/v1/auth/refresh:
   *   post:
   *     tags: [Authentication]
   *     summary: 刷新访问令牌
   *     description: 使用刷新令牌获取新的访问令牌
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               refreshToken:
   *                 type: string
   *                 description: 刷新令牌
   *             required:
   *               - refreshToken
   *     responses:
   *       200:
   *         description: 令牌刷新成功
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/SuccessResponse'
   *                 - type: object
   *                   properties:
   *                     data:
   *                       $ref: '#/components/schemas/AuthResult'
   *       400:
   *         description: 请求参数错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: 刷新令牌无效或已过期
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: 服务器内部错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.post('/refresh', async (req, res) => {
    try {
      const { refreshToken } = parseRequest(refreshSchema, req.body)

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
      if (error instanceof ValidationError) {
        res.status(400).json({
          success: false,
          message: error.message,
          code: 'VALIDATION_ERROR',
        })
        return
      }

      logger.error({ error }, 'Token refresh error')
      res.status(500).json({
        success: false,
        message: '令牌刷新失败',
        code: 'REFRESH_ERROR',
      })
    }
  })

  /**
   * @swagger
   * /api/v1/auth/check-player/{playerId}:
   *   get:
   *     tags: [Authentication]
   *     summary: 检查玩家状态
   *     description: 检查玩家是否为游客或注册用户
   *     parameters:
   *       - in: path
   *         name: playerId
   *         required: true
   *         schema:
   *           type: string
   *         description: 玩家ID
   *     responses:
   *       200:
   *         description: 玩家状态信息
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/SuccessResponse'
   *                 - type: object
   *                   properties:
   *                     data:
   *                       type: object
   *                       properties:
   *                         playerId:
   *                           type: string
   *                         playerName:
   *                           type: string
   *                         isRegistered:
   *                           type: boolean
   *                         requiresAuth:
   *                           type: boolean
   *                         email:
   *                           type: string
   *                           format: email
   *                           nullable: true
   *                         createdAt:
   *                           type: string
   *                           format: date-time
   *       404:
   *         description: 玩家不存在
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: 服务器内部错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
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
      logger.error({ error }, 'Check player error')
      res.status(500).json({
        success: false,
        message: '检查玩家状态失败',
        code: 'CHECK_PLAYER_ERROR',
      })
    }
  })

  /**
   * PUT /auth/update-player-name
   * 更新玩家名字 - 支持游客和注册用户
   */
  router.put('/update-player-name', smartAuth, async (req: any, res: any) => {
    try {
      const { playerId, name } = parseRequest(Type.Object({
          playerId: Type.String({ minLength: 1 }),
          name: Type.String({ minLength: 1, maxLength: 30 }),
        }), req.body)

      // 检查玩家是否存在
      const existingPlayer = await playerRepo.getPlayerById(playerId)
      if (!existingPlayer) {
        return res.status(404).json({
          success: false,
          message: '玩家不存在',
          code: 'PLAYER_NOT_FOUND',
        })
      }

      // 更新玩家名字
      const updatedPlayer = await playerRepo.updatePlayer(playerId, { name })

      logger.info(`Player name updated: ${playerId} -> ${name}`)

      res.json({
        success: true,
        message: '玩家名称更新成功',
        data: {
          playerId: updatedPlayer.id,
          playerName: updatedPlayer.name,
        },
      })
    } catch (error) {
      if (error instanceof ValidationError) {
        return res.status(400).json({
          success: false,
          message: error.message,
          code: 'VALIDATION_ERROR',
        })
      }

      logger.error({ error }, 'Update player name error')
      res.status(500).json({
        success: false,
        message: '更新玩家名称失败',
        code: 'UPDATE_NAME_ERROR',
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
      logger.error({ error }, 'Logout error')
      res.status(500).json({
        success: false,
        message: '登出失败',
        code: 'LOGOUT_ERROR',
      })
    }
  })

  /**
   * @swagger
   * /api/v1/auth/verify:
   *   get:
   *     tags: [Authentication]
   *     summary: 验证访问令牌
   *     description: 验证当前访问令牌的有效性
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       200:
   *         description: 令牌有效
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/SuccessResponse'
   *                 - type: object
   *                   properties:
   *                     valid:
   *                       type: boolean
   *                       example: true
   *                     data:
   *                       type: object
   *                       properties:
   *                         playerId:
   *                           type: string
   *                         isRegistered:
   *                           type: boolean
   *                         email:
   *                           type: string
   *                           format: email
   *       401:
   *         description: 令牌无效或已过期
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: 服务器内部错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
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
      logger.error({ error }, 'Token verification error')
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
