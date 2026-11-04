import {
  AddMarkContext,
  AttackTargetOpinion,
  BaseMark,
  EffectContext,
  EffectTrigger,
  ParameterCatalog,
  RemoveMarkContext,
  TurnContext,
  UseSkillContext,
  effectAuthoring,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import {
  createGeneratedAttributeContributions,
  createGeneratedDamageModifierEffects,
  createGeneratedDynamicContributions,
  createGeneratedMarkApplications,
  createGeneratedVitalSequences,
  createNamedParameterModifiers,
  generatedMarkApplicationDependencies,
  namedParameterModifierDependencies,
  officialRageCandidate,
} from '@arcadia-eternity/data-pack-base/effects'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { makeScenario } from './scenario'

function catalogs() {
  const effects = {
    ...createGeneratedAttributeContributions(),
    ...createGeneratedDynamicContributions(),
    ...createGeneratedDamageModifierEffects(),
    ...createGeneratedVitalSequences(),
    ...createGeneratedMarkApplications(
      new Map(generatedMarkApplicationDependencies.map(id => [id, new BaseMark(id as baseMarkId, [])])),
    ),
  }
  return new Map(
    namedParameterModifierDependencies.map(id => [
      id,
      id === officialRageCandidate.effect.id
        ? officialRageCandidate.parameters
        : effectAuthoring.effectParameters(effects[id as keyof typeof effects]),
    ]),
  )
}
const dependencies = catalogs(),
  candidates = createNamedParameterModifiers(dependencies)
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('rejects missing catalogs and unknown aliases at assembly without mutating the supplied map', () => {
  expect(() => createNamedParameterModifiers(new Map())).toThrow('Missing parameter catalog')
  const map = catalogs()
  const first = namedParameterModifierDependencies[0]
  map.set(first, new ParameterCatalog([]))
  expect(() => createNamedParameterModifiers(map)).toThrow('Unknown parameter')
  expect(map.size).toBe(namedParameterModifierDependencies.length)
})
it('the rage consumer reads the modified canonical parameter and returns to baseline after source removal', () => {
  const { battle, a, b, debuff } = makeScenario(763)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  officialRageCandidate.parameters.install(battle.configSystem)
  const mark = new BaseMark(
    'fixture/rage-emblem' as baseMarkId,
    [candidates.effect_emblem_fengbaozhixing_rage_boost_5],
    debuff.config,
  ).createInstance()
  mark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(mark)
  battle.applyEffects(battle, EffectTrigger.OnBattleStart, mark)
  const skill = a.activePet.skills[0]
  skill.effects.push(officialRageCandidate.effect)
  const use = new UseSkillContext(new TurnContext(battle), a, a.activePet, AttackTargetOpinion.opponent, skill)
  a.currentRage = 0
  battle.applyEffects(use, EffectTrigger.OnHit, skill)
  expect(a.currentRage).toBe(25)
  battle.removeMark(new RemoveMarkContext(new EffectContext(use, EffectTrigger.OnHit, skill), mark))
  a.currentRage = 0
  battle.applyEffects(use, EffectTrigger.OnHit, skill)
  expect(a.currentRage).toBe(20)
})

it('a captured parameter factor stays captured while its mark stack follows; new applications read the current factor', () => {
  const { battle, a, b, debuff } = makeScenario(764)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const dependency = createGeneratedAttributeContributions().effect_mark_increase_crit_rate_20_percent_per_stack
  const catalog = effectAuthoring.effectParameters(dependency)
  catalog.install(battle.configSystem)
  const all = new Map(dependencies)
  all.set(dependency.id, catalog)
  const emblem = new BaseMark(
    'fixture/crit-emblem' as baseMarkId,
    [createNamedParameterModifiers(all).effect_emblem_dianhe_crit_rate_boost_5_percent],
    debuff.config,
  ).createInstance()
  const pet = a.activePet
  emblem.setOwner(pet, battle.emitter)
  pet.marks.push(emblem)
  const initial = pet.stat.critRate
  battle.applyEffects(battle, EffectTrigger.OnBattleStart, emblem)
  const context = new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, pet.skills[0])
  function apply() {
    const base = new BaseMark('fixture/crit-consumer' as baseMarkId, [dependency], { ...debuff.config, maxStacks: 20 })
    const mark = base.createInstance()
    mark.setOwner(pet, battle.emitter)
    mark.stack = 1
    pet.marks.push(mark)
    battle.applyEffects(new AddMarkContext(context, pet, base), EffectTrigger.OnMarkCreated, mark)
    return mark
  }
  const first = apply()
  expect(pet.stat.critRate).toBe(initial + 25)
  battle.removeMark(new RemoveMarkContext(context, emblem))
  expect(
    catalog.read(
      battle.configSystem,
      'effect_mark_increase_crit_rate_20_percent_per_stack.crit_rate_increase_per_stack',
      first,
    ),
  ).toBe(20)
  expect(pet.stat.critRate).toBe(initial + 25)
  first.stack = 2
  expect(pet.stat.critRate).toBe(initial + 50)
  apply()
  expect(pet.stat.critRate).toBe(initial + 70)
})
