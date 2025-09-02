import { EffectTrigger } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import type { SwitchPetContext } from '../context'
import type { Pet } from '../pet'
import { SynchronousPhase } from '../phase'
import { MarkTransferPhase } from './markTransfer'
import { RemoveMarkPhase } from './removeMark'

/**
 * MarkSwitchOutPhase handles mark switch out operations
 * Replaces MarkSystem.handleSwitchOut logic with proper phase-based execution
 */

export class MarkSwitchOutPhase extends SynchronousPhase<SwitchPetContext> {
  constructor(
    battle: Battle,
    private readonly switchContext: SwitchPetContext,
    private readonly pet: Pet,
    id?: string,
  ) {
    super(battle, id)
    this._context = switchContext
  }

  protected createContext(): SwitchPetContext {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the mark switch out operation logic
    executeMarkSwitchOutOperation(context, this.pet, this.battle)
  }
}
/**
 * Extracted mark switch out operation logic
 * This function contains the core mark switch out logic, replacing MarkSystem.handleSwitchOut
 */

export function executeMarkSwitchOutOperation(context: SwitchPetContext, pet: Pet, battle: Battle): void {
  battle.applyEffects(context, EffectTrigger.OnOwnerSwitchOut, ...pet.marks)
  pet.marks = pet.marks.filter(mark => {
    const shouldKeep = mark.config.keepOnSwitchOut ?? false

    // Handle marks that need to be transferred
    if (mark.config.transferOnSwitch && (context as any).switchInPet) {
      const transferPhase = new MarkTransferPhase(battle, context, (context as any).switchInPet, [mark])
      battle.phaseManager.registerPhase(transferPhase)
      battle.phaseManager.executePhase(transferPhase.id)
      // Mark should be removed from original pet after transfer
      return false
    } else if (!shouldKeep) {
      const removePhase = new RemoveMarkPhase(battle, context, mark)
      battle.phaseManager.registerPhase(removePhase)
      battle.phaseManager.executePhase(removePhase.id)
      return false
    }

    return shouldKeep
  })
}
