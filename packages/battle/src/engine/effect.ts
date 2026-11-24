import { EffectTrigger } from '@arcadia-eternity/const'
import { evaluationSavepoint, getDamageEvaluation, runDamageAuthor, runReplacementSample } from './phase/damage'
import { EffectContext } from './context'
import { type Prototype } from './entity'
import type { effectId } from '@arcadia-eternity/const'
import { MarkInstanceImpl } from './mark'

// EffectScheduler has been replaced by EffectExecutionPhase
// All effect scheduling and execution logic is now handled by the Phase system

export class Effect<T extends EffectTrigger> implements Prototype {
  constructor(
    public readonly id: effectId,
    public readonly triggers: T[],
    public readonly apply: ((context: EffectContext<T>) => void) | ((context: EffectContext<T>) => void)[],
    public readonly priority: number,
    public readonly condition?: (context: EffectContext<T>) => boolean,
    public readonly consumesStacks?: number | 'all',
    public readonly tags: string[] = [],
  ) {}

  // 为了向后兼容，保留trigger属性的getter
  get trigger(): T {
    return this.triggers[0]
  }

  public innerApply(context: EffectContext<T>) {
    const mark = context.source instanceof MarkInstanceImpl ? context.source : undefined
    if (mark && (!mark.isActive || mark.isSuppressed)) return
    const evaluation = getDamageEvaluation()
    const rollback = evaluation && evaluationSavepoint(evaluation, context.parent)
    try {
      if (mark && this.consumesStacks) {
        const amount = this.consumesStacks === 'all' ? mark.stack : this.consumesStacks
        if (!evaluation) mark.consumeStack(context, amount)
        else if (context.trigger !== EffectTrigger.OnDamageReplacement && context.trigger !== EffectTrigger.Shield) {
          const modifiesProposal = context.parent === evaluation || context.trigger === EffectTrigger.OnBeforeHeal
          if (!modifiesProposal || !evaluation.reserveModifierCost(mark, this.consumesStacks))
            throw new Error('Cannot pay damage modifier cost')
        }
        // Replacement costs travel with the rule and are reserved only if selected.
      }

      const apply = () => {
        if (Array.isArray(this.apply)) this.apply.forEach(a => a.call(this, context))
        else this.apply.call(this, context)
      }
      if (evaluation) runDamageAuthor(context, () => runReplacementSample(context, 'apply', apply))
      else apply()
    } catch (error) {
      rollback?.()
      throw error
    }
  }
}

export interface EffectContainer {
  effects: Effect<EffectTrigger>[]
  /** Effective list; mutable permanent effects remain separate from phase-scoped additions. */
  getEffects?(trigger: EffectTrigger): Effect<EffectTrigger>[]
}

export interface TemporaryEffect {
  readonly effect: Effect<EffectTrigger>
  readonly phaseId: string
}
