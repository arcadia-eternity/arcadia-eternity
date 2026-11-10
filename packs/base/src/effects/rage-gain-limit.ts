import { EffectTrigger, compileEffect, conditions, contexts, ops, targets } from '@arcadia-eternity/battle/authoring'

export function createRageGainLimit() {
  return compileEffect({
    id: 'effect_mark_limit_rage_gain',
    triggers: [EffectTrigger.BeforeRageGain],
    priority: 0,
    when: conditions.ownerReceivesRage,
    apply: contexts.rage.apply(ops.limitRageGain(targets.sourceMark.first().attribute('stack'))),
  })
}
