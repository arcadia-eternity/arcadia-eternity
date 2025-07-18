import pino from 'pino'
import type { ClusterStateManager } from '../core/clusterStateManager'
import type { RedisClientManager } from '../redis/redisClient'
import { getCostOptimizationConfig, logOptimizationConfig } from '../config/costOptimizationConfig'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export interface MetricData {
  timestamp: number
  value: number
  labels?: Record<string, string>
}

export interface PerformanceMetrics {
  // 系统指标
  cpuUsage: number
  memoryUsage: number
  memoryTotal: number
  uptime: number

  // 应用指标
  activeConnections: number
  totalRequests: number
  errorRate: number
  averageResponseTime: number

  // 集群指标
  instanceCount: number
  healthyInstances: number
  totalRooms: number
  activeRooms: number
  queueSize: number

  // Redis指标
  redisConnections: number
  redisMemoryUsage: string
  redisResponseTime: number

  // 扩展的Redis内存指标
  redisMemoryUsedBytes: number
  redisMemoryMaxBytes: number
  redisMemoryUsagePercent: number
  redisKeyCount: number
  redisExpiredKeys: number
  redisEvictedKeys: number
}

export interface RedisMemoryStats {
  usedMemoryBytes: number
  maxMemoryBytes: number
  usagePercent: number
  keyCount: number
  expiredKeys: number
  evictedKeys: number
}

export interface AlertRule {
  id: string
  name: string
  metric: string
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte'
  threshold: number
  duration: number // 持续时间（毫秒）
  enabled: boolean
  lastTriggered?: number
}

export interface Alert {
  id: string
  ruleId: string
  ruleName: string
  metric: string
  value: number
  threshold: number
  triggeredAt: number
  resolvedAt?: number
  instanceId: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
}

export class MonitoringManager {
  private stateManager: ClusterStateManager
  private redisManager: RedisClientManager
  private instanceId: string
  private metricsInterval?: NodeJS.Timeout
  private alertsInterval?: NodeJS.Timeout
  private alertRules: Map<string, AlertRule> = new Map()
  private activeAlerts: Map<string, Alert> = new Map()
  private metricsHistory: Map<string, MetricData[]> = new Map()

  // 本地缓存以减少 Redis 查询
  private redisStatsCache: { stats: RedisMemoryStats; timestamp: number } | null = null
  private readonly REDIS_STATS_CACHE_TTL = 120000 // 2分钟缓存
  private isCollectingMetrics = false // 防止重复收集指标

