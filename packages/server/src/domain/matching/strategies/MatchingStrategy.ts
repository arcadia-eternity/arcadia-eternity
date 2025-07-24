import type { MatchmakingEntry } from '../../../cluster/types'

/**
 * 匹配质量评估结果
 */
export interface MatchQuality {
  /** 匹配质量分数 (0-1, 1为最佳匹配) */
  score: number
  /** ELO差距 (仅ELO匹配时有效) */
  eloDifference?: number
  /** 等待时间差距 (毫秒) */
  waitTimeDifference: number
  /** 是否为可接受的匹配 */
  acceptable: boolean
}

/**
 * 匹配策略配置
 */
export interface MatchingConfig {
  /** 匹配策略类型 */
  strategy: 'fifo' | 'elo'
  /** ELO匹配配置 (仅当strategy为'elo'时有效) */
  eloConfig?: {
    /** 初始ELO匹配范围 */
    initialRange: number
    /** 每秒扩大的范围 */
    rangeExpansionPerSecond: number
    /** 最大ELO差距 */
    maxEloDifference: number
    /** 最大等待时间 (秒) */
    maxWaitTime: number
  }
}

/**
 * 默认ELO匹配配置
 */
export const DEFAULT_ELO_CONFIG: NonNullable<MatchingConfig['eloConfig']> = {
  initialRange: 100,
  rangeExpansionPerSecond: 10,
  maxEloDifference: 500,
  maxWaitTime: 300, // 5分钟
}

/**
 * 匹配策略接口
 */
export interface MatchingStrategy {
  /**
   * 策略名称
   */
  readonly name: string

  /**
   * 从队列中找到最佳匹配
   * @param queue 当前队列
   * @param config 匹配配置
   * @returns 匹配的玩家对，如果没有找到匹配则返回null
   */
  findMatch(
    queue: MatchmakingEntry[],
    config: MatchingConfig,
  ): Promise<{
    player1: MatchmakingEntry
    player2: MatchmakingEntry
    quality: MatchQuality
  } | null>

  /**
   * 评估两个玩家的匹配质量
   * @param player1 玩家1
   * @param player2 玩家2
   * @param config 匹配配置
   * @returns 匹配质量评估
   */
  evaluateMatch(player1: MatchmakingEntry, player2: MatchmakingEntry, config: MatchingConfig): Promise<MatchQuality>

  /**
   * 检查匹配是否可接受
   * @param player1 玩家1
   * @param player2 玩家2
   * @param config 匹配配置
   * @returns 是否可接受此匹配
   */
  isMatchAcceptable(player1: MatchmakingEntry, player2: MatchmakingEntry, config: MatchingConfig): Promise<boolean>
}

/**
 * 抽象匹配策略基类
 */
export abstract class AbstractMatchingStrategy implements MatchingStrategy {
  abstract readonly name: string

  abstract findMatch(
    queue: MatchmakingEntry[],
    config: MatchingConfig,
  ): Promise<{
    player1: MatchmakingEntry
    player2: MatchmakingEntry
    quality: MatchQuality
  } | null>

  abstract evaluateMatch(
    player1: MatchmakingEntry,
    player2: MatchmakingEntry,
    config: MatchingConfig,
  ): Promise<MatchQuality>

  async isMatchAcceptable(
    player1: MatchmakingEntry,
    player2: MatchmakingEntry,
    config: MatchingConfig,
  ): Promise<boolean> {
    const quality = await this.evaluateMatch(player1, player2, config)
    return quality.acceptable
  }

  /**
   * 计算等待时间 (秒)
   */
  protected getWaitTimeSeconds(entry: MatchmakingEntry): number {
    return Math.floor((Date.now() - entry.joinTime) / 1000)
  }

  /**
   * 计算等待时间差距 (毫秒)
   */
  protected getWaitTimeDifference(player1: MatchmakingEntry, player2: MatchmakingEntry): number {
    return Math.abs(player1.joinTime - player2.joinTime)
  }
}
