import type { IBattleSystem } from '@test-battle/interface'
import { Battle } from '@test-battle/battle'
import type { BattleMessage, BattleState, playerId, PlayerSelection } from '@test-battle/const'

export class LocalBattleSystem implements IBattleSystem {
  private generator: Generator<void, void, void>
  constructor(private battle: Battle) {
    this.generator = battle.startBattle()
  }

  init() {
    this.generator.next()
  }

  async getAvailableSelection(playerId: playerId) {
    return this.battle.getAvailableSelection(playerId)
  }

  async submitAction(selection: PlayerSelection) {
    this.battle.setSelection(selection)
    this.generator.next()
  }

  async getState(playerId?: playerId, showHidden = false): Promise<BattleState> {
    return this.battle.getState(playerId, showHidden)
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    this.battle.registerListener(callback)
    return () => {}
  }
}