  constructor(stateManager: ClusterStateManager, redisManager: RedisClientManager, instanceId: string) {
    this.stateManager = stateManager
    this.redisManager = redisManager
    this.instanceId = instanceId

    this.setupDefaultAlertRules()

    // 记录成本优化配置
    const config = getCostOptimizationConfig()
    logOptimizationConfig(config)
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing monitoring manager')

      // 启动指标收集
      this.startMetricsCollection()

      // 启动告警检查
      this.startAlertChecking()

      logger.info('Monitoring manager initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize monitoring manager')
      throw error
    }
  }

  /**
   * 收集性能指标
   */
  async collectMetrics(): Promise<PerformanceMetrics> {
    // 防止重复收集指标
    if (this.isCollectingMetrics) {
      logger.debug('Metrics collection already in progress, skipping')
      throw new Error('Metrics collection already in progress')
    }

    this.isCollectingMetrics = true
    try {
      const startTime = Date.now()

      // 系统指标
      const memUsage = process.memoryUsage()
      const cpuUsage = process.cpuUsage()

      // 集群统计
      const clusterStats = await this.stateManager.getClusterStats()

      // Redis健康检查和详细信息
      const redisHealth = await this.redisManager.healthCheck()
      const redisResponseTime = Date.now() - startTime

      // 获取Redis内存使用详情
      const redisMemoryStats = await this.getRedisMemoryStats()

      const metrics: PerformanceMetrics = {
        // 系统指标
        cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // 转换为秒
        memoryUsage: memUsage.heapUsed,
        memoryTotal: memUsage.heapTotal,
        uptime: process.uptime(),

        // 应用指标（这些需要从应用层收集）
        activeConnections: 0, // TODO: 从Socket.IO获取
        totalRequests: 0, // TODO: 从HTTP服务器获取
        errorRate: 0, // TODO: 从错误统计获取
        averageResponseTime: 0, // TODO: 从请求统计获取

        // 集群指标
        instanceCount: clusterStats.instances.total,
        healthyInstances: clusterStats.instances.healthy,
        totalRooms: clusterStats.rooms.total,
        activeRooms: clusterStats.rooms.active,
        queueSize: clusterStats.matchmaking.queueSize,

        // Redis指标
        redisConnections: parseInt(redisHealth.details.connectedClients) || 0,
        redisMemoryUsage: redisHealth.details.usedMemory || '0',
        redisResponseTime,

        // 扩展的Redis内存指标
        redisMemoryUsedBytes: redisMemoryStats.usedMemoryBytes,
        redisMemoryMaxBytes: redisMemoryStats.maxMemoryBytes,
        redisMemoryUsagePercent: redisMemoryStats.usagePercent,
        redisKeyCount: redisMemoryStats.keyCount,
        redisExpiredKeys: redisMemoryStats.expiredKeys,
        redisEvictedKeys: redisMemoryStats.evictedKeys,
      }

      // 存储指标到历史记录
      await this.storeMetrics(metrics)

      return metrics
    } catch (error) {
      logger.error({ error }, 'Failed to collect metrics')
      throw error
    } finally {
      this.isCollectingMetrics = false
    }
  }

  /**
   * 存储指标数据
   */
  private async storeMetrics(metrics: PerformanceMetrics): Promise<void> {
    try {
      const timestamp = Date.now()
      const config = getCostOptimizationConfig()

      // 检查是否禁用Redis存储
      if (!config.features.disableRedisMetricsStorage) {
        const client = this.redisManager.getClient()

        // 存储到Redis时序数据
        const metricsKey = `metrics:${this.instanceId}:${Math.floor(timestamp / 60000)}` // 按分钟分组

        await client.hset(metricsKey, {
          timestamp: timestamp.toString(),
          data: JSON.stringify(metrics),
        })

        // 设置过期时间（24小时）
        await client.expire(metricsKey, 24 * 60 * 60)

        logger.debug('Metrics stored to Redis')
      } else {
        logger.debug('Redis metrics storage disabled, storing only in memory')
      }

      // 始终更新本地历史记录（内存存储）
      for (const [key, value] of Object.entries(metrics)) {
        if (typeof value === 'number') {
          const history = this.metricsHistory.get(key) || []
          history.push({ timestamp, value })

          // 保留最近1小时的数据
          const oneHourAgo = timestamp - 60 * 60 * 1000
          this.metricsHistory.set(
            key,
            history.filter(m => m.timestamp > oneHourAgo),
          )
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to store metrics')
    }
  }

  /**
   * 获取Redis内存统计信息（带缓存优化）
   */
  private async getRedisMemoryStats(): Promise<RedisMemoryStats> {
    try {
      const now = Date.now()

      // 检查缓存是否有效
      if (this.redisStatsCache && now - this.redisStatsCache.timestamp < this.REDIS_STATS_CACHE_TTL) {
        return this.redisStatsCache.stats
      }

      const client = this.redisManager.getClient()
      const info = await this.redisManager.getInfo()

      // 解析Redis内存信息
      const usedMemoryBytes = parseInt(info.used_memory) || 0
      const maxMemoryBytes = parseInt(info.maxmemory) || 0
      const usagePercent = maxMemoryBytes > 0 ? (usedMemoryBytes / maxMemoryBytes) * 100 : 0

      // 获取键统计信息
      const keyspaceInfo = await client.info('keyspace')
      let keyCount = 0

      // 解析keyspace信息，格式如: db0:keys=123,expires=45,avg_ttl=67890
      const keyspaceLines = keyspaceInfo.split('\r\n')
      for (const line of keyspaceLines) {
        if (line.startsWith('db')) {
          const match = line.match(/keys=(\d+)/)
          if (match) {
            keyCount += parseInt(match[1])
          }
        }
      }

      // 获取过期和驱逐统计
      const expiredKeys = parseInt(info.expired_keys) || 0
      const evictedKeys = parseInt(info.evicted_keys) || 0

      const stats: RedisMemoryStats = {
        usedMemoryBytes,
        maxMemoryBytes,
        usagePercent,
        keyCount,
        expiredKeys,
        evictedKeys,
      }

      // 更新缓存
      this.redisStatsCache = { stats, timestamp: now }

      return stats
    } catch (error) {
      logger.error({ error }, 'Failed to get Redis memory stats')
      return {
        usedMemoryBytes: 0,
        maxMemoryBytes: 0,
        usagePercent: 0,
        keyCount: 0,
        expiredKeys: 0,
        evictedKeys: 0,
      }
    }
  }

  /**
   * 获取指标历史数据
   */
  async getMetricsHistory(
    metric: string,
    startTime: number,
    endTime: number,
    instanceId?: string,
  ): Promise<MetricData[]> {
    try {
      const config = getCostOptimizationConfig()

      // 如果禁用了Redis指标存储，只返回内存中的数据
      if (config.features.disableRedisMetricsStorage) {
        logger.debug('Redis metrics storage disabled, returning only in-memory data')
        const memoryHistory = this.metricsHistory.get(metric) || []
        return memoryHistory
          .filter(data => data.timestamp >= startTime && data.timestamp <= endTime)
          .sort((a, b) => a.timestamp - b.timestamp)
      }

      const client = this.redisManager.getClient()
      const targetInstanceId = instanceId || this.instanceId
      const history: MetricData[] = []

      // 按分钟遍历时间范围
      for (let time = startTime; time <= endTime; time += 60000) {
        const metricsKey = `metrics:${targetInstanceId}:${Math.floor(time / 60000)}`
        const data = await client.hgetall(metricsKey)

        if (data.timestamp && data.data) {
          const metrics = JSON.parse(data.data)
          if (metrics[metric] !== undefined) {
            history.push({
              timestamp: parseInt(data.timestamp),
              value: metrics[metric],
            })
          }
        }
      }

      return history.sort((a, b) => a.timestamp - b.timestamp)
    } catch (error) {
      logger.error({ error, metric, startTime, endTime }, 'Failed to get metrics history')
      return []
    }
  }

  /**
   * 添加告警规则
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule)
    logger.info({ ruleId: rule.id, ruleName: rule.name }, 'Alert rule added')
  }

  /**
   * 移除告警规则
   */
  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId)
    if (removed) {
      logger.info({ ruleId }, 'Alert rule removed')
    }
    return removed
  }

  /**
   * 检查告警
   */
  private async checkAlerts(metrics: PerformanceMetrics): Promise<void> {
    try {
      for (const rule of this.alertRules.values()) {
        if (!rule.enabled) continue

        const metricValue = (metrics as any)[rule.metric]
        if (metricValue === undefined) continue

        const shouldTrigger = this.evaluateAlertCondition(metricValue, rule)
        const alertKey = `${rule.id}:${this.instanceId}`
        const existingAlert = this.activeAlerts.get(alertKey)

        if (shouldTrigger && !existingAlert) {
          // 触发新告警
          const alert: Alert = {
            id: `alert_${Date.now()}_${rule.id}`,
            ruleId: rule.id,
            ruleName: rule.name,
            metric: rule.metric,
            value: metricValue,
            threshold: rule.threshold,
            triggeredAt: Date.now(),
            instanceId: this.instanceId,
            severity: this.calculateSeverity(metricValue, rule),
            message: `${rule.name}: ${rule.metric} is ${metricValue} (threshold: ${rule.threshold})`,
          }

          this.activeAlerts.set(alertKey, alert)
          await this.publishAlert(alert)

          // 更新规则的最后触发时间
          rule.lastTriggered = Date.now()
        } else if (!shouldTrigger && existingAlert) {
          // 解决告警
          existingAlert.resolvedAt = Date.now()
          await this.publishAlert(existingAlert)
          this.activeAlerts.delete(alertKey)
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to check alerts')
    }
  }

  private evaluateAlertCondition(value: number, rule: AlertRule): boolean {
    switch (rule.operator) {
      case 'gt':
        return value > rule.threshold
      case 'gte':
        return value >= rule.threshold
      case 'lt':
        return value < rule.threshold
      case 'lte':
        return value <= rule.threshold
      case 'eq':
        return value === rule.threshold
      default:
        return false
    }
  }

  private calculateSeverity(value: number, rule: AlertRule): Alert['severity'] {
    const ratio = Math.abs(value - rule.threshold) / rule.threshold

    if (ratio > 0.5) return 'critical'
    if (ratio > 0.3) return 'high'
    if (ratio > 0.1) return 'medium'
    return 'low'
  }

  private async publishAlert(alert: Alert): Promise<void> {
    try {
      const config = getCostOptimizationConfig()
      const client = this.redisManager.getPublisher()

      // 始终发布告警事件（用于实时通知）
      await client.publish('cluster:alerts', JSON.stringify(alert))

      // 根据配置决定是否存储告警历史到Redis
      if (!config.features.disableRedisAlertStorage) {
        const alertKey = `alert:${alert.id}`
        await client.hset(alertKey, {
          id: alert.id,
          ruleId: alert.ruleId,
          ruleName: alert.ruleName,
          metric: alert.metric,
          value: alert.value.toString(),
          threshold: alert.threshold.toString(),
          triggeredAt: alert.triggeredAt.toString(),
          resolvedAt: alert.resolvedAt?.toString() || '',
          instanceId: alert.instanceId,
          severity: alert.severity,
          message: alert.message,
        })

        // 设置过期时间（7天）
        await client.expire(alertKey, 7 * 24 * 60 * 60)

        logger.debug('Alert stored to Redis')
      } else {
        logger.debug('Redis alert storage disabled, alert only published for real-time notifications')
      }

      if (alert.resolvedAt) {
        logger.info({ alertId: alert.id, duration: alert.resolvedAt - alert.triggeredAt }, 'Alert resolved')
      } else {
        logger.warn({ alertId: alert.id, severity: alert.severity, message: alert.message }, 'Alert triggered')
      }
    } catch (error) {
      logger.error({ error, alertId: alert.id }, 'Failed to publish alert')
    }
  }

  private setupDefaultAlertRules(): void {
    const defaultRules: AlertRule[] = [
      {
        id: 'high_cpu_usage',
        name: 'High CPU Usage',
        metric: 'cpuUsage',
        operator: 'gt',
        threshold: 0.8, // 80%
        duration: 300000, // 5分钟
        enabled: true,
      },
      {
        id: 'high_memory_usage',
        name: 'High Memory Usage',
        metric: 'memoryUsage',
        operator: 'gt',
        threshold: 1024 * 1024 * 1024, // 1GB
        duration: 300000,
        enabled: true,
      },
      {
        id: 'low_healthy_instances',
        name: 'Low Healthy Instances',
        metric: 'healthyInstances',
        operator: 'lt',
        threshold: 1,
        duration: 60000, // 1分钟
        enabled: true,
      },
      {
        id: 'high_queue_size',
        name: 'High Matchmaking Queue Size',
        metric: 'queueSize',
        operator: 'gt',
        threshold: 100,
        duration: 600000, // 10分钟
        enabled: true,
      },
      {
        id: 'high_redis_response_time',
        name: 'High Redis Response Time',
        metric: 'redisResponseTime',
        operator: 'gt',
        threshold: 100, // 100ms
        duration: 180000, // 3分钟
        enabled: true,
      },
      {
        id: 'high_redis_memory_usage',
        name: 'High Redis Memory Usage',
        metric: 'redisMemoryUsagePercent',
        operator: 'gt',
        threshold: 80, // 80%
        duration: 300000, // 5分钟
        enabled: true,
      },
      {
        id: 'high_redis_key_count',
        name: 'High Redis Key Count',
        metric: 'redisKeyCount',
        operator: 'gt',
        threshold: 1000000, // 100万个键
        duration: 600000, // 10分钟
        enabled: true,
      },
    ]

    for (const rule of defaultRules) {
      this.addAlertRule(rule)
    }
  }

  private startMetricsCollection(): void {
    const config = getCostOptimizationConfig()
    const interval = config.monitoring.metricsInterval

    this.metricsInterval = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics()
        await this.checkAlerts(metrics)
      } catch (error) {
        // 如果是因为正在收集指标而跳过，不记录错误
        if (error instanceof Error && error.message.includes('already in progress')) {
          logger.debug('Skipped metrics collection due to ongoing collection')
        } else {
          logger.error({ error }, 'Metrics collection error')
        }
      }
    }, interval)

    logger.info({ interval: interval / 1000 }, 'Metrics collection started (cost optimized)')
  }

  private startAlertChecking(): void {
    this.alertsInterval = setInterval(async () => {
      try {
        // 清理已解决的告警
        const now = Date.now()
        for (const [key, alert] of this.activeAlerts.entries()) {
          if (alert.resolvedAt && now - alert.resolvedAt > 60000) {
            // 1分钟后清理
            this.activeAlerts.delete(key)
          }
        }
      } catch (error) {
        logger.error({ error }, 'Alert checking error')
      }
    }, 60000) // 每分钟检查一次
  }

  /**
   * 获取当前活跃告警
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values())
  }

  /**
   * 获取告警历史
   */
  async getAlertHistory(startTime: number, endTime: number): Promise<Alert[]> {
    try {
      const config = getCostOptimizationConfig()

      // 如果禁用了Redis告警存储，只返回当前活跃的告警
      if (config.features.disableRedisAlertStorage) {
        logger.debug('Redis alert storage disabled, returning only active alerts')
        return this.getActiveAlerts().filter(alert => alert.triggeredAt >= startTime && alert.triggeredAt <= endTime)
      }

      const client = this.redisManager.getClient()
      const pattern = 'alert:*'
      const keys = await client.keys(pattern)
      const alerts: Alert[] = []

      for (const key of keys) {
        const alertData = await client.hgetall(key)
        if (alertData.triggeredAt) {
          const triggeredAt = parseInt(alertData.triggeredAt)
          if (triggeredAt >= startTime && triggeredAt <= endTime) {
            alerts.push({
              id: alertData.id,
              ruleId: alertData.ruleId,
              ruleName: alertData.ruleName,
              metric: alertData.metric,
              value: parseFloat(alertData.value),
              threshold: parseFloat(alertData.threshold),
              triggeredAt,
              resolvedAt: alertData.resolvedAt ? parseInt(alertData.resolvedAt) : undefined,
              instanceId: alertData.instanceId,
              severity: alertData.severity as Alert['severity'],
              message: alertData.message,
            })
          }
        }
      }

      return alerts.sort((a, b) => b.triggeredAt - a.triggeredAt)
    } catch (error) {
      logger.error({ error }, 'Failed to get alert history')
      return []
    }
  }

  // 键统计缓存
  private keyStatsCache: { stats: Record<string, number>; totalKeys: number; timestamp: number } | null = null
  private readonly KEY_STATS_CACHE_TTL = 300000 // 5分钟缓存

  /**
   * 获取Redis清理统计信息（大幅优化，减少SCAN操作）
   */
  async getRedisCleanupStats(): Promise<{
    totalKeys: number
    expiredKeys: number
    evictedKeys: number
    memoryUsagePercent: number
    keysByPattern: Record<string, number>
  }> {
    try {
      const now = Date.now()

      // 检查键统计缓存
      let keysByPattern: Record<string, number> = {}
      let totalKeys = 0

      if (this.keyStatsCache && now - this.keyStatsCache.timestamp < this.KEY_STATS_CACHE_TTL) {
        // 使用缓存数据
        keysByPattern = this.keyStatsCache.stats
        totalKeys = this.keyStatsCache.totalKeys
      } else {
        // 大幅减少扫描的模式，只保留最重要的
        const patterns = ['session:*', 'room:*', 'player:sessions:connections:*']

        const client = this.redisManager.getClient()
        const keyPrefix = this.redisManager.getKeyPrefix()

        // 使用更大的 COUNT 值减少网络往返
        for (const pattern of patterns) {
          const fullPattern = `${keyPrefix}${pattern}`
          let count = 0
          let cursor = '0'
          let scanCount = 0
          const maxScans = 10 // 限制最大扫描次数以控制成本

          do {
            const result = await client.scan(cursor, 'MATCH', fullPattern, 'COUNT', 500) // 增大COUNT
            cursor = result[0]
            count += result[1].length
            scanCount++
          } while (cursor !== '0' && scanCount < maxScans)

          keysByPattern[pattern] = count
          totalKeys += count
        }

        // 更新缓存
        this.keyStatsCache = { stats: keysByPattern, totalKeys, timestamp: now }
      }

      // 获取Redis内存统计（已有缓存）
      const memoryStats = await this.getRedisMemoryStats()

      return {
        totalKeys,
        expiredKeys: memoryStats.expiredKeys,
        evictedKeys: memoryStats.evictedKeys,
        memoryUsagePercent: memoryStats.usagePercent,
        keysByPattern,
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get Redis cleanup stats')
      return {
        totalKeys: 0,
        expiredKeys: 0,
        evictedKeys: 0,
        memoryUsagePercent: 0,
        keysByPattern: {},
      }
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up monitoring manager')

      if (this.metricsInterval) {
        clearInterval(this.metricsInterval)
      }

      if (this.alertsInterval) {
        clearInterval(this.alertsInterval)
      }

      logger.info('Monitoring manager cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during monitoring manager cleanup')
    }
  }
}

// LogAggregationManager 已移除以减少 Redis 操作频率
// 日志现在直接使用 pino 输出到标准输出，由容器日志系统处理

// 日志相关类型定义已移除 - 不再使用 Redis 存储日志
