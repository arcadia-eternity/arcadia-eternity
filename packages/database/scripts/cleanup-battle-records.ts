#!/usr/bin/env tsx

/**
 * 手动清理战报记录的脚本
 * 用于测试和手动维护
 */

import { databaseService } from '../src/index'
import { initializeSupabase } from '../src/supabase'

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  // 初始化数据库连接
  initializeSupabase({
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  })

  try {
    switch (command) {
      case 'old':
        await cleanupOldRecords()
        break
      case 'abandoned':
        await cleanupAbandonedRecords()
        break
      case 'all':
        await cleanupAbandonedRecords()
        await cleanupOldRecords()
        break
      default:
        console.log('Usage: tsx cleanup-battle-records.ts <command>')
        console.log('Commands:')
        console.log('  old        - 清理超过7天的战报记录')
        console.log('  abandoned  - 清理超过24小时未完成的战报')
        console.log('  all        - 执行所有清理操作')
        process.exit(1)
    }
  } catch (error) {
    console.error('清理失败:', error)
    process.exit(1)
  }
}

async function cleanupOldRecords() {
  console.log('开始清理超过7天的战报记录...')
  
  const cleanedCount = await databaseService.battles.cleanupOldBattleRecords(7)
  
  console.log(`✅ 已清理 ${cleanedCount} 条超过7天的战报记录`)
}

async function cleanupAbandonedRecords() {
  console.log('开始清理超过24小时未完成的战报...')
  
  const cleanedCount = await databaseService.battles.cleanupAbandonedBattles(24)
  
  console.log(`✅ 已清理 ${cleanedCount} 条超过24小时未完成的战报`)
}

if (require.main === module) {
  main()
}
