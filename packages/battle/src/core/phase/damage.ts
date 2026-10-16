import { EffectTrigger } from '@arcadia-eternity/const'
import { DamageContext, ConsumeStackContext } from '../context.js'
import { requireNumber } from '../data.js'
import { SynchronousPhase } from './base.js'
export class DamagePhase extends SynchronousPhase<DamageContext, number> {
  readonly kind = 'damage'
  protected executeOperation() {
    const ctx = this.context,
      battle = this.battle
    battle.applyEffects(ctx, EffectTrigger.OnBeforeCalculateDamage)
    if (!ctx.available) {
      battle.emitEvent('damageFail', { sourceId: ctx.source.id, targetId: ctx.target.id, reason: 'disabled' })
      return 0
    }
    requireNumber(ctx.baseDamage, 'damage')
    ctx.updateDamageResult()
    if (!ctx.ignoreShield) {
      battle.applyEffects(ctx, EffectTrigger.Shield)
      for (const mark of [...ctx.target.marks])
        if (mark.isActive && mark.config.isShield)
          ctx.damageResult -= battle.consumeMarkStacks(new ConsumeStackContext(ctx, mark, ctx.damageResult))
    }
    ctx.target.currentHp = Math.max(0, ctx.target.currentHp - ctx.damageResult)
    battle.applyEffects(ctx, EffectTrigger.OnDamage)
    battle.emitEvent('damage', {
      sourceId: ctx.source.id,
      targetId: ctx.target.id,
      damage: ctx.damageResult,
      isCrit: ctx.crit,
      effectiveness: ctx.effectiveness,
      damageType: ctx.damageType,
      currentHp: ctx.target.currentHp,
      maxHp: ctx.target.stat.maxHp,
    })
    battle.applyEffects(ctx, EffectTrigger.PostDamage)
    if (ctx.crit) battle.applyEffects(ctx, EffectTrigger.OnCritPostDamage)
    return ctx.damageResult
  }
}
