import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import {
  defineEffects,
  EffectTrigger,
  checks,
  conditions,
  numberParam,
  ops,
  targets,
  values,
  type Trigger,
} from '@arcadia-eternity/battle/authoring'

function healing(on: Trigger, divisor: number, needsField = false) {
  const parameters = { divisor: numberParam({ default: divisor }) }
  const amount = values.combine(targets.ownerPet.first().attribute('maxHp'), parameters.divisor, (hp, divisor) =>
    Math.floor(hp / divisor),
  )
  return {
    triggers: [on] as const,
    priority: 0,
    parameters,
    when: needsField
      ? conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_guanghuilingyu').condition(checks.exists()),
        )
      : conditions.selfUsesSkill,
    apply: targets.ownerPet.apply(ops.heal(amount)),
  }
}

/** Finite divisions retain legacy flooring; a zero divisor is rejected by the shared numeric action boundary. */
@effectGroup({ id: 'fractional-healing' })
export class FractionalHealingEffects {
  static build() {
    return defineEffects({
      effect_skill_heal_self_1_6_max_hp: healing(EffectTrigger.OnHit, 6),
      effect_skill_heal_quarter_if_guanghuilingyu: healing(EffectTrigger.OnHit, 4, true),
      effect_skill_heal_self_1_6_max_hp_on_defeat_opponent: healing(EffectTrigger.OnDefeat, 6),
    })
  }
}
