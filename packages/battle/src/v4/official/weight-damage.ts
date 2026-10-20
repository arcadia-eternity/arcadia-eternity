import { compileEffect, conditions, contexts, defineEffect, ops, targets } from '../content/authoring'

/** Read computed weight when the action runs; do not capture an instance or install a binding. */
export function createWeightDamageEffects() {
  const selfWeight = targets.ownerPet.first().attribute('weight')
  const opponentWeight = targets.opponentActive.first().attribute('weight')
  return Object.freeze({
    effect_mark_reduce_damage_with_weight: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_damage_with_weight',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        consumesStacks: 1,
        when: conditions.selfBeDamaged,
        execute: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: selfWeight.map(weight => -weight) })),
      }),
    ),
    effect_skill_fixed_damage_by_weight: compileEffect(
      defineEffect({
        id: 'effect_skill_fixed_damage_by_weight',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: selfWeight })),
      }),
    ),
    effect_skill_damage_by_opponent_weight: compileEffect(
      defineEffect({
        id: 'effect_skill_damage_by_opponent_weight',
        on: 'OnBeforeCalculateDamage',
        priority: 0,
        when: conditions.selfUsesSkill,
        execute: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: opponentWeight })),
      }),
    ),
  })
}
