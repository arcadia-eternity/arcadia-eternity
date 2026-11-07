import { EffectTrigger, conditions, contexts, targets, ops, values } from '@arcadia-eternity/battle/v4/authoring'
import { template, numeric, choice, target } from './contracts'

import { healingOnHit, consecutiveHealingAmount } from '../effects/shared-plans'

const hp = targets.ownerPet.first().attribute('maxHp')
const players = (selection: string) =>
  selection === 'self' ? targets.selfPlayer : targets.opponentActive.flatMap(pet => (pet.owner ? [pet.owner] : []))

export const resourceTemplates = [
  template(
    {
      id: 'heal-fixed',
      family: 'healing',
      title: '技能恢复生命',
      description: '本技能命中后恢复自身固定生命，通过正常治疗流程结算。',
      timing: EffectTrigger.OnHit,
      sourceKind: 'skill',
      fields: { amount: numeric('治疗量', 90, 0, 1000000) },
    },
    c => healingOnHit(c.number('amount')),
  ),
  template(
    {
      id: 'heal-fraction',
      family: 'healing',
      title: '按最大生命恢复',
      description: '本技能命中后，按最大生命乘分子再除分母向下取整后治疗。',
      timing: EffectTrigger.OnHit,
      sourceKind: 'skill',
      fields: {
        numerator: numeric('分子', 1, 0, 1000, undefined, true),
        denominator: numeric('分母', 2, 1, 1000, undefined, true),
      },
    },
    c =>
      healingOnHit(
        values.combine(
          values.combine(hp, c.number('numerator'), (max, numerator) => max * numerator),
          c.number('denominator'),
          (value, denominator) => Math.floor(value / denominator),
        ),
      ),
  ),
  template(
    {
      id: 'heal-consecutive',
      family: 'consecutive-healing',
      title: '连续使用改变治疗量',
      description: '本技能命中后，连续使用次数大于一时采用连续治疗量，否则采用普通治疗量。',
      timing: EffectTrigger.OnHit,
      sourceKind: 'skill',
      fields: { normal: numeric('普通治疗量', 60, 0, 1000000), repeated: numeric('连续治疗量', 120, 0, 1000000) },
    },
    c => healingOnHit(consecutiveHealingAmount(c.number('normal'), c.number('repeated'))),
  ),
  template(
    {
      id: 'heal-from-damage',
      family: 'damage-benefit',
      title: '伤害转治疗',
      description: '本技能造成伤害后，按结算伤害的一定比例向下取整后恢复自身生命；结算伤害可能超过目标剩余生命。',
      timing: EffectTrigger.OnDamage,
      sourceKind: 'skill',
      fields: { ratio: numeric('治疗比例', 0.25, 0, 10, '倍率') },
    },
    c => ({
      triggers: [EffectTrigger.OnDamage],
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(
        ops.heal(
          values.combine(
            contexts.damage.select(event => event.damageResult).first(),
            c.number('ratio'),
            (damage, ratio) => Math.floor(damage * ratio),
          ),
        ),
      ),
    }),
  ),
  template(
    {
      id: 'rage-after-damage',
      family: 'damage-benefit',
      title: '伤害超过阈值后获得怒气',
      description: '本技能的结算伤害严格大于阈值时，为己方增加怒气。',
      timing: EffectTrigger.OnDamage,
      sourceKind: 'skill',
      fields: { threshold: numeric('伤害阈值', 100, 0, 1000000), amount: numeric('怒气量', 25, 0, 1000000) },
    },
    c => ({
      triggers: [EffectTrigger.OnDamage],
      when: conditions.all(
        conditions.selfUsesSkill,
        contexts.damage.condition((ctx, events) =>
          events.some(event => event.damageResult > ctx.read(c.number('threshold'))),
        ),
      ),
      apply: targets.selfPlayer.apply(ops.addRage(c.number('amount'))),
    }),
  ),
  template(
    {
      id: 'rage-after-crit',
      family: 'damage-benefit',
      title: '暴击伤害后获得怒气',
      description: '本技能暴击伤害结束后，为己方增加怒气。',
      timing: EffectTrigger.OnCritPostDamage,
      sourceKind: 'skill',
      fields: { amount: numeric('怒气量', 20, 0, 1000000) },
    },
    c => ({
      triggers: [EffectTrigger.OnCritPostDamage],
      when: conditions.selfUsesSkill,
      apply: targets.selfPlayer.apply(ops.addRage(c.number('amount'))),
    }),
  ),
  ...(['heal', 'damage', 'rage'] as const).map(resource =>
    template(
      {
        id: `turn-end-${resource}`,
        family: 'periodic-vitals',
        title: `回合末${{ heal: '恢复生命', damage: '造成伤害', rage: '改变怒气' }[resource]}`,
        description: '持有者出战时，在回合末对所选对象执行固定资源变化，沿用对应结算流程。',
        timing: EffectTrigger.TurnEnd,
        sourceKind: 'petMark',
        fields: {
          target: target(),
          amount: numeric('数值', resource === 'rage' ? 5 : 25, 0, 1000000),
          ...(resource === 'rage' ? { operation: choice('怒气变化', ['add', 'reduce']) } : {}),
        },
      },
      c => ({
        triggers: [EffectTrigger.TurnEnd],
        when: conditions.ownerIsActive,
        apply:
          resource === 'rage'
            ? players(c.text('target')).apply(
                c.text('operation') === 'add' ? ops.addRage(c.number('amount')) : ops.reduceRage(c.number('amount')),
              )
            : (c.text('target') === 'self' ? targets.ownerPet : targets.opponentActive).apply(
                resource === 'heal' ? ops.heal(c.number('amount')) : ops.dealDamage(c.number('amount')),
              ),
      }),
    ),
  ),
  template(
    {
      id: 'rage-on-hit',
      family: 'periodic-vitals',
      title: '命中后改变怒气',
      description: '本技能命中时，对所选一方增加或减少怒气；分别触发获得与损失怒气的结算。',
      timing: EffectTrigger.OnHit,
      sourceKind: 'skill',
      fields: {
        target: target(),
        operation: choice('怒气变化', ['add', 'reduce']),
        amount: numeric('怒气量', 20, 0, 1000000),
      },
    },
    c => ({
      triggers: [EffectTrigger.OnHit],
      when: conditions.selfUsesSkill,
      apply: players(c.text('target')).apply(
        c.text('operation') === 'add' ? ops.addRage(c.number('amount')) : ops.reduceRage(c.number('amount')),
      ),
    }),
  ),
]
