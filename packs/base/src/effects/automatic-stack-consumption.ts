import { Category } from '@arcadia-eternity/const'
import {
  EffectTrigger,
  actions,
  compileEffect,
  conditions,
  contexts,
  defineEffect,
} from '@arcadia-eternity/battle/v4/authoring'

/** Consumption belongs to Effect.innerApply; the original TODO body intentionally does nothing. */
export function createAutomaticStackConsumption() {
  return Object.freeze({
    effect_mark_consume_stack_on_skill_use: compileEffect(
      defineEffect({
        id: 'effect_mark_consume_stack_on_skill_use',
        triggers: [EffectTrigger.SkillUseEnd],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(conditions.selfUsesSkill, ctx => {
          const use = contexts.nearestSkillUse(ctx)
          return !!use && use.category !== Category.Climax && use.category !== Category.Status
        }),
        apply: actions.sequence(),
      }),
    ),
    effect_mark_anyingzhiguang_consume_stack_on_skill_use: compileEffect(
      defineEffect({
        id: 'effect_mark_anyingzhiguang_consume_stack_on_skill_use',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(conditions.selfUsesSkill, ctx => {
          const use = contexts.nearestSkillUse(ctx)
          return !!use && use.category !== Category.Status
        }),
        apply: actions.sequence(),
      }),
    ),
  })
}
