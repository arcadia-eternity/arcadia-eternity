import pino from 'pino'
import type { RedisClientManager } from './redisClient'
import type { ClusterStateManager } from './clusterStateManager'
import type { ServiceInstance } from './types'
import { ServiceDiscoveryError } from './types'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

export interface LoadBalancingStrategy {
  selectInstance(instances: ServiceInstance[]): ServiceInstance | null
}

export class RoundRobinStrategy implements LoadBalancingStrategy {
  private currentIndex = 0

  selectInstance(instances: ServiceInstance[]): ServiceInstance | null {
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
  selectInstance(instances: ServiceInstance[]): ServiceInstance | null {
    const healthyInstances = instances.filter(i => i.status === 'healthy')

    if (healthyInstances.length === 0) {
      return null
    }

    return healthyInstances.reduce((least, current) => (current.connections < least.connections ? current : least))
  }
}

export class WeightedLoadStrategy implements LoadBalancingStrategy {
  selectInstance(instances: ServiceInstance[]): ServiceInstance | null {
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

export class ServiceDiscoveryManager {
  protected redisManager: RedisClientManager
  protected stateManager: ClusterStateManager
  protected loadBalancer: LoadBalancingStrategy
  private healthCheckInterval?: NodeJS.Timeout
  private failoverCheckInterval?: NodeJS.Timeout

  constructor(
    redisManager: RedisClientManager,
    stateManager: ClusterStateManager,
    loadBalancer: LoadBalancingStrategy = new WeightedLoadStrategy(),
  ) {
    this.redisManager = redisManager
    this.stateManager = stateManager
    this.loadBalancer = loadBalancer
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
  async getOptimalInstance(): Promise<ServiceInstance | null> {
    try {
      const instances = await this.stateManager.getInstances()
      return this.loadBalancer.selectInstance(instances)
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
      return this.loadBalancer.selectInstance(regionInstances)
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
