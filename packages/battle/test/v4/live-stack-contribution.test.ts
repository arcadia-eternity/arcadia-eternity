import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  createGeneratedAttributeContributions,
  effectAuthoring,
  BaseMark,
  AddMarkContext,
  RemoveMarkContext,
  EffectContext,
  EffectTrigger,
  TurnContext,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  BattleMessageType,
  parameterAddress,
  setGlobalLogger,
  getValueRecipe,
  type Battle,
  type baseMarkId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const id = 'effect_mark_increase_crit_rate_20_percent_per_stack'
const original = parse(readFileSync(new URL('../../../../packs/base/data/effect_mark.yaml', import.meta.url), 'utf8'), {
  merge: true,
}).find((d: { id: string }) => d.id === id)
const legacy = EffectParser.parse(original)
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
  for (const battle of battles.splice(0)) await battle.cleanup()
  expect(errors.splice(0)).toEqual([])
})
function setup(native: boolean) {
  const f = makeScenario(2601)
  battles.push(f.battle)
  for (const p of [...f.a.team, ...f.b.team]) for (const s of p.skills) s.effects.splice(0)
  const effect = native ? createGeneratedAttributeContributions()[id] : legacy
  if (native) effectAuthoring.effectParameters(effect).install(f.battle.configSystem)
  const base = new BaseMark('fixture/live-crit' as baseMarkId, [effect], {
    ...f.debuff.config,
    maxStacks: 20,
    stackable: true,
    duration: -1,
    persistent: true,
    keepOnSwitchOut: true,
  })
  const mark = base.createInstance()
  mark.setOwner(f.a.activePet, f.battle.emitter)
  f.a.activePet.marks.push(mark)
  const parent = new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0])
  const event = new AddMarkContext(parent, f.a.activePet, base)
  const key = native ? parameterAddress(id, 'parameters', 'action0_value_factor') : `${id}.crit_rate_increase_per_stack`
  const set = (value: number) => f.battle.configSystem.set(key, value, mark)
  const fire = () => f.battle.applyEffects(event, EffectTrigger.OnMarkCreated, mark)
  return { ...f, mark, parent, set, fire, effect }
}
for (const factor of [20, 3.5, -2.5, 0])
  it(`follows stack, captures multiplier and appends ${factor}`, () => {
    const run = (native: boolean) => {
      const f = setup(native),
        before = f.a.activePet.stat.critRate,
        trace: number[] = []
      const read = () => trace.push(f.a.activePet.stat.critRate - before)
      f.mark.stack = 2
      f.set(factor)
      f.fire()
      read()
      f.mark.stack = 3
      read()
      f.set(7)
      read()
      f.fire()
      read()
      f.mark.stack = 4
      read()
      f.mark.isSuppressed = true
      read()
      f.mark.isSuppressed = false
      read()
      f.battle.removeMark(new RemoveMarkContext(f.parent, f.mark))
      read()
      return trace
    }
    const actual = run(true)
    expect(actual).toEqual(run(false))
    expect(actual).toEqual([
      Math.floor(2 * factor),
      Math.floor(3 * factor),
      Math.floor(3 * factor),
      Math.floor(3 * factor) + 21,
      Math.floor(4 * factor) + 28,
      0,
      Math.floor(4 * factor) + 28,
      0,
    ])
  })
it('restores appended bindings with independent captured factors and fresh factories', async () => {
  const f = setup(true),
    before = f.a.activePet.stat.critRate
  f.mark.stack = 2
  f.set(3.5)
  f.fire()
  f.set(7)
  f.fire()
  f.set(100)
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(m => {
      if (m.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = f.battle.startBattle().catch(() => {})
  await ready
  function catalog(effect: typeof f.effect) {
    const result = new SnapshotCatalog('live-stack-contribution/v1')
    for (const pet of [...f.a.team, ...f.b.team])
      for (const skill of pet.skills)
        for (const e of [...skill.base.effects, ...skill.effects]) result.registerEffect(e.id, e)
    for (const e of f.debuff.effects) result.registerEffect(e.id, e)
    effectAuthoring.registerEffect(result, effect)
    return result
  }
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog(f.effect))))
  await f.battle.cleanup()
  await run
  const restored = restoreBattle(saved, catalog(createGeneratedAttributeContributions()[id]))
  battles.push(restored)
  const pet = restored.playerA.activePet,
    mark = pet.marks.find(m => m.baseId === 'fixture/live-crit')!
  expect(pet.stat.critRate - before).toBe(21)
  mark.stack = 3
  expect(pet.stat.critRate - before).toBe(31)
  restored.configSystem.set(parameterAddress(id, 'parameters', 'action0_value_factor'), 200, mark)
  mark.stack = 4
  expect(pet.stat.critRate - before).toBe(42)
  const ctx = new EffectContext(new TurnContext(restored), EffectTrigger.TurnStart, pet.skills[0])
  restored.removeMark(new RemoveMarkContext(ctx, mark))
  expect(pet.stat.critRate).toBe(before)
})

