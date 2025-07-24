import { RuleSetImpl } from '../core/AbstractRuleSet'
import { RuleRegistry } from '../core/RuleRegistry'

/**
 * 竞技规则集
 * 严格的竞技对战规则，确保公平竞争
 */
export function createCompetitiveRuleSet(): RuleSetImpl {
  const ruleSet = new RuleSetImpl('competitive_ruleset', '竞技规则集', {
    description: '严格的竞技对战规则集，确保公平竞争环境',
    version: '1.0.0',
    author: 'Arcadia Eternity Team',
    tags: ['competitive', 'strict', 'tournament'],
    enabled: true,
    matchingConfig: {
      strategy: 'elo',
      eloConfig: {
        initialRange: 100,
        rangeExpansionPerSecond: 15,
        maxEloDifference: 400,
        maxWaitTime: 180, // 3分钟
      },
    },
  })

  // 从注册表获取规则实例，而不是创建新实例
  const registry = RuleRegistry.getInstance()

  // 添加严格的竞技规则（使用注册表中的实例）
  const competitiveTeamSizeRule = registry.getRule('competitive_team_size')
  const competitiveLevelLimitRule = registry.getRule('competitive_level_limit')
  const standardEVLimitRule = registry.getRule('standard_ev_limit')
  const standardCompetitiveTimerRule = registry.getRule('standard_competitive_timer')
  const competitivePetSpeciesUniqueRule = registry.getRule('competitive_pet_species_unique')
  const competitiveSkillAvailabilityRule = registry.getRule('competitive_skill_availability')
  const standardGenderRestrictionRule = registry.getRule('standard_gender_restriction')

  if (competitiveTeamSizeRule) ruleSet.addRule(competitiveTeamSizeRule)
  if (competitiveLevelLimitRule) ruleSet.addRule(competitiveLevelLimitRule)
  if (standardEVLimitRule) ruleSet.addRule(standardEVLimitRule)
  if (standardCompetitiveTimerRule) ruleSet.addRule(standardCompetitiveTimerRule)
  if (competitivePetSpeciesUniqueRule) ruleSet.addRule(competitivePetSpeciesUniqueRule)
  if (competitiveSkillAvailabilityRule) ruleSet.addRule(competitiveSkillAvailabilityRule)
  if (standardGenderRestrictionRule) ruleSet.addRule(standardGenderRestrictionRule)

  return ruleSet
}
