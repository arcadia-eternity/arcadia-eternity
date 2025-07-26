import { RuleSetImpl } from '../core/AbstractRuleSet'
import { RuleRegistry } from '../core/RuleRegistry'
import {
  createViewOnlyRule,
  createStarterSelectionRule,
  createCompetitive6v3Rule,
  createCasual6v4Rule,
} from '../rules/special/TeamSelectionRule'

/**
 * Team View Only Rule Set
 * Shows both teams for a short time before battle starts
 */
export function createTeamViewOnlyRuleSet(): RuleSetImpl {
  const ruleSet = new RuleSetImpl('team_view_only_ruleset', '队伍查看规则集', {
    description: '战斗开始前显示双方队伍信息',
    version: '1.0.0',
    author: 'Arcadia Eternity Team',
    tags: ['team-selection', 'view-only', 'casual'],
    enabled: true,
    matchingConfig: {
      strategy: 'fifo',
    },
  })

  const registry = RuleRegistry.getInstance()

  // Add base casual rules
  const standardTeamSizeRule = registry.getRule('standard_team_size')
  const standardLevelLimitRule = registry.getRule('standard_level_limit')
  const standardEVLimitRule = registry.getRule('standard_ev_limit')
  const casualTimerRule = registry.getRule('casual_timer')
  const standardSkillAvailabilityRule = registry.getRule('standard_skill_availability')
  const standardGenderRestrictionRule = registry.getRule('standard_gender_restriction')

  if (standardTeamSizeRule) ruleSet.addRule(standardTeamSizeRule)
  if (standardLevelLimitRule) ruleSet.addRule(standardLevelLimitRule)
  if (standardEVLimitRule) ruleSet.addRule(standardEVLimitRule)
  if (casualTimerRule) ruleSet.addRule(casualTimerRule)
  if (standardSkillAvailabilityRule) ruleSet.addRule(standardSkillAvailabilityRule)
  if (standardGenderRestrictionRule) ruleSet.addRule(standardGenderRestrictionRule)

  // Add team selection rule
  ruleSet.addRule(createViewOnlyRule(10))

  return ruleSet
}

/**
 * Starter Selection Rule Set
 * Allows players to choose their starter pet from full team
 */
export function createStarterSelectionRuleSet(): RuleSetImpl {
  const ruleSet = new RuleSetImpl('starter_selection_ruleset', '首发选择规则集', {
    description: '使用完整队伍但可以选择首发精灵',
    version: '1.0.0',
    author: 'Arcadia Eternity Team',
    tags: ['team-selection', 'starter-selection', 'casual'],
    enabled: true,
    matchingConfig: {
      strategy: 'fifo',
    },
  })

  const registry = RuleRegistry.getInstance()

  // Add base casual rules
  const standardTeamSizeRule = registry.getRule('standard_team_size')
  const standardLevelLimitRule = registry.getRule('standard_level_limit')
  const standardEVLimitRule = registry.getRule('standard_ev_limit')
  const casualTimerRule = registry.getRule('casual_timer')
  const standardSkillAvailabilityRule = registry.getRule('standard_skill_availability')
  const standardGenderRestrictionRule = registry.getRule('standard_gender_restriction')

  if (standardTeamSizeRule) ruleSet.addRule(standardTeamSizeRule)
  if (standardLevelLimitRule) ruleSet.addRule(standardLevelLimitRule)
  if (standardEVLimitRule) ruleSet.addRule(standardEVLimitRule)
  if (casualTimerRule) ruleSet.addRule(casualTimerRule)
  if (standardSkillAvailabilityRule) ruleSet.addRule(standardSkillAvailabilityRule)
  if (standardGenderRestrictionRule) ruleSet.addRule(standardGenderRestrictionRule)

  // Add team selection rule
  ruleSet.addRule(createStarterSelectionRule(30))

  return ruleSet
}

/**
 * Competitive 6v3 Rule Set
 * Players select 3 pets from their 6-pet team for competitive battle
 */
export function createCompetitive6v3RuleSet(): RuleSetImpl {
  const ruleSet = new RuleSetImpl('competitive_6v3_ruleset', '竞技6选3规则集', {
    description: '从6只精灵中选择3只参战的竞技规则集',
    version: '1.0.0',
    author: 'Arcadia Eternity Team',
    tags: ['team-selection', 'competitive', '6v3', 'tournament'],
    enabled: true,
    matchingConfig: {
      strategy: 'elo',
      eloConfig: {
        initialRange: 100,
        rangeExpansionPerSecond: 15,
        maxEloDifference: 400,
        maxWaitTime: 180,
      },
    },
  })

  const registry = RuleRegistry.getInstance()

  // Add competitive rules
  const competitiveTeamSizeRule = registry.getRule('competitive_team_size')
  const competitiveLevelLimitRule = registry.getRule('competitive_level_limit')
  const standardEVLimitRule = registry.getRule('standard_ev_limit')
  const competitiveTimerRule = registry.getRule('standard_competitive_timer')
  const competitivePetSpeciesUniqueRule = registry.getRule('competitive_pet_species_unique')
  const competitiveSkillAvailabilityRule = registry.getRule('competitive_skill_availability')
  const standardGenderRestrictionRule = registry.getRule('standard_gender_restriction')

  if (competitiveTeamSizeRule) ruleSet.addRule(competitiveTeamSizeRule)
  if (competitiveLevelLimitRule) ruleSet.addRule(competitiveLevelLimitRule)
  if (standardEVLimitRule) ruleSet.addRule(standardEVLimitRule)
  if (competitiveTimerRule) ruleSet.addRule(competitiveTimerRule)
  if (competitivePetSpeciesUniqueRule) ruleSet.addRule(competitivePetSpeciesUniqueRule)
  if (competitiveSkillAvailabilityRule) ruleSet.addRule(competitiveSkillAvailabilityRule)
  if (standardGenderRestrictionRule) ruleSet.addRule(standardGenderRestrictionRule)

  // Add team selection rule
  ruleSet.addRule(createCompetitive6v3Rule(60))

  return ruleSet
}

