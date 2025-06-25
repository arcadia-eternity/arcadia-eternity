/**
 * Redis 成本优化配置管理器
 * 用于集中管理所有与降低 Upstash Redis 命令数量相关的配置
 */

export interface CostOptimizationConfig {
  // 监控频率配置
  monitoring: {
    metricsInterval: number
    alertCheckInterval: number
    systemMetricsInterval: number
  }

  // 集群管理频率配置
  cluster: {
    heartbeatInterval: number
    healthCheckInterval: number
  }

  // 服务发现频率配置
  serviceDiscovery: {
    healthCheckInterval: number
    failoverCheckInterval: number
  }

  // 缓存TTL配置
  cache: {
    redisStatsTTL: number
    keyStatsTTL: number
    clusterStatsTTL: number
    playerConnectionsTTL: number
    redisInfoTTL: number
  }

  // 数据TTL配置（用于自动清理）
  dataTTL: {
    serviceInstanceTTL: number
    playerConnectionTTL: number
    sessionDataTTL: number
    roomStateTTL: number
    matchmakingQueueTTL: number
    authBlacklistTTL: number
    distributedLockTTL: number
  }

  // SCAN操作优化配置
  scan: {
    count: number
    maxIterations: number
    enablePatternReduction: boolean
  }

  // 功能开关
  features: {
    enableCostOptimization: boolean
    disableDetailedMetrics: boolean
    disableAlertHistoryScan: boolean
    enableLocalCache: boolean
    disableRedisMetricsStorage: boolean // 禁用Redis监控数据存储
    disableRedisAlertStorage: boolean // 禁用Redis告警数据存储
  }
}

/**
 * 获取成本优化配置
 */
export function getCostOptimizationConfig(): CostOptimizationConfig {
  const isDev = process.env.NODE_ENV === 'development'
  const isOptimizationEnabled = process.env.REDIS_COST_OPTIMIZATION === 'true'

  return {
    monitoring: {
      metricsInterval: isOptimizationEnabled
        ? parseInt(process.env[`MONITORING_METRICS_INTERVAL_${isDev ? 'DEV' : 'PROD'}`] || '300') * 1000
        : isDev
          ? 30000
          : 60000,
      alertCheckInterval: 60000, // 保持1分钟不变
      systemMetricsInterval: isOptimizationEnabled
        ? parseInt(process.env.SYSTEM_METRICS_INTERVAL || '300') * 1000
        : 30000,
    },

    cluster: {
      heartbeatInterval: isOptimizationEnabled
        ? parseInt(process.env[`CLUSTER_HEARTBEAT_INTERVAL_${isDev ? 'DEV' : 'PROD'}`] || '300') * 1000
        : isDev
          ? 30000
          : 45000,
      healthCheckInterval: isOptimizationEnabled
        ? parseInt(process.env.CLUSTER_HEALTH_CHECK_INTERVAL || '600') * 1000
        : 60000,
    },

    serviceDiscovery: {
      healthCheckInterval: isOptimizationEnabled
        ? parseInt(process.env.SERVICE_DISCOVERY_HEALTH_CHECK || '300') * 1000
        : 30000,
      failoverCheckInterval: isOptimizationEnabled
        ? parseInt(process.env.SERVICE_DISCOVERY_FAILOVER_CHECK || '600') * 1000
        : 60000,
    },

    cache: {
      redisStatsTTL: parseInt(process.env.REDIS_STATS_CACHE_TTL || '120000'),
      keyStatsTTL: parseInt(process.env.KEY_STATS_CACHE_TTL || '300000'),
      clusterStatsTTL: parseInt(process.env.CLUSTER_STATS_CACHE_TTL || '60000'),
      playerConnectionsTTL: parseInt(process.env.PLAYER_CONNECTIONS_CACHE_TTL || '30000'),
      redisInfoTTL: 30000, // Redis info 缓存30秒
    },

    dataTTL: {
      serviceInstanceTTL: parseInt(process.env.SERVICE_INSTANCE_TTL || (isOptimizationEnabled ? '900000' : '300000')), // 15分钟/5分钟
      playerConnectionTTL: parseInt(process.env.PLAYER_CONNECTION_TTL || '1800000'), // 30分钟
      sessionDataTTL: parseInt(process.env.SESSION_DATA_TTL || '86400000'), // 24小时
      roomStateTTL: parseInt(process.env.ROOM_STATE_TTL || '14400000'), // 4小时
      matchmakingQueueTTL: parseInt(process.env.MATCHMAKING_QUEUE_TTL || '1800000'), // 30分钟
      authBlacklistTTL: parseInt(process.env.AUTH_BLACKLIST_TTL || '86400000'), // 24小时
      distributedLockTTL: parseInt(process.env.DISTRIBUTED_LOCK_TTL || '30000'), // 30秒
    },

    scan: {
      count: parseInt(process.env.REDIS_SCAN_COUNT || '500'),
      maxIterations: parseInt(process.env.REDIS_SCAN_MAX_ITERATIONS || '10'),
      enablePatternReduction: isOptimizationEnabled,
    },

    features: {
      enableCostOptimization: isOptimizationEnabled,
      disableDetailedMetrics: process.env.DISABLE_DETAILED_METRICS === 'true',
      disableAlertHistoryScan: process.env.DISABLE_ALERT_HISTORY_SCAN === 'true',
      enableLocalCache: true, // 始终启用本地缓存
      disableRedisMetricsStorage: process.env.ENABLE_REDIS_METRICS_STORAGE !== 'true', // 默认禁用Redis监控数据存储
      disableRedisAlertStorage: process.env.ENABLE_REDIS_ALERT_STORAGE !== 'true', // 默认禁用Redis告警数据存储
    },
  }
}

/**
 * 获取优化后的间隔时间
 */
export function getOptimizedInterval(
  defaultInterval: number,
  optimizedInterval: number,
  enableOptimization: boolean = true,
): number {
  return enableOptimization ? optimizedInterval : defaultInterval
}

/**
 * 日志记录优化配置
 */
export function logOptimizationConfig(config: CostOptimizationConfig): void {
  if (config.features.enableCostOptimization) {
    console.log('🚀 Redis Cost Optimization Enabled:')
    console.log(`  📊 Metrics Collection: ${config.monitoring.metricsInterval / 1000}s`)
    console.log(`  💓 Heartbeat: ${config.cluster.heartbeatInterval / 1000}s`)
    console.log(`  🏥 Health Check: ${config.cluster.healthCheckInterval / 1000}s`)
    console.log(`  🔍 SCAN Count: ${config.scan.count}`)
    console.log(
      `  💾 Cache TTLs: Redis(${config.cache.redisStatsTTL / 1000}s), Keys(${config.cache.keyStatsTTL / 1000}s)`,
    )
  } else {
    console.log('⚡ Using default intervals (cost optimization disabled)')
  }
}
