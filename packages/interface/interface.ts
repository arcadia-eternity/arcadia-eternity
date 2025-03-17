import type { BattleMessage, BattlePhase, BattleState, PlayerSelection } from '@test-battle/const'

export interface IBattleSystem {
  getState(): Promise<BattleState>
  getAvailableSelection(): Promise<PlayerSelection[]>

  submitAction(selection: PlayerSelection): Promise<void>

  BattleEvent(callback: (message: BattleMessage) => void): () => void
}
