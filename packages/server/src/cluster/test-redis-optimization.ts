#!/usr/bin/env node

/**
 * Redis优化测试脚本
 * 用于验证Redis调用去重和缓存优化是否正常工作
 */

import { ClusterManager, createClusterConfigFromEnv } from './clusterManager'
import { getGlobalRedisDeduplicationStats, getGlobalRedisDeduplicationSavings } from './redisCallDeduplicator'
import pino from 'pino'

const logger = pino({
  level: 'info',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

async function testRedisOptimization() {
  logger.info('开始Redis优化测试...')

  let clusterManager: ClusterManager | null = null

  try {
    // 创建集群配置
    const config = createClusterConfigFromEnv()
    clusterManager = ClusterManager.getInstance(config)

    // 初始化集群管理器
    await clusterManager.initialize()
    const stateManager = clusterManager.getStateManager()

    logger.info('集群管理器初始化完成')

    // 测试1: 并发调用相同方法，验证去重
    logger.info('测试1: 并发调用去重测试')
    const startTime = Date.now()

    // 同时发起多个相同的调用
    const promises = []
    for (let i = 0; i < 10; i++) {
      promises.push(stateManager.getInstances())
      promises.push(stateManager.getClusterStats())
      promises.push(stateManager.getMatchmakingQueueSize())
    }

    await Promise.all(promises)
    const duration1 = Date.now() - startTime

    // 获取去重统计
    const stats1 = getGlobalRedisDeduplicationStats()
    const savings1 = getGlobalRedisDeduplicationSavings()

    logger.info({
      duration: duration1,
      stats: stats1,
      savings: savings1,
    }, '测试1完成 - 并发调用去重')

    // 等待一段时间让缓存过期
    logger.info('等待2秒让去重窗口过期...')
    await new Promise(resolve => setTimeout(resolve, 2000))

    // 测试2: 缓存效果测试
    logger.info('测试2: 缓存效果测试')
    const startTime2 = Date.now()

    // 第一次调用（应该命中Redis）
    await stateManager.getClusterStats()
    const firstCallTime = Date.now() - startTime2

    // 立即第二次调用（应该命中缓存）
    const startTime3 = Date.now()
    await stateManager.getClusterStats()
    const secondCallTime = Date.now() - startTime3

    logger.info({
      firstCallTime,
      secondCallTime,
      cacheSpeedup: firstCallTime / secondCallTime,
    }, '测试2完成 - 缓存效果')

    // 测试3: 健康检查重复执行保护
    logger.info('测试3: 健康检查重复执行保护测试')
    
    // 尝试同时触发多个健康检查
    const healthCheckPromises = []
    for (let i = 0; i < 5; i++) {
      // 这里我们无法直接调用私有方法，但可以通过多次调用公共方法来间接测试
      healthCheckPromises.push(clusterManager.healthCheck())
    }

    await Promise.all(healthCheckPromises)
    logger.info('测试3完成 - 健康检查保护')

    // 最终统计
    const finalStats = getGlobalRedisDeduplicationStats()
    const finalSavings = getGlobalRedisDeduplicationSavings()

    logger.info({
      finalStats,
      finalSavings,
    }, '所有测试完成 - 最终统计')

    // 验证优化效果
    if (finalSavings.estimatedSavedCalls > 0) {
      logger.info(`✅ 优化成功！估计节省了 ${finalSavings.estimatedSavedCalls} 次Redis调用 (${finalSavings.savingsPercentage.toFixed(2)}%)`)
    } else {
      logger.warn('⚠️  未检测到明显的Redis调用节省，可能需要更多并发测试')
    }

    // 输出详细的调用统计
    logger.info('详细调用统计:')
    finalStats.callStats.forEach(stat => {
      logger.info(`  ${stat.key}: ${stat.count} 次调用`)
    })

  } catch (error) {
    logger.error({ error }, '测试过程中发生错误')
    throw error
  } finally {
    // 清理资源
    if (clusterManager) {
      await clusterManager.cleanup()
      logger.info('集群管理器已清理')
    }
  }
}

// 运行测试
if (require.main === module) {
  testRedisOptimization()
    .then(() => {
      logger.info('Redis优化测试完成')
      process.exit(0)
    })
    .catch(error => {
      logger.error({ error }, 'Redis优化测试失败')
      process.exit(1)
    })
}

export { testRedisOptimization }
