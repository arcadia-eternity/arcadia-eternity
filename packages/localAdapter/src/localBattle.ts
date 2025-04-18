import type { IBattleSystem } from '@arcadia-eternity/interface'
import { Battle } from '@arcadia-eternity/battle'
import type { BattleMessage, BattleState, playerId, PlayerSelection } from '@arcadia-eternity/const'

export class LocalBattleSystem implements IBattleSystem {
  private generator: Generator<void, void, void>
  private inited: boolean = false
  constructor(private battle: Battle) {
    this.generator = battle.startBattle()
  }

  init() {
    if (this.inited) return
    this.generator.next()
    this.inited = true
  }

  async getAvailableSelection(playerId: playerId) {
    return this.battle.getAvailableSelection(playerId)
  }

  async submitAction(selection: PlayerSelection) {
    this.battle.setSelection(selection)
    this.generator.next()
  }

  async getState(playerId?: playerId, showHidden = false): Promise<BattleState> {
    return this.battle.getState(playerId, true)
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    this.battle.registerListener(callback)
    return () => {}
  }
}
