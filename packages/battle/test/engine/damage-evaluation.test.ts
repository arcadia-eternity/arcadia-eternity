import { afterEach, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  BaseMark,
  DamageContext,
  DamageType,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  effectAuthoring,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/engine'
import { makeScenario } from './scenario'

const { actions, compileEffect, contexts, ops, selectFrom } = effectAuthoring
const battles: Battle[] = []
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function setup() {
  const { a, b, battle, debuff } = makeScenario()
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const skill = a.activePet.skills[0]
  const target = b.activePet
  const mark = new BaseMark('test/damage-cost' as baseMarkId, [], { ...debuff.config, maxStacks: 3 }).createInstance({
    stack: 3,
  })
  mark.setOwner(target, battle.emitter)
  target.marks.push(mark)
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
  const damage = new DamageContext(use, skill, target, 30, DamageType.Physical)
  return { target, skill, mark, damage }
}

it('discards a failed numeric rule and its reserved cost before evaluating the next effect', () => {
  const { target, skill, mark, damage } = setup()
  const before = target.currentHp
  mark.effects.push(
    compileEffect({
      id: 'test/failed-rule',
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      priority: 9,
      consumesStacks: 2,
      apply: actions.sequence(
        contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -15 })),
        selectFrom([target]).property('currentHp').apply(ops.assign(1)),
      ),
    }),
  )
  skill.effects.push(
    compileEffect({
      id: 'test/working-rule',
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -2 })),
    }),
  )

  target.damage(damage)
  expect(target.currentHp).toBe(before - 28)
  expect(mark.stack).toBe(3)
  expect(damage.result?.hpLoss).toBe(28)
})

it('vetoes a numeric effect through its immediate BeforeEffect context without spending its stack cost', () => {
  const { target, skill, mark, damage } = setup()
  const before = target.currentHp
  mark.effects.push(
    compileEffect({
      id: 'test/vetoed',
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      consumesStacks: 1,
      apply: contexts.damage.apply(ops.modifyDamage({ percent: 0, delta: -15 })),
    }),
  )
  skill.effects.push(
    compileEffect({
      id: 'test/meta-veto',
      triggers: [EffectTrigger.BeforeEffect],
      when: contexts.effect.condition((_frame, events) => events.some(event => event.effect?.id === 'test/vetoed')),
      apply: contexts.effect.apply(ops.disableContext()),
    }),
  )

  target.damage(damage)
  expect(target.currentHp).toBe(before - 30)
  expect(mark.stack).toBe(3)
})

it('pays the selected Shield rule exactly once', () => {
  const { target, mark, damage } = setup()
  mark.stack = 1
  mark.effects.push(
    compileEffect({
      id: 'test/shield-cost',
      triggers: [EffectTrigger.Shield],
      consumesStacks: 1,
      apply: contexts.damage.apply(ops.preventDamage({ amount: 7 })),
    }),
  )
  const hp = target.currentHp
  target.damage(damage)
  expect(target.currentHp).toBe(hp - 23)
  expect(mark.stack).toBe(0)
})

it('honors a healing veto before committing the conversion cost', () => {
  const { target, skill, mark, damage } = setup()
  target.currentHp -= 10
  const hp = target.currentHp
  mark.effects.push(
    compileEffect({
      id: 'test/absorb',
      triggers: [EffectTrigger.OnDamageReplacement],
      apply: contexts.damage.apply(ops.replaceDamageWithHeal(1, 1)),
    }),
  )
  skill.effects.push(
    compileEffect({
      id: 'test/veto-heal',
      triggers: [EffectTrigger.OnBeforeHeal],
      apply: contexts.heal.apply(ops.disableContext()),
    }),
  )
  target.damage(damage)
  expect(target.currentHp).toBe(hp)
  expect(mark.stack).toBe(3)
})

it('reserves a healing modifier cost from the same ledger as the conversion', () => {
  const { target, mark, damage } = setup()
  target.currentHp -= 60
  const hp = target.currentHp
  mark.effects.push(
    compileEffect({
      id: 'test/conversion',
      triggers: [EffectTrigger.OnDamageReplacement],
      apply: contexts.damage.apply(ops.replaceDamageWithHeal(1, 1)),
    }),
    compileEffect({
      id: 'test/paid-heal-bonus',
      triggers: [EffectTrigger.OnBeforeHeal],
      consumesStacks: 2,
      apply: contexts.heal.apply(ops.modifyHeal({ percent: 0, delta: 10 })),
    }),
  )
  target.damage(damage)
  expect(target.currentHp).toBe(hp + 40)
  expect(damage.result?.payments.map(cost => cost.stacks)).toEqual([1, 2])
  expect(mark.stack).toBe(0)
})

it('rejects HP assignments from an immediate selector callback before committing the proposal', () => {
  const { target, skill, damage } = setup()
  const hp = target.currentHp
  skill.effects.push(
    compileEffect({
      id: 'test/invalid-selector',
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      apply(frame) {
        frame.read(
          selectFrom([target])
            .select(pet => {
              pet.currentHp = 1
              return pet.currentHp
            })
            .first(),
        )
      },
    }),
  )
  target.damage(damage)
  expect(target.currentHp).toBe(hp - 30)
})
