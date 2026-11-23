import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  BaseMark,
  DamageContext,
  DamageType,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/engine'
import { DamagePayments } from '../../src/engine/damagePayments'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function setup() {
  const { battle, a, b, debuff } = makeScenario()
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = b.activePet
  const mark = new BaseMark('fixture/payment' as baseMarkId, [], { ...debuff.config, maxStacks: 5 }).createInstance({
    stack: 5,
  })
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  const skill = a.activePet.skills[0]
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
  const damage = new DamageContext(use, skill, owner, 30, DamageType.Special)
  return { damage, skill, mark, owner, payments: new DamagePayments(damage) }
}

it('requires exact successful costs but lets a shield spend a smaller authorized amount', () => {
  const { skill, mark, owner, payments } = setup()
  const observed: (number | string)[][] = []
  const preflight: string[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/cost-maximum' as effectId,
      triggers: [EffectTrigger.OnBeforeConsumeStack],
      apply(ctx) {
        preflight.push(ctx.parent.reason)
        ctx.parent.setActualAmount(2)
      },
    }),
    defineNativeEffect({
      id: 'fixture/after-payment' as effectId,
      triggers: [EffectTrigger.OnConsumeStack],
      apply(ctx) {
        observed.push([ctx.parent.reason, ctx.parent.actualAmount, mark.stack, owner.currentHp])
      },
    }),
  )
  expect(payments.reserve(mark, 3)).toBe(0)
  expect(payments.reserve(mark, 9, true, 'shield')).toBe(2)
  expect(mark.stack).toBe(5)
  expect(observed).toEqual([])
  const rollback = payments.savepoint()
  expect(payments.reserve(mark, 2)).toBe(2)
  rollback()
  expect(payments.available(mark)).toBe(3)
  expect(payments.validate()).toBe(true)
  payments.commit()
  expect(mark.stack).toBe(3)
  expect(observed).toEqual([])
  owner.currentHp -= 28
  payments.notify()
  expect(preflight).toEqual(['rule', 'shield', 'rule'])
  expect(observed).toEqual([['shield', 2, 3, owner.currentHp]])
})

it('rejects cancelled debits, detached or suppressed marks, and marks belonging to another battle', () => {
  const { skill, mark, payments } = setup()
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/veto-cost' as effectId,
      triggers: [EffectTrigger.OnBeforeConsumeStack],
      apply(ctx) {
        ctx.parent.available = false
      },
    }),
  )
  expect(payments.reserve(mark, 1)).toBe(0)
  expect(payments.reserve(setup().mark, 1)).toBe(0)
  skill.effects.splice(0)
  expect(payments.reserve(mark, 'all')).toBe(5)
  mark.isSuppressed = true
  expect(payments.validate()).toBe(false)
  mark.isSuppressed = false
  mark.detach()
  expect(payments.validate()).toBe(false)
  expect(() => payments.commit()).toThrow()
  expect(mark.stack).toBe(5)
})

it('releases both numeric and replacement reservations on veto', () => {
  const { payments, mark } = setup()
  expect(payments.reserve(mark, 3, false, 'modifier')).toBe(3)
  expect(payments.reserve(mark, 3)).toBe(0)
  expect(payments.reserve(mark, 1)).toBe(1)
  payments.clear()
  expect(payments.available(mark)).toBe(5)
  payments.commit()
  payments.notify()
  expect(mark.stack).toBe(5)
})
