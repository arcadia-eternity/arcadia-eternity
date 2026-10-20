// Generated candidates; C15 repairs unsupported damage-rage triggers and ownership conditions.
import { compileEffect, defineEffect, conditions, contexts, ops } from '../content/authoring'
export function createGeneratedRageModifiers() {
  return Object.freeze({
    effect_emblem_increase_rage_on_damage: compileEffect(
      defineEffect({
        id: 'effect_emblem_increase_rage_on_damage',
        on: 'OnRageGain',
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        execute: contexts.rage.apply(ops.modifyRage({ percent: 20, delta: 0 })),
      }),
    ),
    effect_mark_increase_rage_on_damage_10_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_rage_on_damage_10_percent',
        on: 'OnRageGain',
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        execute: contexts.rage.apply(ops.modifyRage({ percent: 10, delta: 0 })),
      }),
    ),
    effect_mark_increase_rage_on_damage_20_percent: compileEffect(
      defineEffect({
        id: 'effect_mark_increase_rage_on_damage_20_percent',
        on: 'OnRageGain',
        priority: 0,
        when: conditions.ownerReceivesDamageRage,
        execute: contexts.rage.apply(ops.modifyRage({ percent: 20, delta: 0 })),
      }),
    ),
  })
}
export const generatedRageModifiers = createGeneratedRageModifiers()
