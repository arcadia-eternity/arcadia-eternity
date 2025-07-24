import { injectable } from 'inversify'
import type { PlayerEloRating, UpdateEloRatingInput, EloUpdateResult } from '@arcadia-eternity/database'

/**
 * ELO计算配置
 */
export interface EloConfig {
  /** 初始ELO评级 */
  initialElo: number
  /** K因子配置 */
  kFactor: {
    /** 新手K因子（游戏场次少于30场） */
    newbie: number
    /** 普通K因子（游戏场次30-100场） */
    normal: number
    /** 老手K因子（游戏场次超过100场） */
    veteran: number
  }
  /** 最小ELO评级 */
  minElo: number
  /** 最大ELO评级 */
  maxElo: number
}

/**
 * 默认ELO配置
 */
const DEFAULT_ELO_CONFIG: EloConfig = {
  initialElo: 1200,
  kFactor: {
    newbie: 32,
    normal: 24,
    veteran: 16,
  },
  minElo: 100,
  maxElo: 3000,
}

/**
 * 战斗结果类型
 */
export type BattleResult = 'win' | 'loss' | 'draw'

/**
 * ELO计算结果
 */
export interface EloCalculationResult {
  playerA: EloUpdateResult
  playerB: EloUpdateResult
}

/**
 * ELO计算服务
 */
@injectable()
export class EloCalculationService {
  private config: EloConfig

  constructor(config: Partial<EloConfig> = {}) {
    this.config = { ...DEFAULT_ELO_CONFIG, ...config }
  }

  /**
   * 计算期望得分
   * @param playerElo 玩家ELO
   * @param opponentElo 对手ELO
   * @returns 期望得分 (0-1)
   */
  private calculateExpectedScore(playerElo: number, opponentElo: number): number {
    return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400))
  }

  /**
   * 获取K因子
   * @param gamesPlayed 已游戏场次
   * @returns K因子
   */
  private getKFactor(gamesPlayed: number): number {
    if (gamesPlayed < 30) {
      return this.config.kFactor.newbie
    } else if (gamesPlayed < 100) {
      return this.config.kFactor.normal
    } else {
      return this.config.kFactor.veteran
    }
  }

  /**
   * 将战斗结果转换为实际得分
   * @param result 战斗结果
   * @returns 实际得分 (0, 0.5, 1)
   */
  private resultToScore(result: BattleResult): number {
    switch (result) {
      case 'win':
        return 1
      case 'loss':
        return 0
      case 'draw':
        return 0.5
      default:
        throw new Error(`Invalid battle result: ${result}`)
    }
  }

  /**
   * 限制ELO评级在有效范围内
   * @param elo ELO评级
   * @returns 限制后的ELO评级
   */
  private clampElo(elo: number): number {
    return Math.max(this.config.minElo, Math.min(this.config.maxElo, Math.round(elo)))
  }

  /**
   * 计算新的ELO评级
   * @param currentElo 当前ELO
   * @param opponentElo 对手ELO
   * @param result 战斗结果
   * @param gamesPlayed 已游戏场次
   * @returns 新的ELO评级
   */
  calculateNewElo(
    currentElo: number,
    opponentElo: number,
    result: BattleResult,
    gamesPlayed: number
  ): number {
    const expectedScore = this.calculateExpectedScore(currentElo, opponentElo)
    const actualScore = this.resultToScore(result)
    const kFactor = this.getKFactor(gamesPlayed)

    const newElo = currentElo + kFactor * (actualScore - expectedScore)
    return this.clampElo(newElo)
  }

  /**
   * 计算战斗后两个玩家的ELO变化
   * @param playerA 玩家A的ELO数据
   * @param playerB 玩家B的ELO数据
   * @param winner 胜利者ID，null表示平局
   * @param ruleSetId 规则集ID
   * @returns ELO计算结果
   */
  calculateBattleEloChanges(
    playerA: PlayerEloRating,
    playerB: PlayerEloRating,
    winner: string | null,
    ruleSetId: string
  ): EloCalculationResult {
    // 确定战斗结果
    let playerAResult: BattleResult
    let playerBResult: BattleResult

    if (winner === null) {
      // 平局
      playerAResult = 'draw'
      playerBResult = 'draw'
    } else if (winner === playerA.player_id) {
      // 玩家A获胜
      playerAResult = 'win'
      playerBResult = 'loss'
    } else if (winner === playerB.player_id) {
      // 玩家B获胜
      playerAResult = 'loss'
      playerBResult = 'win'
    } else {
      throw new Error(`Invalid winner ID: ${winner}`)
    }

    // 计算新的ELO评级
    const newEloA = this.calculateNewElo(
      playerA.elo_rating,
      playerB.elo_rating,
      playerAResult,
      playerA.games_played
    )

    const newEloB = this.calculateNewElo(
      playerB.elo_rating,
      playerA.elo_rating,
      playerBResult,
      playerB.games_played
    )

    return {
      playerA: {
        player_id: playerA.player_id,
        rule_set_id: ruleSetId,
        old_elo: playerA.elo_rating,
        new_elo: newEloA,
        elo_change: newEloA - playerA.elo_rating,
        result: playerAResult,
      },
      playerB: {
        player_id: playerB.player_id,
        rule_set_id: ruleSetId,
        old_elo: playerB.elo_rating,
        new_elo: newEloB,
        elo_change: newEloB - playerB.elo_rating,
        result: playerBResult,
      },
    }
  }

  /**
   * 生成ELO更新输入
   * @param eloResult ELO计算结果
   * @returns ELO更新输入数组
   */
  generateUpdateInputs(eloResult: EloCalculationResult): UpdateEloRatingInput[] {
    return [
      {
        player_id: eloResult.playerA.player_id,
        rule_set_id: eloResult.playerA.rule_set_id,
        new_elo: eloResult.playerA.new_elo,
        result: eloResult.playerA.result,
      },
      {
        player_id: eloResult.playerB.player_id,
        rule_set_id: eloResult.playerB.rule_set_id,
        new_elo: eloResult.playerB.new_elo,
        result: eloResult.playerB.result,
      },
    ]
  }

  /**
   * 获取当前配置
   */
  getConfig(): EloConfig {
    return { ...this.config }
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<EloConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  /**
   * 预测战斗结果概率
   * @param playerAElo 玩家A的ELO
   * @param playerBElo 玩家B的ELO
   * @returns 玩家A获胜的概率
   */
  predictWinProbability(playerAElo: number, playerBElo: number): number {
    return this.calculateExpectedScore(playerAElo, playerBElo)
  }

  /**
   * 计算ELO差距对应的胜率
   * @param eloDifference ELO差距（正数表示优势）
   * @returns 胜率百分比
   */
  eloToWinRate(eloDifference: number): number {
    const expectedScore = 1 / (1 + Math.pow(10, -eloDifference / 400))
    return Math.round(expectedScore * 100)
  }
}
