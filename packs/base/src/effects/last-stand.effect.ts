import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import {
  defineEffects,
  EffectTrigger,
  conditions,
  contexts,
  numberParam,
  ops,
} from '@arcadia-eternity/battle/authoring'

@effectGroup({ id: 'last-stand' })
export class LastStandEffects {
  static build() {
    const health = numberParam({ default: 1 })
    return defineEffects({
      effect_mark_set_health_to_1_on_damage: {
        triggers: [EffectTrigger.OnDamageReplacement],
        priority: 0,
        parameters: { health },
        when: conditions.selfBeDamaged,
        apply: contexts.damage.apply(ops.surviveDamage(health, 1)),
      },
    })
  }
}
