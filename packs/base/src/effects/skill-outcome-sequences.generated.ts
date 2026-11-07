// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  checks,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedSkillOutcomeSequences() {
  return Object.freeze({
    effect_emblem_add_crit_rate_5_percent_if_has_shuiwenzhenji: compileEffect(
      defineEffect({
        id: 'effect_emblem_add_crit_rate_5_percent_if_has_shuiwenzhenji',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shuiwenzhenji').condition(checks.exists()),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.addCritRate(5))),
      }),
    ),
    effect_mark_amplify_next_damage_skill_power_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_next_damage_skill_power_with_stack',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category !== 'Status'),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(
            ops.amplifyPower(
              targets.sourceMark
                .select(mark => mark.stack)
                .all()
                .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 0.01 : 0))))
                .map(items => items.map((n, index) => n + (index === 0 ? 1 : 0))),
            ),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_amplify_next_electric_skill: compileEffect(
      defineEffect({
        id: 'effect_mark_amplify_next_electric_skill',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.element === 'Electric'),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.amplifyPower(2)),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_mark_next_attack_damage_increase_50_percent_sure_hit: compileEffect(
      defineEffect({
        id: 'effect_mark_next_attack_damage_increase_50_percent_sure_hit',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.skillUse.condition((_ctx, events) => events[0]?.category !== 'Status'),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.amplifyPower(1.5)),
          contexts.skillUse.apply(ops.setSureHit(1)),
        ),
      }),
    ),
    effect_mark_next_non_status_skill_sure_crit: compileEffect(
      defineEffect({
        id: 'effect_mark_next_non_status_skill_sure_crit',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          conditions.selfUsesSkill,
          contexts.skillUse.condition((_ctx, events) => events[0]?.skill.category !== 'Status'),
        ),
        apply: actions.sequence(contexts.skillUse.apply(ops.setSureCrit(1))),
      }),
    ),
    effect_mark_reduce_accuracy_next_skill_with_stack: compileEffect(
      defineEffect({
        id: 'effect_mark_reduce_accuracy_next_skill_with_stack',
        triggers: [EffectTrigger.BeforeUseSkillCheck],
        priority: 0,
        when: conditions.sourceOwnsEvent,
        apply: actions.sequence(
          contexts.skillUse.apply(
            ops.addAccuracy(
              targets.sourceMark
                .select(mark => mark.stack)
                .all()
                .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? -1 : 0)))),
            ),
          ),
          targets.sourceMark.apply(ops.removeMark()),
        ),
      }),
    ),
    effect_skill_add_power_10_consume_shazhidanke: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_10_consume_shazhidanke',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhidanke').condition(checks.exists()),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.addPower(10)),
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhidanke').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
    effect_skill_add_power_50_consume_heianwuzhi: compileEffect(
      defineEffect({
        id: 'effect_skill_add_power_50_consume_heianwuzhi',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(conditions.selfUsesSkill, (ctx: EffectFrame) => {
          const left = ctx.read(
            targets.opponentMarks
              .where(mark => mark.baseId === 'mark_heianwuzhi')
              .select(mark => mark.stack)
              .all(),
          )
          const right = 0
          return right !== undefined && left.some(value => value > right)
        }),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.addPower(50)),
          targets.opponentMarks.where(mark => mark.baseId === 'mark_heianwuzhi').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
    effect_skill_consume_dongqifuti_sure_crit: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_dongqifuti_sure_crit',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_dongqifuti').condition(checks.exists()),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.setSureCrit(0)),
          targets.opponentMarks.where(mark => mark.baseId === 'mark_dongqifuti').apply(ops.removeMark()),
        ),
      }),
    ),
    effect_skill_consume_heimowuzhi_2_sure_crit: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_heimowuzhi_2_sure_crit',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.opponentActive.condition((_ctx, pets) =>
            pets.some(pet => pet.marks.some(mark => mark.baseId === 'mark_heianwuzhi')),
          ),
          (ctx: EffectFrame) => {
            const left = ctx.read(
              targets.opponentMarks
                .where(mark => mark.baseId === 'mark_heianwuzhi')
                .select(mark => mark.stack)
                .all(),
            )
            const right = 1
            return right !== undefined && left.some(value => value > right)
          },
        ),
        apply: actions.sequence(
          targets.opponentMarks.where(mark => mark.baseId === 'mark_heianwuzhi').apply(ops.consumeStacks(2)),
          contexts.skillUse.apply(ops.setSureCrit(1)),
        ),
      }),
    ),
    effect_skill_consume_huanxiang_set_sure_hit: compileEffect(
      defineEffect({
        id: 'effect_skill_consume_huanxiang_set_sure_hit',
        triggers: [EffectTrigger.BeforeHit],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').condition(checks.exists()),
        ),
        apply: actions.sequence(
          targets.ownerMarks.where(mark => mark.baseId === 'mark_huanxiang').apply(ops.consumeStacks(1)),
          contexts.skillUse.apply(ops.setSureHit(99)),
        ),
      }),
    ),
    effect_skill_sure_hit_consume_shazhidanke: compileEffect(
      defineEffect({
        id: 'effect_skill_sure_hit_consume_shazhidanke',
        triggers: [EffectTrigger.AfterUseSkillCheck],
        priority: 0,
        when: conditions.all(
          conditions.selfUsesSkill,
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhidanke').condition(checks.exists()),
        ),
        apply: actions.sequence(
          contexts.skillUse.apply(ops.setSureHit(2)),
          targets.ownerMarks.where(mark => mark.baseId === 'mark_shazhidanke').apply(ops.consumeStacks(1)),
        ),
      }),
    ),
  })
}
export const generatedSkillOutcomeSequences = createGeneratedSkillOutcomeSequences()
