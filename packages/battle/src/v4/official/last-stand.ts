import { compileEffect, conditions, defineEffect, numberParam, ops, targets } from '../content/authoring'

/** Re-query the owner after automatic consumption; a destroyed source no longer has an owner. */
export function createLastStand() {
  const health = numberParam({ default: 1 })
  return Object.freeze({
    effect_mark_set_health_to_1_on_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_set_health_to_1_on_damage',
        on: 'PostDamage',
        priority: 0,
        consumesStacks: 1,
        parameters: { health },
        when: conditions.all(
          conditions.selfBeDamaged,
          targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.currentHp <= 0)),
        ),
        execute: targets.ownerPet.property('currentHp').apply(ops.assign(health)),
      }),
    ),
  })
}
