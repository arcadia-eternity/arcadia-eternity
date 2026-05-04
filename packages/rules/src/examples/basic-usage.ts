/**
 * 规则系统基本使用示例
 */

import { Gender, Nature } from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import {
  createRuleSystemWithDefaults,
  getAvailableRuleSets,
  BattleIntegration,
  TeamBuilderIntegration,
  TimerIntegration,
} from '../index'

// 创建示例队伍数据
function createSampleTeam(): PetSchemaType[] {
  return [
    {
      id: 'pet1',
      name: '休罗斯',
      species: 'pet_xiuluosi',
      level: 100,
      evs: { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      skills: ['skill_dixiulazhinu', 'skill_lieyanjuexiji', 'skill_qili', 'skill_fenlitupo'],
      gender: Gender.Male,
      nature: Nature.Jolly,
      ability: 'mark_ability_yanhuo',
      emblem: 'mark_emblem_nuhuo',
      height: 77,
      weight: 39,
    },
    {
      id: 'pet2',
      name: '水精灵',
      species: 'pet_shuijingling',
      level: 100,
      evs: { hp: 252, atk: 0, def: 4, spa: 252, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31 },
      skills: ['skill_shuipao', 'skill_bingdong', 'skill_zhiliao', 'skill_fantan'],
      gender: Gender.Female,
      nature: Nature.Modest,
      ability: 'mark_ability_shuixi',
      emblem: 'mark_emblem_shuidi',
      height: 65,
      weight: 29,
    },
  ]
}

/**
 * 基本规则系统使用示例
 */
export function basicRuleSystemExample(): void {
  console.log('=== 规则系统基本使用示例 ===')

  // 1. 创建规则系统
  const { ruleSystem, registry } = createRuleSystemWithDefaults()

  // 2. 获取推荐的规则集
  const competitiveRules = getAvailableRuleSets().filter(id => id.includes('competitive'))
  console.log('竞技模式推荐规则集:', competitiveRules)

  // 3. 激活规则集
  for (const ruleSetId of competitiveRules) {
    ruleSystem.activateRuleSet(ruleSetId)
  }

  // 4. 创建示例队伍
  const team = createSampleTeam()

  // 5. 验证队伍
  const validation = ruleSystem.validateTeam(team)
  console.log('队伍验证结果:', {
    isValid: validation.isValid,
    errorCount: validation.errors.length,
    warningCount: validation.warnings.length,
  })

  if (!validation.isValid) {
    console.log('验证错误:')
    validation.errors.forEach(error => {
      console.log(`- ${error.message}`)
    })
  }

  if (validation.warnings.length > 0) {
    console.log('验证警告:')
    validation.warnings.forEach(warning => {
      console.log(`- ${warning.message}`)
    })
  }
}

/**
 * 战斗集成使用示例
 */
export async function battleIntegrationExample(): Promise<void> {
  console.log('\n=== 战斗集成使用示例 ===')

  // 1. 创建战斗集成实例
  const battleIntegration = new BattleIntegration()

  // 2. 准备队伍数据
  const playerATeam = createSampleTeam()
  const playerBTeam = createSampleTeam()

  // 3. 准备战斗
  const ruleSetIds = ['competitive_ruleset']
  const battlePreparation = await battleIntegration.prepareBattle(playerATeam, playerBTeam, ruleSetIds, {
    allowFaintSwitch: true,
    showHidden: false,
  })

  console.log('战斗准备结果:', {
    isValid: battlePreparation.validation.isValid,
    errorCount: battlePreparation.validation.errors.length,
    battleOptions: battlePreparation.battleOptions,
  })
}

/**
 * 队伍构建器集成使用示例
 */
export function teamBuilderIntegrationExample(): void {
  console.log('\n=== 队伍构建器集成使用示例 ===')

  // 1. 创建队伍构建器集成实例
  const teamBuilderIntegration = new TeamBuilderIntegration()

  // 2. 创建示例队伍
  const team = createSampleTeam()

  // 3. 验证队伍
  const ruleSetIds = ['competitive_ruleset']
  const validation = teamBuilderIntegration.validateTeam(team, ruleSetIds)

  console.log('队伍验证结果:', {
    isValid: validation.isValid,
    errorCount: validation.errors.length,
  })

  // 4. 获取构建建议
  const suggestions = teamBuilderIntegration.getTeamBuildingSuggestions(team, ruleSetIds)
  console.log('构建建议:', {
    suggestionCount: suggestions.suggestions.length,
    canAddMore: suggestions.canAddMore,
    maxTeamSize: suggestions.maxTeamSize,
  })

  // 5. 获取规则限制信息
  const limitations = teamBuilderIntegration.getRuleLimitations(ruleSetIds)
  console.log('规则限制:', {
    teamSize: limitations.teamSize,
    levelRange: limitations.levelRange,
    evLimits: limitations.evLimits,
  })
}

/**
 * 计时器集成使用示例
 */
export function timerIntegrationExample(): void {
  console.log('\n=== 计时器集成使用示例 ===')

  // 1. 创建计时器集成实例
  const timerIntegration = new TimerIntegration()

  // 2. 获取推荐的计时器配置
  const ruleSetIds = getAvailableRuleSets()
  const recommendedConfig = timerIntegration.getRecommendedTimerConfig(['competitive_ruleset'])

  console.log('推荐计时器配置:', recommendedConfig)

  // 3. 验证自定义计时器配置
  const customConfig = {
    enabled: true,
    turnTimeLimit: 45,
    totalTimeLimit: 1200,
    animationPauseEnabled: true,
    maxAnimationDuration: 15000,
  }

  const configValidation = timerIntegration.validateTimerConfig(customConfig, ruleSetIds)
  console.log('配置验证结果:', {
    isValid: configValidation.isValid,
    errorCount: configValidation.errors.length,
    warningCount: configValidation.warnings.length,
  })
}

/**
 * 运行所有示例
 */
export function runAllExamples(): void {
  try {
    basicRuleSystemExample()
    battleIntegrationExample()
    teamBuilderIntegrationExample()
    timerIntegrationExample()
    console.log('\n=== 所有示例运行完成 ===')
  } catch (error) {
    console.error('示例运行出错:', error)
  }
}

// 如果直接运行此文件，则执行所有示例
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples()
}
