import { EffectTrigger } from '@arcadia-eternity/const'
import { RageContext } from '../context.js'
import { requireNumber } from '../data.js'
import { SynchronousPhase } from './base.js'
export class RagePhase extends SynchronousPhase<RageContext> {
  readonly kind = 'rage'
  protected executeOperation() {
    const ctx = this.context,
      battle = this.battle
    requireNumber(ctx.amount, 'rage amount')
    if (ctx.direction !== 'setting')
      battle.applyEffects(ctx, ctx.direction === 'add' ? EffectTrigger.BeforeRageGain : EffectTrigger.BeforeRageLoss)
    if (!ctx.available) return
    ctx.updateRageChangeResult()
    requireNumber(ctx.rageChangeResult, 'modified rage')
    const before = ctx.player.currentRage,
      value = ctx.rageChangeResult
    ctx.player.settingRage(ctx.direction === 'setting' ? value : before + (ctx.direction === 'add' ? value : -value))
    battle.emitEvent('rageChange', {
      playerId: ctx.player.id,
      reason: ctx.reason,
      type: ctx.direction,
      amount: value,
      before,
      newRage: ctx.player.currentRage,
    })
    if (ctx.direction !== 'setting')
      battle.applyEffects(ctx, ctx.direction === 'add' ? EffectTrigger.OnRageGain : EffectTrigger.OnRageLoss)
  }
}
