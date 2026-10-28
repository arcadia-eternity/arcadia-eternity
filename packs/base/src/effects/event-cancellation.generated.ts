// Reviewed native behavior; edit this TypeScript source directly.
import {
  EffectTrigger,
  compileEffect,
  defineEffect,
  conditions,
  contexts,
  targets,
  ops,
  actions,
  type EffectFrame,
} from '@arcadia-eternity/battle/v4/authoring'
export function createGeneratedEventCancellation() {
  return Object.freeze({
    effect_ability_immune_exceptional_if_rage_gt_50: compileEffect(
      defineEffect({
        id: 'effect_ability_immune_exceptional_if_rage_gt_50',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.selfPlayer.select(player => player.currentRage).first())
            const right = 50
            return left !== undefined && right !== undefined && left > right
          },
          contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.tags[0] === 'exceptional')),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
    effect_ability_shenguang_immune_status_above_half_hp: compileEffect(
      defineEffect({
        id: 'effect_ability_shenguang_immune_status_above_half_hp',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.tags[0] === 'status')),
          (ctx: EffectFrame) => {
            const left = ctx.read(targets.ownerPet.select(pet => pet.currentHp).first())
            const right = ctx.read(
              targets.ownerPet
                .select(pet => pet.stat.maxHp)
                .first()
                .map(n => Math.floor(n / 2)),
            )
            return left !== undefined && right !== undefined && left > right
          },
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
    effect_emblem_anying_immune_fear_early_wake: compileEffect(
      defineEffect({
        id: 'effect_emblem_anying_immune_fear_early_wake',
        triggers: [EffectTrigger.BeforeEffect],
        priority: 0,
        when: conditions.all(
          conditions.damageTargetBelongsToOtherPlayer,
          contexts.effect.condition((_ctx, events) =>
            events.some(event => event.effect?.id === 'effect_mark_onDamage_over100_recovery'),
          ),
        ),
        apply: actions.sequence(contexts.effect.apply(ops.disableContext())),
      }),
    ),
    effect_emblem_immune_mark_haipa: compileEffect(
      defineEffect({
        id: 'effect_emblem_immune_mark_haipa',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_haipa'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
    effect_emblem_immune_mark_zhixi: compileEffect(
      defineEffect({
        id: 'effect_emblem_immune_mark_zhixi',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_zhixi'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
    effect_mark_disabled_xingzhili_effect: compileEffect(
      defineEffect({
        id: 'effect_mark_disabled_xingzhili_effect',
        triggers: [EffectTrigger.BeforeEffect],
        priority: 0,
        when: conditions.all(
          conditions.sourceOwnsEvent,
          contexts.effect.condition((_ctx, events) => events.some(event => event.effect?.tags[0] === 'xingzhili')),
        ),
        apply: actions.sequence(contexts.effect.apply(ops.disableContext())),
      }),
    ),
    effect_mark_immune_exceptional: compileEffect(
      defineEffect({
        id: 'effect_mark_immune_exceptional',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.tags[0] === 'exceptional')),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
    effect_mark_immune_stage_debuff: compileEffect(
      defineEffect({
        id: 'effect_mark_immune_stage_debuff',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          conditions.any(
            conditions.statStageChange('atk', 'down'),
            conditions.statStageChange('def', 'down'),
            conditions.statStageChange('spa', 'down'),
            conditions.statStageChange('spd', 'down'),
            conditions.statStageChange('spe', 'down'),
          ),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
    effect_mark_immune_status: compileEffect(
      defineEffect({
        id: 'effect_mark_immune_status',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.tags[0] === 'status')),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
    effect_mark_immune_zhongdu: compileEffect(
      defineEffect({
        id: 'effect_mark_immune_zhongdu',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_zhongdu'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.disableContext())),
      }),
    ),
  })
}
export const generatedEventCancellation = createGeneratedEventCancellation()
