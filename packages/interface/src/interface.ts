import type { BattleMessage, BattleState, playerId, PlayerSelection } from '@arcadia-eternity/const'

export interface IBattleSystem {
  ready(): Promise<void>
  getState(playerId?: playerId, showHidden?: boolean): Promise<BattleState>
  getAvailableSelection(playerId: playerId): Promise<PlayerSelection[]>

  submitAction(selection: PlayerSelection): Promise<void>

  BattleEvent(callback: (message: BattleMessage) => void): () => void

  /**
   * Clean up all resources and subscriptions associated with this battle system
   */
  cleanup(): Promise<void>
}
