import {
  type playerId,
  type TimerConfig,
  TimerState,
  TimeoutType,
  type PlayerTimerState,
  type TimerEvent,
  TimerEventType,
  type TimerSnapshot,
  TIMER_CONSTANTS,
} from '@arcadia-eternity/const'
import mitt, { type Emitter } from 'mitt'
import { createChildLogger } from '../logger'

type BattleTimerEvents = {
  timerEvent: TimerEvent
}

/**
 * 单个玩家的战斗计时器
 * 管理回合时间和总思考时间
 */
export class BattleTimer {
  private readonly logger = createChildLogger('BattleTimer')
  private state: TimerState = TimerState.Stopped
  private remainingTurnTime: number = 0
  private remainingTotalTime: number
  private lastUpdateTime: number = 0
  private updateTimer?: ReturnType<typeof setTimeout>
  private pauseStartTime?: number
  private totalPausedTime: number = 0
  private emitter: Emitter<BattleTimerEvents> = mitt<BattleTimerEvents>()
  private hasActiveAnimationsCallback?: () => boolean // 检查是否有活跃动画的回调

  // 新增：用于减少事件发送频率的状态跟踪
  private lastEmittedState: TimerState = TimerState.Stopped
  private lastSnapshotTime: number = 0
  private pauseReason?: 'animation' | 'system'

  constructor(
    private readonly playerId: playerId,
    private readonly config: TimerConfig,
  ) {
    this.remainingTotalTime = config.totalTimeLimit || Infinity
  }

  /**
   * 设置检查活跃动画的回调函数
   */
  public setHasActiveAnimationsCallback(callback: () => boolean): void {
    this.hasActiveAnimationsCallback = callback
  }

  /**
   * 开始新回合计时
   */
  public startTurn(): void {
    if (!this.config.enabled) return

    this.remainingTurnTime = this.config.turnTimeLimit || Infinity
    this.state = TimerState.Running
    this.pauseReason = undefined
    this.lastUpdateTime = Date.now()
    this.totalPausedTime = 0
    this.pauseStartTime = undefined

    this.startUpdateTimer()
    this.emitStateChangeIfNeeded()
    this.emitEvent(TimerEventType.Start)
  }

  /**
   * 重置回合时间并启动计时器
   */
  public resetTurn(): void {
    if (!this.config.enabled) return

    this.remainingTurnTime = this.config.turnTimeLimit || Infinity
    this.state = TimerState.Running
    this.pauseReason = undefined
    this.lastUpdateTime = Date.now()
    this.totalPausedTime = 0
    this.pauseStartTime = undefined

    this.startUpdateTimer()
    this.emitStateChangeIfNeeded()
    this.emitEvent(TimerEventType.Start)
  }

  /**
   * 暂停计时器
   */
  public pause(reason: 'animation' | 'system' = 'system'): void {
    if (this.state !== TimerState.Running) return

    this.state = TimerState.Paused
    this.pauseReason = reason
    this.pauseStartTime = Date.now()
    this.stopUpdateTimer()

    this.emitStateChangeIfNeeded()
    this.emitEvent(TimerEventType.Pause, { reason })
  }

  /**
   * 恢复计时器
   */
  public resume(): void {
    // 允许从暂停状态或超时状态恢复（动画超时不应该阻止计时器恢复）
    if (this.state !== TimerState.Paused && this.state !== TimerState.Timeout) return

    // 计算暂停时间
    if (this.pauseStartTime) {
      this.totalPausedTime += Date.now() - this.pauseStartTime
      this.pauseStartTime = undefined
    }

    this.state = TimerState.Running
    this.pauseReason = undefined
    this.lastUpdateTime = Date.now()
    this.startUpdateTimer()

    this.emitStateChangeIfNeeded()
    this.emitEvent(TimerEventType.Resume)
  }

  /**
   * 停止计时器
   */
  public stop(): void {
    this.state = TimerState.Stopped
    this.stopUpdateTimer()
    this.pauseStartTime = undefined
    this.totalPausedTime = 0

    this.emitEvent(TimerEventType.Stop)
  }

  /**
   * 强制超时
   */
  public forceTimeout(type: TimeoutType): void {
    this.state = TimerState.Timeout
    this.stopUpdateTimer()

    this.emitEvent(TimerEventType.Timeout, { type })
  }

  /**
   * 获取当前状态
   */
  public getState(): PlayerTimerState {
    // 如果正在运行，更新时间
    if (this.state === TimerState.Running) {
      this.updateTime()
    }

    return {
      playerId: this.playerId,
      state: this.state,
      remainingTurnTime: Math.max(0, this.remainingTurnTime),
      remainingTotalTime: Math.max(0, this.remainingTotalTime),
      lastUpdateTime: this.lastUpdateTime,
    }
  }

