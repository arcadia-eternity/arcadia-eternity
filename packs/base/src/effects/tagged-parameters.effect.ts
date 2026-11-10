import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { defineEffects, EffectTrigger, ops, targets } from '@arcadia-eternity/battle/authoring'

/** Match installed parameter tags at execution; repeated applications append scoped modifiers. */
@effectGroup({ id: 'tagged-parameters' })
export class TaggedParametersEffects {
  static build() {
    const owner = (tag: string, amount: number) => ({
      triggers: [EffectTrigger.OnBattleStart] as const,
      priority: 0,
      apply: targets.ownerPet.apply(ops.addTaggedParameterModifier(tag, 'delta', amount)),
    })
    return defineEffects({
      effect_ability_increase_huohuanzhixin_gain_1: owner('skill_effect_huohuanzhixin_stack', 1),
      effect_emblem_increase_skill_trigger_rate_5_percent: owner('skill_effect_probability', 5),
      effect_emblem_add_yinbo_stack_config_5: owner('skill_effect_yinbo_stack', 5),
      effect_emblem_yingguanghuafen_extra_accuracy_reduction_5: owner('skill_effect_mingzhongxiajiang_stack', 5),
      effect_emblem_add_mark_mabi_chance_5: {
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        apply: targets.opponentPlayer.apply(ops.addTaggedParameterModifier('mark_mabi_chance', 'delta', 5)),
      },
    })
  }
}