/**
 * Casual 6v4 Rule Set
 * Players select 4 pets from their 6-pet team for casual battle
 */
export function createCasual6v4RuleSet(): RuleSetImpl {
  const ruleSet = new RuleSetImpl('casual_6v4_ruleset', '休闲6选4规则集', {
    description: '从6只精灵中选择4只参战的休闲规则集',
    version: '1.0.0',
    author: 'Arcadia Eternity Team',
    tags: ['team-selection', 'casual', '6v4'],
    enabled: true,
    matchingConfig: {
      strategy: 'fifo',
    },
  })

  const registry = RuleRegistry.getInstance()

  // Add base casual rules
  const standardTeamSizeRule = registry.getRule('standard_team_size')
  const standardLevelLimitRule = registry.getRule('standard_level_limit')
  const standardEVLimitRule = registry.getRule('standard_ev_limit')
  const casualTimerRule = registry.getRule('casual_timer')
  const standardSkillAvailabilityRule = registry.getRule('standard_skill_availability')
  const standardGenderRestrictionRule = registry.getRule('standard_gender_restriction')

  if (standardTeamSizeRule) ruleSet.addRule(standardTeamSizeRule)
  if (standardLevelLimitRule) ruleSet.addRule(standardLevelLimitRule)
  if (standardEVLimitRule) ruleSet.addRule(standardEVLimitRule)
  if (casualTimerRule) ruleSet.addRule(casualTimerRule)
  if (standardSkillAvailabilityRule) ruleSet.addRule(standardSkillAvailabilityRule)
  if (standardGenderRestrictionRule) ruleSet.addRule(standardGenderRestrictionRule)

  // Add team selection rule
  ruleSet.addRule(createCasual6v4Rule(90))

  return ruleSet
}

/**
 * Advanced Team Selection Rule Set
 * Demonstrates complex team selection with multiple constraints
 */
export function createAdvancedTeamSelectionRuleSet(): RuleSetImpl {
  const ruleSet = new RuleSetImpl('advanced_team_selection_ruleset', '高级队伍选择规则集', {
    description: '具有复杂队伍选择约束的高级规则集',
    version: '1.0.0',
    author: 'Arcadia Eternity Team',
    tags: ['team-selection', 'advanced', 'complex'],
    enabled: true,
    matchingConfig: {
      strategy: 'elo',
      eloConfig: {
        initialRange: 50,
        rangeExpansionPerSecond: 10,
        maxEloDifference: 300,
        maxWaitTime: 120,
      },
    },
  })

  const registry = RuleRegistry.getInstance()

  // Add competitive rules
  const competitiveTeamSizeRule = registry.getRule('competitive_team_size')
  const competitiveLevelLimitRule = registry.getRule('competitive_level_limit')
  const standardEVLimitRule = registry.getRule('standard_ev_limit')
  const competitiveTimerRule = registry.getRule('standard_competitive_timer')
  const competitivePetSpeciesUniqueRule = registry.getRule('competitive_pet_species_unique')
  const competitiveSkillAvailabilityRule = registry.getRule('competitive_skill_availability')
  const standardGenderRestrictionRule = registry.getRule('standard_gender_restriction')

  if (competitiveTeamSizeRule) ruleSet.addRule(competitiveTeamSizeRule)
  if (competitiveLevelLimitRule) ruleSet.addRule(competitiveLevelLimitRule)
  if (standardEVLimitRule) ruleSet.addRule(standardEVLimitRule)
  if (competitiveTimerRule) ruleSet.addRule(competitiveTimerRule)
  if (competitivePetSpeciesUniqueRule) ruleSet.addRule(competitivePetSpeciesUniqueRule)
  if (competitiveSkillAvailabilityRule) ruleSet.addRule(competitiveSkillAvailabilityRule)
  if (standardGenderRestrictionRule) ruleSet.addRule(standardGenderRestrictionRule)

  // Add custom team selection rule with flexible size
  const customTeamSelectionRule = createCompetitive6v3Rule(45)
  customTeamSelectionRule.updateConfig({
    minTeamSize: 2,
    maxTeamSize: 4,
    showOpponentTeam: true,
    teamInfoVisibility: 'BASIC',
  })
  ruleSet.addRule(customTeamSelectionRule)

  return ruleSet
}
