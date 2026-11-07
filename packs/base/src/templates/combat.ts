import { Element, StatTypeWithoutHp, type SkillInstance } from '@arcadia-eternity/battle/v4'
import { EffectTrigger, conditions, contexts, targets, ops, values } from '@arcadia-eternity/battle/v4/authoring'
import {
  template,
  numeric,
  choice,
  reference,
  textField,
  amount,
  target,
  chance,
  probability,
  type BuildContext,
  type TemplateField,
} from './contracts'

const scopes = ['all', 'element', 'tag', 'skill'] as const
type Scope = (typeof scopes)[number]
const scopeLabels: Record<Scope, string> = { all: '全部技能', element: '指定属性', tag: '指定标签', skill: '指定技能' }
function scopeFields(scope: Scope): Record<string, TemplateField> {
  if (scope === 'element') return { element: choice('技能属性', Object.values(Element)) }
  if (scope === 'tag') return { tag: textField('技能标签', 'xifa') }
  if (scope === 'skill') return { skill: reference('指定技能', 'skill') }
  return {}
}
function matches(c: BuildContext, scope: Scope): (skill: SkillInstance) => boolean {
  return skill =>
    scope === 'all' ||
    (scope === 'element'
      ? skill.element === c.text('element')
      : scope === 'tag'
        ? skill.tags.includes(c.text('tag'))
        : skill.baseId === c.text('skill'))
}
const damagingSkill = contexts.skillUse.condition((_ctx, uses) => uses.some(use => use.category !== 'Status'))

