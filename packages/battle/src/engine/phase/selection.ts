import { BattleMessageType } from '@arcadia-eternity/const'
import { InteractivePhase } from './base'
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
  constructor(
    battle: Battle,
    id?: string,
    private readonly restored = false,
  ) {
    super(battle, id)
  }

  protected createContext(): SelectionContext {
    return new SelectionContext(this.battle)
  }

  protected async executeOperation(): Promise<void> {
    if (!this.restored) {
      // Clear previous selections
      this.battle.clearSelections()

      this.battle.timerManager.startNewTurn([this.battle.playerA.id, this.battle.playerB.id])

      // Emit turn action message
      this.battle.emitMessage(BattleMessageType.TurnAction, {
        player: [this.battle.playerA.id, this.battle.playerB.id],
      })
    } else {
      this.battle.timerManager.activateRestoredState()
    }
    // Wait for both players to make selections
    await this.battle.waitForBothPlayersReady()
    this.battle.timerManager.finishDecisionPhase()
  }
}
