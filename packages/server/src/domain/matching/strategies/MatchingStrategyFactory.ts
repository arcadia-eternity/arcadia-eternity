import type { MatchingStrategy, MatchingConfig } from './MatchingStrategy'
import { FIFOMatchingStrategy } from './FIFOMatchingStrategy'
import { EloMatchingStrategy } from './EloMatchingStrategy'
import pino from 'pino'

const logger = pino({ name: 'MatchingStrategyFactory' })

/**
 * 匹配策略工厂
 * 根据配置创建相应的匹配策略实例
 */
export class MatchingStrategyFactory {
  private static strategies = new Map<string, MatchingStrategy>()

  /**
   * 获取匹配策略实例
   * @param config 匹配配置
   * @returns 匹配策略实例
   */
  static getStrategy(config: MatchingConfig): MatchingStrategy {
    const strategyType = config.strategy

    // 使用单例模式，避免重复创建策略实例
    if (!this.strategies.has(strategyType)) {
      let strategy: MatchingStrategy

      switch (strategyType) {
        case 'fifo':
          strategy = new FIFOMatchingStrategy()
          break
        case 'elo':
          strategy = new EloMatchingStrategy()
          break
        default:
          logger.warn(
            { strategyType },
            'Unknown matching strategy type, falling back to FIFO'
          )
          strategy = new FIFOMatchingStrategy()
          break
      }

      this.strategies.set(strategyType, strategy)
      logger.info(
        { strategyType, strategyName: strategy.name },
        'Created new matching strategy instance'
      )
    }

    return this.strategies.get(strategyType)!
  }

  /**
   * 清除所有策略实例缓存
   * 主要用于测试或重新配置
   */
  static clearCache(): void {
    this.strategies.clear()
    logger.info('Cleared matching strategy cache')
  }

  /**
   * 获取所有支持的策略类型
   */
  static getSupportedStrategies(): string[] {
    return ['fifo', 'elo']
  }

  /**
   * 验证匹配配置
   * @param config 匹配配置
   * @returns 验证结果
   */
  static validateConfig(config: MatchingConfig): {
    isValid: boolean
    errors: string[]
  } {
    const errors: string[] = []

    // 检查策略类型
    if (!this.getSupportedStrategies().includes(config.strategy)) {
      errors.push(`Unsupported matching strategy: ${config.strategy}`)
    }

    // 检查ELO配置
    if (config.strategy === 'elo') {
      if (!config.eloConfig) {
        errors.push('ELO strategy requires eloConfig')
      } else {
        const eloConfig = config.eloConfig

        if (eloConfig.initialRange <= 0) {
          errors.push('eloConfig.initialRange must be positive')
        }

        if (eloConfig.rangeExpansionPerSecond < 0) {
          errors.push('eloConfig.rangeExpansionPerSecond must be non-negative')
        }

        if (eloConfig.maxEloDifference <= eloConfig.initialRange) {
          errors.push('eloConfig.maxEloDifference must be greater than initialRange')
        }

        if (eloConfig.maxWaitTime <= 0) {
          errors.push('eloConfig.maxWaitTime must be positive')
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }
}
