import { Router, type Request, type Response } from 'express'
import { resourceLoadingManager } from './resourceLoadingManager'

/**
 * 创建资源状态监控路由
 */
export function createResourceStatusRoutes(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/resources/status:
   *   get:
   *     summary: 获取游戏资源加载状态
   *     description: 返回当前游戏资源的加载进度和状态信息
   *     tags:
   *       - Resources
   *     responses:
   *       200:
   *         description: 资源状态信息
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   enum: [not_started, loading, completed, failed]
   *                   description: 资源加载状态
   *                 startTime:
   *                   type: string
   *                   format: date-time
   *                   description: 开始加载时间
   *                 completedTime:
   *                   type: string
   *                   format: date-time
   *                   description: 完成加载时间
   *                 error:
   *                   type: string
   *                   description: 错误信息（如果有）
   *                 gameDataLoaded:
   *                   type: boolean
   *                   description: 游戏数据是否已加载
   *                 scriptsLoaded:
   *                   type: boolean
   *                   description: 脚本是否已加载
   *                 validationCompleted:
   *                   type: boolean
   *                   description: 数据验证是否已完成
   *                 isReady:
   *                   type: boolean
   *                   description: 资源是否已准备就绪
   *                 duration:
   *                   type: number
   *                   description: 加载耗时（毫秒）
   */
  router.get('/status', (req: Request, res: Response) => {
    try {
      const progress = resourceLoadingManager.getProgress()
      const isReady = resourceLoadingManager.isReady()

      let duration: number | undefined
      if (progress.startTime) {
        const endTime = progress.completedTime || new Date()
        duration = endTime.getTime() - progress.startTime.getTime()
      }

      res.json({
        ...progress,
        isReady,
        duration,
      })
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get resource status',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  /**
   * @swagger
   * /api/v1/resources/health:
   *   get:
   *     summary: 资源健康检查
   *     description: 检查资源是否已准备就绪，用于健康检查
   *     tags:
   *       - Resources
   *     responses:
   *       200:
   *         description: 资源已准备就绪
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ready:
   *                   type: boolean
   *                   description: 资源是否已准备就绪
   *                 status:
   *                   type: string
   *                   description: 当前状态
   *       503:
   *         description: 资源未准备就绪
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ready:
   *                   type: boolean
   *                   description: 资源是否已准备就绪
   *                 status:
   *                   type: string
   *                   description: 当前状态
   *                 error:
   *                   type: string
   *                   description: 错误信息（如果有）
   */
  router.get('/health', (req: Request, res: Response) => {
    try {
      const progress = resourceLoadingManager.getProgress()
      const isReady = resourceLoadingManager.isReady()

      if (isReady) {
        res.json({
          ready: true,
          status: progress.status,
        })
      } else {
        res.status(503).json({
          ready: false,
          status: progress.status,
          error: progress.error,
        })
      }
    } catch (error) {
      res.status(500).json({
        ready: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  return router
}
