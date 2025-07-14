import type { SmartLoadBalancingConfig } from './serviceDiscovery'

/**
 * 负载均衡配置管理器
 */
export class LoadBalancingConfigManager {
  private config: SmartLoadBalancingConfig
  private configUpdateCallbacks: Array<(config: SmartLoadBalancingConfig) => void> = []

  constructor(initialConfig?: Partial<SmartLoadBalancingConfig>) {
    this.config = this.createDefaultConfig()

    if (initialConfig) {
      this.updateConfig(initialConfig)
    }

    // 从环境变量加载配置
    this.loadFromEnvironment()
  }

  /**
   * 创建默认配置
   */
  private createDefaultConfig(): SmartLoadBalancingConfig {
    return {
      weights: {
        cpu: 0.25,
        memory: 0.2,
        battles: 0.25,
        connections: 0.15,
        responseTime: 0.1,
        errorRate: 0.05,
      },
      thresholds: {
        cpuHigh: 80,
        memoryHigh: 85,
        battlesMax: 100,
        connectionsMax: 1000,
        responseTimeMax: 5000,
        errorRateMax: 0.1,
      },
      preferSameRegion: true,
      enableThresholdFiltering: true,
    }
  }

  /**
   * 从环境变量加载配置
   */
  private loadFromEnvironment(): void {
    const envConfig: Partial<SmartLoadBalancingConfig> = {}

    // 权重配置
    const weights = { ...this.config.weights }
    if (process.env.LB_WEIGHT_CPU) {
      weights.cpu = parseFloat(process.env.LB_WEIGHT_CPU)
    }
    if (process.env.LB_WEIGHT_MEMORY) {
      weights.memory = parseFloat(process.env.LB_WEIGHT_MEMORY)
    }
    if (process.env.LB_WEIGHT_BATTLES) {
      weights.battles = parseFloat(process.env.LB_WEIGHT_BATTLES)
    }
    if (process.env.LB_WEIGHT_CONNECTIONS) {
      weights.connections = parseFloat(process.env.LB_WEIGHT_CONNECTIONS)
    }
    if (process.env.LB_WEIGHT_RESPONSE_TIME) {
      weights.responseTime = parseFloat(process.env.LB_WEIGHT_RESPONSE_TIME)
    }
    if (process.env.LB_WEIGHT_ERROR_RATE) {
      weights.errorRate = parseFloat(process.env.LB_WEIGHT_ERROR_RATE)
    }
    envConfig.weights = weights

    // 阈值配置
    const thresholds = { ...this.config.thresholds }
    if (process.env.LB_THRESHOLD_CPU_HIGH) {
      thresholds.cpuHigh = parseInt(process.env.LB_THRESHOLD_CPU_HIGH)
    }
    if (process.env.LB_THRESHOLD_MEMORY_HIGH) {
      thresholds.memoryHigh = parseInt(process.env.LB_THRESHOLD_MEMORY_HIGH)
    }
    if (process.env.LB_THRESHOLD_BATTLES_MAX) {
      thresholds.battlesMax = parseInt(process.env.LB_THRESHOLD_BATTLES_MAX)
    }
    if (process.env.LB_THRESHOLD_CONNECTIONS_MAX) {
      thresholds.connectionsMax = parseInt(process.env.LB_THRESHOLD_CONNECTIONS_MAX)
    }
    if (process.env.LB_THRESHOLD_RESPONSE_TIME_MAX) {
      thresholds.responseTimeMax = parseInt(process.env.LB_THRESHOLD_RESPONSE_TIME_MAX)
    }
    if (process.env.LB_THRESHOLD_ERROR_RATE_MAX) {
      thresholds.errorRateMax = parseFloat(process.env.LB_THRESHOLD_ERROR_RATE_MAX)
    }
    envConfig.thresholds = thresholds

    // 其他配置
    if (process.env.LB_PREFER_SAME_REGION !== undefined) {
      envConfig.preferSameRegion = process.env.LB_PREFER_SAME_REGION === 'true'
    }
    if (process.env.LB_ENABLE_THRESHOLD_FILTERING !== undefined) {
      envConfig.enableThresholdFiltering = process.env.LB_ENABLE_THRESHOLD_FILTERING === 'true'
    }

    if (Object.keys(envConfig).length > 0) {
      this.updateConfig(envConfig)
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): SmartLoadBalancingConfig {
    return { ...this.config }
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<SmartLoadBalancingConfig>): void {
    // 深度合并配置
    this.config = {
      ...this.config,
      ...newConfig,
      weights: {
        ...this.config.weights,
        ...newConfig.weights,
      },
      thresholds: {
        ...this.config.thresholds,
        ...newConfig.thresholds,
      },
    }

    // 验证配置
    this.validateConfig()

    // 通知所有监听器
    this.configUpdateCallbacks.forEach(callback => {
      try {
        callback(this.config)
      } catch (error) {
        console.error('Error in config update callback:', error)
      }
    })
  }

  /**
   * 验证配置的有效性
   */
  private validateConfig(): void {
    const { weights, thresholds } = this.config

    // 验证权重总和
    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0)
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      console.warn(`Load balancing weights sum to ${totalWeight}, expected 1.0. Auto-normalizing...`)

      // 自动标准化权重
      Object.keys(weights).forEach(key => {
        weights[key as keyof typeof weights] = weights[key as keyof typeof weights] / totalWeight
      })
    }

