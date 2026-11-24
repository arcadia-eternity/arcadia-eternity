import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { ContextPhase } from './base'
import { RageContext } from '../context'

export class RagePhase extends ContextPhase<RageContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle

    const before = context.target.currentRage

    switch (context.modifiedType) {
      case 'setting':
        context.target.settingRage(context.value)
        break
      case 'add':
        battle.applyEffects(context, EffectTrigger.BeforeRageGain)
        if (!context.available) {
          context.rageChangeResult = 0
          return
        }
        context.updateRageChangeResult()
        context.target.settingRage(context.target.currentRage + context.rageChangeResult)
        battle.applyEffects(context, EffectTrigger.OnRageGain)
        break
      case 'reduce': {
        battle.applyEffects(context, EffectTrigger.BeforeRageLoss)
        if (!context.available) {
          context.rageChangeResult = 0
          return
        }
        context.updateRageChangeResult()
        const rageBeforePayment = context.target.currentRage
        context.target.settingRage(rageBeforePayment - context.rageChangeResult)
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
