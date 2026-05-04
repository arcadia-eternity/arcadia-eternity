import pino from 'pino'
import type { RedisClientManager } from '../redis/redisClient'
import type { ClusterStateManager } from '../core/clusterStateManager'
import type { ServiceInstance } from '../types'
import { ServiceDiscoveryError } from '../types'
import { loadBalancingConfigManager, type LoadBalancingConfigManager } from '../config/loadBalancingConfig'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export interface LoadBalancingStrategy {
  selectInstance(instances: ServiceInstance[], preferredRegion?: string): ServiceInstance | null
}

export class RoundRobinStrategy implements LoadBalancingStrategy {
  private currentIndex = 0

  selectInstance(instances: ServiceInstance[], _preferredRegion?: string): ServiceInstance | null {
    const healthyInstances = instances.filter(i => i.status === 'healthy')

    if (healthyInstances.length === 0) {
      return null
    }

    const instance = healthyInstances[this.currentIndex % healthyInstances.length]
    this.currentIndex = (this.currentIndex + 1) % healthyInstances.length

    return instance
  }
}

export class LeastConnectionsStrategy implements LoadBalancingStrategy {
  selectInstance(instances: ServiceInstance[], _preferredRegion?: string): ServiceInstance | null {
    const healthyInstances = instances.filter(i => i.status === 'healthy')

    if (healthyInstances.length === 0) {
      return null
    }

    return healthyInstances.reduce((least, current) => (current.connections < least.connections ? current : least))
  }
}

export class WeightedLoadStrategy implements LoadBalancingStrategy {
  selectInstance(instances: ServiceInstance[], _preferredRegion?: string): ServiceInstance | null {
    const healthyInstances = instances.filter(i => i.status === 'healthy')

    if (healthyInstances.length === 0) {
      return null
    }

    // 基于负载和连接数计算权重（负载越低权重越高）
    const weightedInstances = healthyInstances.map(instance => ({
      instance,
      weight: Math.max(1, 100 - (instance.load * 50 + instance.connections * 0.1)),
    }))

    const totalWeight = weightedInstances.reduce((sum, item) => sum + item.weight, 0)
    const random = Math.random() * totalWeight

    let currentWeight = 0
    for (const item of weightedInstances) {
      currentWeight += item.weight
      if (random <= currentWeight) {
        return item.instance
      }
    }

    return weightedInstances[0].instance
  }
}

export interface SmartLoadBalancingConfig {
  // 各指标权重配置
  weights: {
    cpu: number // CPU使用率权重
    memory: number // 内存使用率权重
    battles: number // 活跃战斗数权重
    connections: number // 连接数权重
    responseTime: number // 响应时间权重
    errorRate: number // 错误率权重
  }
  // 负载阈值配置
  thresholds: {
    cpuHigh: number // CPU高负载阈值 (%)
    memoryHigh: number // 内存高负载阈值 (%)
    battlesMax: number // 最大战斗数
    connectionsMax: number // 最大连接数
    responseTimeMax: number // 最大响应时间 (ms)
    errorRateMax: number // 最大错误率
  }
  // 是否启用区域优先
  preferSameRegion: boolean
  // 是否启用负载阈值过滤
  enableThresholdFiltering: boolean
}

export class SmartLoadBalancingStrategy implements LoadBalancingStrategy {
  private configManager: LoadBalancingConfigManager
  private performanceTracker?: any // PerformanceTracker type

  constructor(configManager?: LoadBalancingConfigManager, performanceTracker?: any) {
    this.configManager = configManager || loadBalancingConfigManager
    this.performanceTracker = performanceTracker

    // 监听配置更新
    this.configManager.onConfigUpdate(newConfig => {
      logger.info({ newConfig }, 'Load balancing configuration updated')
    })
  }

