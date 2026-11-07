import {
  EffectTrigger,
  compileEffect,
  conditions,
  defineEffect,
  numberParam,
  ops,
  targets,
} from '@arcadia-eternity/battle/v4/authoring'

/** Re-query the owner after automatic consumption; a destroyed source no longer has an owner. */
export function createLastStand() {
  const health = numberParam({ default: 1 })
  return Object.freeze({
    effect_mark_set_health_to_1_on_damage: compileEffect(
      defineEffect({
        id: 'effect_mark_set_health_to_1_on_damage',
        triggers: [EffectTrigger.PostDamage],
        priority: 0,
        consumesStacks: 1,
        parameters: { health },
        when: conditions.all(
          conditions.selfBeDamaged,
          targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.currentHp <= 0)),
        ),
        apply: targets.ownerPet.property('currentHp').apply(ops.assign(health)),
      }),
    ),
  })
}
