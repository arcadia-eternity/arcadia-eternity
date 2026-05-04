import pino from 'pino'
import type { RedisClientManager } from '../redis/redisClient'
import type { ClusterStateManager } from '../core/clusterStateManager'
import type { ServiceInstance } from '../types'
import { REDIS_KEYS as _REDIS_KEYS } from '../types'

const logger = pino().child({ module: 'LoadBalancingReporter' })

export interface LoadBalancingReport {
  timestamp: number
  reportPeriod: {
    start: number
    end: number
  }
  clusterOverview: {
    totalInstances: number
    healthyInstances: number
    totalBattles: number
    totalConnections: number
    avgCpuUsage: number
    avgMemoryUsage: number
  }
  instanceMetrics: Array<{
    instanceId: string
    region?: string
    performance: {
      cpuUsage: number
      memoryUsage: number
      memoryUsedMB: number
      memoryTotalMB: number
      activeBattles: number
      queuedPlayers: number
      avgResponseTime: number
      errorRate: number
      lastUpdated: number
    }
    connections: number
    score: number
    battlesCreated: number
    loadBalancingSelections: number
  }>
  loadDistribution: {
    battlesPerInstance: Record<string, number>
    connectionsPerInstance: Record<string, number>
    cpuDistribution: {
      min: number
      max: number
      avg: number
      std: number
    }
    memoryDistribution: {
      min: number
      max: number
      avg: number
      std: number
    }
  }
  recommendations: string[]
}

export class LoadBalancingReporter {
  private redisManager: RedisClientManager
  private stateManager: ClusterStateManager
  private reportHistory: LoadBalancingReport[] = []
  private maxHistorySize = 100

  constructor(redisManager: RedisClientManager, stateManager: ClusterStateManager) {
    this.redisManager = redisManager
    this.stateManager = stateManager
  }

  /**
   * 生成负载均衡报告
   */
  async generateReport(periodMinutes: number = 60): Promise<LoadBalancingReport> {
    const endTime = Date.now()
    const startTime = endTime - periodMinutes * 60 * 1000

    try {
      const instances = await this.stateManager.getInstances()
      const healthyInstances = instances.filter(i => i.status === 'healthy')

      // 收集集群概览数据
      const clusterOverview = this.calculateClusterOverview(instances)

      // 收集实例指标
      const instanceMetrics = await this.collectInstanceMetrics(instances, startTime, endTime)

      // 计算负载分布
      const loadDistribution = this.calculateLoadDistribution(instances)

      // 生成建议
      const recommendations = this.generateRecommendations(instances, loadDistribution)

      const report: LoadBalancingReport = {
        timestamp: endTime,
        reportPeriod: { start: startTime, end: endTime },
        clusterOverview,
        instanceMetrics,
        loadDistribution,
        recommendations,
      }

      // 保存报告到历史记录
      this.addToHistory(report)

      logger.info(
        {
          reportTimestamp: endTime,
          periodMinutes,
          totalInstances: instances.length,
          healthyInstances: healthyInstances.length,
          recommendationsCount: recommendations.length,
        },
        'Load balancing report generated',
      )

      return report
    } catch (error) {
      logger.error({ error, periodMinutes }, 'Error generating load balancing report')
      throw error
    }
  }

  /**
   * 计算集群概览
   */
  private calculateClusterOverview(instances: ServiceInstance[]) {
    const healthyInstances = instances.filter(i => i.status === 'healthy')

    const totalBattles = instances.reduce((sum, i) => sum + i.performance.activeBattles, 0)
    const totalConnections = instances.reduce((sum, i) => sum + i.connections, 0)

    const avgCpuUsage =
      healthyInstances.length > 0
        ? healthyInstances.reduce((sum, i) => sum + i.performance.cpuUsage, 0) / healthyInstances.length
        : 0

    const avgMemoryUsage =
      healthyInstances.length > 0
        ? healthyInstances.reduce((sum, i) => sum + i.performance.memoryUsage, 0) / healthyInstances.length
        : 0

    return {
      totalInstances: instances.length,
      healthyInstances: healthyInstances.length,
      totalBattles,
      totalConnections,
      avgCpuUsage: Math.round(avgCpuUsage * 100) / 100,
      avgMemoryUsage: Math.round(avgMemoryUsage * 100) / 100,
    }
  }

  /**
   * 收集实例指标
   */
  private async collectInstanceMetrics(instances: ServiceInstance[], startTime: number, endTime: number) {
    const metrics = []

    for (const instance of instances) {
      // 计算实例得分（使用简化的计算方法）
      const score = this.calculateSimpleInstanceScore(instance)

      // 从Redis获取统计数据（如果有的话）
      const battlesCreated = await this.getBattlesCreatedCount(instance.id, startTime, endTime)
      const loadBalancingSelections = await this.getLoadBalancingSelectionsCount(instance.id, startTime, endTime)

      metrics.push({
        instanceId: instance.id,
        region: instance.region,
        performance: instance.performance,
        connections: instance.connections,
        score,
        battlesCreated,
        loadBalancingSelections,
      })
    }

    return metrics
  }

