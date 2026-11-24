import { EffectTrigger } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { RemoveMarkContext, type SwitchPetContext } from '../context'
import type { Pet } from '../pet'
import { SynchronousPhase } from './base'
import { MarkTransferPhase } from './MarkTransferPhase'

export class MarkSwitchOutPhase extends SynchronousPhase<SwitchPetContext> {
  constructor(
    battle: Battle,
    switchContext: SwitchPetContext,
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
    const pet = this.pet
    const battle = this.battle

    battle.applyEffects(context, EffectTrigger.OnOwnerSwitchOut, ...pet.marks)
    pet.marks = pet.marks.filter(mark => {
      const shouldKeep = mark.config.keepOnSwitchOut ?? false

      // Handle marks that need to be transferred
      if (mark.config.transferOnSwitch && context.switchInPet) {
        battle.phaseManager.run(new MarkTransferPhase(battle, context, context.switchInPet, [mark]))
        // Mark should be removed from original pet after transfer
        return false
      } else if (!shouldKeep) {
        battle.removeMark(new RemoveMarkContext(context, mark))
        return false
      }

      return shouldKeep
    })
  }
}
