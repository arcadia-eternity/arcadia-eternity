import { matchesMarkApplication } from './AddMarkPhase'
import { EffectTrigger, StackStrategy } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { SwitchPetContext, EffectContext, AddMarkContext, StackContext } from '../context'
import type { MarkInstance } from '../mark'
import type { Pet } from '../pet'
import { SynchronousPhase } from './base'
import { MarkStackPhase } from './MarkStackPhase'
import { isOwnerContribution } from '../content/owner-contributions'

export class MarkTransferPhase extends SynchronousPhase<SwitchPetContext | EffectContext<EffectTrigger>> {
  constructor(
    battle: Battle,
    transferContext: SwitchPetContext | EffectContext<EffectTrigger>,
    private readonly target: Pet | Battle,
    private readonly marks: MarkInstance[],
    id?: string,
  ) {
    super(battle, id)
    this._context = transferContext
  }

  protected createContext(): SwitchPetContext | EffectContext<EffectTrigger> {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!
    const target = this.target
    const marks = this.marks
    const battle = this.battle

    marks.forEach(mark => {
      if (!mark.isActive || !mark.owner) return
      mark.cleanupOwnerContributions()
      mark.detach()
      const existingMark = target.marks.find(m => matchesMarkApplication(m, mark.base, mark.deferredDamage))
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
        battle.phaseManager.run(stackPhase)
        // The incoming instance has been merged and may still be in this turn's update list.
        mark.isActive = false
        mark.deferredDamage = undefined
        battle.configSystem.releaseScope(mark)
      } else {
        // Transfer mark directly
        mark.transfer(context, target)
        // Rebuild only trusted owner-bound contributions. No OnMarkCreated/OnAnyMarkAdded event is replayed.
        const sourceContext =
          context instanceof EffectContext ? context : new EffectContext(context, EffectTrigger.OnOwnerSwitchOut, mark)
        const creation = new AddMarkContext(sourceContext, target, mark.base, mark.stack, mark.duration, mark.config)
        for (const effect of mark.effects.filter(isOwnerContribution)) {
          const frame = new EffectContext(creation, EffectTrigger.OnMarkCreated, mark, effect)
          const actions = Array.isArray(effect.apply) ? effect.apply : [effect.apply]
          for (const apply of actions)
            battle.executionBudget.action(battle.currentTurn, () => apply.call(effect, frame))
        }
      }
    })
  }
}
