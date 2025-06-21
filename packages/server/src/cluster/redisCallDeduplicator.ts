import pino from 'pino'

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
})

/**
 * Redis调用去重器
 * 防止短时间内的重复Redis调用，减少Upstash成本
 */
export class RedisCallDeduplicator {
  private pendingCalls = new Map<string, Promise<any>>()
  private callStats = new Map<string, { count: number; lastCall: number }>()
  private readonly dedupTTL: number
  private readonly statsCleanupInterval: number
  private cleanupTimer?: NodeJS.Timeout

  constructor(dedupTTL: number = 1000, statsCleanupInterval: number = 60000) {
    this.dedupTTL = dedupTTL // 去重时间窗口，默认1秒
    this.statsCleanupInterval = statsCleanupInterval // 统计清理间隔，默认1分钟
    this.startStatsCleanup()
  }

  /**
   * 去重执行Redis调用
   * @param key 调用的唯一标识符
   * @param fn 要执行的Redis调用函数
   * @returns Promise结果
   */
  async dedupCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // 检查是否有正在进行的相同调用
    const existingCall = this.pendingCalls.get(key)
    if (existingCall) {
      this.updateStats(key, true)
      logger.debug({ key }, 'Deduplicating Redis call')
      return existingCall as Promise<T>
    }

    // 创建新的调用
    const promise = fn().finally(() => {
      // 延迟清理，防止极短时间内的重复调用
      setTimeout(() => {
        this.pendingCalls.delete(key)
      }, this.dedupTTL)
    })

    this.pendingCalls.set(key, promise)
    this.updateStats(key, false)
    return promise
  }

  /**
   * 批量去重执行Redis调用
   * @param calls 调用配置数组
   * @returns Promise结果数组
   */
  async dedupBatchCalls<T>(calls: Array<{ key: string; fn: () => Promise<T> }>): Promise<T[]> {
    const promises = calls.map(({ key, fn }) => this.dedupCall(key, fn))
    return Promise.all(promises)
  }

  /**
   * 更新调用统计
   */
  private updateStats(key: string, wasDeduplicated: boolean): void {
    const stats = this.callStats.get(key) || { count: 0, lastCall: 0 }
    stats.count += wasDeduplicated ? 0 : 1 // 只统计实际执行的调用
    stats.lastCall = Date.now()
    this.callStats.set(key, stats)
  }

  /**
   * 获取去重统计信息
   */
  getStats(): {
    totalKeys: number
    pendingCalls: number
    callStats: Array<{ key: string; count: number; lastCall: number }>
  } {
    return {
      totalKeys: this.callStats.size,
      pendingCalls: this.pendingCalls.size,
      callStats: Array.from(this.callStats.entries()).map(([key, stats]) => ({
        key,
        count: stats.count,
        lastCall: stats.lastCall,
      })),
    }
  }

  /**
   * 获取节省的调用次数估算
   */
  getSavingsEstimate(): {
    totalCalls: number
    estimatedSavedCalls: number
    savingsPercentage: number
  } {
    const totalCalls = Array.from(this.callStats.values()).reduce((sum, stats) => sum + stats.count, 0)
    const totalKeys = this.callStats.size
    
    // 估算：如果没有去重，每个key平均会被调用更多次
    // 这是一个保守估算，实际节省可能更多
    const estimatedSavedCalls = Math.max(0, totalKeys * 2 - totalCalls)
    const savingsPercentage = totalCalls > 0 ? (estimatedSavedCalls / (totalCalls + estimatedSavedCalls)) * 100 : 0

    return {
      totalCalls,
      estimatedSavedCalls,
      savingsPercentage,
    }
  }

  /**
   * 清理过期的统计数据
   */
  private cleanupStats(): void {
    const now = Date.now()
    const maxAge = 5 * 60 * 1000 // 5分钟

    for (const [key, stats] of this.callStats.entries()) {
      if (now - stats.lastCall > maxAge) {
        this.callStats.delete(key)
      }
    }

    logger.debug(
      {
        remainingKeys: this.callStats.size,
        pendingCalls: this.pendingCalls.size,
      },
      'Cleaned up Redis call deduplicator stats',
    )
  }

  /**
   * 启动统计清理定时器
   */
  private startStatsCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStats()
    }, this.statsCleanupInterval)
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
    this.pendingCalls.clear()
    this.callStats.clear()
  }

  /**
   * 强制清除所有待处理的调用（用于测试或紧急情况）
   */
  forceClearPendingCalls(): void {
    this.pendingCalls.clear()
    logger.warn('Force cleared all pending Redis calls')
  }
}

/**
 * 全局Redis调用去重器实例
 */
export const globalRedisDeduplicator = new RedisCallDeduplicator()

/**
 * 便捷函数：去重执行Redis调用
 */
export function dedupRedisCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return globalRedisDeduplicator.dedupCall(key, fn)
}

/**
 * 便捷函数：批量去重执行Redis调用
 */
export function dedupBatchRedisCall<T>(calls: Array<{ key: string; fn: () => Promise<T> }>): Promise<T[]> {
  return globalRedisDeduplicator.dedupBatchCalls(calls)
}

/**
 * 获取全局去重统计
 */
export function getGlobalRedisDeduplicationStats() {
  return globalRedisDeduplicator.getStats()
}

/**
 * 获取全局去重节省估算
 */
export function getGlobalRedisDeduplicationSavings() {
  return globalRedisDeduplicator.getSavingsEstimate()
}
