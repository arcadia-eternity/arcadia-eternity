import { removeMark } from './RemoveMarkPhase'
import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { RemoveMarkContext, ConsumeStackContext, type EffectContext, type DamageContext } from '../context'
import type { MarkInstance } from '../mark'
import { Pet } from '../pet'
import { ContextPhase } from './base'

export function consumeMarkStacks(
  parent: EffectContext<EffectTrigger> | DamageContext,
  mark: MarkInstance,
  amount: number,
): number {
  const event = new ConsumeStackContext(parent, mark, amount, amount)
  return parent.battle.phaseManager.run(new ConsumeStackPhase(event)).success ? event.actualAmount : 0
}

class ConsumeStackPhase extends ContextPhase<ConsumeStackContext> {
  protected executeOperation(): void {
    const context = this.event
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
      removeMark(new RemoveMarkContext(context.parent, context.mark))
    }
  }
}
