import { EffectTrigger, StackStrategy } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { SwitchPetContext, EffectContext, AddMarkContext, StackContext } from '../context'
import type { MarkInstance } from '../mark'
import type { Pet } from '../pet'
import { SynchronousPhase } from '../phase'
import { MarkStackPhase } from './markStack'

/**
 * MarkTransferPhase handles mark transfer operations
 * Replaces MarkSystem.transferMarks logic with proper phase-based execution
 */

export class MarkTransferPhase extends SynchronousPhase<SwitchPetContext | EffectContext<EffectTrigger>> {
  constructor(
    battle: Battle,
    private readonly transferContext: SwitchPetContext | EffectContext<EffectTrigger>,
    private readonly target: Pet | Battle,
    private readonly marks: MarkInstance[],
    id?: string,
  ) {
    super(battle, id)
    this._context = transferContext
  }

  protected createContext() {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the mark transfer operation logic
    executeMarkTransferOperation(context, this.target, this.marks, this.battle)
  }
}
/**
 * Extracted mark transfer operation logic
 * This function contains the core mark transfer logic, replacing MarkSystem.transferMarks
 */

export function executeMarkTransferOperation(
  context: SwitchPetContext | EffectContext<EffectTrigger>,
  target: Pet | Battle,
  marks: MarkInstance[],
  battle: Battle,
): void {
  marks.forEach(mark => {
    mark.detach()
    const existingMark = target.marks.find(m => m.base.id === mark.base.id)
    if (existingMark) {
      // Create EffectContext for stacking
      const effectContext =
        context instanceof EffectContext
          ? context
          : new EffectContext(context, EffectTrigger.OnOwnerSwitchOut, mark, undefined)
      const addMarkContext = new AddMarkContext(
        effectContext,
        target,
        mark.base,
        mark.stack,
        mark.duration,
        mark.config,
      )

      // Use MarkStackPhase for stacking (calculation will be done in the phase)
      const strategy = existingMark.config.stackStrategy || StackStrategy.extend
      const stackPhase = new MarkStackPhase(
        battle,
        new StackContext(
          addMarkContext,
          existingMark,
          mark,
          existingMark.stack,
          existingMark.duration,
          mark.stack, // Initial values, will be calculated in MarkStackPhase
          mark.duration,
          strategy,
        ),
      )
      battle.phaseManager.registerPhase(stackPhase)
      battle.phaseManager.executePhase(stackPhase.id)
    } else {
      // Transfer mark directly
      mark.transfer(context, target)
    }
  })
}
