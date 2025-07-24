import {
  AbstractMatchingStrategy,
  type MatchingConfig,
  type MatchQuality,
  DEFAULT_ELO_CONFIG,
} from './MatchingStrategy'
import type { MatchmakingEntry } from '../../../cluster/types'
import { EloService } from '../../elo/services/eloService'
import { EloCalculationService } from '../../elo/services/eloCalculationService'
import { EloRepository } from '@arcadia-eternity/database'
import pino from 'pino'

const logger = pino({ name: 'EloMatchingStrategy' })

/**
 * ELO匹配策略
 * 基于玩家的ELO评级进行匹配，优先匹配ELO相近的玩家
 */
export class EloMatchingStrategy extends AbstractMatchingStrategy {
  readonly name = 'ELO'
  private eloService: EloService

  constructor() {
    super()
    // 创建ELO服务实例
    const eloRepository = new EloRepository()
    const eloCalculationService = new EloCalculationService()
    this.eloService = new EloService(eloRepository, eloCalculationService)
  }

  async findMatch(
    queue: MatchmakingEntry[],
    config: MatchingConfig,
  ): Promise<{
    player1: MatchmakingEntry
    player2: MatchmakingEntry
    quality: MatchQuality
  } | null> {
    if (queue.length < 2) {
      return null
    }

    const eloConfig = config.eloConfig || DEFAULT_ELO_CONFIG
    let bestMatch: {
      player1: MatchmakingEntry
      player2: MatchmakingEntry
      quality: MatchQuality
    } | null = null

    // 获取所有玩家的ELO评级
    const playersWithElo = await Promise.all(
      queue.map(async entry => {
        const ruleSetId = entry.ruleSetId || 'casual_standard_ruleset'
        const eloRating = await this.eloService.getOrCreatePlayerElo(entry.playerId, ruleSetId)
        return {
          entry,
          elo: eloRating.elo_rating,
          waitTime: this.getWaitTimeSeconds(entry),
        }
      }),
    )

    logger.debug(
      {
        queueSize: queue.length,
        players: playersWithElo.map(p => ({
          id: p.entry.playerId,
          elo: p.elo,
          waitTime: p.waitTime,
        })),
      },
      'Attempting ELO-based matching',
    )

    // 尝试为每个玩家找到最佳匹配
    for (let i = 0; i < playersWithElo.length; i++) {
      const player1 = playersWithElo[i]

      // 计算当前玩家的可接受ELO范围
      const acceptableRange = this.calculateAcceptableEloRange(player1.waitTime, eloConfig)
      const minElo = player1.elo - acceptableRange
      const maxElo = player1.elo + acceptableRange

      logger.debug(
        {
          playerId: player1.entry.playerId,
          playerElo: player1.elo,
          waitTime: player1.waitTime,
          acceptableRange,
          eloRange: [minElo, maxElo],
        },
        'Calculating acceptable ELO range for player',
      )

      // 寻找ELO范围内的对手
      for (let j = i + 1; j < playersWithElo.length; j++) {
        const player2 = playersWithElo[j]

        // 检查ELO是否在可接受范围内
        if (player2.elo >= minElo && player2.elo <= maxElo) {
          const quality = await this.evaluateMatch(player1.entry, player2.entry, config)

          if (quality.acceptable && (!bestMatch || quality.score > bestMatch.quality.score)) {
            bestMatch = {
              player1: player1.entry,
              player2: player2.entry,
              quality,
            }

            logger.debug(
              {
                player1: { id: player1.entry.playerId, elo: player1.elo },
                player2: { id: player2.entry.playerId, elo: player2.elo },
                eloDifference: quality.eloDifference,
                matchScore: quality.score,
              },
              'Found potential ELO match',
            )
          }
        }
      }
    }

    if (bestMatch) {
      logger.info(
        {
          player1: { id: bestMatch.player1.playerId },
          player2: { id: bestMatch.player2.playerId },
          eloDifference: bestMatch.quality.eloDifference,
          matchScore: bestMatch.quality.score,
        },
        'ELO match found',
      )
    } else {
      logger.debug('No acceptable ELO match found in current queue')
    }

    return bestMatch
  }

  async evaluateMatch(
    player1: MatchmakingEntry,
    player2: MatchmakingEntry,
    config: MatchingConfig,
  ): Promise<MatchQuality> {
    const eloConfig = config.eloConfig || DEFAULT_ELO_CONFIG
    const ruleSetId = player1.ruleSetId || player2.ruleSetId || 'casual_standard_ruleset'

    // 获取两个玩家的ELO评级
    const [player1Elo, player2Elo] = await Promise.all([
      this.eloService.getOrCreatePlayerElo(player1.playerId, ruleSetId),
      this.eloService.getOrCreatePlayerElo(player2.playerId, ruleSetId),
    ])

    const eloDifference = Math.abs(player1Elo.elo_rating - player2Elo.elo_rating)
    const waitTimeDifference = this.getWaitTimeDifference(player1, player2)

    // 计算匹配质量分数
    // ELO差距越小，分数越高
    const eloScore = Math.max(0, 1 - eloDifference / eloConfig.maxEloDifference)

    // 等待时间相似性也影响匹配质量
    const maxWaitTimeDiff = 60000 // 1分钟
    const waitTimeScore = Math.max(0, 1 - waitTimeDifference / maxWaitTimeDiff)

    // 综合评分 (ELO权重更高)
    const score = eloScore * 0.8 + waitTimeScore * 0.2

    // 检查是否可接受
    const player1WaitTime = this.getWaitTimeSeconds(player1)
    const player2WaitTime = this.getWaitTimeSeconds(player2)
    const maxWaitTime = Math.max(player1WaitTime, player2WaitTime)

    const acceptable = eloDifference <= eloConfig.maxEloDifference && maxWaitTime <= eloConfig.maxWaitTime

    return {
      score,
      eloDifference,
      waitTimeDifference,
      acceptable,
    }
  }

  async isMatchAcceptable(
    player1: MatchmakingEntry,
    player2: MatchmakingEntry,
    config: MatchingConfig,
  ): Promise<boolean> {
    const quality = await this.evaluateMatch(player1, player2, config)
    return quality.acceptable
  }

  /**
   * 根据等待时间计算可接受的ELO范围
   */
  private calculateAcceptableEloRange(waitTimeSeconds: number, eloConfig: typeof DEFAULT_ELO_CONFIG): number {
    const expandedRange = eloConfig.initialRange + waitTimeSeconds * eloConfig.rangeExpansionPerSecond
    return Math.min(expandedRange, eloConfig.maxEloDifference)
  }
}
