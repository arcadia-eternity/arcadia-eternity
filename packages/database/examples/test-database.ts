#!/usr/bin/env tsx

/**
 * 数据库功能测试脚本
 * 
 * 使用方法:
 * 1. 配置环境变量 SUPABASE_URL 和 SUPABASE_ANON_KEY
 * 2. 运行: tsx packages/database/examples/test-database.ts
 */

import { initializeSupabase, databaseService } from '../src/index'
import type { BattleMessage } from '@arcadia-eternity/const'

// 配置数据库连接
const config = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY
}

if (!config.supabaseUrl || !config.supabaseAnonKey) {
  console.error('请设置 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量')
  process.exit(1)
}

// 初始化数据库连接
initializeSupabase(config)

// 生成测试用的随机ID
function generateTestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

async function testDatabase() {
  console.log('🚀 开始测试数据库功能...\n')

  try {
    // 1. 测试玩家创建
    console.log('1. 测试玩家创建')
    const player1Id = generateTestId('test_player')
    const player2Id = generateTestId('test_player')
    
    const player1 = await databaseService.players.createPlayer({
      id: player1Id,
      name: '测试玩家1',
      metadata: { level: 10, experience: 1000 }
    })
    console.log('✅ 玩家1创建成功:', player1.name)

    const player2 = await databaseService.players.createPlayer({
      id: player2Id,
      name: '测试玩家2',
      metadata: { level: 8, experience: 800 }
    })
    console.log('✅ 玩家2创建成功:', player2.name)

    // 2. 测试战报创建
    console.log('\n2. 测试战报创建')
    const battleRecord = await databaseService.battles.createBattleRecord({
      player_a_id: player1.id,
      player_a_name: player1.name,
      player_b_id: player2.id,
      player_b_name: player2.name,
      metadata: { map: 'test_arena', mode: 'ranked' }
    })
    console.log('✅ 战报创建成功:', battleRecord.id)

    // 3. 测试战报完成
    console.log('\n3. 测试战报完成')
    const mockBattleMessages: BattleMessage[] = [
      {
        type: 'BattleStart' as any,
        sequenceId: 1,
        data: {
          playerA: { id: player1.id, name: player1.name } as any,
          playerB: { id: player2.id, name: player2.name } as any
        },
        stateDelta: {}
      },
      {
        type: 'BattleEnd' as any,
        sequenceId: 2,
        data: {
          winner: player1.id,
          reason: 'all_pet_fainted'
        },
        stateDelta: {}
      }
    ]

    const completedBattle = await databaseService.battles.completeBattleRecord(
      battleRecord.id,
      player1.id,
      'player_a_wins',
      'all_pet_fainted',
      mockBattleMessages,
      { finalHp: { [player1.id]: 50, [player2.id]: 0 } }
    )
    console.log('✅ 战报完成成功')

    // 4. 测试玩家统计查询
    console.log('\n4. 测试玩家统计查询')
    await new Promise(resolve => setTimeout(resolve, 1000)) // 等待触发器执行

    const player1Stats = await databaseService.players.getPlayerStats(player1.id)
    const player2Stats = await databaseService.players.getPlayerStats(player2.id)
    
    console.log('✅ 玩家1统计:', {
      总场次: player1Stats?.total_battles,
      胜场: player1Stats?.wins,
      负场: player1Stats?.losses
    })
    console.log('✅ 玩家2统计:', {
      总场次: player2Stats?.total_battles,
      胜场: player2Stats?.wins,
      负场: player2Stats?.losses
    })

    // 5. 测试战报查询
    console.log('\n5. 测试战报查询')
    const battleRecords = await databaseService.battles.getBattleRecords({ limit: 10 })
    console.log('✅ 战报列表查询成功，共', battleRecords.data.length, '条记录')

    const battleDetail = await databaseService.battles.getBattleRecordById(battleRecord.id)
    console.log('✅ 战报详情查询成功，消息数量:', battleDetail?.battle_messages.length)

    // 6. 测试玩家战报查询
    console.log('\n6. 测试玩家战报查询')
    const playerBattles = await databaseService.battles.getPlayerBattleRecords(player1.id, { limit: 5 })
    console.log('✅ 玩家战报查询成功，共', playerBattles.data.length, '条记录')

    // 7. 测试排行榜
    console.log('\n7. 测试排行榜')
    const leaderboard = await databaseService.players.getLeaderboard({ limit: 10 })
    console.log('✅ 排行榜查询成功，共', leaderboard.data.length, '名玩家')
    if (leaderboard.data.length > 0) {
      console.log('   第一名:', leaderboard.data[0].player_name, '胜率:', leaderboard.data[0].win_rate + '%')
    }

    // 8. 测试玩家搜索
    console.log('\n8. 测试玩家搜索')
    const searchResults = await databaseService.players.searchPlayers('测试', 5)
    console.log('✅ 玩家搜索成功，找到', searchResults.length, '个结果')

    // 9. 测试战报统计
    console.log('\n9. 测试战报统计')
    const statistics = await databaseService.battles.getBattleStatistics()
    console.log('✅ 战报统计查询成功:', {
      总战斗数: statistics.total_battles,
      总玩家数: statistics.total_players,
      今日战斗: statistics.battles_today,
      平均时长: Math.round(statistics.avg_battle_duration) + '秒'
    })

    console.log('\n🎉 所有测试通过！数据库功能正常工作。')

  } catch (error) {
    console.error('❌ 测试失败:', error)
    process.exit(1)
  }
}

// 清理测试数据
async function cleanup() {
  console.log('\n🧹 清理测试数据...')
  try {
    // 注意：在生产环境中不要使用这些清理操作
    // 这里仅用于测试环境
    console.log('⚠️  测试完成，请手动清理测试数据')
  } catch (error) {
    console.error('清理失败:', error)
  }
}

// 运行测试
async function main() {
  await testDatabase()
  await cleanup()
}

if (require.main === module) {
  main().catch(console.error)
}
