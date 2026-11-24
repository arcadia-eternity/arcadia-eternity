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
        await battle.phaseManager.runAsync(new SelectionPhase(battle, undefined, true))
      } else {
        // Phase 1: Handle switches (forced and faint switches)
        battle.currentPhase = BattlePhase.SwitchPhase
        const switchPhase = new BattleSwitchPhase(battle, undefined, this.resumePhase === BattlePhase.SwitchPhase)
        this.resumePhase = undefined
        await battle.phaseManager.runAsync(switchPhase)

        battle.assertRunning()
        if (battle.isBattleEnded()) break

        // Phase 2: Collect player actions
        battle.currentPhase = BattlePhase.SelectionPhase
        await battle.phaseManager.runAsync(new SelectionPhase(battle))

        battle.assertRunning()
        if (battle.isBattleEnded()) break
      }
      battle.assertRunning()
      if (battle.isBattleEnded()) break
      // Phase 3: Execute turn
      battle.currentPhase = BattlePhase.ExecutionPhase
      await battle.phaseManager.runAsync(new TurnPhase(battle))

      battle.assertRunning()
      if (battle.isBattleEnded()) break

      // Clear selections for next iteration
      battle.clearSelections()
    }
  }
}