    // 验证权重范围
    Object.entries(weights).forEach(([key, value]) => {
      if (value < 0 || value > 1) {
        throw new Error(`Invalid weight for ${key}: ${value}. Must be between 0 and 1.`)
      }
    })

    // 验证阈值范围
    if (thresholds.cpuHigh < 0 || thresholds.cpuHigh > 100) {
      throw new Error(`Invalid CPU threshold: ${thresholds.cpuHigh}. Must be between 0 and 100.`)
    }
    if (thresholds.memoryHigh < 0 || thresholds.memoryHigh > 100) {
      throw new Error(`Invalid memory threshold: ${thresholds.memoryHigh}. Must be between 0 and 100.`)
    }
    if (thresholds.battlesMax < 1) {
      throw new Error(`Invalid battles max threshold: ${thresholds.battlesMax}. Must be at least 1.`)
    }
    if (thresholds.connectionsMax < 1) {
      throw new Error(`Invalid connections max threshold: ${thresholds.connectionsMax}. Must be at least 1.`)
    }
    if (thresholds.responseTimeMax < 1) {
      throw new Error(`Invalid response time max threshold: ${thresholds.responseTimeMax}. Must be at least 1.`)
    }
    if (thresholds.errorRateMax < 0 || thresholds.errorRateMax > 1) {
      throw new Error(`Invalid error rate max threshold: ${thresholds.errorRateMax}. Must be between 0 and 1.`)
    }
  }

  /**
   * 注册配置更新回调
   */
  onConfigUpdate(callback: (config: SmartLoadBalancingConfig) => void): void {
    this.configUpdateCallbacks.push(callback)
  }

  /**
   * 移除配置更新回调
   */
  removeConfigUpdateCallback(callback: (config: SmartLoadBalancingConfig) => void): void {
    const index = this.configUpdateCallbacks.indexOf(callback)
    if (index > -1) {
      this.configUpdateCallbacks.splice(index, 1)
    }
  }

  /**
   * 重置为默认配置
   */
  resetToDefault(): void {
    this.config = this.createDefaultConfig()
    this.loadFromEnvironment()

    // 通知所有监听器
    this.configUpdateCallbacks.forEach(callback => {
      try {
        callback(this.config)
      } catch (error) {
        console.error('Error in config update callback:', error)
      }
    })
  }

  /**
   * 获取配置的JSON表示
   */
  toJSON(): string {
    return JSON.stringify(this.config, null, 2)
  }

  /**
   * 从JSON字符串加载配置
   */
  fromJSON(jsonString: string): void {
    try {
      const config = JSON.parse(jsonString)
      this.updateConfig(config)
    } catch (error) {
      throw new Error(`Invalid JSON configuration: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }
}

// 全局配置管理器实例
export const loadBalancingConfigManager = new LoadBalancingConfigManager()
