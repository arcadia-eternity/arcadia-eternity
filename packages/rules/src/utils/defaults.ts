import { RuleSystem } from '../core/RuleSystem'
import { RuleRegistry } from '../core/RuleRegistry'
import { createCasualStandardRuleSet, createCompetitiveRuleSet } from '../rulesets'
import {
  // 队伍规则
  createStandardTeamSizeRule,
  createCompetitiveTeamSizeRule,
  // 等级规则
  createStandardLevelLimitRule,
  createCompetitiveLevelLimitRule,
  // 学习力规则
  createStandardEVLimitRule,
  // 计时器规则
  createStandardCompetitiveTimerRule,
  createCasualTimerRule,
  // 竞技规则
  createCompetitivePetSpeciesUniqueRule,
  // 技能验证规则
  createStandardSkillAvailabilityRule,
  createCompetitiveSkillAvailabilityRule,
  // 性别限制规则
  createStandardGenderRestrictionRule,
} from '../rules'

/**
 * 创建带有默认规则的规则系统
 * @param autoRegisterDefaults 是否自动注册默认规则和规则集
 * @returns 规则系统实例
 */
export function createRuleSystemWithDefaults(autoRegisterDefaults: boolean = true): {
  ruleSystem: RuleSystem
  registry: RuleRegistry
} {
  const registry = RuleRegistry.getInstance()
  const ruleSystem = new RuleSystem(registry)

  if (autoRegisterDefaults) {
    registerDefaultRules(registry)
  }

  return { ruleSystem, registry }
}

/**
 * 注册所有基础规则到注册表
 * @param registry 规则注册表实例
 */
function registerAllBasicRules(registry: RuleRegistry): void {
  // 只注册最基础的规则

  // 队伍大小规则
  registry.registerRule(createStandardTeamSizeRule())
  registry.registerRule(createCompetitiveTeamSizeRule())

  // 等级限制规则
  registry.registerRule(createStandardLevelLimitRule())
  registry.registerRule(createCompetitiveLevelLimitRule())

  // 学习力限制规则
  registry.registerRule(createStandardEVLimitRule())

  // 基础计时器规则
  registry.registerRule(createStandardCompetitiveTimerRule())
  registry.registerRule(createCasualTimerRule())

  // 竞技规则
  registry.registerRule(createCompetitivePetSpeciesUniqueRule())

  // 技能验证规则
  registry.registerRule(createStandardSkillAvailabilityRule())
  registry.registerRule(createCompetitiveSkillAvailabilityRule())

  // 性别限制规则
  registry.registerRule(createStandardGenderRestrictionRule())
}

/**
 * 注册默认规则和规则集到注册表
 * @param registry 规则注册表实例
 */
export function registerDefaultRules(registry: RuleRegistry): void {
  try {
    // 首先注册所有基础规则
    registerAllBasicRules(registry)

    // 只注册基础的规则集
    registry.registerRuleSet(createCasualStandardRuleSet()) // 休闲模式（默认）
    registry.registerRuleSet(createCompetitiveRuleSet()) // 竞技模式

    console.log('Default rules and rule sets registered successfully')
  } catch (error) {
    console.error('Failed to register default rules:', error)
    throw error
  }
}

/**
 * 获取可用的规则集列表
 * @returns 可用的规则集ID列表
 */
export function getAvailableRuleSets(): string[] {
  return ['casual_standard_ruleset', 'competitive_ruleset']
}

/**
 * 验证规则系统是否正确初始化
 * @param registry 规则注册表
 * @returns 验证结果
 */
export function validateRuleSystemSetup(registry: RuleRegistry): {
  isValid: boolean
  errors: string[]
  warnings: string[]
  stats: {
    totalRules: number
    totalRuleSets: number
    enabledRules: number
    enabledRuleSets: number
  }
} {
  const errors: string[] = []
  const warnings: string[] = []

  // 验证注册表完整性
  const registryValidation = registry.validateRegistry()
  if (!registryValidation.isValid) {
    errors.push(...registryValidation.errors.map(e => e.message))
  }
  warnings.push(...registryValidation.warnings.map(w => w.message))

  // 检查基本规则集是否存在
  const requiredRuleSets = ['competitive_ruleset', 'casual_standard_ruleset']

  for (const ruleSetId of requiredRuleSets) {
    if (!registry.hasRuleSet(ruleSetId)) {
      errors.push(`Required rule set "${ruleSetId}" is not registered`)
    }
  }

  // 统计信息
  const stats = {
    totalRules: registry.getAllRules().length,
    totalRuleSets: registry.getAllRuleSets().length,
    enabledRules: registry.getEnabledRules().length,
    enabledRuleSets: registry.getEnabledRuleSets().length,
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    stats,
  }
}
