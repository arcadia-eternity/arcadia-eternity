import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { HealContext, RageContext, UseSkillContext, type AllContext } from '@arcadia-eternity/battle/v4'
import { Pet } from '@arcadia-eternity/battle/v4'
import { SkillInstance } from '@arcadia-eternity/battle/v4'
import { MarkInstanceImpl } from '@arcadia-eternity/battle/v4'
import { defineNativeEffect, type NativeEffectContext } from '@arcadia-eternity/battle/v4'

type DamageTrigger = EffectTrigger.OnDamage | EffectTrigger.OnCritPostDamage
function selfUsesSkill(context: NativeEffectContext<DamageTrigger>): boolean {
  // Effect-caused damage can be nested below the original skill. Preserve that ancestry.
  let parent: AllContext | null = context.parent.parent
  while (parent) {
    if (parent instanceof UseSkillContext)
      return (
        context.source.owner === parent.pet &&
        (context.source instanceof SkillInstance
          ? context.source === parent.skill
          : context.source instanceof MarkInstanceImpl)
      )
    parent = parent.parent
  }
  return false
}

/** Native candidates; neither damage amount nor trigger timing is inferred from effect names. */
export const officialDamageBenefitEffects = Object.freeze({
  effect_skill_heal_25_percent_damage_dealt: defineNativeEffect({
    id: 'effect_skill_heal_25_percent_damage_dealt' as effectId,
    triggers: [EffectTrigger.OnDamage],
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (owner instanceof Pet)
        owner.heal(new HealContext(context, context.source, owner, Math.floor(context.parent.damageResult * 0.25)))
    },
  }),
  effect_skill_add_rage_25_if_damage_over_100: defineNativeEffect({
    id: 'effect_skill_add_rage_25_if_damage_over_100' as effectId,
    triggers: [EffectTrigger.OnDamage],
    when: context => selfUsesSkill(context) && context.parent.damageResult > 100,
    apply(context) {
      const owner = context.source.owner
      if (owner instanceof Pet) owner.addRage(new RageContext(context, owner.owner!, 'effect', 'add', 25))
    },
  }),
  effect_skill_crit_gain_rage_20: defineNativeEffect({
    id: 'effect_skill_crit_gain_rage_20' as effectId,
    triggers: [EffectTrigger.OnCritPostDamage],
    when: selfUsesSkill,
    apply(context) {
      const owner = context.source.owner
      if (owner instanceof Pet) owner.addRage(new RageContext(context, owner.owner!, 'effect', 'add', 20))
    },
  }),
})
