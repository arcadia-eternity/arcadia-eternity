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

/**
 * 开发者功能接口 - 仅在开发模式下可用
 */
export interface IDeveloperBattleSystem {
  /**
   * 设置宠物血量（开发者功能）
   */
  setDevPetHp(petId: string, hp: number): void

  /**
   * 设置玩家怒气（开发者功能）
   */
  setDevPlayerRage(playerId: string, rage: number): void

  /**
   * 强制AI选择（开发者功能）
   */
  forceAISelection(selection: PlayerSelection): void

  /**
   * 获取指定玩家的可用操作（开发者功能）
   */
  getAvailableActionsForPlayer(playerId: string): PlayerSelection[]
}

/**
 * 带开发者功能的战斗系统接口
 */
export interface IBattleSystemWithDev extends IBattleSystem, IDeveloperBattleSystem {}
