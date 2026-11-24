import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { RemoveMarkContext } from '../context'
import { StatLevelMarkInstanceImpl } from '../mark'
import { Pet } from '../pet'
import { ContextPhase } from './base'

export class RemoveMarkPhase extends ContextPhase<RemoveMarkContext> {
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

    // Clean up attribute modifiers before destroying the mark
    mark.cleanupAttributeModifiers()

    // Special cleanup for StatLevelMarkInstanceImpl
    if (mark instanceof StatLevelMarkInstanceImpl) {
      // Clean up the stat stage modifier
      mark.cleanupStatStageModifier()
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
