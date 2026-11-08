import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  ops,
} from '@arcadia-eternity/battle/authoring'

/** Keep the nearest skill ancestry, including damage caused by a nested effect. */
export const officialDamageBenefitEffects = Object.freeze({
  effect_skill_heal_25_percent_damage_dealt: compileEffect(
    defineEffect({
      id: 'effect_skill_heal_25_percent_damage_dealt',
      triggers: [EffectTrigger.OnDamage],
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(
        ops.heal(contexts.damage.select(event => Math.floor(event.damageResult * 0.25)).first()),
      ),
    }),
  ),
  effect_skill_add_rage_25_if_damage_over_100: compileEffect(
    defineEffect({
      id: 'effect_skill_add_rage_25_if_damage_over_100',
      triggers: [EffectTrigger.OnDamage],
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.damage.condition((_ctx, events) => events.some(event => event.damageResult > 100)),
      ),
      apply: targets.ownerPet.apply(ops.addRage(25)),
    }),
  ),
  effect_skill_crit_gain_rage_20: compileEffect(
    defineEffect({
      id: 'effect_skill_crit_gain_rage_20',
      triggers: [EffectTrigger.OnCritPostDamage],
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.addRage(20)),
    }),
  ),
})
