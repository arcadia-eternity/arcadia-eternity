import { Router } from 'express'
import { z } from 'zod'
import { EmailVerificationRepository, PlayerRepository } from '@arcadia-eternity/database'
import { getContainer, TYPES } from './container'
import type { IEmailService } from './interfaces/IEmailService'
import type { IAuthService } from './authService'
import { smartAuth, requireRegisteredUser, playerRateLimit } from './smartAuthMiddleware'
import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

// 请求验证 schemas
const SendVerificationCodeSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  playerId: z.string().optional(),
  purpose: z.enum(['bind', 'recover']),
})

const VerifyCodeSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  code: z
    .string()
    .length(6, '验证码必须是6位数字')
    .regex(/^\d{6}$/, '验证码只能包含数字'),
  purpose: z.enum(['bind', 'recover']),
  playerId: z.string().optional(),
})

const BindEmailSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  code: z
    .string()
    .length(6, '验证码必须是6位数字')
    .regex(/^\d{6}$/, '验证码只能包含数字'),
  playerId: z.string().min(1, '玩家ID不能为空'),
})

const RecoverPlayerSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  code: z
    .string()
    .length(6, '验证码必须是6位数字')
    .regex(/^\d{6}$/, '验证码只能包含数字'),
})

const UnbindEmailSchema = z.object({
  playerId: z.string().min(1, '玩家ID不能为空'),
})

/**
 * 执行智能认证检查的辅助函数
 */
async function performSmartAuth(
  req: any,
  playerId: string,
): Promise<{
  success: boolean
  status?: number
  message?: string
  code?: string
}> {
  try {
    const container = getContainer()
    const playerRepo = container.get<PlayerRepository>(TYPES.PlayerRepository)
    const authService = container.get<IAuthService>(TYPES.AuthService)

    // 检查玩家是否存在且已注册
    const player = await playerRepo.getPlayerById(playerId)

    if (!player) {
      logger.debug(`Player not found: ${playerId}`)
      return {
        success: false,
        status: 404,
        message: '玩家不存在',
        code: 'PLAYER_NOT_FOUND',
      }
    }

    const isRegistered = player.is_registered || false
    req.playerId = playerId
    req.isRegisteredPlayer = isRegistered

    if (!isRegistered) {
      // 游客用户，直接放行
      logger.debug(`Guest user access granted: ${playerId}`)
      req.requiresAuth = false
      return { success: true }
    }

    // 注册用户，需要JWT认证
    req.requiresAuth = true
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) {
      logger.debug(`Registered user missing token: ${playerId}`)
      return {
        success: false,
        status: 401,
        message: '注册用户需要提供访问令牌',
        code: 'TOKEN_REQUIRED_FOR_REGISTERED_USER',
      }
    }

    // 验证JWT token
    const payload = authService.verifyAccessToken(token)
    if (!payload) {
      logger.debug(`Invalid token for registered user: ${playerId}`)
      return {
        success: false,
        status: 401,
        message: '访问令牌无效或已过期',
        code: 'TOKEN_INVALID',
      }
    }

    // 验证token中的玩家ID是否匹配
    if (payload.playerId !== playerId) {
      logger.warn(`Player ID mismatch: token=${payload.playerId}, request=${playerId}`)
      return {
        success: false,
        status: 403,
        message: '令牌与请求的玩家ID不匹配',
        code: 'PLAYER_ID_TOKEN_MISMATCH',
      }
    }

    // 认证成功
    req.user = payload
    logger.debug(`Registered user authenticated: ${playerId}`)
    return { success: true }
  } catch (error) {
    logger.error({ error }, 'Smart auth handler error')
    return {
      success: false,
      status: 500,
      message: '认证处理失败',
      code: 'AUTH_HANDLER_ERROR',
    }
  }
}

