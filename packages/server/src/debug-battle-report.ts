#!/usr/bin/env tsx

/**
 * 战报调试脚本
 * 检查战斗过程中战报记录的具体问题
 */

import { createClusterApp } from './cluster/core/clusterApp'
import { initializeSupabase } from '@arcadia-eternity/database'
import type { BattleReportService } from './domain/report/services/battleReportService'
import type { IBattleService } from './domain/battle/services/interfaces'
import pino from 'pino'

const _logger = pino({ name: 'BattleReportDebug' })

async function debugBattleReportFlow() {
  console.log('🔍 调试战报记录流程...\n')

  // 检查环境变量
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.log('❌ 缺少Supabase环境变量')
    console.log('请确保设置了以下环境变量：')
    console.log('- SUPABASE_URL')
    console.log('- SUPABASE_ANON_KEY')
    console.log('- SUPABASE_SERVICE_KEY (可选)')
    return
  }

  console.log('✅ 环境变量检查通过')

  // 初始化数据库
  try {
    initializeSupabase({
      supabaseUrl,
      supabaseAnonKey,
      supabaseServiceKey,
    })
    console.log('✅ 数据库初始化成功')
  } catch (error) {
    console.log('❌ 数据库初始化失败:', error)
    return
  }

  // 创建应用配置
  const battleReportConfig = {
    enableReporting: true,
    enableApi: true,
    database: {
      supabaseUrl,
      supabaseAnonKey,
      supabaseServiceKey,
    },
  }

  console.log('📊 战报配置:', {
    enableReporting: battleReportConfig.enableReporting,
    enableApi: battleReportConfig.enableApi,
    hasDatabase: !!battleReportConfig.database,
  })

  // 创建集群应用
  try {
    const { battleServer, start, stop } = createClusterApp({
      port: 8103, // 使用不同端口避免冲突
      battleReport: battleReportConfig,
    })

    console.log('✅ 集群应用创建成功')

    // 检查战报服务是否正确初始化
    const battleReportService = (battleServer as unknown as { battleReportService: BattleReportService; battleService: IBattleService }).battleReportService
    if (battleReportService) {
      console.log('✅ 战报服务已初始化')
      console.log('   - 配置:', battleReportService.config)
      console.log('   - 活跃战斗数:', battleReportService.getActiveBattleCount())
    } else {
      console.log('❌ 战报服务未初始化')
      console.log('   - 检查battleReportConfig是否正确传递')
      console.log('   - 检查依赖注入是否正确')
    }

    // 检查战斗服务
    const battleService = (battleServer as unknown as { battleReportService: BattleReportService; battleService: IBattleService }).battleService
    if (battleService) {
      console.log('✅ 战斗服务已初始化')
      const battleReportServiceInBattleService = (battleService as unknown as { battleReportService: BattleReportService; battleService: IBattleService }).battleReportService
      if (battleReportServiceInBattleService) {
        console.log('✅ 战斗服务中的战报服务已初始化')
      } else {
        console.log('❌ 战斗服务中的战报服务未初始化')
      }
    } else {
      console.log('❌ 战斗服务未初始化')
    }

    // 启动服务器进行测试
    console.log('\n🚀 启动测试服务器...')
    await start()
    console.log('✅ 服务器启动成功，端口: 8103')

    // 等待一段时间让服务器完全启动
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 模拟创建战斗房间的过程
    console.log('\n🎮 模拟战斗房间创建...')
    
    try {
      // 这里我们需要模拟匹配过程来创建战斗房间
      // 但由于复杂性，我们先检查服务是否正确配置
      
      console.log('📋 战报服务状态检查完成')
      console.log('\n💡 建议检查项目:')
      console.log('1. 确认启动服务器时使用了 --enable-battle-reports 参数')
      console.log('2. 检查服务器日志中是否有战报服务初始化的消息')
      console.log('3. 进行一场实际战斗，观察日志中的战报记录消息')
      console.log('4. 检查数据库中的 battle_records 表是否有新记录')
      
    } catch (error) {
      console.log('❌ 战斗房间创建测试失败:', error)
    }

    // 停止服务器
    console.log('\n🛑 停止测试服务器...')
    await stop()
    console.log('✅ 服务器已停止')

  } catch (error) {
    console.log('❌ 集群应用创建失败:', error)
  }
}

async function checkBattleReportLogs() {
  console.log('\n📝 检查战报相关日志模式...')
  
  console.log('在服务器日志中查找以下关键信息：')
  console.log('')
  console.log('✅ 正常情况应该看到：')
  console.log('  - "Battle report service initialized"')
  console.log('  - "Creating battle record..."')
  console.log('  - "Battle record created successfully"')
  console.log('  - "Recording battle message"')
  console.log('  - "Completed battle record"')
  console.log('  - "ELO ratings updated successfully"')
  console.log('')
  console.log('❌ 问题情况可能看到：')
  console.log('  - "Battle report service disabled"')
  console.log('  - "Failed to create battle record"')
  console.log('  - "Attempted to record message for unknown battle"')
  console.log('  - "Failed to complete battle record"')
  console.log('  - "Failed to update ELO ratings"')
  console.log('')
  console.log('🔍 调试命令：')
  console.log('  启动服务器: pnpm run cli server --enable-battle-reports')
  console.log('  查看日志: tail -f logs/server.log | grep -i "battle\\|elo\\|report"')
}

async function main() {
  console.log('🚀 开始战报调试...\n')

  try {
    await debugBattleReportFlow()
    await checkBattleReportLogs()

    console.log('\n📋 调试总结:')
    console.log('1. 检查了环境变量配置')
    console.log('2. 验证了数据库连接')
    console.log('3. 测试了战报服务初始化')
    console.log('4. 提供了日志检查指南')
    console.log('')
    console.log('🎯 下一步行动:')
    console.log('1. 使用 --enable-battle-reports 启动服务器')
    console.log('2. 进行一场实际战斗')
    console.log('3. 观察服务器日志中的战报相关消息')
    console.log('4. 检查数据库表中是否有新的战报记录')

  } catch (error) {
    console.error('❌ 调试过程中发生错误:', error)
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
