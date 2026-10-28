// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  ops,
  actions,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedSkillDisabling() {
  return Object.freeze({
    effect_mark_40probability_stun: compileEffect(
      defineEffect({
        id: 'effect_mark_40probability_stun',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.sourceOwnsEvent, conditions.chance(40)),
        apply: actions.sequence(contexts.skillUse.apply(ops.disableContext())),
      }),
    ),
    effect_mark_physical_stun: compileEffect(
      defineEffect({
        id: 'effect_mark_physical_stun',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Physical'),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.disableContext())),
      }),
    ),
    effect_mark_stun: compileEffect(
      defineEffect({
        id: 'effect_mark_stun',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.sourceOwnsEvent,
        apply: actions.sequence(contexts.skillUse.apply(ops.disableContext())),
      }),
    ),
    effect_mark_taunt: compileEffect(
      defineEffect({
        id: 'effect_mark_taunt',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category === 'Status'),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.disableContext())),
      }),
    ),
  })
}
export const generatedSkillDisabling = createGeneratedSkillDisabling()
