import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
import { Category } from '@arcadia-eternity/const'
import { defineEffects, EffectTrigger, actions, conditions, contexts } from '@arcadia-eternity/battle/authoring'

/** Consumption belongs to Effect.innerApply; the original TODO body intentionally does nothing. */
@effectGroup({ id: 'automatic-stack-consumption' })
export class AutomaticStackConsumptionEffects {
  static build() {
    return defineEffects({
      effect_mark_consume_stack_on_skill_use: {
        triggers: [EffectTrigger.SkillUseEnd],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(conditions.selfUsesSkill, ctx => {
          const use = contexts.nearestSkillUse(ctx)
          return !!use && use.category !== Category.Climax && use.category !== Category.Status
        }),
        apply: actions.sequence(),
      },
      effect_mark_anyingzhiguang_consume_stack_on_skill_use: {
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(conditions.selfUsesSkill, ctx => {
          const use = contexts.nearestSkillUse(ctx)
          return !!use && use.category !== Category.Status
        }),
        apply: actions.sequence(),
      },
    })
  }
}
