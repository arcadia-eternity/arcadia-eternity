import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  BaseMark,
  BattleMessageType,
  Category,
  DamageContext,
  DamageType,
  EffectTrigger,
  SkillPhase,
  TurnContext,
  UseSkillContext,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/engine'
import { officialDamageBenefitEffects } from '../../../../packs/base/src/effects/damage-benefits.effect'
import { VitalSequencesGeneratedEffects } from '../../../../packs/base/src/effects/vital-sequences.generated.effect'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function setup() {
  const fixture = makeScenario(817)
  const { battle, a, b } = fixture
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const skill = a.activePet.skills[0]
  const turn = new TurnContext(battle)
  const use = new UseSkillContext(turn, a, a.activePet, AttackTargetOpinion.opponent, skill)
  const committed: NonNullable<DamageContext['result']>[] = []
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/observe-committed' as effectId,
      priority: 1000,
      triggers: [EffectTrigger.OnDamage],
      apply(ctx) {
        if (ctx.parent.result) committed.push(ctx.parent.result)
      },
    }),
  )
  return { ...fixture, skill, turn, use, committed }
}

it('reflects a committed hit and awards the skill drain only for HP lost by its victim', () => {
  const { battle, a, b, skill, use, committed, debuff } = setup()
  const attacker = a.activePet
  const defender = b.activePet
  const reflector = new BaseMark(
    'fixture/reflect' as baseMarkId,
    [VitalSequencesGeneratedEffects.build().effect_mark_reflect_damage_1_4],
    debuff.config,
  ).createInstance()
  reflector.setOwner(defender, battle.emitter)
  defender.marks.push(reflector)
  skill.effects.push(officialDamageBenefitEffects.effect_skill_heal_25_percent_damage_dealt)

  attacker.currentHp = 70
  defender.currentHp = 32
  const messages: { target: string; damage: number }[] = []
  const healing: number[] = []
  battle.registerListener(message => {
    if (message.type === BattleMessageType.Damage) messages.push(message.data)
    if (message.type === BattleMessageType.Heal) healing.push(message.data.amount)
  })
  const damage = new DamageContext(use, skill, defender, 100, DamageType.Special)
  defender.damage(damage)

  expect(messages.map(hit => [hit.target, hit.damage])).toEqual([
    [defender.id, 100],
    [attacker.id, 8],
  ])
  expect(healing).toEqual([8])
  expect(attacker.currentHp).toBe(70)
  expect(defender.currentHp).toBe(0)
  expect(committed).toHaveLength(2)
  const [parent, child] = committed
  expect(parent).toBe(damage.result)
  expect(parent.id).not.toBe(child.id)
  expect(child.causeId).toBe(parent.id)
  expect(parent).toMatchObject({ hpBefore: 32, hpAfter: 0, hpLoss: 32 })
  expect(parent.origin).toMatchObject({ trigger: 'skill', petId: attacker.id, skillInstanceId: skill.id })
  expect(child.origin).toMatchObject({ trigger: 'effect', petId: defender.id, executorId: reflector.id })
  expect(child.hpLoss).toBe(8)
  expect(Object.isFrozen(parent)).toBe(true)
  expect(Object.isFrozen(parent.origin)).toBe(true)
  expect(Object.isFrozen(parent.trace)).toBe(true)
})

it('each hit commits its own result before the next hit reads current HP', () => {
  const { battle, a, b, use, skill, committed } = setup()
  use.category = Category.Physical
  use.hitOverrides.push({ willHit: true, priority: 1000 })
  use.multihit = 3
  a.currentRage = a.maxRage
  skill.effects.push(
    defineNativeEffect({
      id: 'fixture/constant-hit' as effectId,
      triggers: [EffectTrigger.PreDamage],
      apply(ctx) {
        ctx.parent.baseDamage = 9
        ctx.parent.randomFactor = 1
      },
    }),
  )
  const hp = b.activePet.currentHp
  const phase = new SkillPhase(use)
  battle.phaseManager.run(phase)
  expect(committed.map(hit => [hit.hpBefore, hit.hpAfter])).toEqual([
    [hp, hp - 9],
    [hp - 9, hp - 18],
    [hp - 18, hp - 27],
  ])
  expect(new Set(committed.map(hit => hit.id)).size).toBe(3)
  expect(b.activePet.currentHp).toBe(hp - 27)
})

