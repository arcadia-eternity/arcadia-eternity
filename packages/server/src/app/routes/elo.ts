import { Router, type Request, type Response } from 'express'
import { EloRepository } from '@arcadia-eternity/database'
import { EloService } from '../../domain/elo/services/eloService'
import { EloCalculationService } from '../../domain/elo/services/eloCalculationService'
import pino from 'pino'

const router: Router = Router()
const logger = pino({ name: 'EloAPI' })

// 创建ELO服务实例
const eloRepository = new EloRepository()
const eloCalculationService = new EloCalculationService()
const eloService = new EloService(eloRepository, eloCalculationService)

/**
 * 获取规则集ELO排行榜
 * GET /api/v1/elo/leaderboard/:ruleSetId
 */
router.get('/leaderboard/:ruleSetId', async (req, res) => {
  try {
    const { ruleSetId } = req.params
    const limit = parseInt(req.query.limit as string) || 50
    const offset = parseInt(req.query.offset as string) || 0

    // 验证参数
    if (limit > 100) {
      return res.status(400).json({
        error: 'Limit cannot exceed 100',
      })
    }

    const leaderboard = await eloService.getEloLeaderboard(ruleSetId, limit, offset)

    res.json({
      success: true,
      data: leaderboard,
    })
  } catch (error) {
    logger.error({ error, ruleSetId: req.params.ruleSetId }, 'Failed to get ELO leaderboard')
    res.status(500).json({
      error: 'Failed to get ELO leaderboard',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * 获取玩家在特定规则集下的ELO信息
 * GET /api/v1/elo/player/:playerId/:ruleSetId
 */
router.get('/player/:playerId/:ruleSetId', async (req, res) => {
  try {
    const { playerId, ruleSetId } = req.params

    const [playerElo, playerRank] = await Promise.all([
      eloService.getPlayerElo(playerId, ruleSetId),
      eloService.getPlayerRank(playerId, ruleSetId),
    ])

    if (!playerElo) {
      return res.status(404).json({
        error: 'Player ELO not found',
        message: `No ELO record found for player ${playerId} in rule set ${ruleSetId}`,
      })
    }

    res.json({
      success: true,
      data: {
        ...playerElo,
        rank: playerRank,
      },
    })
  } catch (error) {
    logger.error({ error, playerId: req.params.playerId, ruleSetId: req.params.ruleSetId }, 'Failed to get player ELO')
    res.status(500).json({
      error: 'Failed to get player ELO',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * 获取玩家的所有规则集ELO信息
 * GET /api/v1/elo/player/:playerId
 */
router.get('/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params

    const playerElos = await eloService.getPlayerAllElos(playerId)

    // 获取每个规则集的排名
    const elosWithRanks = await Promise.all(
      playerElos.map(async elo => {
        const rank = await eloService.getPlayerRank(playerId, elo.rule_set_id)
        return {
          ...elo,
          rank,
        }
      }),
    )

    res.json({
      success: true,
      data: elosWithRanks,
    })
  } catch (error) {
    logger.error({ error, playerId: req.params.playerId }, 'Failed to get player all ELOs')
    res.status(500).json({
      error: 'Failed to get player all ELOs',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * 获取规则集的ELO统计信息
 * GET /api/v1/elo/statistics/:ruleSetId
 */
router.get('/statistics/:ruleSetId', async (req, res) => {
  try {
    const { ruleSetId } = req.params

    const statistics = await eloService.getEloStatistics(ruleSetId)

    res.json({
      success: true,
      data: statistics,
    })
  } catch (error) {
    logger.error({ error, ruleSetId: req.params.ruleSetId }, 'Failed to get ELO statistics')
    res.status(500).json({
      error: 'Failed to get ELO statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * 预测两个玩家的战斗结果
 * GET /api/v1/elo/predict/:playerAId/:playerBId/:ruleSetId
 */
router.get('/predict/:playerAId/:playerBId/:ruleSetId', async (req, res) => {
  try {
    const { playerAId, playerBId, ruleSetId } = req.params

    const prediction = await eloService.predictBattleOutcome(playerAId, playerBId, ruleSetId)

    res.json({
      success: true,
      data: prediction,
    })
  } catch (error) {
    logger.error(
      { error, playerAId: req.params.playerAId, playerBId: req.params.playerBId, ruleSetId: req.params.ruleSetId },
      'Failed to predict battle outcome',
    )
    res.status(500).json({
      error: 'Failed to predict battle outcome',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * 获取ELO配置信息
 * GET /api/v1/elo/config
 */
router.get('/config', async (req, res) => {
  try {
    const config = eloService.getEloConfig()

    res.json({
      success: true,
      data: config,
    })
  } catch (error) {
    logger.error({ error }, 'Failed to get ELO config')
    res.status(500).json({
      error: 'Failed to get ELO config',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

/**
 * 计算ELO差距对应的胜率
 * GET /api/v1/elo/win-rate/:eloDifference
 */
router.get('/win-rate/:eloDifference', async (req, res) => {
  try {
    const eloDifference = parseInt(req.params.eloDifference)

    if (isNaN(eloDifference)) {
      return res.status(400).json({
        error: 'Invalid ELO difference',
        message: 'ELO difference must be a number',
      })
    }

    const winRate = eloService.eloToWinRate(eloDifference)

    res.json({
      success: true,
      data: {
        eloDifference,
        winRate,
      },
    })
  } catch (error) {
    logger.error({ error, eloDifference: req.params.eloDifference }, 'Failed to calculate win rate')
    res.status(500).json({
      error: 'Failed to calculate win rate',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

export default router