it('combined plans retain sibling dependencies after a fault and reject missing restored captures', () => {
  const f = setup(true),
    pet = f.a.activePet
  const { bindings, targets, compileEffect, defineEffect, ops, registerEffect } = effectAuthoring
  let fault = false
  const left = targets.sourceMark
    .first()
    .attribute('stack')
    .follow({ key: 'stack' })
    .map(n => {
      if (fault) throw new Error('left fault')
      return n
    })
  const make = (capture: boolean) => {
    const query = targets.ownerPet.first().attribute('spe')
    const right = capture ? query.capture({ key: 'right', scope: 'binding' }) : query.follow({ key: 'right' })
    return compileEffect(
      defineEffect({
        id: `fixture/combined/${capture}`,
        on: 'OnMarkCreated',
        execute: targets.ownerPet.apply(
          ops.bindAttribute({
            key: 'combined',
            attribute: 'critRate',
            operation: 'delta',
            value: bindings.combine(left, right, (a, b) => a + b),
            lifetime: 'sourceMark',
            missing: 'detach',
          }),
        ),
      }),
    )
  }
  const effect = make(false),
    before = pet.stat.critRate
  const fire = (e: typeof effect) =>
    f.battle.executionBudget.run(f.battle.currentTurn, () =>
      e.innerApply(
        new EffectContext(new AddMarkContext(f.parent, pet, f.mark.base), EffectTrigger.OnMarkCreated, f.mark, e),
      ),
    )
  fire(effect)
  expect(pet.stat.critRate - before).toBe(f.mark.stack + pet.stat.spe)
  fault = true
  f.mark.stack = 3
  expect(pet.stat.critRate).toBe(before)
  fault = false
  pet.attributeSystem.updateBaseValue('spe', 123)
  expect(pet.stat.critRate - before).toBe(126)
  const captured = make(true)
  fire(captured)
  const modifier = pet.attributeSystem.findModifier(
    'critRate',
    JSON.stringify([f.mark.id, captured.id, 'combined', pet.id]),
  )!
  const recipe = getValueRecipe(modifier.value)
  if (recipe?.type !== 'bound' || typeof recipe.key !== 'string') throw new Error('Expected bound recipe')
  if (
    !recipe.state ||
    typeof recipe.state !== 'object' ||
    !('captures' in recipe.state) ||
    !(recipe.state.captures instanceof Map)
  )
    throw new Error('Expected capture state')
  const state = recipe.state,
    key = recipe.key
  expect(recipe.state.captures.has('right')).toBe(true)
  const catalog = registerEffect(new SnapshotCatalog('combined-fault'), captured)
  fault = true
  f.mark.stack = 4
  expect(() =>
    catalog.restoreValueBinding(
      key,
      { source: f.mark },
      { ...state, captures: new Map() },
      { pet, attribute: 'critRate' },
    ),
  ).toThrow('Missing or mismatched capture: right')
})

it('pins the unchanged source without correction decisions', () => {
  const ledger = JSON.parse(
    readFileSync(
      new URL('../../../../docs/v4/validation/attribute-contributions-candidates.json', import.meta.url),
      'utf8',
    ),
  )
  const record = ledger.records.find((r: { id: string }) => r.id === id)
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map(k => [k, normalize((v as Record<string, unknown>)[k])]),
          )
        : v
  expect(record.definitionSha256).toBe(
    createHash('sha256')
      .update(JSON.stringify(normalize(original)))
      .digest('hex'),
  )
  expect(record.recipe.repairedPaths).toEqual([])
  expect(record.recipe.pathRepairs).toBeUndefined()
  expect(record.classification).toBe('U')
})
