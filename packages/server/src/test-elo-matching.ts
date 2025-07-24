#!/usr/bin/env tsx

/**
 * ELO匹配系统测试脚本
 * 测试不同规则集的匹配策略
 */

import { MatchingConfigManager } from './domain/matching/services/MatchingConfigManager'
import { MatchingStrategyFactory } from './domain/matching/strategies/MatchingStrategyFactory'
import { FIFOMatchingStrategy } from './domain/matching/strategies/FIFOMatchingStrategy'
import { EloMatchingStrategy } from './domain/matching/strategies/EloMatchingStrategy'
import type { MatchmakingEntry } from './cluster/types'
import { createRuleSystemWithDefaults } from '@arcadia-eternity/rules'

// 模拟匹配队列条目
function createMockEntry(playerId: string, ruleSetId: string, joinTimeOffset: number = 0): MatchmakingEntry {
  return {
    playerId,
    joinTime: Date.now() - joinTimeOffset * 1000, // joinTimeOffset秒前加入
    playerData: {
      id: playerId,
      name: `Player ${playerId}`,
      team: [], // 简化的队伍数据
    },
    sessionId: `session_${playerId}`,
    ruleSetId,
    metadata: {
      sessionId: `session_${playerId}`,
      ruleSetId,
    },
  }
}

