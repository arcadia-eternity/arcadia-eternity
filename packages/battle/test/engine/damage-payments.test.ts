import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  BaseMark,
  DamageContext,
  DamagePhase,
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
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function setup(isShield = false) {
  const { battle, a, b, debuff } = makeScenario()
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = b.activePet
  const mark = new BaseMark('fixture/payment' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 5,
    isShield,
  }).createInstance({
    stack: 5,
  })
  mark.setOwner(owner, battle.emitter)
  owner.marks.push(mark)
  const skill = a.activePet.skills[0]
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
  const damage = new DamageContext(use, skill, owner, 30, DamageType.Special)
  return { damage, skill, mark, owner, run: () => battle.phaseManager.run(new DamagePhase(damage)) }
}

it('requires exact successful costs but lets a shield spend a smaller authorized amount', () => {
  const { skill, mark, owner, damage, run } = setup(true)
  const hpBefore = owner.currentHp
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
  damage.addRule({ id: 'costly-prevention', cost: { mark, stacks: 3 }, change: { kind: 'prevent' } })
  run()
  expect(preflight).toEqual(['rule', 'shield', 'rule'])
  expect(mark.stack).toBe(3)
  expect(owner.currentHp).toBe(hpBefore - 28)
  expect(observed).toEqual([['shield', 2, 3, hpBefore - 28]])
  expect(damage.result?.payments).toEqual([{ markId: mark.id, stacks: 2, reason: 'shield' }])
})

it.each(['detached', 'suppressed'] as const)('rejects the entire hit when a reserved mark becomes %s', state => {
  const { damage, skill, mark, owner, run } = setup()
  const hpBefore = owner.currentHp
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/veto-cost' as effectId,
      triggers: [EffectTrigger.OnBeforeConsumeStack],
      apply(ctx) {
        ctx.parent.available = false
      },
    }),
  )
  expect(damage.reserveModifierCost(mark, 1)).toBe(false)
  skill.effects.splice(0)
  expect(damage.reserveModifierCost(setup().mark, 1)).toBe(false)
  expect(damage.reserveModifierCost(mark, 'all')).toBe(true)
  if (state === 'detached') {
    owner.marks = owner.marks.filter(member => member !== mark)
    mark.owner = null
  } else mark.isSuppressed = true
  run()
  expect(damage.result).toMatchObject({ status: 'failed', reason: 'payment-unavailable', payments: [] })
  expect(owner.currentHp).toBe(hpBefore)
  expect(mark.stack).toBe(5)
})

it('releases numeric and replacement reservations together when a proposal is vetoed', () => {
  const { damage, skill, mark, owner, run } = setup()
  const hpBefore = owner.currentHp
  expect(damage.reserveModifierCost(mark, 3)).toBe(true)
  expect(damage.reserveModifierCost(mark, 3)).toBe(false)
  damage.addRule({ id: 'reduce', cost: { mark, stacks: 1 }, change: { kind: 'prevent', amount: 1 } })
  const amounts: number[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/veto-reduced-hit' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement],
      apply({ parent }) {
        amounts.push(parent.damageResult)
        if (parent.damageResult < 30) parent.available = false
      },
    }),
  )
  run()
  expect(amounts).toEqual([30, 29])
  expect(damage.result).toMatchObject({ status: 'cancelled', payments: [] })
  expect(owner.currentHp).toBe(hpBefore)
  expect(mark.stack).toBe(5)
})
