import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { ContextPhase } from './base'
import { RageContext } from '../context'

export function changeRage(context: RageContext): void {
  context.battle.phaseManager.run(new RagePhase(context))
}

class RagePhase extends ContextPhase<RageContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle

    const before = context.target.currentRage

    switch (context.modifiedType) {
      case 'setting':
        context.target.currentRage = context.value
        break
      case 'add':
        battle.applyEffects(context, EffectTrigger.BeforeRageGain)
        if (!context.available) {
          context.rageChangeResult = 0
          return
        }
        context.rageChangeResult = calculateRageChange(context)
        context.target.currentRage += context.rageChangeResult
        battle.applyEffects(context, EffectTrigger.OnRageGain)
        break
      case 'reduce': {
        battle.applyEffects(context, EffectTrigger.BeforeRageLoss)
        if (!context.available) {
          context.rageChangeResult = 0
          return
        }
        context.rageChangeResult = calculateRageChange(context)
        const rageBeforePayment = context.target.currentRage
        context.target.currentRage = rageBeforePayment - context.rageChangeResult
        context.rageSpent = Math.max(0, rageBeforePayment - context.target.currentRage)
        battle.applyEffects(context, EffectTrigger.OnRageLoss)
        break
      }
    }

    battle.emitMessage(BattleMessageType.RageChange, {
      player: context.target.id,
      pet: context.target.activePet.id,
      before: before,
      after: context.target.currentRage,
      reason: context.reason,
    })
  }
}

function calculateRageChange(context: RageContext): number {
  const [percent, delta] = context.modified
  const amount = context.value * (1 + percent / 100) + delta
  const limited = context.modifiedType === 'add' ? Math.min(amount, context.gainLimit) : amount
  return context.rounding === 'floor' ? Math.floor(limited) : limited
}
