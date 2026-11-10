import { EffectTrigger, actions, compileEffect, conditions } from '@arcadia-eternity/battle/authoring'

/** Preserve the source TODO identity. Experience settlement is not implemented by this effect. */
export function createExperiencePlaceholder() {
  return compileEffect({
    id: 'effect_ability_exp_boost_50_percent',
    triggers: [EffectTrigger.OnBattleStart],
    priority: 0,
    when: conditions.sourceOwnsEvent,
    apply: actions.sequence(),
  })
}
