import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  effectAuthoring,
  BaseMark,
  EffectContext,
  EffectTrigger,
  TurnContext,
  UseSkillContext,
  AttackTargetOpinion,
  AddMarkContext,
  RemoveMarkContext,
  defineNativeEffect,
  setGlobalLogger,
  ParameterCatalog,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import {
  createNamedParameterModifiers,
  namedParameterModifierDependencies,
  createGeneratedAttributeContributions,
  createGeneratedDynamicContributions,
  createGeneratedDamageModifierEffects,
  createGeneratedVitalSequences,
  createGeneratedMarkApplications,
  generatedMarkApplicationDependencies,
  officialRageCandidate,
} from '@arcadia-eternity/data-pack-base/native'

const definitions = ['skill', 'mark', 'emblem'].flatMap(kind =>
  parse(readFileSync(new URL(`../../../../packs/base/data/effect_${kind}.yaml`, import.meta.url), 'utf8'), {
    merge: true,
  }),
)
const sources = definitions.filter(d => d.apply?.type === 'addConfigModifier')
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
function defaultFor(reference: string) {
  const [id, name] = reference.split('.'),
    found: number[] = []
  function walk(value: unknown) {
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>
      if (v.type === 'raw:number' && v.configId === name) found.push(v.value as number)
      for (const child of Object.values(v)) walk(child)
    }
  }
  walk(definitions.find(d => d.id === id))
  expect(found).toHaveLength(1)
  return found[0]
}
const variants = ['normal', 'repeat', 'late-base', 'late-owner', 'cancel', 'suppress-after', 'destroy'] as const
function run(id: string, native: boolean, kind: 'skill' | 'mark', variant: (typeof variants)[number]) {
  const { battle, a, b, debuff } = makeScenario(761)
  battles.push(battle)
  for (const pet of [...a.team, ...b.team]) {
    pet.marks.splice(0)
    for (const skill of pet.skills) skill.effects.splice(0)
  }
  const d = sources.find(d => d.id === id),
    reference = d.apply.configKey,
    base = defaultFor(reference),
    catalog = dependencies.get(reference.split('.')[0])!,
    config = battle.configSystem
  if (native) {
    catalog.install(config)
    expect(config.hasRegisteredConfig(reference)).toBe(false)
    expect(catalog.read(config, reference)).toBe(base)
  } else config.registerConfig(reference, base)
  const sourceMark = new BaseMark('fixture/named-source' as baseMarkId, [], debuff.config).createInstance()
  sourceMark.setOwner(a.activePet, battle.emitter)
  a.activePet.marks.push(sourceMark)
  const source = kind === 'mark' ? sourceMark : a.activePet.skills[0]
  source.effects.push(native ? candidates[id] : EffectParser.parse(d))
  b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/named-before' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: ctx => ctx.parent instanceof EffectContext && ctx.parent.effect?.id === id,
      apply: ctx => {
        if (variant === 'cancel' && ctx.parent instanceof EffectContext) ctx.parent.available = false
        if (variant === 'late-owner') source.owner = a.team[1]
        if (variant === 'late-base') config.set(native ? catalog.addressOf(reference) : reference, base + 3)
      },
    }),
  )
  const scopes = [a.activePet, a.activePet.skills[0], a.team[1], a, b, b.activePet]
  const read = () =>
    scopes.map(scope => (native ? catalog.read(config, reference, scope) : config.get(reference, scope)))
  battle.applyEffects(battle, EffectTrigger.OnBattleStart, source)
  if (variant === 'repeat') battle.applyEffects(battle, EffectTrigger.OnBattleStart, source)
  const before = read()
  if (variant === 'suppress-after') sourceMark.isSuppressed = true
  if (variant === 'destroy')
    battle.removeMark(
      new RemoveMarkContext(new EffectContext(new TurnContext(battle), EffectTrigger.TurnEnd, source), sourceMark),
    )
  const after = read()
  sourceMark.isSuppressed = false
  const modifiers = [...config.exportSnapshotState().scopedModifiers.values()]
    .flatMap(entries => [...entries.values()])
    .flat().length
  return { before, after, recovered: read(), modifiers, next: battle.random() }
}
for (const d of sources)
  for (const kind of ['skill', 'mark'] as const)
    for (const variant of variants)
      it(`${d.id} ${kind} ${variant}`, () => {
        const actual = run(d.id, true, kind, variant)
        expect(actual).toEqual(run(d.id, false, kind, variant))
        const base = defaultFor(d.apply.configKey) + (variant === 'late-base' ? 3 : 0)
        const active = variant !== 'cancel' && d.apply.target !== 'opponentPlayer'
        const delta = active ? d.apply.value * (variant === 'repeat' ? 2 : 1) : 0
        expect(actual.before[variant === 'late-owner' ? 2 : 0]).toBe(base + delta)
        expect(actual.before[4]).toBe(base)
        expect(actual.before[5]).toBe(base)
        expect(actual.modifiers).toBe(
          variant === 'cancel' || (variant === 'destroy' && kind === 'mark') ? 0 : variant === 'repeat' ? 2 : 1,
        )
        if ((variant === 'destroy' || variant === 'suppress-after') && kind === 'mark')
          expect(actual.after[0]).toBe(base)
        if (variant === 'suppress-after') expect(actual.recovered).toEqual(actual.before)
      })
it('rejects missing catalogs and unknown aliases at assembly without mutating the supplied map', () => {
  expect(() => createNamedParameterModifiers(new Map())).toThrow('Missing parameter catalog')
  const map = catalogs()
  const first = namedParameterModifierDependencies[0]
  map.set(first, new ParameterCatalog([]))
  expect(() => createNamedParameterModifiers(map)).toThrow('Unknown parameter')
  expect(map.size).toBe(namedParameterModifierDependencies.length)
})
it('requires installed canonical state rather than creating a zero-valued alias placeholder', () => {
  const { battle, a } = makeScenario(762)
  battles.push(battle)
  const effect = candidates.effect_emblem_fengbaozhixing_rage_boost_5
  const ctx = new EffectContext(battle, EffectTrigger.OnBattleStart, a.activePet.skills[0], effect)
  expect(() => battle.executionBudget.run(0, () => effect.innerApply(ctx))).toThrow('not registered')
  expect(battle.configSystem.hasRegisteredConfig('effect_skill_add_rage_20_if_rage_below_40.add_rage_value')).toBe(
    false,
  )
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
