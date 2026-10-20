import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  SkillPhase,
  Category,
  createStackDamageEffects,
  effectAuthoring,
  parameterAddress,
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
const reduction = 'effect_mark_special_damage_reduction_with_stack'
const amplification = 'effect_skill_add_damage_30_per_niliu'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture(id: typeof reduction | typeof amplification, stack = 3) {
  const f = makeScenario()
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const owner = id === reduction ? f.b.activePet : f.a.activePet
  const mark = new BaseMark((id === reduction ? 'mark_shazhiwang' : 'mark_niliu') as baseMarkId, [], {
    ...f.debuff.config,
    maxStacks: 100,
    persistent: true,
    duration: -1,
  }).createInstance({ stack })
  mark.setOwner(owner, f.battle.emitter)
  owner.marks.push(mark)
  const source = id === reduction ? mark : owner.skills[0]
  const effect = createStackDamageEffects()[id]
  effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  source.effects.push(effect)
  const use = new UseSkillContext(
    new TurnContext(f.battle),
    f.a,
    f.a.activePet,
    AttackTargetOpinion.opponent,
    f.a.activePet.skills[0],
  )
  const damage = (type = DamageType.Special) => new DamageContext(use, use.skill, f.b.activePet, 40, type)
  const apply = (event = damage()) => {
    f.battle.applyEffects(event, EffectTrigger.OnBeforeCalculateDamage, source)
    return event
  }
  const before = (action: () => void) =>
    f.b.activePet.skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/stack-change' as effectId,
        triggers: [EffectTrigger.BeforeEffect],
        when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
        apply: action,
      }),
    )
  return { ...f, owner, mark, source, effect, use, damage, apply, before }
}
for (const id of [reduction, amplification] as const) {
  for (const type of [DamageType.Physical, DamageType.Special, DamageType.Effect])
    it(`${id}: ${type} admission and signed delta`, () => {
      const f = fixture(id)
      const expected = id === amplification ? 90 : type === DamageType.Special ? -3 : 0
      expect(f.apply(f.damage(type)).modified).toEqual([0, expected])
    })
  it(`${id}: late stack change is read at action time`, () => {
    const f = fixture(id)
    f.before(() => {
      f.mark.stack = 7
    })
    const first = f.apply()
    expect(first.modified).toEqual([0, id === amplification ? 210 : -7])
    f.b.activePet.skills[0].effects.splice(0)
    f.mark.stack = 2
    expect(first.modified).toEqual([0, id === amplification ? 210 : -7])
    expect(f.apply().modified).toEqual([0, id === amplification ? 60 : -2])
  })
  it(`${id}: real special damage settlement`, () => {
    const f = fixture(id, 1)
    const event = f.damage()
    f.b.activePet.damage(event)
    expect(event.damageResult).toBe(id === amplification ? 70 : 39)
    expect(f.b.activePet.currentHp).toBe(f.b.activePet.stat.maxHp - event.damageResult)
  })
  it(`${id}: cancellation skips the modifier`, () => {
    const f = fixture(id)
    f.b.activePet.skills[0].effects.push(
      defineNativeEffect({
        id: 'fixture/cancel-stack' as effectId,
        triggers: [EffectTrigger.BeforeEffect],
        when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
        apply: ctx => {
          if (ctx.parent instanceof EffectContext) ctx.parent.available = false
        },
      }),
    )
    expect(f.apply().modified).toEqual([0, 0])
  })
}
it('inverse current is queried again after admission, including absence', () => {
  const f = fixture(amplification)
  f.before(() => {
    f.owner.marks.splice(0)
  })
  expect(f.apply().modified).toEqual([0, 0])
})
it('inverse current supports scoped authored coefficient configuration', () => {
  const f = fixture(amplification)
  f.battle.configSystem.set(parameterAddress(amplification, 'parameters', 'damagePerStack'), 7.5)
  expect(f.apply().modified).toEqual([0, 22])
})
it('inverse current without its mark cannot add damage', () => {
  const f = fixture(amplification)
  f.owner.marks.splice(0)
  expect(f.apply().modified).toEqual([0, 0])
})
it('special reduction cannot protect the other player', () => {
  const f = fixture(reduction)
  expect(f.apply(new DamageContext(f.use, f.use.skill, f.a.activePet, 40, DamageType.Special)).modified).toEqual([0, 0])
})
it("inverse current does not amplify another actor's skill", () => {
  const f = fixture(amplification)
  const use = new UseSkillContext(
    new TurnContext(f.battle),
    f.b,
    f.b.activePet,
    AttackTargetOpinion.opponent,
    f.b.activePet.skills[0],
  )
  expect(f.apply(new DamageContext(use, use.skill, f.a.activePet, 40, DamageType.Special)).modified).toEqual([0, 0])
})

for (const id of [reduction, amplification] as const)
  it(`${id}: complete skill phase reaches the corrected damage hook`, () => {
    const run = (enabled: boolean) => {
      const f = fixture(id, 2)
      if (!enabled) f.source.effects.splice(0)
      f.a.settingRage(100)
      f.b.activePet.attributeSystem.updateBaseValue('maxHp', 1000)
      f.b.activePet.currentHp = 1000
      f.use.category = Category.Special
      f.use.power = 20
      f.use.setSureHit()
      const phase = new SkillPhase(
        f.battle,
        f.a,
        f.a.activePet,
        AttackTargetOpinion.opponent,
        f.use.skill,
        f.use.parent,
        f.use,
      )
      phase.initialize()
      phase.execute()
      expect(f.use.hitResult).toBe(true)
      return 1000 - f.b.activePet.currentHp
    }
    expect(run(true) - run(false)).toBe(id === amplification ? 60 : -2)
  })
