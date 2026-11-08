import { BattlePhase } from '@arcadia-eternity/const'
import { InteractivePhase } from './base'
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
  constructor(
    battle: Battle,
    id?: string,
    private resumePhase?: BattlePhase.SelectionPhase | BattlePhase.SwitchPhase,
  ) {
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
      battle.assertRunning()
      if (this.resumePhase === BattlePhase.SelectionPhase) {
        this.resumePhase = undefined
        const selection = new SelectionPhase(battle, undefined, true)
        battle.phaseManager.registerPhase(selection)
        await battle.phaseManager.executePhaseAsync(selection.id)
      } else {
        // Phase 1: Handle switches (forced and faint switches)
        battle.currentPhase = BattlePhase.SwitchPhase
        const switchPhase = new BattleSwitchPhase(battle, undefined, this.resumePhase === BattlePhase.SwitchPhase)
        this.resumePhase = undefined
        battle.phaseManager.registerPhase(switchPhase)

        // Execute switch phase
        await battle.phaseManager.executePhaseAsync(switchPhase.id)

        battle.assertRunning()
        if (battle.isBattleEnded()) break

        // Phase 2: Collect player actions
        battle.currentPhase = BattlePhase.SelectionPhase
        const selectionPhase = new SelectionPhase(battle)
        battle.phaseManager.registerPhase(selectionPhase)

        // Execute selection phase (async)
        await battle.phaseManager.executePhaseAsync(selectionPhase.id)

        battle.assertRunning()
        if (battle.isBattleEnded()) break
      }
      battle.assertRunning()
      if (battle.isBattleEnded()) break
      // Phase 3: Execute turn
      battle.currentPhase = BattlePhase.ExecutionPhase
      const turnPhase = new TurnPhase(battle)
      battle.phaseManager.registerPhase(turnPhase)

      // Execute turn phase
      await battle.phaseManager.executePhaseAsync(turnPhase.id)

      battle.assertRunning()
      if (battle.isBattleEnded()) break

      // Clear selections for next iteration
      battle.clearSelections()
    }
  }
}
