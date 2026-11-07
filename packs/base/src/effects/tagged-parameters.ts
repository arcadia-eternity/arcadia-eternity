import { EffectTrigger, compileEffect, defineEffect, ops, targets } from '@arcadia-eternity/battle/v4/authoring'

/** Match installed parameter tags at execution; repeated applications append scoped modifiers. */
export function createTaggedParameterModifiers() {
  const owner = (id: string, tag: string, amount: number) =>
    compileEffect(
      defineEffect({
        id,
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        apply: targets.ownerPet.apply(ops.addTaggedParameterModifier(tag, 'delta', amount)),
      }),
    )
  return Object.freeze({
    effect_ability_increase_huohuanzhixin_gain_1: owner(
      'effect_ability_increase_huohuanzhixin_gain_1',
      'skill_effect_huohuanzhixin_stack',
      1,
    ),
    effect_emblem_increase_skill_trigger_rate_5_percent: owner(
      'effect_emblem_increase_skill_trigger_rate_5_percent',
      'skill_effect_probability',
      5,
    ),
    effect_emblem_add_yinbo_stack_config_5: owner(
      'effect_emblem_add_yinbo_stack_config_5',
      'skill_effect_yinbo_stack',
      5,
    ),
    effect_emblem_yingguanghuafen_extra_accuracy_reduction_5: owner(
      'effect_emblem_yingguanghuafen_extra_accuracy_reduction_5',
      'skill_effect_mingzhongxiajiang_stack',
      5,
    ),
    effect_emblem_add_mark_mabi_chance_5: compileEffect(
      defineEffect({
        id: 'effect_emblem_add_mark_mabi_chance_5',
        triggers: [EffectTrigger.OnBattleStart],
        priority: 0,
        apply: targets.opponentPlayer.apply(ops.addTaggedParameterModifier('mark_mabi_chance', 'delta', 5)),
      }),
    ),
  })
}
