// Generated candidates preserving historical pre-settlement damage-rage behavior.
import { defineEffects, EffectTrigger, conditions, contexts, ops } from '@arcadia-eternity/battle/authoring'
export function createGeneratedRageModifiers() {
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
export const generatedRageModifiers = createGeneratedRageModifiers()
