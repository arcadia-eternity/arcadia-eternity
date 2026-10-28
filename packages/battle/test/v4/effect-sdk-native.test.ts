import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  AddMarkContext,
  AttackTargetOpinion,
  BaseMark,
  DamageContext,
  EffectContext,
  EffectTrigger,
  GameRng,
  HealContext,
  Pet,
  RemoveMarkContext,
  SnapshotCatalog,
  TurnContext,
  UseSkillContext,
  compileBehaviorUse,
  restoreBattle,
  setGlobalLogger,
  snapshotBattle,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import * as sdk from '@arcadia-eternity/battle/v4/authoring'
import { createEffects } from '../../../../examples/ugc/native-effects'
import { makeScenario } from './scenario'

const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
function fixture() {
  const f = makeScenario(242)
  battles.push(f.battle)
  return f
}
function compile(kind: 'recover' | 'stack-defense', useId = 'first', sourceMark?: BaseMark) {
  const exports = createEffects({ sdk, marks: new Map(), id: id => `sdk:${id}` })
  const native = exports.find(effect => effect.id === `sdk:${kind}`)!
  const result = compileBehaviorUse(
    sdk.codeEffectDefinition(native),
    { useId, definitionId: native.id },
    {
      owner: kind === 'recover' ? { kind: 'skill', id: 'fixture/setup' } : { kind: 'petMark', id: sourceMark!.id },
      sourceMark,
      nativeExports: exports,
    },
  )
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}
function attack(f: ReturnType<typeof fixture>) {
  return new UseSkillContext(
    new TurnContext(f.battle),
    f.a,
    f.a.activePet,
    AttackTargetOpinion.opponent,
    f.a.activePet.skills[0],
  )
}
function addSource(f: ReturnType<typeof fixture>) {
  const base = new BaseMark('sdk:charge' as baseMarkId, [], {
    ...f.debuff.config,
    maxStacks: 5,
    stackable: true,
    keepOnSwitchOut: true,
  })
  const use = compile('stack-defense', 'defense', base)
  base.effects.push(use.effect)
  use.parameters.install(f.battle.configSystem)
  const context = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  f.a.activePet.addMark(new AddMarkContext(context, f.a.activePet, base, 2))
  return { use, source: f.a.activePet.marks.find(mark => mark.baseId === base.id)!, context }
}
function snapshotCatalog(
  f: ReturnType<typeof fixture>,
  authored: Parameters<typeof sdk.registerEffect>[1][],
  source: BaseMark,
) {
  const catalog = new SnapshotCatalog('effect-sdk/native/1')
  catalog.registerContent('mark:sdk:charge', source)
  for (const pet of [...f.a.team, ...f.b.team])
    for (const skill of pet.skills) for (const effect of skill.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of f.debuff.effects) catalog.registerEffect(effect.id, effect)
  for (const effect of authored) sdk.registerEffect(catalog, effect)
  return catalog
}

it('injects the official domain constructors and executes repeated native code uses with independent battle RNG', () => {
  expect(sdk.Pet).toBe(Pet)
  expect(sdk.BaseMark).toBe(BaseMark)
  expect(sdk.HealContext).toBe(HealContext)
  expect(sdk.DamageContext).toBe(DamageContext)
  const f = fixture(),
    other = fixture(),
    expected = new GameRng(242)
  const uses = [compile('recover'), compile('recover', 'second')]
  expect(uses[0].effect.id).not.toBe(uses[1].effect.id)
  for (const battle of [f.battle, other.battle]) for (const use of uses) use.parameters.install(battle.configSystem)
  for (const scenario of [f, other])
    scenario.a.activePet.skills[0].effects.splice(0, Infinity, ...uses.map(use => use.effect))
  f.a.activePet.currentHp = other.a.activePet.currentHp = 1
  const amount = () => Math.floor(expected.next() * 5) + 3
  const healing = amount() + amount()
  f.battle.applyEffects(attack(f), EffectTrigger.OnMiss)
  expect(f.a.activePet.currentHp).toBe(1)
  f.battle.applyEffects(attack(f), EffectTrigger.OnHit)
  expect(f.a.activePet.currentHp).toBe(1 + healing)
  expect(other.a.activePet.currentHp).toBe(1)
  expect(other.battle.random()).toBe(new GameRng(242).next())
  expect(f.battle.random()).toBe(expected.next())
  const wrongSource = f.b.activePet.skills[0]
  expect(() =>
    uses[0].effect.innerApply(new EffectContext(attack(f), EffectTrigger.OnHit, wrongSource, uses[0].effect)),
  ).toThrow('Mismatched')
})