  /**
   * 检查是否超时
   */
  public isTimeout(): { timeout: boolean; type?: TimeoutType } {
    // 只有在设置了总时间限制且时间用完时才算总时间超时
    if (this.config.totalTimeLimit && this.remainingTotalTime <= 0) {
      return { timeout: true, type: TimeoutType.Total }
    }
    // 只有在设置了回合时间限制且时间用完时才算回合超时
    if (this.config.turnTimeLimit && this.remainingTurnTime <= 0 && this.state === TimerState.Running) {
      return { timeout: true, type: TimeoutType.Turn }
    }
    return { timeout: false }
  }

  /**
   * 获取玩家ID
   */
  public getPlayerId(): playerId {
    return this.playerId
  }

  /**
   * 检查是否启用
   */
  public isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * 开始更新定时器 - 重构后减少事件发送频率
   */
  private startUpdateTimer(): void {
    this.stopUpdateTimer()
    this.updateTimer = setInterval(() => {
      this.updateTime()
      this.checkTimeout()
      // 新架构：只在必要时发送Update事件，大部分情况下由前端本地计算
      // 只有在接近超时或状态变化时才发送更新
      this.emitUpdateIfNeeded()
    }, TIMER_CONSTANTS.UPDATE_INTERVAL)
  }

  /**
   * 停止更新定时器
   */
  private stopUpdateTimer(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = undefined
    }
  }

  /**
   * 更新时间
   */
  private updateTime(): void {
    if (this.state !== TimerState.Running) return

    const now = Date.now()

    // 如果有活跃动画，不推进计时器但更新时间戳
    if (this.hasActiveAnimationsCallback && this.hasActiveAnimationsCallback()) {
      this.logger.debug(`player ${this.playerId} - skipping time update due to active animations`)
      // 更新时间戳以避免动画结束后时间跳跃
      this.lastUpdateTime = now
      return
    }

    const elapsed = (now - this.lastUpdateTime) / 1000 // 转换为秒

    // 只有在设置了时间限制时才减少时间
    if (this.config.turnTimeLimit) {
      this.remainingTurnTime = Math.max(0, this.remainingTurnTime - elapsed)
    }
    if (this.config.totalTimeLimit) {
      this.remainingTotalTime = Math.max(0, this.remainingTotalTime - elapsed)
    }
    this.lastUpdateTime = now
  }

  /**
   * 检查超时
   */
  private checkTimeout(): void {
    const timeoutCheck = this.isTimeout()
    if (timeoutCheck.timeout && timeoutCheck.type) {
      this.forceTimeout(timeoutCheck.type)
    }
  }

  /**
   * 事件监听方法
   */
  public on<K extends keyof BattleTimerEvents>(type: K, handler: (event: BattleTimerEvents[K]) => void): void {
    this.emitter.on(type, handler)
  }

  public off<K extends keyof BattleTimerEvents>(type: K, handler: (event: BattleTimerEvents[K]) => void): void {
    this.emitter.off(type, handler)
  }

  /**
   * 发送事件
   */
  private emitEvent(type: TimerEventType, data?: any): void {
    const event: TimerEvent = {
      type,
      playerId: this.playerId,
      data,
      timestamp: Date.now(),
    }
    this.emitter.emit('timerEvent', event)
  }

  /**
   * 创建Timer快照 - 包含前端本地计算所需的所有信息
   */
  public createSnapshot(): TimerSnapshot {
    // 确保获取最新状态
    if (this.state === TimerState.Running) {
      this.updateTime()
    }

    return {
      timestamp: Date.now(),
      playerId: this.playerId,
      state: this.state,
      remainingTurnTime: Math.max(0, this.remainingTurnTime),
      remainingTotalTime: Math.max(0, this.remainingTotalTime),
      config: this.config,
      hasActiveAnimations: this.hasActiveAnimationsCallback ? this.hasActiveAnimationsCallback() : false,
      pauseReason: this.pauseReason,
    }
  }

  /**
   * 检查是否需要发送状态变化事件
   */
  private emitStateChangeIfNeeded(): void {
    if (this.state !== this.lastEmittedState) {
      this.emitEvent(TimerEventType.StateChange, {
        oldState: this.lastEmittedState,
        newState: this.state,
      })
      this.lastEmittedState = this.state
    }
  }

  /**
   * 检查是否需要发送更新事件 - 减少频繁更新
   */
  private emitUpdateIfNeeded(): void {
    const now = Date.now()
    const timeSinceLastSnapshot = now - this.lastSnapshotTime

    // 只在以下情况发送更新事件：
    // 1. 距离上次快照超过5秒
    // 2. 剩余时间少于10秒（接近超时）
    // 3. 状态发生变化
    const shouldEmitUpdate =
      timeSinceLastSnapshot > 5000 ||
      (this.config.turnTimeLimit && this.remainingTurnTime <= 10) ||
      (this.config.totalTimeLimit && this.remainingTotalTime <= 30) ||
      this.state !== this.lastEmittedState

    if (shouldEmitUpdate) {
      this.emitEvent(TimerEventType.Update)
      this.lastSnapshotTime = now
      this.emitStateChangeIfNeeded()
    }
  }

  /**
   * 清理资源
   */
  public cleanup(): void {
    this.stop()
    this.emitter.all.clear()
  }
}
