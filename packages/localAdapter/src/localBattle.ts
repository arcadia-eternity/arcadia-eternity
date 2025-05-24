import type { IBattleSystem } from '@arcadia-eternity/interface'
import { Battle } from '@arcadia-eternity/battle'
import type { BattleMessage, BattleState, playerId, PlayerSelection } from '@arcadia-eternity/const'

export class LocalBattleSystem implements IBattleSystem {
  private battleStarted: boolean = false
  private battlePromise?: Promise<void>

  constructor(private battle: Battle) {}

  async ready(): Promise<void> {
    if (this.battleStarted) return
    this.battleStarted = true

    // Start the battle asynchronously
    this.battlePromise = this.battle.startBattle().catch(error => {
      console.error('Battle error:', error)
      throw error
    })
  }

  async getAvailableSelection(playerId: playerId) {
    return this.battle.getAvailableSelection(playerId)
  }

  async submitAction(selection: PlayerSelection) {
    this.battle.setSelection(selection)
  }

  async getState(playerId?: playerId, showHidden = false): Promise<BattleState> {
    return this.battle.getState(playerId, true)
  }

  BattleEvent(callback: (message: BattleMessage) => void): () => void {
    this.battle.registerListener(callback)
    return () => {}
  }

  // Get the battle promise for external handling if needed
  getBattlePromise(): Promise<void> | undefined {
    return this.battlePromise
  }
}
