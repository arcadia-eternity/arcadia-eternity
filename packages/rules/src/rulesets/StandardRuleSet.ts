import { RuleSetImpl } from '../core/AbstractRuleSet'
import { RuleRegistry } from '../core/RuleRegistry'

/**
 * 休闲规则集
 * 休闲模式的规则集，包含基础限制和休闲计时器
 */
export function createCasualStandardRuleSet(): RuleSetImpl {
  const ruleSet = new RuleSetImpl('casual_standard_ruleset', '休闲规则集', {
    description: '休闲模式的规则集合，适合日常对战',
    version: '1.0.0',
    author: 'Arcadia Eternity Team',
    tags: ['casual', 'standard', 'default'],
    enabled: true,
  })

  // 从注册表获取规则实例，而不是创建新实例
  const registry = RuleRegistry.getInstance()

  // 添加基础规则（使用注册表中的实例）
  const standardTeamSizeRule = registry.getRule('standard_team_size')
  const standardLevelLimitRule = registry.getRule('standard_level_limit')
  const standardEVLimitRule = registry.getRule('standard_ev_limit')
  const casualTimerRule = registry.getRule('casual_timer')
  const standardSkillAvailabilityRule = registry.getRule('standard_skill_availability')

  if (standardTeamSizeRule) ruleSet.addRule(standardTeamSizeRule)
  if (standardLevelLimitRule) ruleSet.addRule(standardLevelLimitRule)
  if (standardEVLimitRule) ruleSet.addRule(standardEVLimitRule)
  if (casualTimerRule) ruleSet.addRule(casualTimerRule)
  if (standardSkillAvailabilityRule) ruleSet.addRule(standardSkillAvailabilityRule)

  return ruleSet
}
