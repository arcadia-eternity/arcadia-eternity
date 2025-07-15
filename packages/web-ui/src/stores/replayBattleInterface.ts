import type {
  BattleState,
  PlayerSelection,
  BattleMessage,
  playerId,
  PlayerTimerState,
  TimerConfig,
  Events,
} from '@arcadia-eternity/const'
import type { IBattleSystem } from '@arcadia-eternity/interface'

/**
 * 回放专用的BattleInterface，模拟观战模式的行为
 * 复用battleInterface的观战逻辑，但适配回放场景
 */
export class ReplayBattleInterface implements IBattleSystem {
  private currentState: BattleState | null = null
  private _viewerId: playerId | undefined
  private eventCallbacks: Array<(message: BattleMessage) => void> = []

  constructor(initialState: BattleState, viewerId?: playerId) {
    this.currentState = initialState
    this._viewerId = viewerId
  }

  async ready(): Promise<void> {
    // 回放模式下无需准备工作
  }

  async getState(_playerId?: playerId, _showHidden?: boolean): Promise<BattleState> {
    if (!this.currentState) {
      throw new Error('No battle state available in replay mode')
    }

    // 在回放模式下，我们已经有了完整的状态
    // 这里可以根据viewerId进行过滤，但目前直接返回完整状态
    return this.currentState
  }

  async getAvailableSelection(_playerId: playerId): Promise<PlayerSelection[]> {
    // 回放模式下没有可用操作
    return []
  }

  async submitAction(_selection: PlayerSelection): Promise<void> {
    // 回放模式下不允许提交操作
    throw new Error('Cannot submit actions in replay mode')
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    this.eventCallbacks.push(callback)

    // 返回取消订阅的函数
    return () => {
      const index = this.eventCallbacks.indexOf(callback)
      if (index > -1) {
        this.eventCallbacks.splice(index, 1)
      }
    }
  }

  // 回放专用方法：更新当前状态
  updateState(newState: BattleState): void {
    this.currentState = newState
  }

  // 回放专用方法：触发事件
  emitEvent(message: BattleMessage): void {
    this.eventCallbacks.forEach(callback => {
      try {
        callback(message)
      } catch (error) {
        console.error('Error in replay battle event callback:', error)
      }
    })
  }

  // 计时器相关方法（回放模式下不需要）
  async isTimerEnabled(): Promise<boolean> {
    return false
  }

  async getPlayerTimerState(_playerId: playerId): Promise<PlayerTimerState | null> {
    return null
  }

  async getAllPlayerTimerStates(): Promise<PlayerTimerState[]> {
    return []
  }

  async getTimerConfig(): Promise<TimerConfig> {
    return {
      enabled: false,
      turnTimeLimit: 0,
      totalTimeLimit: 0,
      animationPauseEnabled: false,
      maxAnimationDuration: 0,
    }
  }

  async startAnimation(_source: string, _expectedDuration: number, _ownerId: playerId): Promise<string> {
    // 回放模式下返回一个虚拟的动画ID
    return `replay-animation-${Date.now()}`
  }

  async endAnimation(_animationId: string, _actualDuration?: number): Promise<void> {
    // 回放模式下无需处理动画结束
  }

  onTimerEvent<K extends keyof Events>(_eventType: K, _handler: (data: Events[K]) => void): () => void {
    // 回放模式下不处理计时器事件
    return () => {}
  }

  offTimerEvent<K extends keyof Events>(_eventType: K, _handler: (data: Events[K]) => void): void {
    // 回放模式下不处理计时器事件
  }

  async cleanup(): Promise<void> {
    this.eventCallbacks = []
    this.currentState = null
  }
}