  selectInstance(instances: ServiceInstance[], preferredRegion?: string): ServiceInstance | null {
    const startTime = Date.now()

    try {
      let healthyInstances = instances.filter(i => i.status === 'healthy')

      if (healthyInstances.length === 0) {
        this.performanceTracker?.recordLoadBalancingDecision('smart', 'error')
        return null
      }

      const config = this.configManager.getConfig()

      // 区域优先过滤
      if (config.preferSameRegion && preferredRegion) {
        const sameRegionInstances = healthyInstances.filter(i => i.region === preferredRegion)
        if (sameRegionInstances.length > 0) {
          healthyInstances = sameRegionInstances
        }
      }

      // 负载阈值过滤
      let usedThresholdFiltering = false
      if (config.enableThresholdFiltering) {
        const filteredInstances = healthyInstances.filter(instance => this.isWithinThresholds(instance))
        if (filteredInstances.length > 0) {
          healthyInstances = filteredInstances
          usedThresholdFiltering = true
        }
        // 如果所有实例都超过阈值，仍然使用原始列表，但会选择负载最低的
      }

      // 计算每个实例的综合得分
      const scoredInstances = healthyInstances.map(instance => {
        const score = this.calculateInstanceScore(instance)

        // 记录实例得分用于监控
        this.performanceTracker?.updateInstanceScore(instance.id, score)

        return {
          instance,
          score,
        }
      })

      // 按得分排序（得分越高越好）
      scoredInstances.sort((a, b) => b.score - a.score)

      // 使用加权随机选择，偏向高分实例
      const selectedInstance = this.weightedRandomSelection(scoredInstances)

      // 记录成功的负载均衡决策
      this.performanceTracker?.recordLoadBalancingDecision('smart', 'success')

      // 记录选择耗时
      const duration = Date.now() - startTime
      this.performanceTracker?.recordInstanceSelectionDuration('smart', duration)

      logger.debug(
        {
          selectedInstanceId: selectedInstance?.id,
          totalInstances: instances.length,
          healthyInstances: healthyInstances.length,
          usedThresholdFiltering,
          preferredRegion,
          selectionDuration: duration,
          topScores: scoredInstances.slice(0, 3).map(s => ({ id: s.instance.id, score: s.score })),
        },
        'Smart load balancing instance selection completed',
      )

      return selectedInstance
    } catch (error) {
      this.performanceTracker?.recordLoadBalancingDecision('smart', 'error')

      const duration = Date.now() - startTime
      this.performanceTracker?.recordInstanceSelectionDuration('smart', duration)

      logger.error(
        {
          error,
          instanceCount: instances.length,
          preferredRegion,
          selectionDuration: duration,
        },
        'Error in smart load balancing instance selection',
      )

      // 出错时回退到简单选择
      const healthyInstances = instances.filter(i => i.status === 'healthy')
      return healthyInstances.length > 0 ? healthyInstances[0] : null
    }
  }

  private isWithinThresholds(instance: ServiceInstance): boolean {
    const { performance } = instance
    const { thresholds } = this.configManager.getConfig()

    return (
      performance.cpuUsage <= thresholds.cpuHigh &&
      performance.memoryUsage <= thresholds.memoryHigh &&
      performance.activeBattles <= thresholds.battlesMax &&
      instance.connections <= thresholds.connectionsMax &&
      performance.avgResponseTime <= thresholds.responseTimeMax &&
      performance.errorRate <= thresholds.errorRateMax
    )
  }

  private calculateInstanceScore(instance: ServiceInstance): number {
    const { performance } = instance
    const { weights, thresholds } = this.configManager.getConfig()

    // 计算各项指标的标准化得分（0-1，越高越好）
    const cpuScore = Math.max(0, 1 - performance.cpuUsage / 100)
    const memoryScore = Math.max(0, 1 - performance.memoryUsage / 100)
    const battlesScore = Math.max(0, 1 - performance.activeBattles / thresholds.battlesMax)
    const connectionsScore = Math.max(0, 1 - instance.connections / thresholds.connectionsMax)
    const responseTimeScore = Math.max(0, 1 - performance.avgResponseTime / thresholds.responseTimeMax)
    const errorRateScore = Math.max(0, 1 - performance.errorRate / thresholds.errorRateMax)

    // 加权计算综合得分
    const totalScore =
      cpuScore * weights.cpu +
      memoryScore * weights.memory +
      battlesScore * weights.battles +
      connectionsScore * weights.connections +
      responseTimeScore * weights.responseTime +
      errorRateScore * weights.errorRate

    return Math.max(0.01, totalScore) // 确保最小得分为0.01
  }

  private weightedRandomSelection(
    scoredInstances: Array<{ instance: ServiceInstance; score: number }>,
  ): ServiceInstance {
    if (scoredInstances.length === 1) {
      return scoredInstances[0].instance
    }

    // 计算总权重
    const totalWeight = scoredInstances.reduce((sum, item) => sum + item.score, 0)
    const random = Math.random() * totalWeight

    let currentWeight = 0
    for (const item of scoredInstances) {
      currentWeight += item.score
      if (random <= currentWeight) {
        return item.instance
      }
    }

    // 备用：返回得分最高的实例
    return scoredInstances[0].instance
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SmartLoadBalancingConfig>): void {
    this.configManager.updateConfig(config)
  }

  /**
   * 获取当前配置
   */
  getConfig(): SmartLoadBalancingConfig {
    return this.configManager.getConfig()
  }

  /**
   * 获取配置管理器
   */
  getConfigManager(): LoadBalancingConfigManager {
    return this.configManager
  }
}

