import { BattleMessageType } from '@arcadia-eternity/const'
import { InteractivePhase } from '../phase'
import { Context } from '../context'
import type { Battle } from '../battle'

/**
 * SelectionContext for player selection phase
 */
export class SelectionContext extends Context {
  readonly type = 'selection'
  public readonly battle: Battle

  constructor(battle: Battle) {
    super(null)
    this.battle = battle
  }
}

/**
 * SelectionPhase handles player selection operations
 * This is an interactive phase that waits for player input
 */
export class SelectionPhase extends InteractivePhase<SelectionContext> {
  constructor(battle: Battle, id?: string) {
    super(battle, id)
  }

  protected createContext(): SelectionContext {
    return new SelectionContext(this.battle)
  }

  protected async executeOperation(): Promise<void> {
    // Clear previous selections
    this.battle.clearSelections()

    // Emit turn action message
    this.battle.emitMessage(BattleMessageType.TurnAction, {
      player: [this.battle.playerA.id, this.battle.playerB.id],
    })

    // Start new turn timer
    this.battle.timerManager.startNewTurn([this.battle.playerA.id, this.battle.playerB.id])

    // Wait for both players to make selections
    await this.battle.waitForBothPlayersReady()
  }
}
