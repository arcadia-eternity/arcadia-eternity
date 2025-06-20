import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
import pino from 'pino'
import swaggerUi from 'swagger-ui-express'
import { ClusterBattleServer } from './clusterBattleServer'
import { SocketClusterAdapter } from './socketClusterAdapter'
import { BattleRpcServer } from './battleRpcServer'
import { ServiceDiscoveryManager, WeightedLoadStrategy } from './serviceDiscovery'
import { FlyIoServiceDiscoveryManager } from './flyIoServiceDiscovery'
import { ClusterManager, createClusterConfigFromEnv } from './clusterManager'
import { MonitoringManager } from './monitoringManager'
import { PerformanceTracker } from './performanceTracker'
import { createBattleReportRoutes } from '../battleReportRoutes'
import { createEmailInheritanceRoutes } from '../emailInheritanceRoutes'
import { createAuthRoutes } from '../authRoutes'
import { createSessionRoutes } from '../sessionRoutes'
import type { BattleReportConfig } from '../battleReportService'
import type { EmailConfig } from '../emailService'
import { createEmailConfigFromEnv } from '../emailService'
import { createContainer, resetContainer } from '../container'
import type { ClientToServerEvents, ServerToClientEvents } from '@arcadia-eternity/protocol'
import { swaggerSpec, swaggerUiOptions } from '../swagger'
import { initializeSupabase } from '@arcadia-eternity/database'
import type { ClusterConfig } from './types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

// 集群配置接口
export interface ClusterServerConfig {
  port: number
  rpcPort?: number // RPC服务端口
  cors: {
    origin: string | string[]
    credentials: boolean
  }
  battleReport?: BattleReportConfig & {
    enableApi: boolean
  }
  email?: EmailConfig
  cluster?: ClusterConfig
  rpcServer?: BattleRpcServer // 可选的预配置 RPC 服务器
}

// 默认配置
const defaultConfig: ClusterServerConfig = {
  port: 8102,
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  },
}

/**
 * 创建集群感知的应用服务器
 */
