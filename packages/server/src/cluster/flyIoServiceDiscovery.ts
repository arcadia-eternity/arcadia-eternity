import pino from 'pino'
import { ServiceDiscoveryManager } from './serviceDiscovery'
import type { ServiceInstance } from './types'
import type { RedisClientManager } from './redisClient'
import type { ClusterStateManager } from './clusterStateManager'
import type { LoadBalancingStrategy } from './serviceDiscovery'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

/**
 * Fly.io 特定的服务发现管理器
 * 扩展基础服务发现功能，添加 Fly.io 环境的特殊处理
 */
export class FlyIoServiceDiscoveryManager extends ServiceDiscoveryManager {
  private flyAppName: string
  private flyRegion: string

  constructor(
    redisManager: RedisClientManager,
    stateManager: ClusterStateManager,
    loadBalancer: LoadBalancingStrategy,
    flyAppName?: string,
    flyRegion?: string,
  ) {
    super(redisManager, stateManager, loadBalancer)
    this.flyAppName = flyAppName || process.env.FLY_APP_NAME || ''
    this.flyRegion = flyRegion || process.env.FLY_REGION || ''
  }

  /**
   * 获取 Fly.io 环境中的最佳 gRPC 实例
   * 优先选择同区域的实例
   */
  async getOptimalGrpcInstance(preferSameRegion = true): Promise<ServiceInstance | null> {
    try {
      const instances = await this.stateManager.getInstances()
      const grpcInstances = instances.filter(instance => instance.rpcPort && instance.rpcAddress)

      if (grpcInstances.length === 0) {
        logger.warn('No gRPC instances available')
        return null
      }

      // 在 Fly.io 环境中，优先选择同区域的实例
      if (preferSameRegion && this.flyRegion) {
        const sameRegionInstances = grpcInstances.filter(instance => instance.region === this.flyRegion)
        if (sameRegionInstances.length > 0) {
          const selected = this.loadBalancer.selectInstance(sameRegionInstances, this.flyRegion)
          if (selected) {
            logger.debug({ instanceId: selected.id, region: selected.region }, 'Selected same-region gRPC instance')
            return selected
          }
        }
      }

      // 如果没有同区域实例或不需要优先同区域，选择最佳实例
      const selected = this.loadBalancer.selectInstance(grpcInstances, this.flyRegion)
      if (selected) {
        logger.debug({ instanceId: selected.id, region: selected.region }, 'Selected gRPC instance')
      }
      return selected
    } catch (error) {
      logger.error({ error }, 'Error getting optimal gRPC instance')
      return null
    }
  }

  /**
   * 获取指定实例的 gRPC 地址
   * 在 Fly.io 环境中，使用内部网络地址
   */
  async getGrpcAddress(instanceId: string): Promise<string | null> {
    try {
      const instances = await this.stateManager.getInstances()
      const instance = instances.find(i => i.id === instanceId)

      if (!instance || !instance.rpcPort) {
        logger.warn({ instanceId }, 'Instance not found or no gRPC port configured')
        return null
      }

      // 在 Fly.io 环境中，使用内部网络地址
      if (this.isFlyIoEnvironment()) {
        // Fly.io 内部网络格式：{instance-id}.internal:{port}
        const internalAddress = `${instanceId}.internal:${instance.rpcPort}`
        logger.debug({ instanceId, address: internalAddress }, 'Using Fly.io internal gRPC address')
        return internalAddress
      }

      // 非 Fly.io 环境，使用标准地址
      const address = `${instance.host}:${instance.rpcPort}`
      logger.debug({ instanceId, address }, 'Using standard gRPC address')
      return address
    } catch (error) {
      logger.error({ error, instanceId }, 'Error getting gRPC address')
      return null
    }
  }

  /**
   * 获取所有可用的 gRPC 实例地址
   */
  async getAllGrpcAddresses(): Promise<Array<{ instanceId: string; address: string; region?: string }>> {
    try {
      const instances = await this.stateManager.getInstances()
      const grpcInstances = instances.filter(instance => instance.rpcPort)

      const addresses = await Promise.all(
        grpcInstances.map(async instance => {
          const address = await this.getGrpcAddress(instance.id)
          return address
            ? {
                instanceId: instance.id,
                address,
                region: instance.region,
              }
            : null
        }),
      )

      return addresses.filter((addr): addr is NonNullable<typeof addr> => addr !== null)
    } catch (error) {
      logger.error({ error }, 'Error getting all gRPC addresses')
      return []
    }
  }

  /**
   * 检查是否在 Fly.io 环境中
   */
  private isFlyIoEnvironment(): boolean {
    return Boolean(this.flyAppName && process.env.FLY_APP_NAME)
  }

  /**
   * 获取当前实例的 Fly.io 信息
   */
  getFlyIoInfo(): {
    appName: string
    region: string
    isInFlyIo: boolean
  } {
    return {
      appName: this.flyAppName,
      region: this.flyRegion,
      isInFlyIo: this.isFlyIoEnvironment(),
    }
  }

  /**
   * 健康检查 gRPC 连接
   */
  async healthCheckGrpcInstance(instanceId: string): Promise<boolean> {
    try {
      const address = await this.getGrpcAddress(instanceId)
      if (!address) {
        return false
      }

      // 这里可以添加实际的 gRPC 健康检查逻辑
      // 目前只检查地址是否可获取
      logger.debug({ instanceId, address }, 'gRPC instance health check passed')
      return true
    } catch (error) {
      logger.error({ error, instanceId }, 'gRPC instance health check failed')
      return false
    }
  }

  /**
   * 获取集群 gRPC 拓扑信息
   */
  async getGrpcTopology(): Promise<{
    totalInstances: number
    grpcInstances: number
    regionDistribution: Record<string, number>
    addresses: Array<{ instanceId: string; address: string; region?: string }>
  }> {
    try {
      const instances = await this.stateManager.getInstances()
      const grpcInstances = instances.filter(instance => instance.rpcPort)
      const addresses = await this.getAllGrpcAddresses()

      const regionDistribution: Record<string, number> = {}
      grpcInstances.forEach(instance => {
        const region = instance.region || 'unknown'
        regionDistribution[region] = (regionDistribution[region] || 0) + 1
      })

      return {
        totalInstances: instances.length,
        grpcInstances: grpcInstances.length,
        regionDistribution,
        addresses,
      }
    } catch (error) {
      logger.error({ error }, 'Error getting gRPC topology')
      return {
        totalInstances: 0,
        grpcInstances: 0,
        regionDistribution: {},
        addresses: [],
      }
    }
  }
}
