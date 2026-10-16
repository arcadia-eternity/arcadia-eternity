import { EffectTrigger } from '@arcadia-eternity/const'
import { HealContext } from '../context.js'
import { requireNumber } from '../data.js'
import { SynchronousPhase } from './base.js'
export class HealPhase extends SynchronousPhase<HealContext, number> {
  readonly kind = 'heal'
  protected executeOperation() {
    const ctx = this.context,
      battle = this.battle
    battle.applyEffects(ctx, EffectTrigger.OnBeforeHeal)
    if (!ctx.available || !ctx.target.isAlive) return 0
    requireNumber(ctx.baseHeal, 'heal')
    ctx.updateHealResult()
    const before = ctx.target.currentHp
    ctx.target.currentHp = Math.min(ctx.target.stat.maxHp, before + ctx.healResult)
    battle.applyEffects(ctx, EffectTrigger.OnHeal)
    const amount = ctx.target.currentHp - before
    battle.emitEvent('heal', { sourceId: ctx.source.id, targetId: ctx.target.id, amount })
    return amount
  }
}
