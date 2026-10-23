import {
  checks,
  compileEffect,
  conditions,
  defineEffect,
  numberParam,
  ops,
  targets,
  values,
  type Trigger,
} from '@arcadia-eternity/battle/v4/authoring'

function healing(id: string, on: Trigger, divisor: number, needsField = false) {
  const parameters = { divisor: numberParam({ default: divisor }) }
  const amount = values.combine(targets.ownerPet.first().attribute('maxHp'), parameters.divisor, (hp, divisor) =>
    Math.floor(hp / divisor),
  )
  return compileEffect(
    defineEffect({
      id,
      on,
      priority: 0,
      parameters,
      when: needsField
        ? conditions.all(
            conditions.selfUsesSkill,
            targets.ownerMarks.where(mark => mark.baseId === 'mark_guanghuilingyu').condition(checks.exists()),
          )
        : conditions.selfUsesSkill,
      execute: targets.ownerPet.apply(ops.heal(amount)),
    }),
  )
}

/** Finite divisions retain legacy flooring; a zero divisor is rejected by the shared numeric action boundary. */
export function createFractionalHealing() {
  return Object.freeze({
    effect_skill_heal_self_1_6_max_hp: healing('effect_skill_heal_self_1_6_max_hp', 'OnHit', 6),
    effect_skill_heal_quarter_if_guanghuilingyu: healing(
      'effect_skill_heal_quarter_if_guanghuilingyu',
      'OnHit',
      4,
      true,
    ),
    effect_skill_heal_self_1_6_max_hp_on_defeat_opponent: healing(
      'effect_skill_heal_self_1_6_max_hp_on_defeat_opponent',
      'OnDefeat',
      6,
    ),
  })
}
