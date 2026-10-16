import { EffectTrigger } from '@arcadia-eternity/const'
import { TransformContext, TransformEndContext, type Transformable } from '../context.js'
import { SynchronousPhase } from './base.js'

export class TransformPhase<T extends Transformable> extends SynchronousPhase<TransformContext<T>, string | null> {
  readonly kind = 'transform'
  protected executeOperation(): string | null {
    const ctx = this.context,
      battle = this.battle,
      system = battle.transformationSystem
    return system.withTarget(ctx, () => {
      system.validate(ctx)
      battle.applyEffects(ctx, EffectTrigger.BeforeTransform)
      if (!ctx.available) return null
      system.validate(ctx)
      for (const record of system.removals(ctx))
        battle.endTransformation(
          new TransformEndContext(
            ctx,
            ctx.target,
            record.id,
            ctx.options.transformType === 'permanent' ? 'cleared' : 'replaced',
          ),
        )
      ctx.transformationId = system.apply(ctx)
      battle.emitEvent('transform', {
        targetId: ctx.target.id,
        transformationId: ctx.transformationId,
        fromBaseId: ctx.fromBase.id,
        toBaseId: ctx.target.base.id,
        requestedBaseId: ctx.toBase.id,
        transformType: ctx.options.transformType ?? 'temporary',
        priority: ctx.options.priority ?? 0,
        sourceId: ctx.options.causedBy?.id ?? null,
      })
      battle.applyEffects(ctx, EffectTrigger.OnTransform)
      battle.applyEffects(ctx, EffectTrigger.AfterTransform)
      return ctx.transformationId
    })
  }
}
export class TransformEndPhase<T extends Transformable> extends SynchronousPhase<TransformEndContext<T>, boolean> {
  readonly kind = 'transform-end'
  protected executeOperation(): boolean {
    const ctx = this.context,
      battle = this.battle,
      system = battle.transformationSystem
    return system.withTarget(ctx, () => {
      if (!system.prepareEnd(ctx)) return false
      battle.applyEffects(ctx, EffectTrigger.OnTransformEnd)
      system.remove(ctx)
      battle.emitEvent('transformEnd', {
        targetId: ctx.target.id,
        transformationId: ctx.record!.id,
        reason: ctx.reason,
        fromBaseId: ctx.fromBase.id,
        toBaseId: ctx.target.base.id,
      })
      return true
    })
  }
}
