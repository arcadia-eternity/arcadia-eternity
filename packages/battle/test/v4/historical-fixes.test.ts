import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  BaseSkill,
  DamageContext,
  RageContext,
  Effect,
  type effectId,
  EffectContext,
  EffectTrigger,
  Gender,
  HealContext,
  PhaseState,
  StatTypeWithoutHp,
  TurnContext,
  setGlobalLogger,
  type Battle,
} from '@arcadia-eternity/battle/v4'
import { DataRepository, PetParser } from '@arcadia-eternity/battle/v4/legacy'
import { makeScenario } from './scenario'
const battles: Battle[] = []
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  return f
}
function context(battle: Battle) {
  return new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, battle.playerA.activePet.skills[0])
}
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('honors parsed maxHp and explicit gender through real Pet initialization', () => {
  const { a, b, battle } = fixture()
  const base = { ...a.activePet.base, id: 'pet_fixture' as typeof a.activePet.base.id }
  DataRepository.getInstance().species.set(base.id, base)
  DataRepository.getInstance().skills.set(a.activePet.skills[0].base.id, a.activePet.skills[0].base)
  const pet = PetParser.parse({
    name: 'override',
    species: base.id,
    level: 50,
    evs: a.activePet.evs,
    ivs: a.activePet.ivs,
    nature: a.activePet.nature,
    skills: [a.activePet.skills[0].base.id],
    maxHp: 37,
    gender: Gender.Male,
  })
  pet.setOwner(b, battle.emitter)
  expect(pet.stat.maxHp).toBe(37)
  expect(pet.currentHp).toBe(37)
  expect(pet.gender).toBe(Gender.Male)
})
it('keeps a stat-stage mark and modifier attached when the level changes sign', () => {
  const { a, battle } = fixture(),
    ctx = context(battle)
  a.activePet.addStatStage(ctx, StatTypeWithoutHp.atk, 1)
  a.activePet.addStatStage(ctx, StatTypeWithoutHp.atk, -2)
  expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toHaveLength(0)
  expect(a.activePet.stat.atk).toBeCloseTo(55 * 0.66)
  expect(a.activePet.marks[0].owner).toBe(a.activePet)
  expect(a.activePet.marks[0].baseId).toBe('stat_stage_atk_down')
})
it('does not heal a benched pet just because isActive is a function', () => {
  const { a, battle } = fixture(),
    pet = a.team[1]
  pet.currentHp = 10
  pet.heal(new HealContext(context(battle), a.activePet.skills[0], pet, 20))
  expect(pet.currentHp).toBe(10)
})
it('gives a default Builder one hit and 100 percent accuracy', () => {
  const skill = new BaseSkill.Builder().withID('default').build()
  expect(skill.multihit).toBe(1)
  expect(skill.accuracy).toBe(100)
})

it('retains sureCrit and opponent-stage strategy in the actual skill context', async () => {
  const { SkillInstance, Category, Element, IgnoreStageStrategy, UseSkillContext } =
    await import('@arcadia-eternity/battle/v4')
  const { a, battle } = fixture()
  const base = new BaseSkill.Builder().withID('sure-crit').withMultihit(1).build()
  const sureCrit = new BaseSkill(
    base.id,
    Category.Physical,
    Element.Normal,
    50,
    100,
    0,
    0,
    undefined,
    1,
    true,
    true,
    false,
    IgnoreStageStrategy.positive,
  )
  const skill = new SkillInstance(sureCrit)
  skill.setOwner(a.activePet)
  const ctx = new UseSkillContext(new TurnContext(battle), a, a.activePet, skill.target, skill)
  ctx.critRate = 0
  ctx.updateCritResult()
  expect(ctx.crit).toBe(true)
  expect(ctx.ignoreStageStrategy).toBe(IgnoreStageStrategy.positive)
})

it('sets rejected damage to zero and retains the caller context', () => {
  const { a, b, battle } = fixture()
  a.activePet.skills[0].effects.push(
    new Effect<EffectTrigger>(
      'block' as effectId,
      [EffectTrigger.OnBeforeCalculateDamage],
      ctx => {
        if (ctx.parent instanceof DamageContext) ctx.parent.available = false
      },
      0,
    ),
  )
  const ctx = new DamageContext(context(battle), b.activePet, a.activePet, 30)
  const hp = a.activePet.currentHp
  a.activePet.damage(ctx)
  expect(a.activePet.currentHp).toBe(hp)
  expect(ctx.available).toBe(false)
  expect(ctx.damageResult).toBe(0)
})
it('honors a denied rage gain and returns its outcome in the caller context', () => {
  const { a, battle } = fixture()
  a.activePet.skills[0].effects.push(
    new Effect<EffectTrigger>(
      'deny-rage' as effectId,
      [EffectTrigger.OnRageGain],
      ctx => {
        if (ctx.parent instanceof RageContext) ctx.parent.available = false
      },
      0,
    ),
  )
  const ctx = new RageContext(new TurnContext(battle), a, 'effect', 'add', 10)
  a.addRage(ctx)
  expect(a.currentRage).toBe(20)
  expect(ctx.available).toBe(false)
  expect(ctx.rageChangeResult).toBe(0)
})
