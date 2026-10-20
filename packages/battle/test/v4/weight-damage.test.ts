import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  createWeightDamageEffects,
  Modifier,
  DurationType,
  BaseMark,
  DamageContext,
  DamageType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  defineNativeEffect,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

const effects = createWeightDamageEffects()
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
    f.battle.applyEffects(event, EffectTrigger.OnBeforeCalculateDamage, source)
    return event
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
      expect(f.apply().modified).toEqual([0, 0 + expected * f.sign])
      expect(f.mark.stack).toBe(f.sign === -1 ? 2 : 3)
    })
  it(`${id}: late changes and repeated evaluation read the current attribute`, () => {
    const f = setup(id)
    f.queried.attributeSystem.updateBaseValue('weight', 17)
    f.b.activePet.skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/weight-observer' as effectId,
        triggers: [EffectTrigger.BeforeEffect],
        when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
        apply: () => f.queried.attributeSystem.updateBaseValue('weight', 31),
      }),
    )
    const first = f.apply()
    expect(first.modified).toEqual([0, 31 * f.sign])
    f.b.activePet.skills[0].effects.splice(0)
    f.queried.attributeSystem.updateBaseValue('weight', 43)
    expect(first.modified).toEqual([0, 31 * f.sign])
    expect(f.apply().modified).toEqual([0, 43 * f.sign])
  })
  it(`${id}: actual physical damage settles the signed delta`, () => {
    const f = setup(id)
    f.queried.attributeSystem.updateBaseValue('weight', 12)
    const event = f.damage()
    const before = f.b.activePet.currentHp
    f.b.activePet.damage(event)
    expect(event.modified).toEqual([0, 12 * f.sign])
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
  expect(f.apply().modified).toEqual([0, 29])
  expect(first.modified).toEqual([0, 11])
})
it('last defensive stack is consumed before querying its now-detached owner', () => {
  const f = setup('effect_mark_reduce_damage_with_weight', 1)
  expect(f.apply().modified).toEqual([0, 0])
  expect(f.mark.isActive).toBe(false)
  expect(f.mark.owner).toBeNull()
})
it('defensive mark does not modify damage to another pet', () => {
  const f = setup('effect_mark_reduce_damage_with_weight')
  const event = new DamageContext(f.use, f.use.skill, f.a.activePet, 83, DamageType.Physical)
  expect(f.apply(event).modified).toEqual([0, 0])
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
    expect(f.apply().modified).toEqual([0, 27 * f.sign])
  })
it('opponent position is resolved after BeforeEffect, not when damage was created', () => {
  const f = setup('effect_skill_damage_by_opponent_weight')
  const event = f.damage()
  f.b.activePet.attributeSystem.updateBaseValue('weight', 11)
  const next = f.b.team[1]
  next.attributeSystem.updateBaseValue('weight', 29)
  f.b.activePet.skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/weight-switch' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx =>
        ctx.parent instanceof EffectContext && ctx.parent.effect?.id === 'effect_skill_damage_by_opponent_weight',
      apply: () => {
        f.b.activePet = next
      },
    }),
  )
  expect(f.apply(event).modified).toEqual([0, 29])
})
