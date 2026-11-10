import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import {
  defineEffects,
  EffectTrigger,
  conditions,
  numberParam,
  ops,
  targets,
  values,
} from '@arcadia-eternity/battle/authoring'

import { healingOnHit, consecutiveHealingAmount } from './shared-plans'

const repeated = targets.ownerPet.condition((_ctx, pets) => pets.some(pet => pet.lastSkillUsedTimes > 1))

function fixedHealing(yes: number, no: number) {
  const parameters = {
    trueValue: numberParam({ default: yes }),
    falseValue: numberParam({ default: no }),
  }
  return {
    parameters,
    ...healingOnHit(consecutiveHealingAmount(parameters.falseValue, parameters.trueValue)),
  }
}

/** Keep the source branch direction. Each anonymous raw value has its own stable parameter identity. */
export const officialConsecutiveHealingEffects = defineEffects({
  effect_skill_heal_self_120_hp_if_consecutive_half: fixedHealing(120, 60),
  effect_skill_heal_self_125_hp_if_consecutive_half: fixedHealing(125, 63),
  effect_skill_heal_self_quarter_if_consecutive_half: {
    triggers: [EffectTrigger.OnHit],
    when: conditions.selfUsesSkill,
    apply: targets.ownerPet.apply(
      ops.heal(
        values.combine(targets.ownerPet.first().attribute('maxHp'), values.choose(repeated, 8, 4), (hp, divisor) =>
          Math.floor(hp / divisor),
        ),
      ),
    ),
  },
})

@effectGroup({ id: 'consecutive-healing' })
export class ConsecutiveHealingEffects {
  static build() {
    return officialConsecutiveHealingEffects
  }
}
