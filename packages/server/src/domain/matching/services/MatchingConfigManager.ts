import type { MatchingConfig } from '../strategies/MatchingStrategy'
import { RuleRegistry } from '@arcadia-eternity/rules'
import pino from 'pino'

const logger = pino({ name: 'MatchingConfigManager' })

/**
 * 匹配配置管理器
 * 负责获取和管理规则集的匹配配置
 */
export class MatchingConfigManager {
  private static instance: MatchingConfigManager
  private configCache = new Map<string, MatchingConfig>()

  private constructor() {}

  static getInstance(): MatchingConfigManager {
    if (!this.instance) {
      this.instance = new MatchingConfigManager()
    }
    return this.instance
  }

  /**
   * 获取规则集的匹配配置
   * @param ruleSetId 规则集ID
   * @returns 匹配配置
   */
  getMatchingConfig(ruleSetId: string): MatchingConfig {
    // 检查缓存
    if (this.configCache.has(ruleSetId)) {
      return this.configCache.get(ruleSetId)!
    }

    // 从规则注册表获取规则集
    const registry = RuleRegistry.getInstance()
    const ruleSet = registry.getRuleSet(ruleSetId)

    let config: MatchingConfig

    if (ruleSet?.matchingConfig) {
      config = ruleSet.matchingConfig
      logger.info(
        {
          ruleSetId,
          strategy: config.strategy,
          eloConfig: config.eloConfig,
        },
        'Using rule set matching configuration'
      )
    } else {
      // 默认使用FIFO匹配
      config = { strategy: 'fifo' }
      logger.info(
        { ruleSetId },
        'No matching configuration found for rule set, using default FIFO strategy'
      )
    }

    // 缓存配置
    this.configCache.set(ruleSetId, config)
    return config
  }

  /**
   * 设置规则集的匹配配置
   * @param ruleSetId 规则集ID
   * @param config 匹配配置
   */
  setMatchingConfig(ruleSetId: string, config: MatchingConfig): void {
    this.configCache.set(ruleSetId, config)
    logger.info(
      {
        ruleSetId,
        strategy: config.strategy,
        eloConfig: config.eloConfig,
      },
      'Updated matching configuration for rule set'
    )
  }

  /**
   * 清除配置缓存
   */
  clearCache(): void {
    this.configCache.clear()
    logger.info('Cleared matching configuration cache')
  }

  /**
   * 获取所有缓存的配置
   */
  getAllConfigs(): Map<string, MatchingConfig> {
    return new Map(this.configCache)
  }

  /**
   * 检查规则集是否启用ELO匹配
   * @param ruleSetId 规则集ID
   * @returns 是否启用ELO匹配
   */
  isEloMatchingEnabled(ruleSetId: string): boolean {
    const config = this.getMatchingConfig(ruleSetId)
    return config.strategy === 'elo'
  }

  /**
   * 获取规则集的ELO配置
   * @param ruleSetId 规则集ID
   * @returns ELO配置，如果未启用ELO匹配则返回null
   */
  getEloConfig(ruleSetId: string): NonNullable<MatchingConfig['eloConfig']> | null {
    const config = this.getMatchingConfig(ruleSetId)
    return config.strategy === 'elo' ? config.eloConfig || null : null
  }

  /**
   * 获取支持ELO匹配的规则集列表
   */
  getEloEnabledRuleSets(): string[] {
    const eloRuleSets: string[] = []
    
    for (const [ruleSetId, config] of this.configCache) {
      if (config.strategy === 'elo') {
        eloRuleSets.push(ruleSetId)
      }
    }

    return eloRuleSets
  }

  /**
   * 获取使用FIFO匹配的规则集列表
   */
  getFifoEnabledRuleSets(): string[] {
    const fifoRuleSets: string[] = []
    
    for (const [ruleSetId, config] of this.configCache) {
      if (config.strategy === 'fifo') {
        fifoRuleSets.push(ruleSetId)
      }
    }

    return fifoRuleSets
  }

  /**
   * 验证匹配配置
   * @param config 匹配配置
   * @returns 验证结果
   */
  validateConfig(config: MatchingConfig): {
    isValid: boolean
    errors: string[]
  } {
    const errors: string[] = []

    if (!['fifo', 'elo'].includes(config.strategy)) {
      errors.push(`Invalid strategy: ${config.strategy}`)
    }

    if (config.strategy === 'elo') {
      if (!config.eloConfig) {
        errors.push('ELO strategy requires eloConfig')
      } else {
        const eloConfig = config.eloConfig

        if (eloConfig.initialRange <= 0) {
          errors.push('initialRange must be positive')
        }

        if (eloConfig.rangeExpansionPerSecond < 0) {
          errors.push('rangeExpansionPerSecond must be non-negative')
        }

        if (eloConfig.maxEloDifference <= eloConfig.initialRange) {
          errors.push('maxEloDifference must be greater than initialRange')
        }

        if (eloConfig.maxWaitTime <= 0) {
          errors.push('maxWaitTime must be positive')
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    }
  }
}
