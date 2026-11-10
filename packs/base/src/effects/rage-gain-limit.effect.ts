import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { EffectTrigger, compileEffect, conditions, contexts, ops, targets } from '@arcadia-eternity/battle/authoring'

@effectGroup({ id: 'rage-gain-limit' })
export class RageGainLimitEffects {
  static build() {
    return compileEffect({
      id: 'effect_mark_limit_rage_gain',
      triggers: [EffectTrigger.BeforeRageGain],
      priority: 0,
      when: conditions.ownerReceivesRage,
      apply: contexts.rage.apply(ops.limitRageGain(targets.sourceMark.first().attribute('stack'))),
    })
  }
}
