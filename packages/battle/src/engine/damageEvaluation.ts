import { EffectTrigger } from '@arcadia-eternity/const'
import type { Battle } from './battle'
import type { ConsumeStackContext, EffectContext, HealContext, AllContext, DamageContext } from './context'

// Damage evaluation and effect callbacks are synchronous. Keep this capability on the
// host stack so a cached frame, a different battle or a constructed Context cannot grant it.
let evaluation: DamageContext | undefined
let author: EffectContext<EffectTrigger> | undefined

export function getDamageEvaluation(): DamageContext | undefined {
  return evaluation
}

export function runDamageEvaluation<T>(battle: Battle, event: DamageContext, run: () => T): T {
  if (event.battle !== battle) throw new Error('Foreign damage evaluation')
  const previous = evaluation
  evaluation = event
  try {
    return run()
  } finally {
    evaluation = previous
  }
}

export function runDamageAuthor<T>(context: EffectContext<EffectTrigger> | undefined, run: () => T): T {
  const previous = author
  author = context
  try {
    return run()
  } finally {
    author = previous
  }
}

/** Veto and amount hooks edit their pending sub-event; keep those edits within the same callback boundary. */
export function evaluationSavepoint(damage: DamageContext, parent: AllContext): () => void {
  const restoreDamage = damage.savepoint()
  if (parent.type === 'effect' || parent.type === 'consumeStack' || parent.type === 'heal') {
    const pending = parent as ConsumeStackContext | EffectContext<EffectTrigger> | HealContext
    const available = pending.available
    const amount = 'actualAmount' in pending ? pending.actualAmount : undefined
    const heal = 'modified' in pending ? ([...pending.modified] as [number, number]) : undefined
    return () => {
      restoreDamage()
      pending.available = available
      if (amount !== undefined && 'actualAmount' in pending) pending.actualAmount = amount
      if (heal && 'modified' in pending) pending.modified = heal
    }
  }
  return restoreDamage
}

/** During evaluation the SDK may edit only the current proposal, or veto the current nested operation. */
export function assertEvaluationOperation(operation: string, selected: readonly unknown[], context = author): void {
  if (!evaluation) return
  if (context && context === author) {
    if (
      operation === 'disableContext' &&
      (context.trigger === EffectTrigger.BeforeEffect || context.trigger === EffectTrigger.OnBeforeConsumeStack) &&
      selected.every(target => target === context.parent)
    )
      return
    if (
      context.trigger === EffectTrigger.OnBeforeHeal &&
      (operation === 'modifyHeal' || operation === 'disableContext') &&
      selected.every(target => target === context.parent)
    )
      return
    if (context.parent === evaluation) {
      if (operation === 'payDamageStacks' && context.trigger === EffectTrigger.OnBeforeCalculateDamage) return
      if (
        [
          'cancelDamage',
          'modifyDamage',
          'setDamageThreshold',
          'replaceDamageWithHeal',
          'preventDamage',
          'surviveDamage',
          'redirectDamage',
        ].includes(operation) &&
        selected.every(target => target === evaluation)
      )
        return
    }
  }
  throw new Error(`Cannot perform ${operation} during damage evaluation`)
}
