import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
import pino from 'pino'
import swaggerUi from 'swagger-ui-express'
import { BattleServer } from './battle'
import { createBattleReportRoutes } from './battleReportRoutes'
import { createEmailInheritanceRoutes } from './emailInheritanceRoutes'
import { createAuthRoutes } from './authRoutes'
import type { BattleReportConfig } from './battleReportService'
import type { EmailConfig } from './emailService'
import { createEmailConfigFromEnv } from './emailService'
import { createContainer, resetContainer } from './container'
import type { ClientToServerEvents, ServerToClientEvents } from '@arcadia-eternity/protocol'
import { swaggerSpec, swaggerUiOptions } from './swagger'
import { initializeSupabase } from '@arcadia-eternity/database'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

// 配置接口
export interface ServerConfig {
  port: number
  cors: {
    origin: string | string[]
    credentials: boolean
  }
  battleReport?: BattleReportConfig & {
    enableApi: boolean
  }
  email?: EmailConfig
}

// 默认配置
const defaultConfig: ServerConfig = {
  port: parseInt(process.env.PORT || '3001'),
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',').map(origin => origin.trim()) || ['http://localhost:3000'],
    credentials: true,
  },
  battleReport:
    process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
      ? {
          enableReporting: true,
          enableApi: true,
          database: {
            supabaseUrl: process.env.SUPABASE_URL,
            supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
            supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
          },
        }
      : undefined,
  // 邮件配置默认为undefined，将在createApp中处理
  email: undefined,
}

/**
 * 创建并配置应用服务器
 */
export function createApp(config: Partial<ServerConfig> = {}): {
  app: express.Application
  server: ReturnType<typeof createServer>
  battleServer: BattleServer
  start: () => Promise<void>
  stop: () => Promise<void>
} {
  const finalConfig = { ...defaultConfig, ...config }

  // 处理邮件配置：如果没有提供邮件配置，则从环境变量创建
  if (!finalConfig.email) {
    finalConfig.email = createEmailConfigFromEnv()
  }

  // 初始化数据库连接（如果有配置的话）
  // 无论是否启用战报功能，认证和邮箱继承API都需要数据库
  if (finalConfig.battleReport?.database) {
    initializeSupabase(finalConfig.battleReport.database)
    logger.info('Database initialized for user services')
  } else {
    // 尝试从环境变量初始化数据库
    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

    if (supabaseUrl && supabaseAnonKey) {
      initializeSupabase({
        supabaseUrl,
        supabaseAnonKey,
        supabaseServiceKey,
      })
      logger.info('Database initialized from environment variables for user services')
    } else {
      logger.warn('No database configuration found - user services (auth, email) may not work properly')
    }
  }

  // 重置并创建新的DI容器，传入邮件配置
  resetContainer()
  const container = createContainer(finalConfig.email)

  // 创建 Express 应用
  const app = express()

  // 中间件
  app.use(cors(finalConfig.cors))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  // Swagger API 文档
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions))

  // 提供 OpenAPI JSON 规范
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(swaggerSpec)
  })

  // 健康检查端点
  /**
   * @swagger
   * /health:
   *   get:
   *     tags: [Health]
   *     summary: 健康检查
   *     description: 检查服务器运行状态
   *     responses:
   *       200:
   *         description: 服务器运行正常
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/HealthResponse'
   */
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    })
  })

  // 创建 HTTP 服务器
  const server = createServer(app)

  // 创建 Socket.IO 服务器
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: finalConfig.cors,
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  // 创建战斗服务器
  const battleServer = new BattleServer(io, finalConfig.battleReport)

  // 设置 API 路由
  const apiRouter = express.Router()

  // 战报 API 路由
  if (finalConfig.battleReport?.enableApi) {
    createBattleReportRoutes(apiRouter, { enableApi: true }, logger)
    logger.info('Battle report API enabled at /api/v1')
  }

  // 认证 API 路由
  apiRouter.use('/auth', createAuthRoutes())
  logger.info('Authentication API enabled at /api/v1/auth')

  // 邮箱继承 API 路由
  apiRouter.use('/email', createEmailInheritanceRoutes())
  logger.info('Email inheritance API enabled at /api/v1/email')

  app.use('/api/v1', apiRouter)

  // 服务器统计端点
  /**
   * @swagger
   * /api/stats:
   *   get:
   *     tags: [Health]
   *     summary: 获取服务器统计信息
   *     description: 获取服务器运行统计数据，包括连接数、战斗数等
   *     responses:
   *       200:
   *         description: 服务器统计信息
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ServerStats'
   *       500:
   *         description: 服务器内部错误
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get('/api/stats', (req, res) => {
    try {
      const stats = battleServer.getServerStats()
      res.json(stats)
    } catch (error) {
      logger.error({ error }, 'Failed to get server stats')
      res.status(500).json({ error: 'Failed to get server stats' })
    }
  })

  // 错误处理中间件
  app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error({ error, url: req.url, method: req.method }, 'Express error')
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong',
    })
  })

  // 404 处理
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      message: `Route ${req.method} ${req.url} not found`,
    })
  })

  let isStarted = false

  const start = async (): Promise<void> => {
    if (isStarted) {
      throw new Error('Server is already started')
    }

    return new Promise((resolve, reject) => {
      server.listen(finalConfig.port, () => {
        isStarted = true
        logger.info(
          {
            port: finalConfig.port,
            cors: finalConfig.cors.origin,
            battleReportEnabled: !!finalConfig.battleReport?.enableReporting,
            apiEnabled: !!finalConfig.battleReport?.enableApi,
          },
          'Server started successfully',
        )
        resolve()
      })

      server.on('error', error => {
        logger.error({ error }, 'Server startup failed')
        reject(error)
      })
    })
  }

  const stop = async (): Promise<void> => {
    if (!isStarted) {
      return
    }

    logger.info('Shutting down server...')

    // 设置强制关闭超时时间（10秒）
    const SHUTDOWN_TIMEOUT = 10000
    let shutdownCompleted = false

    // 设置强制关闭定时器
    const forceShutdownTimer = setTimeout(() => {
      if (!shutdownCompleted) {
        logger.warn('优雅关闭超时，强制退出进程')
        process.exit(1)
      }
    }, SHUTDOWN_TIMEOUT)

    try {
      // 清理战斗服务器资源（包括主动断开所有socket）
      await battleServer.cleanup()

      // 关闭 Socket.IO 服务器
      io.close()

      // 关闭 HTTP 服务器
      await new Promise<void>(resolve => {
        server.close(() => {
          isStarted = false
          logger.info('Server shut down successfully')
          resolve()
        })
      })

      shutdownCompleted = true
      clearTimeout(forceShutdownTimer)
    } catch (error) {
      logger.error({ error }, 'Error during server shutdown')
      shutdownCompleted = true
      clearTimeout(forceShutdownTimer)
      throw error
    }
  }

  // 优雅关闭处理
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully')
    await stop()
    process.exit(0)
  })

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully')
    await stop()
    process.exit(0)
  })

  return {
    app,
    server,
    battleServer,
    start,
    stop,
  }
}

// 如果直接运行此文件，启动服务器
if (import.meta.url === `file://${process.argv[1]}`) {
  const { start } = createApp()
  start().catch(error => {
    logger.error({ error }, 'Failed to start server')
    process.exit(1)
  })
}