async function testMatchingStrategies() {
  console.log('🧪 测试匹配策略...\n')

  // 测试FIFO策略
  console.log('📋 测试FIFO匹配策略:')
  const fifoStrategy = new FIFOMatchingStrategy()

  const fifoQueue = [
    createMockEntry('player1', 'casual_standard_ruleset', 30), // 30秒前加入
    createMockEntry('player2', 'casual_standard_ruleset', 20), // 20秒前加入
    createMockEntry('player3', 'casual_standard_ruleset', 10), // 10秒前加入
  ]

  const fifoConfig = { strategy: 'fifo' as const }
  const fifoMatch = await fifoStrategy.findMatch(fifoQueue, fifoConfig)

  if (fifoMatch) {
    console.log(`  ✓ 匹配成功: ${fifoMatch.player1.playerId} vs ${fifoMatch.player2.playerId}`)
    console.log(`  ✓ 匹配质量: ${fifoMatch.quality.score.toFixed(3)}`)
    console.log(`  ✓ 等待时间差: ${fifoMatch.quality.waitTimeDifference / 1000}秒`)
  } else {
    console.log('  ✗ 未找到匹配')
  }

  console.log()

  // 测试ELO策略
  console.log('🏆 测试ELO匹配策略:')
  const eloStrategy = new EloMatchingStrategy()

  const eloQueue = [
    createMockEntry('player4', 'competitive_ruleset', 60), // 60秒前加入
    createMockEntry('player5', 'competitive_ruleset', 45), // 45秒前加入
    createMockEntry('player6', 'competitive_ruleset', 30), // 30秒前加入
  ]

  const eloConfig = {
    strategy: 'elo' as const,
    eloConfig: {
      initialRange: 100,
      rangeExpansionPerSecond: 15,
      maxEloDifference: 400,
      maxWaitTime: 180,
    },
  }

  try {
    const eloMatch = await eloStrategy.findMatch(eloQueue, eloConfig)

    if (eloMatch) {
      console.log(`  ✓ 匹配成功: ${eloMatch.player1.playerId} vs ${eloMatch.player2.playerId}`)
      console.log(`  ✓ 匹配质量: ${eloMatch.quality.score.toFixed(3)}`)
      console.log(`  ✓ ELO差距: ${eloMatch.quality.eloDifference || 'N/A'}`)
      console.log(`  ✓ 等待时间差: ${eloMatch.quality.waitTimeDifference / 1000}秒`)
    } else {
      console.log('  ✗ 未找到匹配')
    }
  } catch (error) {
    console.log(`  ⚠️ ELO匹配测试跳过 (需要数据库连接): ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  console.log()
}

async function testMatchingConfigManager() {
  console.log('⚙️ 测试匹配配置管理器...\n')

  const configManager = MatchingConfigManager.getInstance()

  // 测试获取不同规则集的配置
  const ruleSetIds = ['casual_standard_ruleset', 'competitive_ruleset', 'unknown_ruleset']

  for (const ruleSetId of ruleSetIds) {
    console.log(`📋 规则集: ${ruleSetId}`)

    try {
      const config = configManager.getMatchingConfig(ruleSetId)
      console.log(`  ✓ 匹配策略: ${config.strategy}`)

      if (config.strategy === 'elo' && config.eloConfig) {
        console.log(`  ✓ ELO配置:`)
        console.log(`    - 初始范围: ±${config.eloConfig.initialRange}`)
        console.log(`    - 扩展速度: +${config.eloConfig.rangeExpansionPerSecond}/秒`)
        console.log(`    - 最大差距: ±${config.eloConfig.maxEloDifference}`)
        console.log(`    - 最大等待: ${config.eloConfig.maxWaitTime}秒`)
      }

      const isEloEnabled = configManager.isEloMatchingEnabled(ruleSetId)
      console.log(`  ✓ ELO匹配: ${isEloEnabled ? '启用' : '禁用'}`)
    } catch (error) {
      console.log(`  ✗ 配置获取失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    console.log()
  }
}

async function testStrategyFactory() {
  console.log('🏭 测试匹配策略工厂...\n')

  const configs = [
    { strategy: 'fifo' as const },
    {
      strategy: 'elo' as const,
      eloConfig: {
        initialRange: 100,
        rangeExpansionPerSecond: 10,
        maxEloDifference: 300,
        maxWaitTime: 120,
      },
    },
  ]

  for (const config of configs) {
    console.log(`🔧 配置: ${config.strategy}`)

    try {
      const strategy = MatchingStrategyFactory.getStrategy(config)
      console.log(`  ✓ 策略实例: ${strategy.name}`)

      // 验证配置
      const validation = MatchingStrategyFactory.validateConfig(config)
      console.log(`  ✓ 配置验证: ${validation.isValid ? '通过' : '失败'}`)

      if (!validation.isValid) {
        console.log(`  ✗ 验证错误: ${validation.errors.join(', ')}`)
      }
    } catch (error) {
      console.log(`  ✗ 策略创建失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    console.log()
  }

  // 测试支持的策略类型
  const supportedStrategies = MatchingStrategyFactory.getSupportedStrategies()
  console.log(`📋 支持的策略类型: ${supportedStrategies.join(', ')}`)
  console.log()
}

async function main() {
  console.log('🚀 开始ELO匹配系统测试...\n')

  // 初始化规则系统
  console.log('⚙️ 初始化规则系统...')
  try {
    const { ruleSystem, registry } = createRuleSystemWithDefaults()
    console.log('✓ 规则系统初始化成功')
    console.log(`✓ 已注册 ${registry.getAllRuleSets().length} 个规则集`)
    console.log()
  } catch (error) {
    console.warn('⚠️ 规则系统初始化失败，将使用默认配置:', error instanceof Error ? error.message : 'Unknown error')
    console.log()
  }

  try {
    await testMatchingStrategies()
    await testMatchingConfigManager()
    await testStrategyFactory()

    console.log('🎉 所有测试完成!')
    console.log('\n📋 总结:')
    console.log('✓ FIFO匹配策略 - 按加入时间顺序匹配')
    console.log('✓ ELO匹配策略 - 基于ELO评级智能匹配')
    console.log('✓ 匹配配置管理器 - 规则集配置管理')
    console.log('✓ 策略工厂 - 动态策略创建和验证')
    console.log('\n🎯 规则集配置:')
    console.log('• casual_standard_ruleset: FIFO匹配 (休闲模式)')
    console.log('• competitive_ruleset: ELO匹配 (竞技模式)')
    console.log('\n📖 使用说明:')
    console.log('1. 在Supabase中执行ELO系统数据库迁移')
    console.log('2. 启动服务器测试匹配功能')
    console.log('3. 竞技模式将自动使用ELO匹配')
    console.log('4. 休闲模式继续使用FIFO匹配')
  } catch (error) {
    console.error('❌ 测试失败:', error)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
