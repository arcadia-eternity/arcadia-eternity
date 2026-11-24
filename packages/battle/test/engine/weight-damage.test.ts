import { WeightDamageEffects } from '../../../../packs/base/src/effects/weight-damage.effect'
import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  dealDamage,
  Modifier,
  DurationType,
  BaseMark,
  DamageContext,
  DamageType,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/engine'
import { makeScenario } from './scenario'

const effects = WeightDamageEffects.build()
const ids = Object.keys(effects) as (keyof typeof effects)[]
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function setup(id: keyof typeof effects, stacks = 3) {
  const f = makeScenario()
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  for (const pet of [f.b.activePet, f.b.team[1]]) {
    pet.attributeSystem.updateBaseValue('maxHp', 1000)
    pet.currentHp = 1000
  }
  const defensive = id === 'effect_mark_reduce_damage_with_weight'
  const owner = defensive ? f.b.activePet : f.a.activePet
  const queried = id === 'effect_skill_damage_by_opponent_weight' ? f.b.activePet : owner
  const mark = new BaseMark('fixture/weight' as baseMarkId, [], { ...f.debuff.config, maxStacks: 10 }).createInstance({
    stack: stacks,
  })
  mark.setOwner(owner, f.battle.emitter)
  owner.marks.push(mark)
  const source = defensive ? mark : owner.skills[0]
  source.effects.push(effects[id])
  const use = new UseSkillContext(
    new TurnContext(f.battle),
    f.a,
    f.a.activePet,
    AttackTargetOpinion.opponent,
    f.a.activePet.skills[0],
  )
  const damage = () => new DamageContext(use, use.skill, f.b.activePet, 83, DamageType.Physical)
  const apply = (event = damage()) => {
    dealDamage(event)
    if (!event.result) throw new Error('Damage did not resolve')
    return event.result
  }
  return { ...f, owner, queried, source, mark, use, damage, apply, sign: defensive ? -1 : 1 }
}
for (const id of ids) {
  for (const weight of [undefined, 0, 12.5])
    it(`${id}: computed default/zero/fraction ${weight}`, () => {
      const f = setup(id)
      const expected = weight ?? f.queried.stat.weight
      if (weight !== undefined) f.queried.attributeSystem.updateBaseValue('weight', weight)
      // A conflicting raw field must not override the computed attribute.
      Object.defineProperty(f.queried, 'weight', { value: 999, configurable: true })
      expect(f.apply().modifiedDamage).toBe(Math.floor(83 + expected * f.sign))
      expect(f.mark.stack).toBe(f.sign === -1 ? 2 : 3)
    })
  it(`${id}: late changes and repeated evaluation read the current attribute`, () => {
    const f = setup(id)
    const proposal = f.damage()
    f.queried.attributeSystem.updateBaseValue('weight', 31)
    const first = f.apply(proposal)
    expect(first.modifiedDamage).toBe(83 + 31 * f.sign)
    f.queried.attributeSystem.updateBaseValue('weight', 43)
    expect(first.modifiedDamage).toBe(83 + 31 * f.sign)
    expect(f.apply().modifiedDamage).toBe(83 + 43 * f.sign)
  })
  it(`${id}: actual physical damage settles the signed delta`, () => {
    const f = setup(id)
    f.queried.attributeSystem.updateBaseValue('weight', 12)
    const event = f.damage()
    const before = f.b.activePet.currentHp
    dealDamage(event)
    expect(event.result?.modifiedDamage).toBe(83 + 12 * f.sign)
    expect(event.damageResult).toBe(83 + 12 * f.sign)
    expect(f.b.activePet.currentHp).toBe(Math.max(0, before - event.damageResult))
  })
}
it('opponent weight re-queries the current position on the next execution', () => {
  const f = setup('effect_skill_damage_by_opponent_weight')
  const previous = f.b.activePet
  previous.attributeSystem.updateBaseValue('weight', 11)
  f.b.team[1].attributeSystem.updateBaseValue('weight', 29)
  const first = f.apply()
  f.b.activePet = f.b.team[1]
  expect(f.apply().modifiedDamage).toBe(112)
  expect(first.modifiedDamage).toBe(94)
})
it('last defensive stack protects its owner before payment detaches the mark', () => {
  const f = setup('effect_mark_reduce_damage_with_weight', 1)
  f.queried.attributeSystem.updateBaseValue('weight', 12)
  expect(f.apply().modifiedDamage).toBe(71)
  expect(f.mark.isActive).toBe(false)
  expect(f.mark.owner).toBeNull()
})
it('defensive mark does not modify damage to another pet', () => {
  const f = setup('effect_mark_reduce_damage_with_weight')
  const event = new DamageContext(f.use, f.use.skill, f.a.activePet, 83, DamageType.Physical)
  expect(f.apply(event).modifiedDamage).toBe(83)
  expect(f.mark.stack).toBe(3)
})

for (const id of ids)
  it(`${id}: weight modifiers contribute to the computed value`, () => {
    const f = setup(id)
    f.queried.attributeSystem.updateBaseValue('weight', 20)
    f.queried.attributeSystem.addModifier(
      'weight',
      new Modifier(DurationType.binding, 'fixture/weight-bonus', 7, 'delta', 0, f.mark),
    )
    expect(f.queried.stat.weight).toBe(27)
    expect(f.apply().modifiedDamage).toBe(83 + 27 * f.sign)
  })
it('resolves the opponent position when the proposal is evaluated', () => {
  const f = setup('effect_skill_damage_by_opponent_weight')
  const event = f.damage()
  f.b.activePet.attributeSystem.updateBaseValue('weight', 11)
  f.b.activePet = f.b.team[1]
  f.b.activePet.attributeSystem.updateBaseValue('weight', 29)
  expect(f.apply(event).modifiedDamage).toBe(112)
})
