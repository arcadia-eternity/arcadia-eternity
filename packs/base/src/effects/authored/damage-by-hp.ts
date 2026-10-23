import { conditions, defineEffect, targets, values, type Condition } from '@arcadia-eternity/battle/v4/authoring'

const owner = targets.ownerPet
function hpBelow(ratio: number): Condition {
  return owner.condition((_ctx, pets) => pets.some(pet => pet.currentHp < Math.floor(pet.stat.maxHp * ratio)))
}
const belowQuarter = hpBelow(0.25)
const belowHalf = hpBelow(0.5)
const belowThreeQuarters = hpBelow(0.75)
const damageBonus = values.choose(
  belowQuarter,
  70,
  values.choose(belowHalf, 50, values.choose(belowThreeQuarters, 30, 0)),
)

/** Source: effect_mark_damage_boost_based_on_hp_percentage. Admission and amount read separately. */
export const damageBoostByHp = defineEffect({
  id: 'effect_mark_damage_boost_based_on_hp_percentage',
  on: 'OnBeforeCalculateDamage',
  when(ctx) {
    return conditions.selfUsesSkill(ctx) && belowThreeQuarters(ctx)
  },
  execute(ctx) {
    ctx.ops.modifyDamage(ctx.event, { delta: 0, percent: ctx.read(damageBonus) })
  },
})
