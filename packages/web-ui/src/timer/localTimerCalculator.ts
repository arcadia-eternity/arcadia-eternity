import {
  type TimerSnapshot,
  type playerId,
  TimerState,
  TIMER_CONSTANTS,
} from '@arcadia-eternity/const'

/**
 * 本地Timer计算器
 * 基于服务器发送的Timer快照，在前端本地计算实时的倒计时
 * 减少对服务器的频繁请求，提供流畅的用户体验
 */
export class LocalTimerCalculator {
  private snapshots = new Map<playerId, TimerSnapshot>()
  private updateTimer?: ReturnType<typeof setInterval>
  private listeners = new Map<string, Set<(snapshot: TimerSnapshot) => void>>()
  private isRunning = false

  constructor() {
    this.startUpdateLoop()
  }

  /**
   * 更新Timer快照
   */
  public updateSnapshots(snapshots: TimerSnapshot[]): void {
    snapshots.forEach(snapshot => {
      this.snapshots.set(snapshot.playerId, { ...snapshot })
    })
  }

  /**
   * 获取玩家的实时Timer状态
   */
  public getPlayerTimerState(playerId: playerId): TimerSnapshot | null {
    const snapshot = this.snapshots.get(playerId)
    if (!snapshot) {
      return null
    }

    // 检查config是否存在，如果不存在则返回null避免错误
    if (!snapshot.config) {
      console.warn(`Timer snapshot for player ${playerId} has missing config, skipping`)
      return null
    }

    // 如果Timer未启用，直接返回快照
    if (!snapshot.config.enabled) {
      return snapshot
    }

    // 计算实时状态
    return this.calculateRealTimeState(snapshot)
  }

  /**
   * 获取所有玩家的实时Timer状态
   */
  public getAllPlayerTimerStates(): TimerSnapshot[] {
    return Array.from(this.snapshots.values())
      .filter(snapshot => {
        if (!snapshot.config) {
          console.warn(`Timer snapshot for player ${snapshot.playerId} has missing config, filtering out`)
          return false
        }
        return true
      })
      .map(snapshot => {
        if (!snapshot.config.enabled) {
          return snapshot
        }
        return this.calculateRealTimeState(snapshot)
      })
  }

  /**
   * 监听玩家Timer状态变化
   */
  public onPlayerTimerUpdate(playerId: playerId, callback: (snapshot: TimerSnapshot) => void): () => void {
    const key = `player:${playerId}`
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(callback)

    return () => {
      const listeners = this.listeners.get(key)
      if (listeners) {
        listeners.delete(callback)
        if (listeners.size === 0) {
          this.listeners.delete(key)
        }
      }
    }
  }

  /**
   * 监听所有Timer状态变化
   */
  public onTimerUpdate(callback: (snapshots: TimerSnapshot[]) => void): () => void {
    const key = 'all'
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set())
    }
    this.listeners.get(key)!.add(callback as any)

    return () => {
      const listeners = this.listeners.get(key)
      if (listeners) {
        listeners.delete(callback as any)
        if (listeners.size === 0) {
          this.listeners.delete(key)
        }
      }
    }
  }

  /**
   * 计算实时Timer状态
   */
  private calculateRealTimeState(snapshot: TimerSnapshot): TimerSnapshot {
    const now = Date.now()
    const elapsed = (now - snapshot.timestamp) / 1000 // 转换为秒

    // 如果Timer不在运行状态，或者有活跃动画，不推进时间
    if (snapshot.state !== TimerState.Running || snapshot.hasActiveAnimations) {
      return {
        ...snapshot,
        timestamp: now, // 更新时间戳
      }
    }

    // 计算剩余时间
    let remainingTurnTime = snapshot.remainingTurnTime
    let remainingTotalTime = snapshot.remainingTotalTime

    // 只有在设置了时间限制时才减少时间
    if (snapshot.config.turnTimeLimit && remainingTurnTime > 0) {
      remainingTurnTime = Math.max(0, remainingTurnTime - elapsed)
    }
    if (snapshot.config.totalTimeLimit && remainingTotalTime > 0) {
      remainingTotalTime = Math.max(0, remainingTotalTime - elapsed)
    }

    return {
      ...snapshot,
      timestamp: now,
      remainingTurnTime,
      remainingTotalTime,
    }
  }

  /**
   * 开始更新循环
   */
  private startUpdateLoop(): void {
    if (this.isRunning) return

    this.isRunning = true
    this.updateTimer = setInterval(() => {
      this.emitUpdates()
    }, TIMER_CONSTANTS.LOCAL_CALCULATOR_INTERVAL)
  }

  /**
   * 停止更新循环
   */
  private stopUpdateLoop(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = undefined
    }
    this.isRunning = false
  }

  /**
   * 发送更新事件
   */
  private emitUpdates(): void {
    // 发送单个玩家更新
    this.snapshots.forEach((snapshot, playerId) => {
      const key = `player:${playerId}`
      const listeners = this.listeners.get(key)
      if (listeners && listeners.size > 0) {
        const realTimeState = this.getPlayerTimerState(playerId)
        if (realTimeState) {
          listeners.forEach(callback => callback(realTimeState))
        }
      }
    })

    // 发送全局更新
    const allListeners = this.listeners.get('all')
    if (allListeners && allListeners.size > 0) {
      const allStates = this.getAllPlayerTimerStates()
      allListeners.forEach(callback => (callback as any)(allStates))
    }
  }

  /**
   * 检查是否有活跃的Timer
   */
  public hasActiveTimers(): boolean {
    return Array.from(this.snapshots.values()).some(
      snapshot => snapshot.config && snapshot.config.enabled && snapshot.state === TimerState.Running
    )
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    this.stopUpdateLoop()
    this.snapshots.clear()
    this.listeners.clear()
  }

  /**
   * 获取统计信息
   */
  public getStats(): {
    snapshotCount: number
    listenerCount: number
    isRunning: boolean
  } {
    let listenerCount = 0
    this.listeners.forEach(listeners => {
      listenerCount += listeners.size
    })

    return {
      snapshotCount: this.snapshots.size,
      listenerCount,
      isRunning: this.isRunning,
    }
  }
}
