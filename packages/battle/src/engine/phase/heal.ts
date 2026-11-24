import { EffectTrigger, BattleMessageType } from '@arcadia-eternity/const'
import { ContextPhase } from './base'
import { HealContext } from '../context'
import type { Battle } from '../battle'

export class HealPhase extends ContextPhase<HealContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle

    const hp = prepareHeal(context, battle)
    if (hp === undefined) return
    context.target.currentHp = hp
    notifyHeal(context, battle)
  }
}

export function prepareHeal(context: HealContext, battle: Battle): number | undefined {
  battle.applyEffects(context, EffectTrigger.OnBeforeHeal)
  context.updateHealResult()

  if (!context.available || !context.target.isActive() || context.target.currentHp <= 0) {
    battle.emitMessage(BattleMessageType.HealFail, {
      target: context.target.id,
      reason: context.available ? 'disactivated' : 'disabled',
    })
    return
  }
  return Math.floor(Math.min(context.target.stat.maxHp, context.target.currentHp + context.healResult))
}

export function notifyHeal(context: HealContext, battle: Battle): void {
  battle.applyEffects(context, EffectTrigger.OnHeal)

  battle.emitMessage(BattleMessageType.Heal, {
    target: context.target.id,
    amount: context.healResult,
    source: 'effect',
  })
}