export class ServiceDiscoveryManager {
  protected redisManager: RedisClientManager
  protected stateManager: ClusterStateManager
  protected loadBalancer: LoadBalancingStrategy
  protected configManager: LoadBalancingConfigManager
  private healthCheckInterval?: NodeJS.Timeout
  private failoverCheckInterval?: NodeJS.Timeout
  private isPerformingHealthCheck = false // 防止重复健康检查
  private isPerformingFailoverCheck = false // 防止重复故障转移检查

  constructor(
    redisManager: RedisClientManager,
    stateManager: ClusterStateManager,
    loadBalancer: LoadBalancingStrategy = new WeightedLoadStrategy(),
    configManager: LoadBalancingConfigManager = loadBalancingConfigManager,
  ) {
    this.redisManager = redisManager
    this.stateManager = stateManager
    this.loadBalancer = loadBalancer
    this.configManager = configManager
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing service discovery manager')

      // 启动健康检查
      this.startHealthCheck()

      // 启动故障转移检查
      this.startFailoverCheck()

      logger.info('Service discovery manager initialized successfully')
    } catch (error) {
      logger.error({ error }, 'Failed to initialize service discovery manager')
      throw new ServiceDiscoveryError('Failed to initialize service discovery', error)
    }
  }

  /**
   * 获取最佳服务实例
   */
  async getOptimalInstance(preferredRegion?: string): Promise<ServiceInstance | null> {
    try {
      const instances = await this.stateManager.getInstances()
      return this.loadBalancer.selectInstance(instances, preferredRegion)
    } catch (error) {
      logger.error({ error }, 'Error getting optimal instance')
      throw new ServiceDiscoveryError('Failed to get optimal instance', error)
    }
  }

  /**
   * 获取特定区域的最佳实例
   */
  async getOptimalInstanceInRegion(region: string): Promise<ServiceInstance | null> {
    try {
      const instances = await this.stateManager.getInstances()
      const regionInstances = instances.filter(i => i.region === region)
      return this.loadBalancer.selectInstance(regionInstances, region)
    } catch (error) {
      logger.error({ error, region }, 'Error getting optimal instance in region')
      throw new ServiceDiscoveryError('Failed to get optimal instance in region', error)
    }
  }

  /**
   * 获取所有健康的实例
   */
  async getHealthyInstances(): Promise<ServiceInstance[]> {
    try {
      const instances = await this.stateManager.getInstances()
      return instances.filter(i => i.status === 'healthy')
    } catch (error) {
      logger.error({ error }, 'Error getting healthy instances')
      throw new ServiceDiscoveryError('Failed to get healthy instances', error)
    }
  }

  /**
   * 检查特定实例是否健康
   */
  async isInstanceHealthy(instanceId: string): Promise<boolean> {
    try {
      const instances = await this.stateManager.getInstances()
      const instance = instances.find(i => i.id === instanceId)
      return instance?.status === 'healthy' || false
    } catch (error) {
      logger.error({ error, instanceId }, 'Error checking instance health')
      return false
    }
  }

  /**
   * 获取实例负载信息
   */
  async getInstanceLoad(instanceId: string): Promise<{ connections: number; load: number } | null> {
    try {
      const instances = await this.stateManager.getInstances()
      const instance = instances.find(i => i.id === instanceId)

      if (!instance) {
        return null
      }

      return {
        connections: instance.connections,
        load: instance.load,
      }
    } catch (error) {
      logger.error({ error, instanceId }, 'Error getting instance load')
      return null
    }
  }

  /**
   * 设置负载均衡策略
   */
  setLoadBalancingStrategy(strategy: LoadBalancingStrategy): void {
    this.loadBalancer = strategy
    logger.info({ strategy: strategy.constructor.name }, 'Load balancing strategy updated')
  }

  /**
   * 获取负载均衡配置管理器
   */
  getLoadBalancingConfigManager(): LoadBalancingConfigManager {
    return this.configManager
  }

  /**
   * 更新负载均衡配置
   */
  updateLoadBalancingConfig(config: Partial<SmartLoadBalancingConfig>): void {
    this.configManager.updateConfig(config)
    logger.info({ config }, 'Load balancing configuration updated')
  }

  /**
   * 获取当前负载均衡配置
   */
  getLoadBalancingConfig(): SmartLoadBalancingConfig {
    return this.configManager.getConfig()
  }

  /**
   * 重置负载均衡配置为默认值
   */
  resetLoadBalancingConfig(): void {
    this.configManager.resetToDefault()
    logger.info('Load balancing configuration reset to default')
  }

  /**
   * 获取集群拓扑信息
   */
  async getClusterTopology(): Promise<{
    instances: ServiceInstance[]
    regions: string[]
    totalConnections: number
    averageLoad: number
  }> {
    try {
      const instances = await this.stateManager.getInstances()
      const regions = [...new Set(instances.map(i => i.region).filter((region): region is string => Boolean(region)))]
      const totalConnections = instances.reduce((sum, i) => sum + i.connections, 0)
      const averageLoad = instances.length > 0 ? instances.reduce((sum, i) => sum + i.load, 0) / instances.length : 0

      return {
        instances,
        regions,
        totalConnections,
        averageLoad,
      }
    } catch (error) {
      logger.error({ error }, 'Error getting cluster topology')
      throw new ServiceDiscoveryError('Failed to get cluster topology', error)
    }
  }

  private startHealthCheck(): void {
    const interval = 300000 // 5分钟检查一次（大幅延长以节约成本）

    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck()
      } catch (error) {
        logger.error({ error }, 'Health check failed')
      }
    }, interval)

    logger.debug({ interval }, 'Health check started (optimized for cost reduction)')
  }

  private async performHealthCheck(): Promise<void> {
    // 防止重复健康检查
    if (this.isPerformingHealthCheck) {
      logger.debug('Service discovery health check already in progress, skipping')
      return
    }

    this.isPerformingHealthCheck = true
    try {
      const instances = await this.stateManager.getInstances()
      const now = Date.now()
      const healthTimeout = 120000 // 2分钟超时

      for (const instance of instances) {
        const timeSinceLastHeartbeat = now - instance.lastHeartbeat

        if (timeSinceLastHeartbeat > healthTimeout && instance.status === 'healthy') {
          logger.warn(
            {
              instanceId: instance.id,
              timeSinceLastHeartbeat: Math.floor(timeSinceLastHeartbeat / 1000),
            },
            'Instance marked as unhealthy due to missing heartbeat',
          )

          // 这里需要更新实例状态，但由于实例自己负责更新状态，
          // 我们只能记录日志，实际的清理由ClusterStateManager处理
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error performing health check')
    } finally {
      this.isPerformingHealthCheck = false
    }
  }

  private startFailoverCheck(): void {
    const interval = 600000 // 10分钟检查一次（大幅延长以节约成本）

    this.failoverCheckInterval = setInterval(async () => {
      try {
        await this.performFailoverCheck()
      } catch (error) {
        logger.error({ error }, 'Failover check failed')
      }
    }, interval)

    logger.debug({ interval }, 'Failover check started (optimized for cost reduction)')
  }

  private async performFailoverCheck(): Promise<void> {
    // 防止重复故障转移检查
    if (this.isPerformingFailoverCheck) {
      logger.debug('Service discovery failover check already in progress, skipping')
      return
    }

    this.isPerformingFailoverCheck = true
    try {
      const instances = await this.stateManager.getInstances()
      const healthyInstances = instances.filter(i => i.status === 'healthy')
      const unhealthyInstances = instances.filter(i => i.status === 'unhealthy')

      if (unhealthyInstances.length > 0) {
        logger.warn(
          {
            healthyCount: healthyInstances.length,
            unhealthyCount: unhealthyInstances.length,
            unhealthyInstances: unhealthyInstances.map(i => i.id),
          },
          'Unhealthy instances detected',
        )

        // 检查是否需要触发故障转移
        if (healthyInstances.length === 0) {
          logger.error('No healthy instances available - cluster is down!')
          // 这里可以触发告警或其他紧急措施
        } else if (healthyInstances.length < instances.length * 0.5) {
          logger.warn('Less than 50% of instances are healthy - consider scaling up')
        }
      }

      // 检查负载分布
      if (healthyInstances.length > 1) {
        const loads = healthyInstances.map(i => i.load)
        const maxLoad = Math.max(...loads)
        const minLoad = Math.min(...loads)
        const loadImbalance = maxLoad - minLoad

        if (loadImbalance > 0.5) {
          // 50%的负载差异
          logger.warn({ maxLoad, minLoad, loadImbalance }, 'Significant load imbalance detected')
        }
      }
    } catch (error) {
      logger.error({ error }, 'Error performing failover check')
    } finally {
      this.isPerformingFailoverCheck = false
    }
  }

  async cleanup(): Promise<void> {
    try {
      logger.info('Cleaning up service discovery manager')

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval)
      }

      if (this.failoverCheckInterval) {
        clearInterval(this.failoverCheckInterval)
      }

      logger.info('Service discovery manager cleanup completed')
    } catch (error) {
      logger.error({ error }, 'Error during service discovery cleanup')
    }
  }
}
