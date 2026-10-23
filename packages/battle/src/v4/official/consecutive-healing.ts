import { compileEffect, conditions, defineEffect, numberParam, ops, targets, values } from '../content/authoring'

const repeated = targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.lastSkillUsedTimes > 1))

function fixedHealing(id: string, yes: number, no: number) {
  const parameters = {
    trueValue: numberParam({ default: yes }),
    falseValue: numberParam({ default: no }),
  }
  return compileEffect(
    defineEffect({
      id,
      on: 'OnHit',
      when: conditions.selfUsesSkill,
      parameters,
      execute: targets.ownerPet.apply(ops.heal(values.choose(repeated, parameters.trueValue, parameters.falseValue))),
    }),
  )
}

/** Keep the source branch direction. Each anonymous raw value has its own stable parameter identity. */
export const officialConsecutiveHealingEffects = Object.freeze({
  effect_skill_heal_self_120_hp_if_consecutive_half: fixedHealing(
    'effect_skill_heal_self_120_hp_if_consecutive_half',
    120,
    60,
  ),
  effect_skill_heal_self_125_hp_if_consecutive_half: fixedHealing(
    'effect_skill_heal_self_125_hp_if_consecutive_half',
    125,
    63,
  ),
  effect_skill_heal_self_quarter_if_consecutive_half: compileEffect(
    defineEffect({
      id: 'effect_skill_heal_self_quarter_if_consecutive_half',
      on: 'OnHit',
      when: conditions.selfUsesSkill,
      execute: targets.ownerPet.apply(
        ops.heal(
          values.combine(targets.ownerPet.first().attribute('maxHp'), values.choose(repeated, 8, 4), (hp, divisor) =>
            Math.floor(hp / divisor),
          ),
        ),
      ),
    }),
  ),
})
