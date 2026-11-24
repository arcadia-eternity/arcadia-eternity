import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { RemoveMarkContext, ConsumeStackContext, type EffectContext, type DamageContext } from '../context'
import type { MarkInstance } from '../mark'
import { Pet } from '../pet'
import { SynchronousPhase } from './base'

export class ConsumeStackPhase extends SynchronousPhase<ConsumeStackContext> {
  constructor(
    battle: Battle,
    private readonly parentContext: EffectContext<EffectTrigger> | DamageContext,
    private readonly mark: MarkInstance,
    private readonly requestedAmount: number,
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): ConsumeStackContext {
    return new ConsumeStackContext(this.parentContext, this.mark, this.requestedAmount, this.requestedAmount)
  }

  protected executeOperation(): void {
    const context = this._context!
    const battle = this.battle

    const mark = context.mark

    // Check if mark is active
    if (!mark.isActive) {
      context.setActualAmount(0)
      return
    }

    // Apply OnBeforeConsumeStack effects to potentially prevent or modify consumption
    battle.applyEffects(context, EffectTrigger.OnBeforeConsumeStack)

    if (!context.available) {
      // Consumption was prevented
      context.setActualAmount(0)
      return
    }

    // Calculate actual consumption amount (may have been modified by effects)
    const actualAmount = Math.min(context.actualAmount, mark.stack)
    context.setActualAmount(actualAmount)

    // Apply OnConsumeStack effects for any side effects
    battle.applyEffects(context, EffectTrigger.OnConsumeStack)

    // Perform the actual consumption
    mark.stack -= actualAmount

    // Emit consumption message
    battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: mark.owner instanceof Pet ? mark.owner.id : 'battle',
      mark: mark.toMessage(),
    })

    // Check if mark should be destroyed
    if (mark.stack <= 0) {
      context.battle.removeMark(new RemoveMarkContext(context.parent, context.mark))
    }
  }
}
