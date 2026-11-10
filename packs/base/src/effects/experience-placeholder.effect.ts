import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { EffectTrigger, actions, compileEffect, conditions } from '@arcadia-eternity/battle/authoring'

/** Preserve the source TODO identity. Experience settlement is not implemented by this effect. */
@effectGroup({ id: 'experience-placeholder' })
export class ExperiencePlaceholderEffects {
  static build() {
    return compileEffect({
      id: 'effect_ability_exp_boost_50_percent',
      triggers: [EffectTrigger.OnBattleStart],
      priority: 0,
      when: conditions.sourceOwnsEvent,
      apply: actions.sequence(),
    })
  }
}
