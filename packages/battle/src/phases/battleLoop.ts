import { BattlePhase } from '@arcadia-eternity/const'
import { InteractivePhase } from '../phase'
import { BattleSwitchPhase } from './battleSwitch'
import { SelectionPhase } from './selection'
import { TurnPhase } from './turn'
import type { Battle } from '../battle'
import type { Context } from '../context'

/**
 * BattleLoopPhase manages the main battle loop after initialization
 * This phase replaces the while loop logic in startBattle method
 * It continuously executes Switch -> Selection -> Execution phases until battle ends
 *
 * This is an InteractivePhase because it contains SelectionPhase which requires async execution
 */
export class BattleLoopPhase extends InteractivePhase<Context> {
  constructor(battle: Battle, id?: string) {
    super(battle, id)
  }

  protected createContext(): Context {
    // Use battle as context since this is a top-level loop phase
    return this.battle
  }

  protected async executeOperation(): Promise<void> {
    const battle = this.battle

    // Main battle loop - continues until battle ends
    while (true) {
      // Phase 1: Handle switches (forced and faint switches)
      battle.currentPhase = BattlePhase.SwitchPhase
      const switchPhase = new BattleSwitchPhase(battle)
      battle.phaseManager.registerPhase(switchPhase)

      // Execute switch phase
      await battle.phaseManager.executePhaseAsync(switchPhase.id)

      if (battle.isBattleEnded()) break

      // Phase 2: Collect player actions
      battle.currentPhase = BattlePhase.SelectionPhase
      const selectionPhase = new SelectionPhase(battle)
      battle.phaseManager.registerPhase(selectionPhase)

      // Execute selection phase (async)
      await battle.phaseManager.executePhaseAsync(selectionPhase.id)

      // Phase 3: Execute turn
      battle.currentPhase = BattlePhase.ExecutionPhase
      const turnPhase = new TurnPhase(battle)
      battle.phaseManager.registerPhase(turnPhase)

      // Execute turn phase
      await battle.phaseManager.executePhaseAsync(turnPhase.id)

      if (battle.isBattleEnded()) break

      // Clear selections for next iteration
      battle.clearSelections()
    }
  }
}