  /**
   * 计算简化的实例得分
   */
  private calculateSimpleInstanceScore(instance: ServiceInstance): number {
    const { performance } = instance

    // 简化的得分计算（0-1之间）
    const cpuScore = Math.max(0, 1 - performance.cpuUsage / 100)
    const memoryScore = Math.max(0, 1 - performance.memoryUsage / 100)
    const battlesScore = Math.max(0, 1 - performance.activeBattles / 100)
    const connectionsScore = Math.max(0, 1 - instance.connections / 1000)

    return Math.round((cpuScore * 0.3 + memoryScore * 0.3 + battlesScore * 0.3 + connectionsScore * 0.1) * 100) / 100
  }

  /**
   * 计算负载分布
   */
  private calculateLoadDistribution(instances: ServiceInstance[]) {
    const battlesPerInstance: Record<string, number> = {}
    const connectionsPerInstance: Record<string, number> = {}
    const cpuValues: number[] = []
    const memoryValues: number[] = []

    instances.forEach(instance => {
      battlesPerInstance[instance.id] = instance.performance.activeBattles
      connectionsPerInstance[instance.id] = instance.connections
      cpuValues.push(instance.performance.cpuUsage)
      memoryValues.push(instance.performance.memoryUsage)
    })

    return {
      battlesPerInstance,
      connectionsPerInstance,
      cpuDistribution: this.calculateDistributionStats(cpuValues),
      memoryDistribution: this.calculateDistributionStats(memoryValues),
    }
  }

  /**
   * 计算分布统计
   */
  private calculateDistributionStats(values: number[]) {
    if (values.length === 0) {
      return { min: 0, max: 0, avg: 0, std: 0 }
    }

    const min = Math.min(...values)
    const max = Math.max(...values)
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length
    const std = Math.sqrt(variance)

    return {
      min: Math.round(min * 100) / 100,
      max: Math.round(max * 100) / 100,
      avg: Math.round(avg * 100) / 100,
      std: Math.round(std * 100) / 100,
    }
  }

  /**
   * 生成优化建议
   */
  private generateRecommendations(instances: ServiceInstance[], loadDistribution: unknown): string[] {
    const recommendations: string[] = []
    const healthyInstances = instances.filter(i => i.status === 'healthy')

    if (healthyInstances.length === 0) {
      recommendations.push('⚠️ 没有健康的实例可用，请检查集群状态')
      return recommendations
    }

    // CPU使用率建议
    if (loadDistribution.cpuDistribution.avg > 80) {
      recommendations.push('🔥 集群平均CPU使用率过高，建议增加实例或优化代码')
    } else if (loadDistribution.cpuDistribution.std > 20) {
      recommendations.push('⚖️ CPU负载分布不均，建议调整负载均衡权重配置')
    }

    // 内存使用率建议
    if (loadDistribution.memoryDistribution.avg > 85) {
      recommendations.push('💾 集群平均内存使用率过高，建议增加实例或优化内存使用')
    } else if (loadDistribution.memoryDistribution.std > 15) {
      recommendations.push('⚖️ 内存负载分布不均，建议调整负载均衡权重配置')
    }

    // 战斗分布建议
    const battleCounts = Object.values(loadDistribution.battlesPerInstance) as number[]
    const battleStd = this.calculateDistributionStats(battleCounts).std
    if (battleStd > 10) {
      recommendations.push('🎮 战斗分布不均，建议调整战斗权重或检查实例性能')
    }

    // 实例健康状态建议
    const unhealthyCount = instances.length - healthyInstances.length
    if (unhealthyCount > 0) {
      recommendations.push(`🚨 有 ${unhealthyCount} 个实例状态不健康，请检查实例状态`)
    }

    // 性能阈值建议
    const highCpuInstances = healthyInstances.filter(i => i.performance.cpuUsage > 90)
    if (highCpuInstances.length > 0) {
      recommendations.push(`⚡ 有 ${highCpuInstances.length} 个实例CPU使用率超过90%，建议检查负载`)
    }

    if (recommendations.length === 0) {
      recommendations.push('✅ 集群负载均衡状态良好，无需特别调整')
    }

    return recommendations
  }

  /**
   * 获取战斗创建数量（模拟实现）
   */
  private async getBattlesCreatedCount(_instanceId: string, _startTime: number, _endTime: number): Promise<number> {
    // 这里应该从实际的监控数据中获取，暂时返回模拟数据
    return Math.floor(Math.random() * 50)
  }

  /**
   * 获取负载均衡选择次数（模拟实现）
   */
  private async getLoadBalancingSelectionsCount(
    _instanceId: string,
    _startTime: number,
    _endTime: number,
  ): Promise<number> {
    // 这里应该从实际的监控数据中获取，暂时返回模拟数据
    return Math.floor(Math.random() * 100)
  }

  /**
   * 添加报告到历史记录
   */
  private addToHistory(report: LoadBalancingReport): void {
    this.reportHistory.push(report)

    // 保持历史记录大小限制
    if (this.reportHistory.length > this.maxHistorySize) {
      this.reportHistory = this.reportHistory.slice(-this.maxHistorySize)
    }
  }

  /**
   * 获取历史报告
   */
  getReportHistory(): LoadBalancingReport[] {
    return [...this.reportHistory]
  }

  /**
   * 获取最新报告
   */
  getLatestReport(): LoadBalancingReport | null {
    return this.reportHistory.length > 0 ? this.reportHistory[this.reportHistory.length - 1] : null
  }

  /**
   * 清理历史记录
   */
  clearHistory(): void {
    this.reportHistory = []
  }
}
