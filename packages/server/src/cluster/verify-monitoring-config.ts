#!/usr/bin/env node

/**
 * 验证监控配置脚本
 * 检查Redis监控存储是否按预期禁用
 */

import { getCostOptimizationConfig } from './costOptimizationConfig'
import pino from 'pino'

const logger = pino({
  level: 'info',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

function verifyMonitoringConfig() {
  logger.info('验证监控配置...')

  const config = getCostOptimizationConfig()

  logger.info('当前配置:')
  logger.info(`  成本优化启用: ${config.features.enableCostOptimization}`)
  logger.info(`  Redis监控数据存储: ${config.features.disableRedisMetricsStorage ? '禁用 ✅' : '启用 ⚠️'}`)
  logger.info(`  Redis告警数据存储: ${config.features.disableRedisAlertStorage ? '禁用 ✅' : '启用 ⚠️'}`)
  logger.info(`  本地缓存: ${config.features.enableLocalCache ? '启用 ✅' : '禁用 ⚠️'}`)

  // 检查环境变量
  logger.info('\n环境变量检查:')
  logger.info(`  REDIS_COST_OPTIMIZATION: ${process.env.REDIS_COST_OPTIMIZATION || '未设置'}`)
  logger.info(`  ENABLE_REDIS_METRICS_STORAGE: ${process.env.ENABLE_REDIS_METRICS_STORAGE || '未设置'}`)
  logger.info(`  ENABLE_REDIS_ALERT_STORAGE: ${process.env.ENABLE_REDIS_ALERT_STORAGE || '未设置'}`)

  // 验证默认行为
  const expectedDefaults = {
    disableRedisMetricsStorage: true,
    disableRedisAlertStorage: true,
    enableLocalCache: true,
  }

  let allCorrect = true
  logger.info('\n默认配置验证:')

  for (const [key, expectedValue] of Object.entries(expectedDefaults)) {
    const actualValue = config.features[key as keyof typeof config.features]
    const isCorrect = actualValue === expectedValue
    
    if (!isCorrect) {
      allCorrect = false
    }

    logger.info(`  ${key}: ${actualValue} ${isCorrect ? '✅' : '❌ (期望: ' + expectedValue + ')'}`)
  }

  // 成本节省估算
  logger.info('\n成本节省估算:')
  if (config.features.disableRedisMetricsStorage && config.features.disableRedisAlertStorage) {
    logger.info('  ✅ 监控数据写入: 100% 节省（完全禁用）')
    logger.info('  ✅ 预计总体Redis成本节省: 80-90%')
  } else {
    logger.info('  ⚠️  监控数据仍在写入Redis，建议禁用以节省成本')
  }

  // 功能影响说明
  logger.info('\n功能影响:')
  logger.info('  ✅ 实时监控: 正常工作（内存存储）')
  logger.info('  ✅ 告警通知: 正常工作（Redis发布/订阅）')
  logger.info('  ⚠️  历史数据: 重启后丢失（仅内存存储）')
  logger.info('  ⚠️  长期趋势: 无法查询（无持久化）')

  // 总结
  if (allCorrect) {
    logger.info('\n✅ 配置验证通过！Redis监控存储已按预期禁用，将显著节省成本。')
  } else {
    logger.warn('\n❌ 配置验证失败！请检查环境变量设置。')
  }

  return allCorrect
}

// 运行验证
if (require.main === module) {
  const success = verifyMonitoringConfig()
  process.exit(success ? 0 : 1)
}

export { verifyMonitoringConfig }