export const combatTemplates = [
  template(
    {
      id: 'change-stat-stage',
      family: 'stat-stage',
      title: '命中后改变能力等级',
      description: '本技能命中时，按概率改变自己或对手的指定能力等级。沿用等级上限和正常属性阶段印记流程。',
      timing: EffectTrigger.OnHit,
      sourceKind: 'skill',
      fields: {
        target: target(),
        stat: choice('能力', Object.values(StatTypeWithoutHp)),
        amount: numeric('等级变化', 1, -6, 6, '级', true),
        chance: chance(),
      },
    },
    c => ({
      triggers: [EffectTrigger.OnHit],
      when: conditions.all(conditions.selfUsesSkill, probability(c.number('chance'))),
      apply: (c.text('target') === 'self' ? targets.ownerPet : targets.opponentActive).apply(
        ops.changeStatStage(c.text('stat') as StatTypeWithoutHp, c.number('amount')),
      ),
    }),
  ),
  ...scopes.map(scope =>
    template(
      {
        id: `mark-skill-attribute-${scope}`,
        family: 'skill-attribute',
        title: `印记修改技能属性（${scopeLabels[scope]}）`,
        description: '印记创建时修改当前符合范围的技能，来源印记消失时清理；不自动覆盖以后新获得的技能。',
        timing: EffectTrigger.OnMarkCreated,
        sourceKind: 'petMark',
        fields: {
          ...scopeFields(scope),
          attribute: choice('技能字段', ['power', 'accuracy', 'rage', 'priority']),
          operation: choice('计算方式', ['delta', 'percent']),
          amount: amount(),
        },
      },
      c => ({
        triggers: [EffectTrigger.OnMarkCreated],
        rebindOnOwnerTransfer: true,
        apply: targets.selfSkills
          .where(matches(c, scope))
          .apply(
            ops.addSkillAttributeModifier(
              c.text('attribute') as 'power' | 'accuracy' | 'rage' | 'priority',
              c.text('operation') as 'delta' | 'percent',
              c.number('amount'),
              { lifetime: 'sourceMarkOrTargetSkill' },
            ),
          ),
      }),
    ),
  ),
  ...scopes.map(scope =>
    template(
      {
        id: `skill-power-${scope}`,
        family: 'skill-power',
        title: `使用技能时调整威力（${scopeLabels[scope]}）`,
        description: '持有者使用符合范围的技能时，调整本次使用的威力。加法与倍率分别选择，不改技能原型。',
        timing: EffectTrigger.AfterUseSkillCheck,
        sourceKind: 'petMark',
        fields: {
          ...scopeFields(scope),
          operation: choice('计算方式', ['add', 'multiply']),
          amount: numeric('增量或倍率', 1.5, 0, 1000),
        },
      },
      c => ({
        triggers: [EffectTrigger.AfterUseSkillCheck],
        when: conditions.all(
          conditions.ownerUsesSkill,
          contexts.skillUse.condition((_ctx, uses) => uses.some(use => matches(c, scope)(use.skill))),
        ),
        apply: contexts.skillUse.apply(
          c.text('operation') === 'add' ? ops.addPower(c.number('amount')) : ops.amplifyPower(c.number('amount')),
        ),
      }),
    ),
  ),
  ...(['dealt', 'taken'] as const).flatMap(direction =>
    [false, true].map(perStack =>
      template(
        {
          id: `modify-damage-${direction}${perStack ? '-per-stack' : ''}`,
          family: 'damage-modifier',
          title: `${direction === 'dealt' ? '造成' : '承受'}伤害修正${perStack ? '（每层）' : ''}`,
          description: '在伤害计算前调整固定值与百分比；每层版本读取来源印记当前层数并向下取整。',
          timing: EffectTrigger.OnBeforeCalculateDamage,
          sourceKind: 'petMark',
          fields: { percent: numeric('百分比修正', 10, -100, 1000, '%'), delta: amount(0) },
        },
        c => {
          const scaled = (name: string) =>
            perStack
              ? values.combine(targets.sourceMark.first().attribute('stack'), c.number(name), (stack, factor) =>
                  Math.floor(stack * factor),
                )
              : c.number(name)
          return {
            triggers: [EffectTrigger.OnBeforeCalculateDamage],
            when: direction === 'dealt' ? conditions.selfUsesSkill : conditions.selfBeDamaged,
            apply: contexts.damage.apply(ops.modifyDamage({ percent: scaled('percent'), delta: scaled('delta') })),
          }
        },
      ),
    ),
  ),
  ...(['accuracy', 'critRate', 'sureHit', 'sureCrit'] as const).map(result =>
    template(
      {
        id: `skill-result-${result}`,
        family: 'skill-result',
        title: `本技能${{ accuracy: '命中率修正', critRate: '暴击率修正', sureHit: '必中', sureCrit: '必暴' }[result]}`,
        description: '在本技能检查阶段修改本次使用结果。必中和必暴使用既有优先级裁决，不跳过其他机制。',
        timing:
          result === 'accuracy' || result === 'sureHit'
            ? EffectTrigger.BeforeUseSkillCheck
            : EffectTrigger.AfterUseSkillCheck,
        sourceKind: 'skill',
        fields:
          result === 'accuracy' || result === 'critRate'
            ? { amount: numeric('增减幅度', 10, -100, 100, '百分点') }
            : {},
      },
      c => ({
        triggers: [
          result === 'accuracy' || result === 'sureHit'
            ? EffectTrigger.BeforeUseSkillCheck
            : EffectTrigger.AfterUseSkillCheck,
        ],
        when: conditions.selfUsesSkill,
        apply: contexts.skillUse.apply(
          result === 'accuracy'
            ? ops.addAccuracy(c.number('amount'))
            : result === 'critRate'
              ? ops.addCritRate(c.number('amount'))
              : result === 'sureHit'
                ? ops.setSureHit(1)
                : ops.setSureCrit(1),
        ),
      }),
    ),
  ),
  ...(['power', 'sureHit', 'sureCrit'] as const).map(result =>
    template(
      {
        id: `next-attack-${result}`,
        family: 'next-attack',
        title: `下次攻击${{ power: '强化', sureHit: '必中', sureCrit: '必暴' }[result]}并消费印记`,
        description: '持有者下一次非状态技能在检查阶段获得强化并消费来源印记。消费在命中判定完成前，未命中仍消费。',
        timing: EffectTrigger.AfterUseSkillCheck,
        sourceKind: 'petMark',
        fields: {
          ...(result === 'power' ? { multiplier: numeric('威力倍率', 1.5, 0, 1000) } : {}),
          stacks: {
            ...numeric('消费层数', 1, 1, 100000, '层', true),
            contract: { kind: 'number', default: 1, minimum: 1, maximum: 100000, integer: true, static: true },
          },
        },
      },
      c => ({
        triggers: [EffectTrigger.AfterUseSkillCheck],
        consumesStacks: c.scalar('stacks'),
        when: conditions.all(conditions.selfUsesSkill, damagingSkill),
        apply: contexts.skillUse.apply(
          result === 'power'
            ? ops.amplifyPower(c.number('multiplier'))
            : result === 'sureHit'
              ? ops.setSureHit(1)
              : ops.setSureCrit(1),
        ),
      }),
    ),
  ),
  ...(['set', 'add'] as const).map(operation =>
    template(
      {
        id: `multihit-${operation}`,
        family: 'multihit',
        title: operation === 'set' ? '按概率设置多段次数' : '追加多段次数',
        description:
          operation === 'set'
            ? '本技能检查后，按概率设置多段次数。'
            : '本技能原本具有多段次数时，在多段判定前追加次数。',
        timing: operation === 'set' ? EffectTrigger.AfterUseSkillCheck : EffectTrigger.BeforeMultiHit,
        sourceKind: 'skill',
        fields: { amount: numeric('次数', operation === 'set' ? 2 : 1, 1, 100, '次', true), chance: chance() },
      },
      c => ({
        triggers: [operation === 'set' ? EffectTrigger.AfterUseSkillCheck : EffectTrigger.BeforeMultiHit],
        when: conditions.all(
          conditions.selfUsesSkill,
          ...(operation === 'add'
            ? [contexts.skillUse.condition((_ctx, uses) => uses.some(use => use.multihitResult > 1))]
            : []),
          probability(c.number('chance')),
        ),
        apply: contexts.skillUse.apply(
          operation === 'set' ? ops.setMultihit(c.number('amount')) : ops.addMultihitResult(c.number('amount')),
        ),
      }),
    ),
  ),
]
