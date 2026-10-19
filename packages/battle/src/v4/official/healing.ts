import { compileEffect, defineEffect, conditions, targets, ops, type Value } from '../content/authoring'

const owner = targets.ownerPet
const maxHp = owner.first().attribute('maxHp')
function healing(id: string, amount: number | Value<number, 'optional'>) {
  return compileEffect(
    defineEffect({
      id,
      on: 'OnHit',
      when: conditions.selfUsesSkill,
      execute: owner.apply(ops.heal(amount)),
    }),
  )
}

/** Native candidates share context lookup, target queries and action-time value reads. */
export const officialHealingEffects = Object.freeze({
  effect_skill_heal_self_90_hp: healing('effect_skill_heal_self_90_hp', 90),
  // Preserve the legacy floor before HealContext and OnBeforeHeal hooks.
  effect_heal_self_half: healing(
    'effect_heal_self_half',
    maxHp.map(hp => Math.floor(hp / 2)),
  ),
  effect_heal_self_onethird: healing(
    'effect_heal_self_onethird',
    maxHp.map(hp => Math.floor(hp / 3)),
  ),
  effect_skill_heal_self_quarter: healing(
    'effect_skill_heal_self_quarter',
    maxHp.map(hp => Math.floor(hp / 4)),
  ),
})
