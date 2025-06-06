import type { Request, Response, Router, NextFunction } from 'express'
import { databaseService } from '@arcadia-eternity/database'
import type { Logger } from 'pino'

export interface BattleReportRoutesConfig {
  enableApi: boolean
}

/**
 * 创建战报相关的 REST API 路由
 */
export function createBattleReportRoutes(router: Router, config: BattleReportRoutesConfig, logger: Logger): void {
  if (!config.enableApi) {
    logger.info('Battle report API disabled')
    return
  }

  const apiLogger = logger.child({ module: 'BattleReportAPI' })

  // 错误处理中间件
  const handleError = (error: any, res: Response, operation: string) => {
    apiLogger.error({ error, operation }, 'API operation failed')

    if (error.name === 'DatabaseError') {
      res.status(500).json({
        error: 'Database error',
        message: error.message,
        code: error.code,
      })
    } else {
      res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred',
      })
    }
  }

  // 参数验证中间件
  const validatePagination = (req: Request, res: Response, next: NextFunction): void => {
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0

    if (limit < 1 || limit > 100) {
      res.status(400).json({
        error: 'Invalid limit',
        message: 'Limit must be between 1 and 100',
      })
      return
    }

    if (offset < 0) {
      res.status(400).json({
        error: 'Invalid offset',
        message: 'Offset must be non-negative',
      })
      return
    }

    req.pagination = { limit, offset }
    next()
  }

  // 获取战报列表
  router.get('/battles', validatePagination, async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await databaseService.battles.getBattleRecords(req.pagination)
      res.json(result)
    } catch (error) {
      handleError(error, res, 'getBattleRecords')
    }
  })

  // 获取单个战报详情
  router.get('/battles/:id', async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params
      const battleRecord = await databaseService.battles.getBattleRecordById(id)

      if (!battleRecord) {
        res.status(404).json({
          error: 'Battle record not found',
          message: `Battle record with ID ${id} does not exist`,
        })
        return
      }

      res.json(battleRecord)
    } catch (error) {
      handleError(error, res, 'getBattleRecordById')
    }
  })

  // 获取玩家的战报记录
  router.get('/players/:playerId/battles', validatePagination, async (req: Request, res: Response): Promise<void> => {
    try {
      const { playerId } = req.params
      const result = await databaseService.battles.getPlayerBattleRecords(playerId, req.pagination)
      res.json(result)
    } catch (error) {
      handleError(error, res, 'getPlayerBattleRecords')
    }
  })

  // 获取玩家信息
  router.get('/players/:playerId', async (req: Request, res: Response): Promise<void> => {
    try {
      const { playerId } = req.params
      const player = await databaseService.players.getPlayerById(playerId)

      if (!player) {
        res.status(404).json({
          error: 'Player not found',
          message: `Player with ID ${playerId} does not exist`,
        })
        return
      }

      res.json(player)
    } catch (error) {
      handleError(error, res, 'getPlayerById')
    }
  })

  // 获取玩家统计信息
  router.get('/players/:playerId/stats', async (req: Request, res: Response): Promise<void> => {
    try {
      const { playerId } = req.params
      const stats = await databaseService.players.getPlayerStats(playerId)

      if (!stats) {
        res.status(404).json({
          error: 'Player stats not found',
          message: `Stats for player ${playerId} do not exist`,
        })
        return
      }

      res.json(stats)
    } catch (error) {
      handleError(error, res, 'getPlayerStats')
    }
  })

  // 搜索玩家
  router.get('/players', async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, limit } = req.query

      if (!search || typeof search !== 'string') {
        res.status(400).json({
          error: 'Missing search parameter',
          message: 'Search query is required',
        })
        return
      }

      const searchLimit = parseInt(limit as string) || 20
      if (searchLimit < 1 || searchLimit > 50) {
        res.status(400).json({
          error: 'Invalid limit',
          message: 'Limit must be between 1 and 50',
        })
        return
      }

      const results = await databaseService.players.searchPlayers(search, searchLimit)
      res.json({ data: results })
    } catch (error) {
      handleError(error, res, 'searchPlayers')
    }
  })

  // 获取排行榜 - 暂时禁用
  // router.get('/leaderboard', validatePagination, async (req: Request, res: Response): Promise<void> => {
  //   try {
  //     const result = await databaseService.players.getLeaderboard(req.pagination)
  //     res.json(result)
  //   } catch (error) {
  //     handleError(error, res, 'getLeaderboard')
  //   }
  // })

  // 获取战报统计信息
  router.get('/statistics', async (_req: Request, res: Response): Promise<void> => {
    try {
      const stats = await databaseService.battles.getBattleStatistics()
      res.json(stats)
    } catch (error) {
      handleError(error, res, 'getBattleStatistics')
    }
  })

  apiLogger.info('Battle report API routes registered')
}

// 扩展 Request 接口以包含分页参数
declare global {
  namespace Express {
    interface Request {
      pagination?: {
        limit: number
        offset: number
      }
    }
  }
}