export function createEmailInheritanceRoutes(): Router {
  const router = Router()
  const container = getContainer()

  // 从DI容器获取服务
  const emailService = container.get<IEmailService>(TYPES.EmailService)
  const emailVerificationRepo = container.get<EmailVerificationRepository>(TYPES.EmailVerificationRepository)
  const playerRepo = container.get<PlayerRepository>(TYPES.PlayerRepository)
  const authService = container.get<IAuthService>(TYPES.AuthService)

  // 应用速率限制
  router.use(playerRateLimit(20, 60000)) // 每分钟最多20次请求

  /**
   * @swagger
   * /api/v1/email/send-verification-code:
   *   post:
   *     tags: [Email]
   *     summary: 发送邮箱验证码
   *     description: 根据用途（绑定或恢复）发送邮箱验证码
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/SendVerificationRequest'
   *     responses:
   *       200:
   *         description: 验证码发送成功
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SuccessResponse'
   *       400:
   *         description: 请求参数错误或邮箱已被绑定
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: 认证失败（绑定操作需要认证）
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: 邮箱未绑定任何账户（恢复操作）
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       429:
   *         description: 发送过于频繁
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/ErrorResponse'
   *                 - type: object
   *                   properties:
   *                     rateLimitSeconds:
   *                       type: integer
   *                       example: 60
   *       500:
   *         description: 服务器内部错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  router.post('/send-verification-code', async (req: any, res: any) => {
    try {
      const { email, playerId, purpose } = SendVerificationCodeSchema.parse(req.body)

      // 根据用途进行不同的认证和验证
      if (purpose === 'bind') {
        // 绑定操作：需要playerId且需要智能认证
        if (!playerId) {
          return res.status(400).json({
            success: false,
            message: '绑定操作需要提供玩家ID',
          })
        }

        // 执行智能认证检查
        const authResult = await performSmartAuth(req, playerId)
        if (!authResult.success) {
          return res.status(authResult.status).json({
            success: false,
            message: authResult.message,
            code: authResult.code,
          })
        }

        // 检查邮箱是否已被其他玩家绑定
        const isAlreadyBound = await emailVerificationRepo.isEmailBound(email, playerId)
        if (isAlreadyBound) {
          return res.status(400).json({
            success: false,
            message: '该邮箱已被其他玩家绑定',
          })
        }
      } else if (purpose === 'recover') {
        // 恢复操作：不需要playerId，不需要认证
        // 检查邮箱是否已绑定到某个玩家
        const boundPlayer = await emailVerificationRepo.findPlayerByEmail(email)
        if (!boundPlayer) {
          return res.status(404).json({
            success: false,
            message: '该邮箱未绑定任何玩家账户',
          })
        }
      }

      // 检查发送频率限制
      const canSend = await emailVerificationRepo.checkRateLimit(email, purpose, 1)
      if (!canSend) {
        return res.status(429).json({
          success: false,
          message: '发送过于频繁，请稍后再试',
          rateLimitSeconds: 60,
        })
      }

      // 生成验证码
      const code = emailVerificationRepo.generateVerificationCode()

      // 保存验证码到数据库
      await emailVerificationRepo.createVerificationCode({
        email,
        code,
        player_id: playerId || '', // 如果没有playerId，使用空字符串
        purpose,
      })

      // 获取玩家信息（用于邮件模板）
      let playerName: string | undefined
      if (playerId) {
        try {
          const player = await playerRepo.getPlayerById(playerId)
          playerName = player?.name
        } catch (error) {
          // 忽略获取玩家信息的错误，不影响验证码发送
          logger.warn(`Failed to get player info for ${playerId}:`, error)
        }
      }

      // 发送验证码邮件
      const emailSent = await emailService.sendVerificationCode({
        email,
        code,
        purpose,
        playerName,
      })

      if (!emailSent) {
        logger.error(
          {
            email,
            purpose,
            playerId,
            playerName,
          },
          `Failed to send verification email to ${email}`,
        )
        return res.status(500).json({
          success: false,
          message: '验证码发送失败，请稍后重试',
        })
      }

      res.json({
        success: true,
        message: '验证码已发送，请查收邮件',
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: error.issues[0].message,
        })
      }

      logger.error({ error }, '发送验证码失败')
      res.status(500).json({
        success: false,
        message: '服务器内部错误',
      })
    }
  })

  /**
   * 验证邮箱验证码（智能认证）
   */
  router.post('/verify-code', smartAuth, async (req: any, res: any) => {
    try {
      const { email, code, purpose } = VerifyCodeSchema.parse(req.body)

      // 查找有效的验证码
      const verificationCode = await emailVerificationRepo.findValidCode(email, code, purpose)

      if (!verificationCode) {
        return res.status(400).json({
          success: false,
          message: '验证码无效或已过期',
          valid: false,
        })
      }

      res.json({
        success: true,
        message: '验证码验证成功',
        valid: true,
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: error.issues[0].message,
          valid: false,
        })
      }

      logger.error({ error }, '验证码验证失败')
      res.status(500).json({
        success: false,
        message: '服务器内部错误',
        valid: false,
      })
    }
  })

  /**
   * @swagger
   * /api/v1/email/bind:
   *   post:
   *     tags: [Email]
   *     summary: 绑定邮箱到玩家账户
   *     description: 使用验证码将邮箱绑定到玩家账户
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/VerifyAndBindRequest'
   *     responses:
   *       200:
   *         description: 邮箱绑定成功
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/SuccessResponse'
   *                 - type: object
   *                   properties:
   *                     player:
   *                       $ref: '#/components/schemas/Player'
   *       400:
   *         description: 验证码无效或邮箱已被绑定
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: 认证失败
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
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
  router.post('/bind', smartAuth, async (req: any, res: any) => {
    try {
      const { email, code, playerId } = BindEmailSchema.parse(req.body)

      // 验证验证码
      const verificationCode = await emailVerificationRepo.findValidCode(email, code, 'bind')
      if (!verificationCode) {
        return res.status(400).json({
          success: false,
          message: '验证码无效或已过期',
        })
      }

      // 检查玩家是否存在
      const existingPlayer = await playerRepo.getPlayerById(playerId)
      if (!existingPlayer) {
        return res.status(404).json({
          success: false,
          message: '玩家不存在',
        })
      }

      // 再次检查邮箱是否已被绑定
      const isAlreadyBound = await emailVerificationRepo.isEmailBound(email, playerId)
      if (isAlreadyBound) {
        return res.status(400).json({
          success: false,
          message: '该邮箱已被其他玩家绑定',
        })
      }

      // 绑定邮箱
      const updatedPlayer = await playerRepo.bindEmail(playerId, email)

      // 标记验证码为已使用
      await emailVerificationRepo.markCodeAsUsed(verificationCode.id)

      // 为新注册的用户生成认证信息
      const authResult = authService.generateAuthForPlayer(
        updatedPlayer.id,
        updatedPlayer.is_registered || false,
        updatedPlayer.email || undefined,
      )

      logger.info(`Player email bound successfully: ${playerId} -> ${email}`)

      res.json({
        success: true,
        message: '邮箱绑定成功',
        player: updatedPlayer,
        auth: authResult, // 返回新的认证信息
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: error.issues[0].message,
        })
      }

      logger.error({ error }, '邮箱绑定失败')
      res.status(500).json({
        success: false,
        message: '服务器内部错误',
      })
    }
  })

  /**
   * @swagger
   * /api/v1/email/recover:
   *   post:
   *     tags: [Email]
   *     summary: 通过邮箱恢复玩家ID
   *     description: 使用验证码恢复绑定到邮箱的玩家账户
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/VerifyAndRecoverRequest'
   *     responses:
   *       200:
   *         description: 玩家ID恢复成功
   *         content:
   *           application/json:
   *             schema:
   *               allOf:
   *                 - $ref: '#/components/schemas/SuccessResponse'
   *                 - type: object
   *                   properties:
   *                     player:
   *                       $ref: '#/components/schemas/Player'
   *                     auth:
   *                       $ref: '#/components/schemas/AuthResult'
   *       400:
   *         description: 验证码无效或已过期
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: 邮箱未绑定任何玩家账户
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
  router.post('/recover', async (req: any, res: any) => {
    try {
      const { email, code } = RecoverPlayerSchema.parse(req.body)

      // 验证验证码
      const verificationCode = await emailVerificationRepo.findValidCode(email, code, 'recover')
      if (!verificationCode) {
        return res.status(400).json({
          success: false,
          message: '验证码无效或已过期',
        })
      }

      // 查找绑定的玩家
      const player = await playerRepo.getPlayerByEmail(email)
      if (!player) {
        return res.status(404).json({
          success: false,
          message: '该邮箱未绑定任何玩家账户',
        })
      }

      // 标记验证码为已使用
      await emailVerificationRepo.markCodeAsUsed(verificationCode.id)

      // 为恢复的注册用户生成认证信息
      const authResult = authService.generateAuthForPlayer(
        player.id,
        player.is_registered || false,
        player.email || undefined,
      )

      logger.info(`Player recovered via email: ${player.id}`)

      res.json({
        success: true,
        message: '玩家ID恢复成功',
        player,
        auth: authResult, // 返回认证信息
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: error.issues[0].message,
        })
      }

      logger.error({ error }, '玩家ID恢复失败')
      res.status(500).json({
        success: false,
        message: '服务器内部错误',
      })
    }
  })

  /**
   * 检查邮箱绑定状态
   */
  router.get('/check-binding', async (req: any, res: any) => {
    try {
      const email = z.string().email().parse(req.query.email)

      const boundPlayer = await emailVerificationRepo.findPlayerByEmail(email)

      if (boundPlayer) {
        res.json({
          bound: true,
          playerId: boundPlayer.id,
          playerName: boundPlayer.name,
        })
      } else {
        res.json({
          bound: false,
        })
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: '邮箱格式不正确',
        })
      }

      logger.error({ error }, '检查邮箱绑定状态失败')
      res.status(500).json({
        success: false,
        message: '服务器内部错误',
      })
    }
  })

  /**
   * 解绑邮箱（仅注册用户）
   */
  router.post('/unbind', smartAuth, requireRegisteredUser, async (req: any, res: any) => {
    try {
      const { playerId } = UnbindEmailSchema.parse(req.body)

      // 检查玩家是否存在
      const existingPlayer = await playerRepo.getPlayerById(playerId)
      if (!existingPlayer) {
        return res.status(404).json({
          success: false,
          message: '玩家不存在',
        })
      }

      if (!existingPlayer.email) {
        return res.status(400).json({
          success: false,
          message: '该玩家未绑定邮箱',
        })
      }

      // 解绑邮箱
      await playerRepo.unbindEmail(playerId)

      res.json({
        success: true,
        message: '邮箱解绑成功',
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          message: error.issues[0].message,
        })
      }

      logger.error({ error }, '邮箱解绑失败')
      res.status(500).json({
        success: false,
        message: '服务器内部错误',
      })
    }
  })

  return router
}
