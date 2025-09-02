import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { Battle } from '../battle'
import { RemoveMarkContext } from '../context'
import { type MarkInstance, StatLevelMarkInstanceImpl } from '../mark'
import { Pet } from '../pet'
import { SynchronousPhase } from '../phase'

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
  } else {
    // Even if owner is null, we should still try to find and remove the mark from all possible owners
    // This is a fallback mechanism to prevent orphaned marks
    const contextBattle = battle

    if (contextBattle) {
      // Try to find and remove from battle marks
      const battleMarkIndex = contextBattle.marks.findIndex((m: MarkInstance) => m === mark)
      if (battleMarkIndex !== -1) {
        contextBattle.marks.splice(battleMarkIndex, 1)
      }

      // Try to find and remove from pet marks
      ;[contextBattle.playerA.activePet, contextBattle.playerB.activePet].forEach(pet => {
        const petMarkIndex = pet.marks.findIndex((m: MarkInstance) => m === mark)
        if (petMarkIndex !== -1) {
          pet.marks.splice(petMarkIndex, 1)
        }
      })
    }
  }

  // Emit mark destroy message
  battle.emitMessage(BattleMessageType.MarkDestroy, {
    mark: mark.id,
    target: owner instanceof Pet ? owner.id : 'battle',
    baseMarkId: mark.base.id,
  })
}