it.each([false, true])(
  'retains native modifier behavior through refresh, suppression, transfer and removal (suppressed=%s)',
  suppressed => {
    const f = fixture(),
      a = f.a.activePet,
      b = f.b.activePet
    const before = [a.stat.def, b.stat.def]
    const { source, context } = addSource(f)
    expect(a.stat.def).toBe(before[0] + 6)
    source.stack = 4
    expect(a.stat.def).toBe(before[0] + 12)
    f.battle.applyEffects(new AddMarkContext(context, a, source.base), EffectTrigger.OnMarkCreated, source)
    expect(a.stat.def).toBe(before[0] + 12)
    source.isSuppressed = suppressed
    if (suppressed) expect(a.stat.def).toBe(before[0])
    b.transferMarks(context, source)
    expect(a.stat.def).toBe(before[0])
    expect(source.owner).toBe(b)
    expect(b.stat.def).toBe(before[1] + (suppressed ? 0 : 12))
    source.isSuppressed = false
    expect(b.stat.def).toBe(before[1] + 12)
    f.battle.removeMark(new RemoveMarkContext(context, source))
    expect(b.stat.def).toBe(before[1])
  },
)

it('restores native effects, source modifiers and RNG from a supported waiting-point JSON with freshly compiled code', async () => {
  const f = fixture(),
    { use, source } = addSource(f)
  const run = f.battle.startBattle().catch(error => {
    if (error.message !== 'Battle cancelled') throw error
  })
  await f.battle.waitForInputReady()
  source.stack = 3
  const baseline = f.a.activePet.stat.def - 9
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, snapshotCatalog(f, [use.effect], source.base))))
  const expectedRandom = f.battle.random()
  await f.battle.cleanup()
  await run
  const fresh = fixture(),
    freshSource = new BaseMark('sdk:charge' as baseMarkId, [])
  const compiled = compile('stack-defense', 'defense', freshSource)
  freshSource.effects.push(compiled.effect)
  const restored = restoreBattle(saved, snapshotCatalog(fresh, [compiled.effect], freshSource))
  battles.push(restored)
  expect(restored.random()).toBe(expectedRandom)
  const pet = restored.playerA.activePet,
    mark = pet.marks.find(mark => mark.baseId === freshSource.id)!
  expect(pet.stat.def).toBe(baseline + 9)
  mark.stack = 4
  expect(pet.stat.def).toBe(baseline + 12)
  restored.removeMark(new RemoveMarkContext(new TurnContext(restored), mark))
  expect(pet.stat.def).toBe(baseline)
})

it('keeps native parameters scoped to each use and exposes the actual typed context', () => {
  const f = fixture(),
    seen: unknown[] = []
  const native = sdk.defineCodeEffect({
    id: 'sdk:configured',
    sourceKind: 'skill',
    triggers: [EffectTrigger.OnHit],
    parameters: { amount: sdk.numberParam({ default: 5 }) },
    apply(context) {
      seen.push(context)
      const owner = context.source.owner
      const amount = context.battle.configSystem.get(
        sdk.parameterAddress(context.effect!.id, 'parameters', 'amount'),
        context.source,
      )
      if (owner instanceof Pet && typeof amount === 'number')
        owner.heal(new HealContext(context, context.source, owner, amount))
    },
  })
  for (const [index, useId] of ['one', 'two'].entries()) {
    const compiled = compileBehaviorUse(
      sdk.codeEffectDefinition(native),
      { useId, definitionId: native.id },
      {
        owner: { kind: 'skill', id: 'fixture/setup' },
        nativeExports: [native],
      },
    )
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
    compiled.parameters.install(f.battle.configSystem)
    compiled.parameters.set(
      f.battle.configSystem,
      sdk.parameterAddress(compiled.effect.id, 'parameters', 'amount'),
      7 + index,
    )
    const context = new EffectContext(attack(f), EffectTrigger.OnHit, f.a.activePet.skills[0], compiled.effect)
    f.a.activePet.currentHp = 1
    compiled.effect.innerApply(context)
    expect(seen.at(-1)).toBe(context)
    expect(f.a.activePet.currentHp).toBe(8 + index)
  }
})

it('captures native declaration fields before compiling uses and validates unsupported triggers', () => {
  const f = fixture()
  let calls = 0
  const input = {
    id: 'sdk:immutable',
    sourceKind: 'skill' as const,
    triggers: [EffectTrigger.TurnEnd] as EffectTrigger.TurnEnd[],
    apply() {
      calls++
    },
  }
  const native = sdk.defineCodeEffect(input)
  input.triggers.length = 0
  input.apply = () => {
    throw new Error('mutated input')
  }
  const compiled = compileBehaviorUse(
    sdk.codeEffectDefinition(native),
    { useId: 'immutable', definitionId: native.id },
    {
      owner: { kind: 'skill', id: 'fixture/setup' },
      nativeExports: [native],
    },
  )
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  f.a.activePet.skills[0].effects.splice(0, Infinity, compiled.effect)
  f.battle.applyEffects(new TurnContext(f.battle), EffectTrigger.TurnEnd, f.a.activePet.skills[0])
  expect(calls).toBe(1)
  const invalid = sdk.defineCodeEffect({
    id: 'sdk:invalid',
    sourceKind: 'skill',
    triggers: ['ImaginaryTrigger' as EffectTrigger.TurnEnd],
    apply() {},
  })
  const rejected = compileBehaviorUse(
    sdk.codeEffectDefinition(invalid),
    { useId: 'invalid', definitionId: invalid.id },
    {
      owner: { kind: 'skill', id: 'fixture/setup' },
      nativeExports: [invalid],
    },
  )
  expect(rejected.ok).toBe(false)
})
