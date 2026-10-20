import { compileEffect, conditions, contexts, defineEffect, ops, targets } from '../content/authoring'

export function createRageGainLimit() {
  return compileEffect(
    defineEffect({
      id: 'effect_mark_limit_rage_gain',
      on: 'BeforeRageGain',
      priority: 0,
      when: conditions.ownerReceivesRage,
      execute: contexts.rage.apply(ops.limitRageGain(targets.sourceMark.first().attribute('stack'))),
    }),
  )
}
