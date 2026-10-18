import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { HealContext } from '../context'
import { Pet } from '../pet'
import { SkillInstance } from '../skill'
import { MarkInstanceImpl } from '../mark'
import { defineNativeEffect } from '../content/native-effect'

function consecutiveHealing(id: string, amount: (owner: Pet) => number) {
  return defineNativeEffect({
    id: id as effectId,
    triggers: [EffectTrigger.OnHit],
    when: context =>
      context.source.owner === context.parent.pet &&
      (context.source instanceof SkillInstance
        ? context.source === context.parent.skill
        : context.source instanceof MarkInstanceImpl),
    apply(context) {
      const owner = context.source.owner
      if (owner instanceof Pet) owner.heal(new HealContext(context, context.source, owner, amount(owner)))
    },
  })
}

/** Current-YAML candidates. Branches read current source ownership at action execution. */
export const officialConsecutiveHealingEffects = Object.freeze({
  effect_skill_heal_self_120_hp_if_consecutive_half: consecutiveHealing(
    'effect_skill_heal_self_120_hp_if_consecutive_half',
    owner => (owner.lastSkillUsedTimes > 1 ? 120 : 60),
  ),
  effect_skill_heal_self_125_hp_if_consecutive_half: consecutiveHealing(
    'effect_skill_heal_self_125_hp_if_consecutive_half',
    owner => (owner.lastSkillUsedTimes > 1 ? 125 : 63),
  ),
  effect_skill_heal_self_quarter_if_consecutive_half: consecutiveHealing(
    'effect_skill_heal_self_quarter_if_consecutive_half',
    owner => Math.floor(owner.stat.maxHp / (owner.lastSkillUsedTimes > 1 ? 8 : 4)),
  ),
})
