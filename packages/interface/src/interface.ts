import type {
  BattleMessage,
  BattleState,
  playerId,
  PlayerSelection,
  PlayerTimerState,
  TimerConfig,
  Events,
} from '@arcadia-eternity/const'

export interface IBattleSystem {
  ready(): Promise<void>
  getState(playerId?: playerId, showHidden?: boolean): Promise<BattleState>
  getAvailableSelection(playerId: playerId): Promise<PlayerSelection[]>

  submitAction(selection: PlayerSelection): Promise<void>

  BattleEvent(callback: (message: BattleMessage) => void): () => void

  // 计时器相关方法
  isTimerEnabled(): Promise<boolean>
  getPlayerTimerState(playerId: playerId): Promise<PlayerTimerState | null>
  getAllPlayerTimerStates(): Promise<PlayerTimerState[]>
  getTimerConfig(): Promise<TimerConfig>
  startAnimation(source: string, expectedDuration: number, ownerId: playerId): Promise<string>
  endAnimation(animationId: string, actualDuration?: number): Promise<void>

  // 计时器事件监听方法
  onTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void
  offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void

  /**
   * Clean up all resources and subscriptions associated with this battle system
   */
  cleanup(): Promise<void>
}
