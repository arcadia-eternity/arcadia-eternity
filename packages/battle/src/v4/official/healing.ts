import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { HealContext } from '../context'
import { Pet } from '../pet'
import { SkillInstance } from '../skill'
import { defineNativeEffect, type NativeEffectContext } from '../content/native-effect'

function selfUsesSkill(context: NativeEffectContext<EffectTrigger.OnHit>): boolean {
  return (
    context.source.owner === context.parent.pet &&
    (!(context.source instanceof SkillInstance) || context.source === context.parent.skill)
  )
}

function healing(id: string, amount: (target: Pet) => number) {
  return defineNativeEffect({
    id: id as effectId,
    triggers: [EffectTrigger.OnHit],
    when: selfUsesSkill,
    apply(context) {
      const target = context.source.owner
      if (target instanceof Pet) target.heal(new HealContext(context, context.source, target, amount(target)))
    },
  })
}

/** Handwritten production candidates; not installed alongside the legacy catalog. */
export const officialHealingEffects = Object.freeze({
  effect_skill_heal_self_90_hp: healing('effect_skill_heal_self_90_hp', () => 90),
  // Legacy selector.divide floors before HealContext and before OnBeforeHeal hooks.
  effect_heal_self_half: healing('effect_heal_self_half', target => Math.floor(target.stat.maxHp / 2)),
  effect_heal_self_onethird: healing('effect_heal_self_onethird', target => Math.floor(target.stat.maxHp / 3)),
  effect_skill_heal_self_quarter: healing('effect_skill_heal_self_quarter', target =>
    Math.floor(target.stat.maxHp / 4),
  ),
})
