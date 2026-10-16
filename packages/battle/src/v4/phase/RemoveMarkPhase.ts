import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { RemoveMarkContext } from '../context'
import { type MarkInstance, StatLevelMarkInstanceImpl } from '../mark'
import { Pet } from '../pet'
import { SynchronousPhase } from './base'

/**
 * RemoveMarkPhase handles mark removal operations
 * Corresponds to RemoveMarkContext and replaces mark removal logic
 */

export class RemoveMarkPhase extends SynchronousPhase<RemoveMarkContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: any, // EffectContext, DamageContext, AddMarkContext, or TurnContext
    private readonly mark: MarkInstance,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): RemoveMarkContext {
    return new RemoveMarkContext(this.parentContext, this.mark)
  }

  protected executeOperation(): void {
    const context = this._context!

    // Execute the remove mark operation logic
    executeRemoveMarkOperation(context, this.battle)
  }
}
/**
 * Extracted remove mark operation logic
 * This function contains the core mark removal logic, replacing MarkSystem.removeMark
 * and MarkInstance.destroy logic
 */

export function executeRemoveMarkOperation(context: RemoveMarkContext, battle: Battle): void {
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

  // Emit mark destroy message
  battle.emitMessage(BattleMessageType.MarkDestroy, {
    mark: mark.id,
    target: owner instanceof Pet ? owner.id : 'battle',
  })
}
