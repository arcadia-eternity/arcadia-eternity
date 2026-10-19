import { conditions, defineEffect, ops, targets } from '../../content/authoring'

const owner = targets.ownerPet
const isAtZeroHp = owner.condition((_ctx, pets) => pets.some(pet => pet.currentHp <= 0))
const recoveryHp = owner
  .select(pet => pet.stat.maxHp)
  .first()
  .map(maxHp => Math.floor(maxHp / 4))

/** Source: effect_mark_shiguangchongsheng. Direct assignment deliberately does not become healing. */
export const timeRebirth = defineEffect({
  id: 'effect_mark_shiguangchongsheng',
  on: 'PostDamage',
  when(ctx) {
    return conditions.selfBeDamaged(ctx) && isAtZeroHp(ctx)
  },
  execute: owner.property('currentHp').apply(ops.assign(recoveryHp)),
})