it('two reflecting marks may each react once on the same damage chain', () => {
  const { battle, a, b, use, skill, committed, debuff } = setup()
  // The same printed effect on two distinct instances can respond independently.
  const mirror = new BaseMark(
    'fixture/mirror' as baseMarkId,
    [VitalSequencesGeneratedEffects.build().effect_mark_reflect_damage_1_4],
    debuff.config,
  )
  for (const pet of [a.activePet, b.activePet]) {
    const mark = mirror.createInstance()
    mark.setOwner(pet, battle.emitter)
    pet.marks.push(mark)
  }
  const damage = new DamageContext(use, skill, b.activePet, 64, DamageType.Physical)
  b.activePet.damage(damage)
  expect(committed.map(hit => hit.hpLoss)).toEqual([64, 16, 4])
  expect(committed[1].causeId).toBe(committed[0].id)
  expect(committed[2].causeId).toBe(committed[1].id)
  expect(battle.executionBudget.fault).toBeUndefined()

  // The next independent event starts a fresh chain.
  const next = new DamageContext(use, skill, b.activePet, 8, DamageType.Physical)
  b.activePet.damage(next)
  expect(committed.slice(3).map(hit => hit.hpLoss)).toEqual([8, 2])
})

it('a mark cannot spend its modifier payment again to prevent the same damage', () => {
  const { battle, b, use, skill, debuff } = setup()
  const mark = new BaseMark('fixture/limited-stacks' as baseMarkId, [], {
    ...debuff.config,
    maxStacks: 3,
  }).createInstance({ stack: 3 })
  mark.effects.push(
    defineNativeEffect({
      id: 'fixture/paid-adjustment' as effectId,
      triggers: [EffectTrigger.OnBeforeCalculateDamage],
      consumesStacks: 2,
      apply(ctx) {
        ctx.parent.addModified(0, -5)
      },
    }),
    defineNativeEffect({
      id: 'fixture/paid-prevention' as effectId,
      triggers: [EffectTrigger.OnDamageReplacement],
      apply(ctx) {
        ctx.parent.addRule({
          id: 'fixture/second-payment',
          cost: { mark, stacks: 2 },
          change: { kind: 'prevent', amount: 10 },
        })
      },
    }),
  )
  const defender = b.activePet
  mark.setOwner(defender, battle.emitter)
  defender.marks.push(mark)
  const event = new DamageContext(use, skill, defender, 25, DamageType.Physical)
  defender.damage(event)
  expect(event.result).toMatchObject({ status: 'committed', modifiedDamage: 20, hpLoss: 20, preventedDamage: 0 })
  expect(mark.stack).toBe(1)
})

it('retains the reflecting pet after its final mark stack pays the reaction cost', () => {
  const { battle, a, b, use, skill, committed, debuff } = setup()
  const defender = b.activePet
  const reflector = new BaseMark(
    'fixture/consumed-mirror' as baseMarkId,
    [VitalSequencesGeneratedEffects.build().effect_mark_reflect_damage],
    debuff.config,
  ).createInstance({ stack: 1 })
  reflector.setOwner(defender, battle.emitter)
  defender.marks.push(reflector)
  defender.damage(new DamageContext(use, skill, defender, 12, DamageType.Special))
  expect(committed.map(hit => hit.hpLoss)).toEqual([12, 18])
  expect(reflector.owner).toBeNull()
  expect(committed[1]).toMatchObject({
    targetId: a.activePet.id,
    origin: { petId: defender.id, executorId: reflector.id },
    causeId: committed[0].id,
  })
})
