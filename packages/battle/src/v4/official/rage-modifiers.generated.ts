// Generated candidates preserving historical pre-settlement damage-rage behavior.
import { compileEffect, defineEffect, conditions, contexts, ops } from '../content/authoring'
export function createGeneratedRageModifiers() {
  return Object.freeze({
    effect_emblem_increase_rage_on_damage: compileEffect(
      defineEffect({
        id: 'effect_emblem_increase_rage_on_damage',
        on: 'BeforeRageGain',
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        execute: contexts.rage.apply(ops.modifyRage({ percent: 20, delta: 0 })),
      }),
    ),
    effect_mark_increase_rage_on_damage_10_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_rage_on_damage_10_percent',
        on: 'BeforeRageGain',
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        execute: contexts.rage.apply(ops.modifyRage({ percent: 10, delta: 0 })),
      }),
    ),
    effect_mark_increase_rage_on_damage_20_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_rage_on_damage_20_percent',
        on: 'BeforeRageGain',
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        execute: contexts.rage.apply(ops.modifyRage({ percent: 20, delta: 0 })),
      }),
    ),
  })
}
export const generatedRageModifiers = createGeneratedRageModifiers()
