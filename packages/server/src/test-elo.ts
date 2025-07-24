#!/usr/bin/env tsx

/**
 * ELO系统测试脚本
 * 测试ELO计算和数据库操作
 */

import { EloCalculationService } from './domain/elo/services/eloCalculationService'
import { EloService } from './domain/elo/services/eloService'
import { EloRepository } from '@arcadia-eternity/database'

async function testEloCalculation() {
  console.log('🧮 测试ELO计算逻辑...')
  
  const calculationService = new EloCalculationService()
  
  // 模拟两个玩家的ELO数据
  const playerA = {
    player_id: 'player_a',
    rule_set_id: 'casual_standard_ruleset',
    elo_rating: 1200,
    games_played: 10,
    wins: 5,
    losses: 4,
    draws: 1,
    highest_elo: 1250,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  
  const playerB = {
    player_id: 'player_b',
    rule_set_id: 'casual_standard_ruleset',
    elo_rating: 1300,
    games_played: 15,
    wins: 8,
    losses: 6,
    draws: 1,
    highest_elo: 1350,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  
  console.log('📊 初始ELO:')
  console.log(`  玩家A: ${playerA.elo_rating}`)
  console.log(`  玩家B: ${playerB.elo_rating}`)
  
  // 测试玩家A获胜的情况
  console.log('\n🏆 测试玩家A获胜:')
  const resultA = calculationService.calculateBattleEloChanges(
    playerA,
    playerB,
    'player_a',
    'casual_standard_ruleset'
  )
  
  console.log(`  玩家A: ${resultA.playerA.old_elo} → ${resultA.playerA.new_elo} (${resultA.playerA.elo_change > 0 ? '+' : ''}${resultA.playerA.elo_change})`)
  console.log(`  玩家B: ${resultA.playerB.old_elo} → ${resultA.playerB.new_elo} (${resultA.playerB.elo_change > 0 ? '+' : ''}${resultA.playerB.elo_change})`)
  
  // 测试玩家B获胜的情况
  console.log('\n🏆 测试玩家B获胜:')
  const resultB = calculationService.calculateBattleEloChanges(
    playerA,
    playerB,
    'player_b',
    'casual_standard_ruleset'
  )
  
  console.log(`  玩家A: ${resultB.playerA.old_elo} → ${resultB.playerA.new_elo} (${resultB.playerA.elo_change > 0 ? '+' : ''}${resultB.playerA.elo_change})`)
  console.log(`  玩家B: ${resultB.playerB.old_elo} → ${resultB.playerB.new_elo} (${resultB.playerB.elo_change > 0 ? '+' : ''}${resultB.playerB.elo_change})`)
  
  // 测试平局的情况
  console.log('\n🤝 测试平局:')
  const resultDraw = calculationService.calculateBattleEloChanges(
    playerA,
    playerB,
    null,
    'casual_standard_ruleset'
  )
  
  console.log(`  玩家A: ${resultDraw.playerA.old_elo} → ${resultDraw.playerA.new_elo} (${resultDraw.playerA.elo_change > 0 ? '+' : ''}${resultDraw.playerA.elo_change})`)
  console.log(`  玩家B: ${resultDraw.playerB.old_elo} → ${resultDraw.playerB.new_elo} (${resultDraw.playerB.elo_change > 0 ? '+' : ''}${resultDraw.playerB.elo_change})`)
  
  // 测试胜率预测
  console.log('\n🎯 胜率预测:')
  const winProbability = calculationService.predictWinProbability(playerA.elo_rating, playerB.elo_rating)
  console.log(`  玩家A获胜概率: ${(winProbability * 100).toFixed(1)}%`)
  console.log(`  玩家B获胜概率: ${((1 - winProbability) * 100).toFixed(1)}%`)
  
  // 测试ELO差距对应的胜率
  console.log('\n📈 ELO差距胜率表:')
  const eloDifferences = [-200, -100, -50, 0, 50, 100, 200]
  for (const diff of eloDifferences) {
    const winRate = calculationService.eloToWinRate(diff)
    console.log(`  ELO差距 ${diff > 0 ? '+' : ''}${diff}: ${winRate}% 胜率`)
  }
  
  console.log('\n✅ ELO计算测试完成!')
}

async function testEloConfig() {
  console.log('\n⚙️ 测试ELO配置:')
  
  const calculationService = new EloCalculationService()
  const config = calculationService.getConfig()
  
  console.log('  初始ELO:', config.initialElo)
  console.log('  K因子:')
  console.log('    新手 (<30场):', config.kFactor.newbie)
  console.log('    普通 (30-100场):', config.kFactor.normal)
  console.log('    老手 (>100场):', config.kFactor.veteran)
  console.log('  ELO范围:', `${config.minElo} - ${config.maxElo}`)
}

async function main() {
  console.log('🚀 开始ELO系统测试...\n')
  
  try {
    await testEloCalculation()
    await testEloConfig()
    
    console.log('\n🎉 所有测试完成!')
    console.log('\n📋 下一步:')
    console.log('1. 在Supabase SQL编辑器中执行 packages/database/sql/06_add_elo_system.sql')
    console.log('2. 启动服务器测试ELO API端点')
    console.log('3. 进行实际战斗测试ELO更新')
    
  } catch (error) {
    console.error('❌ 测试失败:', error)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
