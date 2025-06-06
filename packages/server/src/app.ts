import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
import pino from 'pino'
import { BattleServer } from './battle'
import { createBattleReportRoutes } from './battleReportRoutes'
import type { BattleReportConfig } from './battleReportService'
import type { ClientToServerEvents, ServerToClientEvents } from '@arcadia-eternity/protocol'

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
}

// 默认配置
const defaultConfig: ServerConfig = {
  port: parseInt(process.env.PORT || '3001'),
  cors: {
    origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
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

  // 创建 Express 应用
  const app = express()

  // 中间件
  app.use(cors(finalConfig.cors))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  // 健康检查端点
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

  // 设置战报 API 路由
  if (finalConfig.battleReport?.enableApi) {
    const apiRouter = express.Router()
    createBattleReportRoutes(apiRouter, { enableApi: true }, logger)
    app.use('/api/v1', apiRouter)
    logger.info('Battle report API enabled at /api/v1')
  }

  // 服务器统计端点
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
if (require.main === module) {
  const { start } = createApp()
  start().catch(error => {
    logger.error({ error }, 'Failed to start server')
    process.exit(1)
  })
}
