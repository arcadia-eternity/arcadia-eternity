#!/usr/bin/env node

/**
 * 测试排行榜功能
 * 验证新的ELO排行榜API是否正常工作
 */

import { RuleRegistry } from '@arcadia-eternity/rules'
import { MatchingConfigManager } from './domain/matching/services/MatchingConfigManager'
import { EloService } from './domain/elo/services/eloService'
import { EloCalculationService } from './domain/elo/services/eloCalculationService'
import { EloRepository } from '@arcadia-eternity/database'
import { GlobalRuleRegistry } from '@arcadia-eternity/rules'

async function testLeaderboardFeatures() {
  console.log('🧪 测试排行榜功能')
  console.log('='.repeat(50))

  try {
    // 1. 初始化规则系统
    console.log('📋 初始化规则系统...')
    await GlobalRuleRegistry.initialize()

    const registry = RuleRegistry.getInstance()
    const configManager = MatchingConfigManager.getInstance()

    // 2. 获取所有规则集
    console.log('\n📋 获取所有规则集:')
    const allRuleSets = registry.getEnabledRuleSets()

    for (const ruleSet of allRuleSets) {
      console.log(`  ✓ ${ruleSet.id}: ${ruleSet.name}`)
      console.log(`    描述: ${ruleSet.description || '无'}`)
      console.log(`    规则数量: ${ruleSet.rules.length}`)
      console.log(`    匹配配置: ${JSON.stringify(ruleSet.matchingConfig)}`)
    }

    // 3. 获取启用ELO的规则集
    console.log('\n🏆 启用ELO的规则集:')
    const eloEnabledRuleSets = allRuleSets.filter(ruleSet => configManager.isEloMatchingEnabled(ruleSet.id))

    if (eloEnabledRuleSets.length === 0) {
      console.log('  ⚠️  没有启用ELO的规则集')
      return
    }

    for (const ruleSet of eloEnabledRuleSets) {
      console.log(`  ✓ ${ruleSet.id}: ${ruleSet.name}`)
      const eloConfig = configManager.getEloConfig(ruleSet.id)
      if (eloConfig) {
        console.log(`    ELO配置:`)
        console.log(`      - 初始范围: ±${eloConfig.initialRange}`)
        console.log(`      - 扩展速度: +${eloConfig.rangeExpansionPerSecond}/秒`)
        console.log(`      - 最大差距: ±${eloConfig.maxEloDifference}`)
        console.log(`      - 最大等待: ${eloConfig.maxWaitTime}秒`)
      }
    }

    // 4. 测试ELO服务
    console.log('\n🎯 测试ELO服务:')
    const eloRepository = new EloRepository()
    const eloCalculationService = new EloCalculationService()
    const eloService = new EloService(eloRepository, eloCalculationService)

    // 测试每个启用ELO的规则集
    for (const ruleSet of eloEnabledRuleSets) {
      console.log(`\n  📊 规则集 ${ruleSet.id} 的排行榜:`)

      try {
        const leaderboard = await eloService.getEloLeaderboard(ruleSet.id, 5, 0)

        if (leaderboard.data.length === 0) {
          console.log('    📭 暂无排行榜数据')
        } else {
          console.log(`    📈 找到 ${leaderboard.data.length} 条记录 (总计: ${leaderboard.total})`)

          leaderboard.data.forEach((entry, index) => {
            console.log(`    ${index + 1}. ${entry.player_name} (${entry.player_id})`)
            console.log(`       ELO: ${entry.elo_rating} (最高: ${entry.highest_elo})`)
            console.log(`       战绩: ${entry.wins}胜 ${entry.losses}负 ${entry.draws}平 (${entry.games_played}场)`)
            console.log(`       胜率: ${entry.win_rate}%`)
          })
        }

        // 获取统计信息
        const stats = await eloService.getEloStatistics(ruleSet.id)
        console.log(`    📊 统计信息:`)
        console.log(`       总玩家数: ${stats.total_players}`)
        console.log(`       平均ELO: ${stats.average_elo}`)
        console.log(`       最高ELO: ${stats.highest_elo}`)
        console.log(`       最低ELO: ${stats.lowest_elo}`)
        console.log(`       总游戏数: ${stats.total_games}`)
      } catch (error) {
        console.log(`    ❌ 获取排行榜失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    console.log('\n✅ 排行榜功能测试完成!')
  } catch (error) {
    console.error('❌ 测试失败:', error)
    process.exit(1)
  }
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  testLeaderboardFeatures().catch(console.error)
}

export { testLeaderboardFeatures }
