import type { TimerConfig } from '@arcadia-eternity/const'
import { RuleSystem } from '../core/RuleSystem'
import { RuleRegistry } from '../core/RuleRegistry'
import type { RuleContext } from '../interfaces/Rule'
import { RulePhase } from '../interfaces/Rule'

/**
 * 计时器系统集成类
 * 提供规则系统与计时器系统的集成功能
 */
export class TimerIntegration {
  private ruleSystem: RuleSystem
  private registry: RuleRegistry

  constructor(ruleSystem?: RuleSystem, registry?: RuleRegistry) {
    this.registry = registry || RuleRegistry.getInstance()
    this.ruleSystem = ruleSystem || new RuleSystem(this.registry)
  }

  /**
   * 根据规则修改计时器配置
   * @param baseConfig 基础计时器配置
   * @param ruleSetIds 要应用的规则集ID列表
   * @param context 可选的规则上下文
   * @returns 修改后的计时器配置
   */
  applyRulesToTimerConfig(baseConfig: TimerConfig, ruleSetIds: string[], context?: RuleContext): TimerConfig {
    // 激活规则集
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of ruleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        console.warn(`Failed to activate rule set ${ruleSetId}:`, error)
      }
    }

    // 设置规则上下文
    const ctx: RuleContext = context || {
      phase: RulePhase.BATTLE_PREPARATION,
      data: { timerConfig: baseConfig },
    }
    this.ruleSystem.setContext(ctx)

    // 获取计时器配置修改
    const modifications = this.ruleSystem.getTimerConfigModifications(ctx)

    // 合并配置
    const finalConfig: TimerConfig = {
      ...baseConfig,
      ...modifications,
    }

    return finalConfig
  }

  /**
   * 验证计时器配置是否符合规则要求
   * @param config 计时器配置
   * @param ruleSetIds 要检查的规则集ID列表
   * @returns 验证结果
   */
  validateTimerConfig(
    config: TimerConfig,
    ruleSetIds: string[],
  ): {
    isValid: boolean
    errors: string[]
    warnings: string[]
    suggestedConfig?: Partial<TimerConfig>
  } {
    const errors: string[] = []
    const warnings: string[] = []
    let suggestedConfig: Partial<TimerConfig> = {}

    // 激活规则集并获取建议配置
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of ruleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        errors.push(`规则集 "${ruleSetId}" 不存在或无法激活`)
        continue
      }
    }

    const context: RuleContext = {
      phase: RulePhase.BATTLE_PREPARATION,
      data: { timerConfig: config },
    }
    this.ruleSystem.setContext(context)

    const ruleModifications = this.ruleSystem.getTimerConfigModifications(context)
    suggestedConfig = ruleModifications

    // 检查配置冲突
    for (const [key, ruleValue] of Object.entries(ruleModifications)) {
      const configValue = (config as any)[key]
      if (configValue !== undefined && configValue !== ruleValue) {
        if (key === 'enabled') {
          if (ruleValue === true && configValue === false) {
            errors.push('规则要求启用计时器，但当前配置禁用了计时器')
          } else if (ruleValue === false && configValue === true) {
            warnings.push('规则建议禁用计时器，但当前配置启用了计时器')
          }
        } else if (key === 'turnTimeLimit') {
          if (typeof ruleValue === 'number' && typeof configValue === 'number') {
            if (configValue > ruleValue) {
              warnings.push(`回合时间限制 ${configValue}秒 超过规则建议的 ${ruleValue}秒`)
            } else if (configValue < ruleValue) {
              warnings.push(`回合时间限制 ${configValue}秒 低于规则建议的 ${ruleValue}秒`)
            }
          }
        } else if (key === 'totalTimeLimit') {
          if (typeof ruleValue === 'number' && typeof configValue === 'number') {
            if (configValue > ruleValue) {
              warnings.push(`总时间限制 ${configValue}秒 超过规则建议的 ${ruleValue}秒`)
            } else if (configValue < ruleValue) {
              warnings.push(`总时间限制 ${configValue}秒 低于规则建议的 ${ruleValue}秒`)
            }
          }
        }
      }
    }

    // 基本配置验证
    if (config.enabled) {
      if (config.turnTimeLimit && config.turnTimeLimit <= 0) {
        errors.push('回合时间限制必须大于0')
      }
      if (config.totalTimeLimit && config.totalTimeLimit <= 0) {
        errors.push('总时间限制必须大于0')
      }
      if (config.maxAnimationDuration && config.maxAnimationDuration <= 0) {
        errors.push('最大动画持续时间必须大于0')
      }

      // 逻辑验证
      if (config.turnTimeLimit && config.totalTimeLimit) {
        if (config.turnTimeLimit > config.totalTimeLimit) {
          errors.push('回合时间限制不能大于总时间限制')
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestedConfig: Object.keys(suggestedConfig).length > 0 ? suggestedConfig : undefined,
    }
  }

  /**
   * 获取规则推荐的计时器配置
   * @param ruleSetIds 规则集ID列表
   * @returns 推荐的计时器配置
   */
  getRecommendedTimerConfig(ruleSetIds: string[]): TimerConfig {
    // 默认配置 - 使用平衡的设置
    const baseConfig: TimerConfig = {
      enabled: true,
      turnTimeLimit: 30,
      totalTimeLimit: 900,
      animationPauseEnabled: true,
      maxAnimationDuration: 10000,
    }

    // 应用规则修改
    return this.applyRulesToTimerConfig(baseConfig, ruleSetIds)
  }

  /**
   * 检查计时器规则兼容性
   * @param ruleSetIds 规则集ID列表
   * @returns 兼容性检查结果
   */
  checkTimerRuleCompatibility(ruleSetIds: string[]): {
    isCompatible: boolean
    conflicts: Array<{
      ruleSetA: string
      ruleSetB: string
      conflictType: string
      description: string
    }>
    warnings: string[]
  } {
    const conflicts: Array<{
      ruleSetA: string
      ruleSetB: string
      conflictType: string
      description: string
    }> = []
    const warnings: string[] = []

    // 获取所有规则集的计时器配置
    const ruleSetConfigs = new Map<string, Partial<TimerConfig>>()

    for (const ruleSetId of ruleSetIds) {
      try {
        this.ruleSystem.clearActiveRuleSets()
        this.ruleSystem.activateRuleSet(ruleSetId)

        const context: RuleContext = {
          phase: RulePhase.BATTLE_PREPARATION,
        }
        this.ruleSystem.setContext(context)

        const config = this.ruleSystem.getTimerConfigModifications(context)
        ruleSetConfigs.set(ruleSetId, config)
      } catch (error) {
        warnings.push(`无法获取规则集 "${ruleSetId}" 的计时器配置`)
      }
    }

    // 检查配置冲突
    const ruleSetIds_array = Array.from(ruleSetConfigs.keys())
    for (let i = 0; i < ruleSetIds_array.length; i++) {
      for (let j = i + 1; j < ruleSetIds_array.length; j++) {
        const ruleSetA = ruleSetIds_array[i]
        const ruleSetB = ruleSetIds_array[j]
        const configA = ruleSetConfigs.get(ruleSetA)!
        const configB = ruleSetConfigs.get(ruleSetB)!

        // 检查具体的配置冲突
        for (const key of Object.keys(configA)) {
          if (key in configB && configA[key as keyof TimerConfig] !== configB[key as keyof TimerConfig]) {
            conflicts.push({
              ruleSetA,
              ruleSetB,
              conflictType: key,
              description: `${ruleSetA} 要求 ${key} = ${configA[key as keyof TimerConfig]}，但 ${ruleSetB} 要求 ${key} = ${configB[key as keyof TimerConfig]}`,
            })
          }
        }
      }
    }

    return {
      isCompatible: conflicts.length === 0,
      conflicts,
      warnings,
    }
  }

  /**
   * 获取规则系统实例
   */
  getRuleSystem(): RuleSystem {
    return this.ruleSystem
  }

  /**
   * 获取规则注册表实例
   */
  getRegistry(): RuleRegistry {
    return this.registry
  }
}
