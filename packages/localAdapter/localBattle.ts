import type { IBattleSystem } from '@test-battle/interface'
import { Battle, Player } from '@test-battle/battle'
import { BattleMessage, BattleState, PlayerSelection } from '../const'

export class LocalBattleSystem implements IBattleSystem {
  constructor(
    private battle: Battle,
    private player: Player,
  ) {}

  async getAvailableSelection() {
    return this.player.getAvailableSelection()
  }

  async submitAction(selection: PlayerSelection) {
    this.player.setSelection(selection)
  }

  async getState(): Promise<BattleState> {
    return this.player.getState()
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    this.player.registerListener(callback)
    return () => {}
  }
}
