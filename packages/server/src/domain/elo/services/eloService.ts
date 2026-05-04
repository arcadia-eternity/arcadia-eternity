import { injectable, inject } from 'inversify'
import { EloRepository } from '@arcadia-eternity/database'
import type { PlayerEloRating, EloUpdateResult } from '@arcadia-eternity/database'
import { EloCalculationService, type EloCalculationResult } from './eloCalculationService'
import pino from 'pino'

const logger = pino({ name: 'EloService' })

/**
 * ELO管理服务
 * 负责协调ELO计算和数据库操作
 */
@injectable()
export class EloService {
  constructor(
    @inject('EloRepository') private eloRepository: EloRepository,
    @inject('EloCalculationService') private calculationService: EloCalculationService
  ) {}

  /**
   * 处理战斗结束后的ELO更新
   * @param playerAId 玩家A的ID
   * @param playerBId 玩家B的ID
   * @param winnerId 胜利者ID，null表示平局
   * @param ruleSetId 规则集ID
   * @returns ELO计算结果
   */
  async processBattleEloUpdate(
    playerAId: string,
    playerBId: string,
    winnerId: string | null,
    ruleSetId: string
  ): Promise<EloCalculationResult> {
    try {
      logger.info(
        {
          playerAId,
          playerBId,
          winnerId,
          ruleSetId,
        },
        'Processing battle ELO update'
      )

      // 获取或创建两个玩家的ELO记录
      const [playerAElo, playerBElo] = await Promise.all([
        this.eloRepository.getOrCreatePlayerElo(playerAId, ruleSetId),
        this.eloRepository.getOrCreatePlayerElo(playerBId, ruleSetId),
      ])

      logger.info(
        {
          playerA: {
            id: playerAId,
            currentElo: playerAElo.elo_rating,
            gamesPlayed: playerAElo.games_played,
          },
          playerB: {
            id: playerBId,
            currentElo: playerBElo.elo_rating,
            gamesPlayed: playerBElo.games_played,
          },
        },
        'Current ELO ratings before battle'
      )

      // 计算ELO变化
      const eloResult = this.calculationService.calculateBattleEloChanges(
        playerAElo,
        playerBElo,
        winnerId,
        ruleSetId
      )

      logger.info(
        {
          playerA: {
            id: playerAId,
            oldElo: eloResult.playerA.old_elo,
            newElo: eloResult.playerA.new_elo,
            change: eloResult.playerA.elo_change,
            result: eloResult.playerA.result,
          },
          playerB: {
            id: playerBId,
            oldElo: eloResult.playerB.old_elo,
            newElo: eloResult.playerB.new_elo,
            change: eloResult.playerB.elo_change,
            result: eloResult.playerB.result,
          },
        },
        'Calculated ELO changes'
      )

      // 生成更新输入
      const updateInputs = this.calculationService.generateUpdateInputs(eloResult)

      // 批量更新ELO评级
      await this.eloRepository.batchUpdatePlayerElos(updateInputs)

      logger.info(
        {
          playerAId,
          playerBId,
          ruleSetId,
        },
        'Successfully updated ELO ratings'
      )

      return eloResult
    } catch (error) {
      logger.error(
        {
          error,
          playerAId,
          playerBId,
          winnerId,
          ruleSetId,
        },
        'Failed to process battle ELO update'
      )
      throw error
    }
  }

  /**
   * 获取玩家在特定规则集下的ELO信息
   * @param playerId 玩家ID
   * @param ruleSetId 规则集ID
   * @returns ELO信息，如果不存在则返回null
   */
  async getPlayerElo(playerId: string, ruleSetId: string): Promise<PlayerEloRating | null> {
    return await this.eloRepository.getPlayerElo(playerId, ruleSetId)
  }

  /**
   * 获取或创建玩家ELO记录
   * @param playerId 玩家ID
   * @param ruleSetId 规则集ID
   * @param initialElo 初始ELO（可选）
   * @returns ELO记录
   */
  async getOrCreatePlayerElo(
    playerId: string,
    ruleSetId: string,
    initialElo?: number
  ): Promise<PlayerEloRating> {
    return await this.eloRepository.getOrCreatePlayerElo(playerId, ruleSetId, initialElo)
  }

  /**
   * 获取玩家的所有规则集ELO信息
   * @param playerId 玩家ID
   * @returns 所有规则集的ELO信息
   */
  async getPlayerAllElos(playerId: string): Promise<PlayerEloRating[]> {
    return await this.eloRepository.getPlayerAllElos(playerId)
  }

  /**
   * 获取规则集ELO排行榜
   * @param ruleSetId 规则集ID
   * @param limit 限制数量
   * @param offset 偏移量
   * @returns 排行榜数据
   */
  async getEloLeaderboard(ruleSetId: string, limit: number = 50, offset: number = 0) {
    return await this.eloRepository.getEloLeaderboard(ruleSetId, { limit, offset })
  }

  /**
   * 获取玩家在特定规则集中的排名
   * @param playerId 玩家ID
   * @param ruleSetId 规则集ID
   * @returns 排名，如果玩家没有ELO记录则返回null
   */
  async getPlayerRank(playerId: string, ruleSetId: string): Promise<number | null> {
    return await this.eloRepository.getPlayerRank(playerId, ruleSetId)
  }

  /**
   * 获取规则集的ELO统计信息
   * @param ruleSetId 规则集ID
   * @returns 统计信息
   */
  async getEloStatistics(ruleSetId: string) {
    return await this.eloRepository.getEloStatistics(ruleSetId)
  }

  /**
   * 预测两个玩家的战斗结果
   * @param playerAId 玩家A的ID
   * @param playerBId 玩家B的ID
   * @param ruleSetId 规则集ID
   * @returns 预测结果，包含玩家A获胜的概率
   */
  async predictBattleOutcome(
    playerAId: string,
    playerBId: string,
    ruleSetId: string
  ): Promise<{
    playerAWinProbability: number
    playerBWinProbability: number
    eloDifference: number
    playerAElo: number
    playerBElo: number
  }> {
    // 获取两个玩家的ELO记录
    const [playerAElo, playerBElo] = await Promise.all([
      this.getOrCreatePlayerElo(playerAId, ruleSetId),
      this.getOrCreatePlayerElo(playerBId, ruleSetId),
    ])

    const playerAWinProbability = this.calculationService.predictWinProbability(
      playerAElo.elo_rating,
      playerBElo.elo_rating
    )

    return {
      playerAWinProbability,
      playerBWinProbability: 1 - playerAWinProbability,
      eloDifference: playerAElo.elo_rating - playerBElo.elo_rating,
      playerAElo: playerAElo.elo_rating,
      playerBElo: playerBElo.elo_rating,
    }
  }

  /**
   * 获取ELO计算服务的配置
   */
  getEloConfig() {
    return this.calculationService.getConfig()
  }

  /**
   * 更新ELO计算配置
   * @param config 新的配置
   */
  updateEloConfig(config: Parameters<EloCalculationService['updateConfig']>[0]) {
    this.calculationService.updateConfig(config)
  }

  /**
   * 计算ELO差距对应的胜率
   * @param eloDifference ELO差距
   * @returns 胜率百分比
   */
  eloToWinRate(eloDifference: number): number {
    return this.calculationService.eloToWinRate(eloDifference)
  }
}
