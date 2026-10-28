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
export function createGeneratedMarkApplicationSettings() {
  return Object.freeze({
    effect_emblem_add_manxingduyao_maxstack_4: compileEffect(
      defineEffect({
        id: 'effect_emblem_add_manxingduyao_maxstack_4',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_manxingduyao'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkMaxStack(14))),
      }),
    ),
    effect_emblem_add_mark_yanhuo_duration_1: compileEffect(
      defineEffect({
        id: 'effect_emblem_add_mark_yanhuo_duration_1',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 1,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_yanhuo'),
        ),
        apply: actions.sequence(
          contexts.addMark.apply(
            ops.setMarkDuration(
              contexts.addMark
                .select(event => event.duration)
                .all()
                .map(items => items.map((n, index) => n + (index === 0 ? 1 : 0))),
            ),
          ),
        ),
      }),
    ),
    effect_emblem_add_shaoshang_duration: compileEffect(
      defineEffect({
        id: 'effect_emblem_add_shaoshang_duration',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_shaoshang'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(4))),
      }),
    ),
    effect_emblem_add_xingzhili_duration: compileEffect(
      defineEffect({
        id: 'effect_emblem_add_xingzhili_duration',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_xingzhili'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(10))),
      }),
    ),
    effect_emblem_add_xuanyun_duration: compileEffect(
      defineEffect({
        id: 'effect_emblem_add_xuanyun_duration',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_xuanyun'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(6))),
      }),
    ),
    effect_emblem_add_zhenjiu_duration_1: compileEffect(
      defineEffect({
        id: 'effect_emblem_add_zhenjiu_duration_1',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 1,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_mianyibuliang'),
        ),
        apply: actions.sequence(
          contexts.addMark.apply(
            ops.setMarkDuration(
              contexts.addMark
                .select(event => event.duration)
                .all()
                .map(items => items.map((n, index) => n + (index === 0 ? 1 : 0))),
            ),
          ),
        ),
      }),
    ),
    effect_emblem_dadiqiang_duration_boost_1: compileEffect(
      defineEffect({
        id: 'effect_emblem_dadiqiang_duration_boost_1',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_yinghua'),
        ),
        apply: actions.sequence(
          contexts.addMark.apply(
            ops.setMarkDuration(
              contexts.addMark
                .select(event => event.duration)
                .all()
                .map(items => items.map((n, index) => n + (index === 0 ? 1 : 0))),
            ),
          ),
        ),
      }),
    ),
    effect_emblem_decrease_liuxie_duration_1: compileEffect(
      defineEffect({
        id: 'effect_emblem_decrease_liuxie_duration_1',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_liuxie'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(2))),
      }),
    ),
    effect_emblem_decrease_shiming_duration_1: compileEffect(
      defineEffect({
        id: 'effect_emblem_decrease_shiming_duration_1',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_shiming'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(2))),
      }),
    ),
    effect_emblem_extend_bizhong_duration_5: compileEffect(
      defineEffect({
        id: 'effect_emblem_extend_bizhong_duration_5',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_bizhong'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(10))),
      }),
    ),
    effect_emblem_increase_huohuanzhixin_maxstacks_4: compileEffect(
      defineEffect({
        id: 'effect_emblem_increase_huohuanzhixin_maxstacks_4',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_huohuanzhixin'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkMaxStack(10))),
      }),
    ),
    effect_emblem_increase_leishenjuexing_duration_1: compileEffect(
      defineEffect({
        id: 'effect_emblem_increase_leishenjuexing_duration_1',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_leishenjuexing'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(4))),
      }),
    ),
    effect_emblem_set_zhongdu_duration_2: compileEffect(
      defineEffect({
        id: 'effect_emblem_set_zhongdu_duration_2',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_zhongdu'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(2))),
      }),
    ),
    effect_emblem_shazhidanke_max_stack_4: compileEffect(
      defineEffect({
        id: 'effect_emblem_shazhidanke_max_stack_4',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_shazhidanke'),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkMaxStack(4))),
      }),
    ),
    effect_emblem_xuruo_10percent_extra_debuff_stack: compileEffect(
      defineEffect({
        id: 'effect_emblem_xuruo_10percent_extra_debuff_stack',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerAddsMark,
          conditions.any(
            conditions.statStageChange('atk', 'down'),
            conditions.statStageChange('def', 'down'),
            conditions.statStageChange('spa', 'down'),
            conditions.statStageChange('spd', 'down'),
            conditions.statStageChange('spe', 'down'),
          ),
          conditions.chance(10),
        ),
        apply: actions.sequence(
          contexts.addMark.apply(
            ops.setMarkStack(
              contexts.addMark
                .select(event => event.stack)
                .all()
                .map(items => items.map((n, index) => n + (index === 0 ? 1 : 0))),
            ),
          ),
        ),
      }),
    ),
    effect_emblem_yaoling_extend_zhaocai_jinbao_duration: compileEffect(
      defineEffect({
        id: 'effect_emblem_yaoling_extend_zhaocai_jinbao_duration',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) =>
            events.some(event => (['mark_zhaocai', 'mark_jinbao'] as string[]).includes(event.baseMark.id)),
          ),
        ),
        apply: actions.sequence(contexts.addMark.apply(ops.setMarkDuration(6))),
      }),
    ),
    effect_mark_double_mark_yanhuo_duration: compileEffect(
      defineEffect({
        id: 'effect_mark_double_mark_yanhuo_duration',
        triggers: [EffectTrigger.OnBeforeAddMark],
        priority: 0,
        consumesStacks: 1,
        when: conditions.all(
          conditions.ownerReceivesMark,
          contexts.addMark.condition((_ctx, events) => events[0]?.baseMark.id === 'mark_yanhuo'),
        ),
        apply: actions.sequence(
          contexts.addMark.apply(
            ops.setMarkDuration(
              contexts.addMark
                .select(event => event.duration)
                .all()
                .map(items => items.map((n, index) => Math.floor(n * (index === 0 ? 2 : 0)))),
            ),
          ),
        ),
      }),
    ),
  })
}
export const generatedMarkApplicationSettings = createGeneratedMarkApplicationSettings()
