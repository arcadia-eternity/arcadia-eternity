import { dealDamage } from '@arcadia-eternity/battle/engine'
import { afterEach, expect, it } from 'vitest'
import {
  AttackTargetOpinion,
  BaseMark,
  DamageContext,
  UseSkillContext,
  DamageType,
  EffectTrigger,
  TurnContext,
  compileEffect,
  contexts,
  ops,
  selectFrom,
  targets,
  type Battle,
  type DamageResult,
  type baseMarkId,
} from '@arcadia-eternity/battle/authoring'
import { makeScenario } from './scenario'

const battles: Battle[] = []
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

function fixture(seed: number) {
  const scenario = makeScenario(seed)
  const { battle, a, b } = scenario
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  return scenario
}

it.each([
  { damageType: DamageType.Special, shields: true },
  { damageType: DamageType.Effect, shields: true },
  { damageType: DamageType.Special, shields: false },
])(
  'settles authored $damageType damage with shields=$shields independently of its source',
  ({ damageType, shields }) => {
    const { battle, a, b, debuff } = fixture(17)
    const source = a.activePet.skills[0]
    const target = b.activePet
    const shield = new BaseMark('test/shield' as baseMarkId, [], {
      ...debuff.config,
      maxStacks: 10,
      isShield: true,
    }).createInstance({ stack: 8 })
    shield.setOwner(target, battle.emitter)
    target.marks.push(shield)
    let result: DamageResult | undefined
    source.effects.push(
      compileEffect({
        id: 'test/damage',
        triggers: [EffectTrigger.TurnStart],
        apply: targets.opponentActive.apply(ops.dealDamage(20, { damageType, policy: { shields } })),
      }),
      compileEffect({
        id: 'test/read-result',
        triggers: [EffectTrigger.OnDamage],
        apply: ctx => {
          result = ctx.read(contexts.damageResult.first())
        },
      }),
    )
    battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnStart, source)
    expect(result).toMatchObject({
      hpLoss: shields ? 12 : 20,
      shieldAbsorbed: shields ? 8 : 0,
      intent: { damageType, policy: { shields } },
      origin: { trigger: 'effect', skillId: source.baseId, petId: a.activePet.id, effectId: 'test/damage' },
    })
    expect(shield.stack).toBe(shields ? 0 : 8)
  },
)

it('retains the actor of an effect whose last mark stack pays the activation cost', () => {
  const { battle, a, b, debuff } = fixture(43)
  const target = b.activePet
  const source = new BaseMark(
    'test/final-charge' as baseMarkId,
    [
      compileEffect({
        id: 'test/final-charge',
        triggers: [EffectTrigger.TurnStart],
        consumesStacks: 1,
        apply: selectFrom([target]).apply(ops.dealDamage(9)),
      }),
    ],
    debuff.config,
  ).createInstance({ stack: 1 })
  source.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(source)
  let result: DamageResult | undefined
  target.skills[0].effects.push(
    compileEffect({
      id: 'test/read-last-charge',
      triggers: [EffectTrigger.OnDamage],
      apply: ctx => {
        result = ctx.read(contexts.damageResult.first())
      },
    }),
  )
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnStart, source)
  expect(source.owner).toBe(null)
  expect(result).toMatchObject({ hpLoss: 9, origin: { petId: a.activePet.id, executorId: source.id } })
})

it('releases reserved damage costs on a later authored cancellation', () => {
  const { battle, a, b, debuff } = fixture(128)
  const defender = b.activePet
  const paid = new BaseMark(
    'test/prepaid' as baseMarkId,
    [
      compileEffect({
        id: 'test/reduce',
        triggers: [EffectTrigger.OnBeforeCalculateDamage],
        consumesStacks: 1,
        apply: contexts.damage.apply(ops.modifyDamage({ percent: -50, delta: 0 })),
      }),
    ],
    debuff.config,
  ).createInstance({ stack: 1 })
  paid.setOwner(defender, battle.emitter)
  defender.marks.push(paid)
  const skill = a.activePet.skills[0]
  skill.effects.push(
    compileEffect({
      id: 'test/cancel',
      triggers: [EffectTrigger.OnDamageReplacement],
      apply: contexts.damage.apply(ops.cancelDamage()),
    }),
  )
  const parent = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
  const damage = new DamageContext(parent, skill, defender, 20, DamageType.Physical)
  dealDamage(damage)
  expect(damage.result).toMatchObject({ status: 'cancelled', modifiedDamage: 10, hpLoss: 0, preventedDamage: 0 })
  expect(paid.stack).toBe(1)
  expect(paid.owner).toBe(defender)
})
