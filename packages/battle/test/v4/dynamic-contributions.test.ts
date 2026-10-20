import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  generatedDynamicContributions,
  createGeneratedDynamicContributions,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  effectAuthoring,
  BaseMark,
  AddMarkContext,
  RemoveMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  defineNativeEffect,
  parameterAddress,
  setGlobalLogger,
  type Battle,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
type Id = keyof typeof generatedDynamicContributions
const ids = Object.keys(generatedDynamicContributions) as Id[]
const ledger = JSON.parse(
  readFileSync(
    new URL('../../../../docs/v4/validation/dynamic-contributions-candidates.json', import.meta.url),
    'utf8',
  ),
)
function normalize(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
        )
      : v
}
const definitions = new Map(
  ids.map(id => {
    const r = ledger.records.find((r: { id: string }) => r.id === id)
    const d = parse(readFileSync(new URL(`../../../../${r.sourceFile}`, import.meta.url), 'utf8'), { merge: true })[
      Number(r.sourcePath.slice(1))
    ]
    expect(r.definitionSha256).toBe(
      createHash('sha256')
        .update(JSON.stringify(normalize(d)))
        .digest('hex'),
    )
    expect(r.recipe.repairedPaths).toEqual([])
    expect(r.recipe.pathRepairs).toBeUndefined()
    return [id, d]
  }),
)
const oracles = new Map(ids.map(id => [id, EffectParser.parse(definitions.get(id))]))
const battles: Battle[] = [],
  errors: unknown[][] = []
beforeAll(() =>
  setGlobalLogger({
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      errors.push(args)
    },
  }),
)
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
  expect(errors.splice(0)).toEqual([])
})
function run(id: Id, native: boolean, variant: string, stack: number) {
  const f = makeScenario(2701)
  battles.push(f.battle)
  for (const pet of [...f.a.team, ...f.b.team]) for (const skill of pet.skills) skill.effects.splice(0)
  const d = definitions.get(id)!,
    effect = native ? generatedDynamicContributions[id] : oracles.get(id)!
  if (native) effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  const source = new BaseMark('fixture/dynamic-source' as baseMarkId, [effect], {
    ...f.debuff.config,
    maxStacks: 500,
    duration: -1,
  }).createInstance()
  source.setOwner(f.a.activePet, f.battle.emitter)
  source.stack = stack
  f.a.activePet.marks.push(source)
  const pet = f.a.activePet,
    bench = f.a.team[1]
  const read = () => [
    pet.attributeSystem.getAttribute$(d.apply.stat).value,
    bench.attributeSystem.getAttribute$(d.apply.stat).value,
  ]
  const before = read(),
    parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, pet.skills[0])
  const event = new AddMarkContext(parent, pet, source.base)
  const parameter = d.apply.observableValue.chain[1]?.arg
  const set = (n: number) =>
    f.battle.configSystem.set(
      native ? parameterAddress(id, 'parameters', 'action0_value_factor') : `${id}.${parameter.configId}`,
      n,
      source,
    )
  if (typeof parameter === 'object') set(-2.5)
  let admitted = 0
  f.b.team[1].skills[0].effects.push(
    defineNativeEffect({
      id: 'fixture/dynamic-observer' as effectId,
      triggers: [EffectTrigger.BeforeEffect],
      when: c => c.parent instanceof EffectContext && c.parent.effect?.id === id,
      apply(c) {
        admitted++
        if (variant === 'late-owner') source.setOwner(bench, f.battle.emitter)
        if (variant === 'late-stack') source.stack = 11
        if (variant === 'cancel' && c.parent instanceof EffectContext) c.parent.available = false
      },
    }),
  )
  const fire = () => f.battle.applyEffects(event, EffectTrigger.OnMarkCreated, source)
  fire()
  const first = read()
  source.stack = 3.5
  const changed = read()
  if (typeof parameter === 'object') set(-7)
  const configured = read()
  if (variant === 'repeat') fire()
  source.stack = 5
  const repeated = read()
  source.isSuppressed = true
  const suppressed = read()
  source.isSuppressed = false
  const restored = read()
  f.battle.removeMark(new RemoveMarkContext(parent, source))
  const removed = read()
  return { before, first, changed, configured, repeated, suppressed, restored, removed, admitted }
}
for (const id of ids)
  for (const variant of ['normal', 'repeat', 'late-owner', 'late-stack', 'cancel'])
    for (const stack of [0, 1, 2.5, 99, 100, 101])
      it(`${id}/${variant}/${stack}`, () =>
        expect(run(id, true, variant, stack)).toEqual(run(id, false, variant, stack)))
