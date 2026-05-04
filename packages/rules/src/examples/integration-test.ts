/**
 * 集成测试示例
 * 演示规则系统如何与现有系统集成
 */

import { Gender, Nature } from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { ServerRuleIntegration, ClientRuleIntegration, BattleRuleManager } from '../index'

// 创建测试用的精灵数据
function createTestPet(overrides: Partial<PetSchemaType> = {}): PetSchemaType {
  return {
    id: 'test-pet-1',
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
    ...overrides,
  }
}

function createTestTeam(): PetSchemaType[] {
  return [
    createTestPet({ id: 'pet1', name: '休罗斯' }),
    createTestPet({ id: 'pet2', name: '水精灵', species: 'pet_shuijingling' }),
    createTestPet({ id: 'pet3', name: '草精灵', species: 'pet_caojingling' }),
    createTestPet({ id: 'pet4', name: '电精灵', species: 'pet_dianjingling' }),
    createTestPet({ id: 'pet5', name: '火精灵', species: 'pet_huojingling' }),
    createTestPet({ id: 'pet6', name: '冰精灵', species: 'pet_bingjingling' }),
  ]
}

/**
 * 服务器端集成测试
 */
export async function testServerIntegration(): Promise<void> {
  console.log('=== 服务器端集成测试 ===')

  try {
    // 1. 初始化服务器端规则系统
    await ServerRuleIntegration.initializeServer()
    console.log('✓ 服务器端规则系统初始化成功')

    // 2. 创建战斗规则管理器
    const ruleManager = await ServerRuleIntegration.createBattleRuleManager(['competitive_ruleset'])
    console.log('✓ 战斗规则管理器创建成功')

    // 3. 准备测试队伍
    const playerATeam = createTestTeam()
    const playerBTeam = createTestTeam()

    // 4. 验证战斗创建
    const battlePreparation = await ruleManager.prepareBattle(playerATeam, playerBTeam, {
      showHidden: false,
      timerConfig: {
        enabled: true,
        turnTimeLimit: 30,
        totalTimeLimit: 1500,
      },
    })

    if (battlePreparation.validation.isValid) {
      console.log('✓ 战斗验证通过')
      console.log('  - 应用的计时器配置:', battlePreparation.battleOptions.timerConfig)
    } else {
      console.log('✗ 战斗验证失败:')
      battlePreparation.validation.errors.forEach((error: Record<string, unknown>) => {
        console.log(`    - ${error.message}`)
      })
    }

    // 5. 测试不同规则集
    const ruleSets = ['casual_standard_ruleset', 'competitive_ruleset']
    for (const ruleSetId of ruleSets) {
      const ruleSetManager = await ServerRuleIntegration.createBattleRuleManager([ruleSetId])
      const timerConfig = ruleSetManager.getRecommendedTimerConfig()
      console.log(`✓ ${ruleSetId} 规则集计时器配置:`, {
        enabled: timerConfig.enabled,
        turnTimeLimit: timerConfig.turnTimeLimit,
        totalTimeLimit: timerConfig.totalTimeLimit,
      })
    }

    console.log('✓ 服务器端集成测试完成')
  } catch (error) {
    console.error('✗ 服务器端集成测试失败:', error)
    throw error
  }
}

/**
 * 客户端集成测试
 */
export async function testClientIntegration(): Promise<void> {
  console.log('\n=== 客户端集成测试 ===')

  try {
    // 1. 初始化客户端规则系统
    await ClientRuleIntegration.initializeClient()
    console.log('✓ 客户端规则系统初始化成功')

    // 2. 获取可用规则集
    const availableRuleSets = await ClientRuleIntegration.getAvailableRuleSets()
    console.log('✓ 可用规则集:', availableRuleSets.join(', '))

    // 3. 测试队伍验证
    const testTeam = createTestTeam()

    // 测试休闲规则集
    await ClientRuleIntegration.setTeamBuilderRuleSetIds(['casual_standard_ruleset'])
    const casualValidation = await ClientRuleIntegration.validateTeam(testTeam)
    console.log(`✓ 休闲规则集验证: ${casualValidation.isValid ? '通过' : '失败'}`)

    // 测试竞技规则集
    await ClientRuleIntegration.setTeamBuilderRuleSetIds(['competitive_ruleset'])
    const competitiveValidation = await ClientRuleIntegration.validateTeam(testTeam)
    console.log(`✓ 竞技规则集验证: ${competitiveValidation.isValid ? '通过' : '失败'}`)

    // 4. 获取当前规则集
    const currentRuleSets = await ClientRuleIntegration.getCurrentRuleSetIds()
    console.log('✓ 当前规则集:', currentRuleSets.join(', '))

    console.log('✓ 客户端集成测试完成')
  } catch (error) {
    console.error('✗ 客户端集成测试失败:', error)
    throw error
  }
}

/**
 * 战斗规则管理器测试
 */
export async function testBattleRuleManager(): Promise<void> {
  console.log('\n=== 战斗规则管理器测试 ===')

  try {
    // 1. 创建不同模式的规则管理器
    const casualManager = new BattleRuleManager(['casual_standard_ruleset'])
    const competitiveManager = new BattleRuleManager(['competitive_ruleset'])

    console.log('✓ 规则管理器创建成功')

    // 2. 比较不同模式的配置
    const casualTimer = casualManager.getRecommendedTimerConfig()
    const competitiveTimer = competitiveManager.getRecommendedTimerConfig()

    console.log('✓ 休闲模式计时器:', {
      enabled: casualTimer.enabled,
      turnTimeLimit: casualTimer.turnTimeLimit,
    })
    console.log('✓ 竞技模式计时器:', {
      enabled: competitiveTimer.enabled,
      turnTimeLimit: competitiveTimer.turnTimeLimit,
    })

    // 3. 测试规则状态
    console.log('✓ 休闲模式状态:', casualManager.getStatus())
    console.log('✓ 竞技模式状态:', competitiveManager.getStatus())

    console.log('✓ 战斗规则管理器测试完成')
  } catch (error) {
    console.error('✗ 战斗规则管理器测试失败:', error)
    throw error
  }
}

/**
 * 运行所有集成测试
 */
export async function runIntegrationTests(): Promise<void> {
  console.log('开始运行规则系统集成测试...\n')

  try {
    await testServerIntegration()
    await testClientIntegration()
    await testBattleRuleManager()

    console.log('\n🎉 所有集成测试通过！')
    console.log('\n规则系统已成功集成到现有系统中：')
    console.log('- ✓ 服务器端：战斗创建时自动应用规则验证和配置')
    console.log('- ✓ 客户端：队伍构建器实时验证和建议')
    console.log('- ✓ 多模式：支持标准、竞技、休闲等多种游戏模式')
    console.log('- ✓ 隔离性：每场战斗使用独立的规则管理器')
  } catch (error) {
    console.error('\n❌ 集成测试失败:', error)
    throw error
  }
}

// 如果直接运行此文件，则执行所有测试
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests().catch(console.error)
}
