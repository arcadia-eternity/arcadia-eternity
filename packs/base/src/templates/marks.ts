import {
  EffectTrigger,
  conditions,
  contexts,
  targets,
  ops,
  bindings,
  type Trigger,
} from '@arcadia-eternity/battle/v4/authoring'
import {
  template,
  numeric,
  choice,
  reference,
  chance,
  stacks,
  amount,
  target,
  attributes,
  operations,
  probability,
} from './contracts'

import { statusTransferOnHit } from '../effects/shared-plans'

const pets = (selection: string) => (selection === 'self' ? targets.ownerPet : targets.opponentActive)
const marks = (selection: string) =>
  selection === 'self' ? targets.ownerMarks : targets.opponentActive.flatMap(pet => pet.marks)
const categories = ['status', 'exceptional', 'debuff'] as const

export const markTemplates = [
  template(
    {
      id: 'apply-mark-on-hit',
      family: 'apply-mark',
      title: '命中后附加印记',
      description: '本技能命中时，按概率向自己或对手当前目标附加指定印记。使用印记自身的持续与叠层配置。',
      timing: EffectTrigger.OnHit,
      sourceKind: 'skill',
      fields: { mark: reference('印记', 'mark'), target: target(), chance: chance(), stacks: stacks() },
    },
    c => ({
      triggers: [EffectTrigger.OnHit],
      when: conditions.all(conditions.selfUsesSkill, probability(c.number('chance'))),
      apply: pets(c.text('target')).apply(ops.addMark(c.mark('mark'), { stack: c.number('stacks') })),
    }),
  ),
  template(
    {
      id: 'mark-attribute',
      family: 'mark-attribute',
      title: '印记修改属性',
      description: '印记创建时为持有者增加属性贡献，随来源印记清理。百分比与固定值分别计算。',
      timing: EffectTrigger.OnMarkCreated,
      sourceKind: 'petMark',
      fields: { attribute: choice('属性', attributes), operation: choice('计算方式', operations), amount: amount() },
    },
    c => ({
      triggers: [EffectTrigger.OnMarkCreated],
      rebindOnOwnerTransfer: true,
      apply: targets.ownerPet.apply(
        ops.addAttributeModifier(
          c.text('attribute') as (typeof attributes)[number],
          c.text('operation') as 'delta' | 'percent',
          c.number('amount'),
        ),
      ),
    }),
  ),
  template(
    {
      id: 'mark-attribute-per-stack',
      family: 'stack-attribute',
      title: '每层印记修改属性',
      description: '属性增量为印记当前层数乘每层数值并向下取整；层数变化时更新，来源消失时解除。',
      timing: 'OnMarkCreated / stack binding',
      sourceKind: 'petMark',
      fields: { attribute: choice('属性', attributes), amount: amount() },
    },
    c => ({
      triggers: [EffectTrigger.OnMarkCreated],
      rebindOnOwnerTransfer: true,
      apply: targets.ownerPet.apply(
        ops.bindAttribute({
          key: 'contribution',
          attribute: c.text('attribute') as (typeof attributes)[number],
          operation: 'delta',
          value: bindings.combine(
            targets.sourceMark
              .first()
              .capture({ key: 'source', scope: 'binding' })
              .attribute('stack')
              .follow({ key: 'stack' }),
            c.number('amount').capture({ key: 'factor', scope: 'binding' }),
            (stack, factor) => Math.floor(stack * factor),
          ),
          stacking: 'append',
          lifetime: 'sourceMark',
          missing: 'detach',
        }),
      ),
    }),
  ),
  template(
    {
      id: 'consume-mark-on-hit',
      family: 'consume-mark',
      title: '命中后消耗印记层数',
      description: '本技能命中后消耗指定印记的层数；没有该印记时不生效。不把消费结果传递给其他效果。',
      timing: 'OnHit / priority -50',
      sourceKind: 'skill',
      fields: { mark: reference('印记', 'mark'), target: target(), stacks: stacks() },
    },
    c => ({
      triggers: [EffectTrigger.OnHit],
      priority: -50,
      when: conditions.selfUsesSkill,
      apply: marks(c.text('target'))
        .where(mark => mark.baseId === c.text('mark'))
        .apply(ops.consumeStacks(c.number('stacks'))),
    }),
  ),
  template(
    {
      id: 'clear-status-on-hit',
      family: 'clear-status',
      title: '命中后清除状态',
      description: '移除所选对象上带指定状态标签的印记，使用正常移除流程。',
      timing: EffectTrigger.OnHit,
      sourceKind: 'skill',
      fields: { target: target(), category: choice('状态类别', categories) },
    },
    c => ({
      triggers: [EffectTrigger.OnHit],
      when: conditions.selfUsesSkill,
      apply: marks(c.text('target'))
        .where(mark => mark.tags.includes(c.text('category')))
        .apply(ops.removeMark()),
    }),
  ),
  ...(['switch-in', 'battle-start'] as const).map(event =>
    template(
      {
        id: `apply-mark-on-${event}`,
        family: 'entry-mark',
        title: event === 'switch-in' ? '换入时获得印记' : '开战时获得印记',
        description: '持有者换入或作为开场出战精灵时，为自己附加印记。',
        timing: event === 'switch-in' ? EffectTrigger.OnSwitchIn : EffectTrigger.OnBattleStart,
        sourceKind: 'petMark',
        fields: { mark: reference('印记', 'mark'), chance: chance(), stacks: stacks() },
      },
      c => ({
        triggers: [(event === 'switch-in' ? EffectTrigger.OnSwitchIn : EffectTrigger.OnBattleStart) as Trigger],
        when: conditions.all(
          event === 'switch-in' ? conditions.ownerSwitchesIn : conditions.ownerIsActive,
          probability(c.number('chance')),
        ),
        apply: targets.ownerPet.apply(ops.addMark(c.mark('mark'), { stack: c.number('stacks') })),
      }),
    ),
  ),
  template(
    {
      id: 'apply-mark-when-damaged',
      family: 'reaction-mark',
      title: '受击后附加印记',
      description: '持有者受到伤害时，按概率向自己或对手当前出战精灵附加印记。',
      timing: EffectTrigger.OnDamage,
      sourceKind: 'petMark',
      fields: { mark: reference('印记', 'mark'), target: target(), chance: chance(), stacks: stacks() },
    },
    c => ({
      triggers: [EffectTrigger.OnDamage],
      when: conditions.all(conditions.selfBeDamaged, probability(c.number('chance'))),
      apply: pets(c.text('target')).apply(ops.addMark(c.mark('mark'), { stack: c.number('stacks') })),
    }),
  ),
  ...(['expiry', 'destroy'] as const).map(event =>
    template(
      {
        id: `apply-mark-on-${event}`,
        family: 'successor-mark',
        title: event === 'expiry' ? '印记到期后附加印记' : '印记销毁后附加印记',
        description:
          '由引擎向来源印记派发对应生命周期事件，为原持有者附加后继印记。销毁包含到期后的销毁阶段。后继必须为不同且无互斥组的印记。',
        timing: event === 'expiry' ? EffectTrigger.OnMarkDurationEnd : EffectTrigger.OnMarkDestroy,
        sourceKind: 'petMark',
        fields: { mark: reference('后继印记', 'mark'), stacks: stacks() },
      },
      c => ({
        triggers: [(event === 'expiry' ? EffectTrigger.OnMarkDurationEnd : EffectTrigger.OnMarkDestroy) as Trigger],
        apply: targets.ownerPet.apply(ops.addMark(c.successor('mark'), { stack: c.number('stacks') })),
      }),
    ),
  ),
  template(
    {
      id: 'grow-mark-on-turn-end',
      family: 'periodic-stacks',
      title: '回合末增加层数',
      description: '持有者处于出战位置时，每回合末增加来源印记层数，服从印记层数上限。',
      timing: EffectTrigger.TurnEnd,
      sourceKind: 'petMark',
      fields: { stacks: stacks() },
    },
    c => ({
      triggers: [EffectTrigger.TurnEnd],
      when: conditions.ownerIsActive,
      apply: targets.sourceMark.apply(ops.addStacks(c.number('stacks'))),
    }),
  ),
  template(
    {
      id: 'consume-mark-after-skill',
      family: 'periodic-stacks',
      title: '使用攻击技能后消耗层数',
      description: '持有者使用非状态、非必杀技能结束时，消耗来源印记层数。',
      timing: EffectTrigger.SkillUseEnd,
      sourceKind: 'petMark',
      fields: { stacks: stacks() },
    },
    c => ({
      triggers: [EffectTrigger.SkillUseEnd],
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.skillUse.condition((_ctx, uses) =>
          uses.some(use => use.category !== 'Status' && use.category !== 'Climax'),
        ),
      ),
      apply: targets.sourceMark.apply(ops.consumeStacks(c.number('stacks'))),
    }),
  ),
  ...(['duration', 'maxStacks'] as const).map(setting =>
    template(
      {
        id: `modify-mark-${setting}`,
        family: 'mark-application',
        title: setting === 'duration' ? '修改附加印记的持续时间' : '修改附加印记的层数上限',
        description: '持有者施加指定印记时，设置这次附加的配置；不改印记原型。',
        timing: EffectTrigger.OnBeforeAddMark,
        sourceKind: 'petMark',
        fields: {
          mark: reference('印记', 'mark'),
          amount: numeric(
            setting === 'duration' ? '持续回合' : '层数上限',
            3,
            setting === 'duration' ? -1 : 1,
            100000,
            undefined,
            true,
          ),
        },
      },
      c => ({
        triggers: [EffectTrigger.OnBeforeAddMark],
        when: conditions.all(
          conditions.ownerAddsMark,
          contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.id === c.text('mark'))),
        ),
        apply: contexts.addMark.apply(
          setting === 'duration' ? ops.setMarkDuration(c.number('amount')) : ops.setMarkMaxStack(c.number('amount')),
        ),
      }),
    ),
  ),
  template(
    {
      id: 'immune-mark',
      family: 'mark-immunity',
      title: '免疫指定印记',
      description: '在持有者接收指定印记之前取消该次附加，不移除已经存在的印记。',
      timing: EffectTrigger.OnBeforeAddMark,
      sourceKind: 'petMark',
      fields: { mark: reference('免疫印记', 'mark') },
    },
    c => ({
      triggers: [EffectTrigger.OnBeforeAddMark],
      when: conditions.all(
        conditions.ownerReceivesMark,
        contexts.addMark.condition((_ctx, events) => events.some(event => event.baseMark.id === c.text('mark'))),
      ),
      apply: contexts.addMark.apply(ops.disableContext()),
    }),
  ),
  template(
    {
      id: 'immune-status-category',
      family: 'mark-immunity',
      title: '免疫状态类别',
      description: '接收带所选标签的印记时取消附加；类别按完整标签列表匹配。',
      timing: EffectTrigger.OnBeforeAddMark,
      sourceKind: 'petMark',
      fields: { category: choice('状态类别', categories) },
    },
    c => ({
      triggers: [EffectTrigger.OnBeforeAddMark],
      when: conditions.all(
        conditions.ownerReceivesMark,
        contexts.addMark.condition((_ctx, events) =>
          events.some(event => event.baseMark.tags.includes(c.text('category'))),
        ),
      ),
      apply: contexts.addMark.apply(ops.disableContext()),
    }),
  ),
  template(
    {
      id: 'transfer-status-on-hit',
      family: 'status-transfer',
      title: '命中后转移状态',
      description: '把自己带所选标签的印记转移给对手；使用既有转移流程，保留其层数与持续语义。',
      timing: EffectTrigger.OnHit,
      sourceKind: 'skill',
      fields: { category: choice('状态类别', categories) },
    },
    c => statusTransferOnHit(c.text('category')),
  ),
]