for (const id of ids)
  it(`source cleanup ${id}`, () => {
    const r = run(id, true, 'normal', 2)
    expect(r.removed).toEqual(r.before)
    expect(r.suppressed).toEqual(r.before)
    expect(r.restored).toEqual(r.repeated)
  })
it('clamp preserves fractional stack and caps at exactly 100', () => {
  const r = run('effect_mark_xukongtizhi_evasion', true, 'normal', 101)
  expect(Number(r.first[0]) - Number(r.before[0])).toBe(100)
  expect(Number(r.changed[0]) - Number(r.before[0])).toBe(3.5)
})
it('configured multiplier remains captured per installation', () => {
  const r = run('effect_mark_reduce_accuracy_5_per_stack', true, 'repeat', 2)
  expect(r.configured).toEqual(r.changed)
  expect(Number(r.repeated[0]) - Number(r.before[0])).toBe(Math.floor(5 * -2.5) + Math.floor(5 * -7))
})

for (const id of ids)
  it(`fresh-factory checkpoint ${id}`, async () => {
    const f = makeScenario(2702)
    battles.push(f.battle)
    for (const pet of [...f.a.team, ...f.b.team]) for (const skill of pet.skills) skill.effects.splice(0)
    const d = definitions.get(id)!,
      effect = createGeneratedDynamicContributions()[id]
    effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
    const base = new BaseMark('fixture/dynamic-checkpoint' as baseMarkId, [effect], {
      ...f.debuff.config,
      maxStacks: 500,
      duration: -1,
      persistent: true,
      keepOnSwitchOut: true,
    })
    const source = base.createInstance()
    source.setOwner(f.a.activePet, f.battle.emitter)
    source.stack = 2
    f.a.activePet.marks.push(source)
    const before = Number(f.a.activePet.attributeSystem.getAttribute$(d.apply.stat).value)
    const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
    const project = d.apply.observableValue.chain[1],
      raw = typeof project?.arg === 'object'
    const key = parameterAddress(id, 'parameters', 'action0_value_factor')
    if (raw) f.battle.configSystem.set(key, -2.5, source)
    const fire = () =>
      f.battle.applyEffects(new AddMarkContext(parent, f.a.activePet, base), EffectTrigger.OnMarkCreated, source)
    fire()
    if (raw) f.battle.configSystem.set(key, -7, source)
    fire()
    const ready = new Promise<void>(resolve =>
      f.battle.registerListener(m => {
        if (m.type === BattleMessageType.TurnAction) resolve()
      }),
    )
    const run = f.battle.startBattle().catch(() => {})
    await ready
    const catalog = (e: typeof effect) => {
      const c = new SnapshotCatalog(`dynamic/${id}`)
      for (const pet of [...f.a.team, ...f.b.team])
        for (const skill of pet.skills)
          for (const x of [...skill.base.effects, ...skill.effects]) c.registerEffect(x.id, x)
      for (const x of f.debuff.effects) c.registerEffect(x.id, x)
      return effectAuthoring.registerEffect(c, e)
    }
    const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(effect))))
    await f.battle.cleanup()
    await run
    const restored = restoreBattle(saved, catalog(createGeneratedDynamicContributions()[id]))
    battles.push(restored)
    const pet = restored.playerA.activePet,
      mark = pet.marks.find(m => m.baseId === base.id)!
    if (raw) restored.configSystem.set(key, 100, mark)
    mark.stack = 5
    const expected = raw
      ? Math.floor(5 * -2.5) + Math.floor(5 * -7)
      : !project
        ? 10
        : project.type === 'clampMax'
          ? 2 * Math.min(5, project.arg)
          : 2 * Math.floor(5 * project.arg)
    expect(Number(pet.attributeSystem.getAttribute$(d.apply.stat).value) - before).toBe(expected)
    restored.removeMark(
      new RemoveMarkContext(new EffectContext(new TurnContext(restored), EffectTrigger.TurnStart, pet.skills[0]), mark),
    )
    expect(pet.attributeSystem.getAttribute$(d.apply.stat).value).toBe(before)
  })