export function createClusterApp(config: Partial<ClusterServerConfig> = {}): {
  app: express.Application
  server: ReturnType<typeof createServer>
  clusterManager: ClusterManager
  battleServer: ClusterBattleServer
  rpcServer: BattleRpcServer
  serviceDiscovery: ServiceDiscoveryManager
  monitoring: MonitoringManager
  performanceTracker: PerformanceTracker
  start: () => Promise<void>
  stop: () => Promise<void>
} {
  const finalConfig = { ...defaultConfig, ...config }

  // 处理邮件配置：如果没有提供邮件配置，则从环境变量创建
  if (!finalConfig.email) {
    finalConfig.email = createEmailConfigFromEnv()
  }

  // 处理集群配置：如果没有提供集群配置，则从环境变量创建
  if (!finalConfig.cluster) {
    finalConfig.cluster = createClusterConfigFromEnv()
  }

  // 初始化数据库连接
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

  // 重置并创建新的DI容器
  resetContainer()
  createContainer(finalConfig.email)

  // 创建Express应用
  const app = express()

  // 中间件设置
  app.use(cors(finalConfig.cors))
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true, limit: '10mb' }))

  // 性能监控中间件（在集群模式下启用）
  if (finalConfig.cluster?.cluster.enabled) {
    // 注意：这里使用延迟初始化，因为 performanceTracker 在 start() 方法中才创建
    app.use((req, res, next) => {
      if (performanceTracker) {
        return performanceTracker.createHttpMiddleware()(req, res, next)
      }
      next()
    })
  }

  // Swagger文档
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions))
  app.get('/api-docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(swaggerSpec)
  })

  // 健康检查端点（增强版，包含集群信息）
  app.get('/health', async (_req, res) => {
    try {
      const basicHealth = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      }

      // 如果集群启用，添加集群健康信息
      if (finalConfig.cluster?.cluster.enabled) {
        try {
          const clusterManager = ClusterManager.getInstance()
          const clusterHealth = await clusterManager.healthCheck()

          res.json({
            ...basicHealth,
            cluster: clusterHealth,
          })
        } catch (error) {
          res.json({
            ...basicHealth,
            cluster: {
              status: 'unhealthy',
              error: 'Cluster manager not available',
            },
          })
        }
      } else {
        res.json(basicHealth)
      }
    } catch (error) {
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // 集群状态端点
  app.get('/cluster/status', async (_req: Request, res: Response): Promise<void> => {
    try {
      if (!finalConfig.cluster?.cluster.enabled) {
        res.json({
          enabled: false,
          message: 'Cluster mode is disabled',
        })
        return
      }

      const clusterManager = ClusterManager.getInstance()
      const stateManager = clusterManager.getStateManager()
      const stats = await stateManager.getClusterStats()

      res.json({
        enabled: true,
        instanceId: clusterManager.getInstanceId(),
        stats,
      })
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // Prometheus指标端点
  app.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
    try {
      if (!finalConfig.cluster?.cluster.enabled || !performanceTracker) {
        res.status(404).send('Metrics not available in single instance mode')
        return
      }

      const metrics = await performanceTracker.getMetrics()
      res.set('Content-Type', 'text/plain')
      res.send(metrics)
    } catch (error) {
      res.status(500).send('Error retrieving metrics')
    }
  })

  // 创建 HTTP 服务器
  const server = createServer(app)

  // 创建 Socket.IO 服务器
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: finalConfig.cors,
    pingTimeout: 60000,
    pingInterval: 25000,
  })

  // 初始化集群管理器
  const clusterManager = ClusterManager.getInstance(finalConfig.cluster)

  // 声明集群组件变量，将在启动时初始化
  let performanceTracker: PerformanceTracker
  let monitoring: MonitoringManager
  let serviceDiscovery: ServiceDiscoveryManager
  let socketAdapter: SocketClusterAdapter
  let battleServer: ClusterBattleServer
  let rpcServer: BattleRpcServer
  let sessionManager: any // SessionManager实例

  // 设置基础 API 路由
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

  let isStarted = false

  const start = async (): Promise<void> => {
    if (isStarted) {
      throw new Error('Server is already started')
    }

    try {
      logger.info('Starting in cluster mode')

      // 初始化集群管理器
      await clusterManager.initialize()

      // 创建并初始化集群组件
      performanceTracker = new PerformanceTracker(clusterManager.getRedisManager(), finalConfig.cluster!.instance.id)
      monitoring = new MonitoringManager(
        clusterManager.getStateManager(),
        clusterManager.getRedisManager(),
        finalConfig.cluster!.instance.id,
      )
      // LogAggregationManager 已移除以减少 Redis 操作频率
      // 根据环境选择服务发现管理器
      if (process.env.FLY_APP_NAME) {
        // Fly.io 环境，使用专门的服务发现管理器
        serviceDiscovery = new FlyIoServiceDiscoveryManager(
          clusterManager.getRedisManager(),
          clusterManager.getStateManager(),
          new WeightedLoadStrategy(),
          process.env.FLY_APP_NAME,
          process.env.FLY_REGION,
        )
      } else {
        // 标准环境
        serviceDiscovery = new ServiceDiscoveryManager(
          clusterManager.getRedisManager(),
          clusterManager.getStateManager(),
          new WeightedLoadStrategy(),
        )
      }
      socketAdapter = new SocketClusterAdapter(
        io,
        clusterManager.getRedisManager(),
        clusterManager.getStateManager(),
        finalConfig.cluster!.instance.id,
      )
      // 创建 gRPC 服务器实例（需要先创建，然后注入到 ClusterBattleServer）
      const grpcPort = finalConfig.cluster!.instance.grpcPort || 50051

      // 先创建一个临时的 ClusterBattleServer 实例用于 gRPC 服务器
      const tempBattleServer = new ClusterBattleServer(
        io,
        clusterManager.getStateManager(),
        socketAdapter,
        clusterManager.getLockManager(),
        finalConfig.battleReport,
        finalConfig.cluster!.instance.id,
        finalConfig.rpcPort,
      )

      // 创建 gRPC 服务器实例
      rpcServer = new BattleRpcServer(tempBattleServer, grpcPort)

      // 创建最终的 ClusterBattleServer 实例，注入 gRPC 服务器
      battleServer = new ClusterBattleServer(
        io,
        clusterManager.getStateManager(),
        socketAdapter,
        clusterManager.getLockManager(),
        finalConfig.battleReport,
        finalConfig.cluster!.instance.id,
        finalConfig.rpcPort,
        rpcServer,
      )

      logger.info({ grpcPort }, 'gRPC server created and injected into ClusterBattleServer')

      // 初始化性能追踪器
      await performanceTracker.initialize()

      // 设置性能追踪器到其他组件
      clusterManager.getRedisManager().setPerformanceTracker(performanceTracker)
      socketAdapter.setPerformanceTracker(performanceTracker)
      battleServer.setPerformanceTracker(performanceTracker)

      // 初始化监控管理器
      await monitoring.initialize()

      // 日志聚合管理器已移除

      // 初始化服务发现
      await serviceDiscovery.initialize()

      // 初始化Socket集群适配器
      await socketAdapter.initialize()
      await socketAdapter.setupCrossInstanceCommandListener()

      // 创建SessionManager实例
      const { SessionManager } = await import('./sessionManager')
      sessionManager = new SessionManager(clusterManager.getStateManager(), clusterManager.getLockManager(), {
        maxSessions: 5, // 每个玩家最多5个会话
        sessionTimeout: 24 * 60 * 60 * 1000, // 24小时
        cleanupInterval: 60 * 60 * 1000, // 1小时清理一次
      })

      // 添加会话管理 API 路由（需要在SessionManager创建后）
      const { createClusterAuthService } = await import('./clusterAuthService')

      // 创建默认的auth配置
      const defaultAuthConfig = {
        jwtSecret: process.env.JWT_SECRET || 'default-secret-key',
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
        refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
      }

      const authService = createClusterAuthService(defaultAuthConfig, clusterManager.getStateManager())

      apiRouter.use('/sessions', createSessionRoutes(authService, sessionManager))
      logger.info('Session management API enabled at /api/v1/sessions')

      // 最后初始化 ClusterBattleServer（确保所有依赖都准备好）
      await battleServer.initialize()

      // 启动 gRPC 服务器
      await rpcServer.start()
      logger.info('gRPC server started successfully')

      logger.info('Cluster components initialized successfully')

      // 启动HTTP服务器
      return new Promise((resolve, reject) => {
        server.listen(finalConfig.port, () => {
          isStarted = true
          logger.info(
            {
              port: finalConfig.port,
              cors: finalConfig.cors.origin,
              clusterEnabled: true,
              instanceId: finalConfig.cluster!.instance.id,
              battleReportEnabled: !!finalConfig.battleReport?.enableReporting,
              apiEnabled: !!finalConfig.battleReport?.enableApi,
            },
            'Cluster server started successfully',
          )
          resolve()
        })

        server.on('error', error => {
          logger.error({ error }, 'Server startup failed')
          reject(error)
        })
      })
    } catch (error) {
      logger.error({ error }, 'Failed to start cluster server')
      throw error
    }
  }

  const stop = async (): Promise<void> => {
    if (!isStarted) {
      return
    }

    logger.info('Shutting down cluster server...')

    // 设置强制关闭超时时间（15秒）
    const SHUTDOWN_TIMEOUT = 15000
    let shutdownCompleted = false

    // 设置强制关闭定时器
    const forceShutdownTimer = setTimeout(() => {
      if (!shutdownCompleted) {
        logger.warn('优雅关闭超时，强制退出进程')
        process.exit(1)
      }
    }, SHUTDOWN_TIMEOUT)

    try {
      // 停止 gRPC 服务器
      if (rpcServer) {
        await rpcServer.stop()
        logger.info('gRPC server stopped')
      }

      // 清理战斗服务器资源
      if (battleServer) {
        await battleServer.cleanup()
      }

      // 清理监控组件
      if (performanceTracker) await performanceTracker.cleanup()
      if (monitoring) await monitoring.cleanup()
      // logAggregation 已移除

      // 清理Socket集群适配器
      if (socketAdapter) {
        await socketAdapter.cleanup()
      }

      // 清理服务发现
      if (serviceDiscovery) {
        await serviceDiscovery.cleanup()
      }

      // 清理集群管理器
      await clusterManager.cleanup()

      // 关闭 Socket.IO 服务器
      io.close()

      // 关闭 HTTP 服务器
      await new Promise<void>(resolve => {
        server.close(() => {
          isStarted = false
          logger.info('Cluster server shut down successfully')
          resolve()
        })
      })

      shutdownCompleted = true
      clearTimeout(forceShutdownTimer)
    } catch (error) {
      logger.error({ error }, 'Error during cluster server shutdown')
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
    clusterManager,
    get battleServer() {
      return battleServer
    },
    get rpcServer() {
      return rpcServer
    },
    get serviceDiscovery() {
      return serviceDiscovery
    },
    get monitoring() {
      return monitoring
    },
    get performanceTracker() {
      return performanceTracker
    },
    // logAggregation 已移除
    start,
    stop,
  }
}
