import { effectGroup } from '@arcadia-eternity/battle/effect-loading'
// Reviewed native behavior; edit this TypeScript source directly.
import { defineEffects, EffectTrigger, conditions, contexts, ops, actions } from '@arcadia-eternity/battle/authoring'
@effectGroup({ id: 'skill-disabling.generated' })
export class SkillDisablingGeneratedEffects {
  static build() {
    return defineEffects({
      effect_mark_40probability_stun: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.sourceOwnsEvent, conditions.chance(40)),
        apply: actions.sequence(contexts.skillUse.apply(ops.disableContext())),
      },
      effect_mark_physical_stun: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Physical'),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.disableContext())),
      },
      effect_mark_stun: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.sourceOwnsEvent,
        apply: actions.sequence(contexts.skillUse.apply(ops.disableContext())),
      },
      effect_mark_taunt: {
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Status'),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.disableContext())),
      },
    })
  }
}

export const generatedSkillDisabling = SkillDisablingGeneratedEffects.build()
