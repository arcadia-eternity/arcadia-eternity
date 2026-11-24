import { addStatStage } from './AddMarkPhase'
import {
  EffectTrigger,
  BattleMessageType,
  type CleanStageStrategy,
  type StatTypeWithoutHp,
} from '@arcadia-eternity/const'
import { RemoveMarkContext, type EffectContext } from '../context'
import { StatLevelMarkInstanceImpl } from '../mark'
import { Pet } from '../pet'
import { ContextPhase } from './base'

export function removeMark(context: RemoveMarkContext): void {
  context.battle.phaseManager.run(new RemoveMarkPhase(context))
}

class RemoveMarkPhase extends ContextPhase<RemoveMarkContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle

    const mark = context.mark

    // Check if mark can be destroyed
    if (!mark.isActive || !mark.config.destroyable) return

    // Store owner info before clearing it
    const owner = mark.owner

    // Apply effects before destroying the mark
    battle.applyEffects(context, EffectTrigger.OnMarkDestroy, mark)
    battle.applyEffects(context, EffectTrigger.OnRemoveMark)

    // Mark as inactive
    mark.isActive = false
    mark.deferredDamage = undefined

    mark.attributeModifierCleanups.forEach(cleanup => cleanup())
    mark.attributeModifierCleanups.length = 0
    if (mark.owner instanceof Pet) mark.owner.attributeSystem.removeModifiersFromSource(mark.id)
    if (mark instanceof StatLevelMarkInstanceImpl) {
      unbindStatStage(mark)
    }

    // Clean up any transformations caused by this mark
    battle.transformationSystem.cleanupMarkTransformations(mark)

    // Remove mark from owner's marks array
    if (owner) {
      owner.marks = owner.marks.filter(m => m !== mark)
      mark.owner = null
    }

    battle.configSystem.releaseScope(mark)

    // Emit mark destroy message
    battle.emitMessage(BattleMessageType.MarkDestroy, {
      mark: mark.id,
      baseMarkId: mark.baseId,
      target: owner instanceof Pet ? owner.id : 'battle',
    })
  }
}

export function unbindStatStage(mark: StatLevelMarkInstanceImpl): void {
  mark.modifierCleanupFn?.()
  mark.modifierCleanupFn = undefined
}

export function reverseStatStages(
  context: EffectContext<EffectTrigger>,
  target: Pet,
  strategy: CleanStageStrategy,
  stats: StatTypeWithoutHp[],
): void {
  for (const mark of target.getClearableStatStageMarks(strategy, ...stats)) {
    const level = mark.level
    removeMark(new RemoveMarkContext(context, mark))
    addStatStage(context, target, mark.statType, -level)
  }
}
