import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
// Generated candidates preserving historical pre-settlement damage-rage behavior.
import { defineEffects, EffectTrigger, conditions, contexts, ops } from '@arcadia-eternity/battle/authoring'
@effectGroup({ id: 'rage-modifiers.generated' })
export class RageModifiersGeneratedEffects {
  static build() {
    return defineEffects({
      effect_emblem_increase_rage_on_damage: {
        triggers: [EffectTrigger.BeforeRageGain],
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        apply: contexts.rage.apply(ops.modifyRage({ percent: 20, delta: 0 })),
      },
      effect_mark_increase_rage_on_damage_10_percent: {
        triggers: [EffectTrigger.BeforeRageGain],
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        apply: contexts.rage.apply(ops.modifyRage({ percent: 10, delta: 0 })),
      },
      effect_mark_increase_rage_on_damage_20_percent: {
        triggers: [EffectTrigger.BeforeRageGain],
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        apply: contexts.rage.apply(ops.modifyRage({ percent: 20, delta: 0 })),
      },
    })
  }
}

export const generatedRageModifiers = RageModifiersGeneratedEffects.build()
