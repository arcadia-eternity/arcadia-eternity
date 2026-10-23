import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, beforeAll, expect, it } from 'vitest'
import { ChainableSelector, EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import {
  EffectContext,
  EffectTrigger,
  TurnContext,
  Signal,
  GameRng,
  BattleMessageType,
  SnapshotCatalog,
  snapshotBattle,
  restoreBattle,
  Modifier,
  DurationType,
  setGlobalLogger,
  type Battle,
  type ReactiveValue,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
const battles: Battle[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const b of battles.splice(0)) await b.cleanup()
})
function fixture(seed = 317) {
  const f = makeScenario(seed)
  battles.push(f.battle)
  return { ...f, ctx: new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0]) }
}
for (const input of [[], [3], [5, 2], [1, 4], [7, 7], [30, 70, 100]])
  it(`sampleBetween ${JSON.stringify(input)}`, () => {
    const f = fixture()
    const rng = new GameRng(317)
    let reads = 0
    const selector = new ChainableSelector(() => {
      reads++
      return input
    }, 'number').sampleBetween()
    const valid = input.length >= 2 && input[0] <= input[1]
    const expected = valid ? [rng.nextInt(input[0], input[1])] : []
    expect(selector.build()(f.ctx)).toEqual(expected)
    expect(reads).toBe(1)
    expect(f.battle.random()).toBe(rng.next())
  })
for (const input of [[], [2], [1, 2], [-5, 2, 4]])
  it(`avg ${JSON.stringify(input)}`, () => {
    const f = fixture()
    const value = input.length ? input.reduce((a, b) => a + b, 0) / input.length : 0
    expect(new ChainableSelector(() => input, 'number').avg().build()(f.ctx)).toEqual([value])
  })
it('dynamic average follows source changes, preserving fractions and single-source identity', () => {
  const f = fixture(),
    a = new Signal(1),
    b = new Signal(2)
  const result = new ChainableSelector(() => [a, b], 'Observable<number>').avg().build()(f.ctx)[0]
  expect(result.value).toBe(1.5)
  a.next(4)
  expect(result.value).toBe(3)
  expect(new ChainableSelector(() => [a], 'Observable<number>').avg().build()(f.ctx)[0]).toBe(a)
  expect(new ChainableSelector<Signal<number>>(() => [], 'Observable<number>').avg().build()(f.ctx)[0].value).toBe(0)
})
it('parser and schema dispatch restored numeric steps', () => {
  const f = fixture()
  for (const [type, value, expected] of [
    ['avg', [1, 2], 1.5],
    ['sampleBetween', [7, 7], 7],
  ] as const) {
    const effect = EffectParser.parse({
      id: `fixture/${type}`,
      trigger: 'TurnStart',
      priority: 0,
      apply: { type: 'setRage', target: 'self', value: { type: 'selector', value: [...value], chain: [{ type }] } },
    })
    f.battle.executionBudget.run(0, () =>
      effect.innerApply(
        new EffectContext(new TurnContext(f.battle), EffectTrigger.TurnStart, f.a.activePet.skills[0], effect),
      ),
    )
    expect(f.a.currentRage).toBe(expected)
  }
})
it('restores live average projection through a fresh JSON snapshot', async () => {
  const f = fixture(),
    catalog = new SnapshotCatalog('average/1')
  for (const p of [...f.a.team, ...f.b.team])
    for (const s of p.skills) for (const e of s.effects) catalog.registerEffect(e.id, e)
  for (const e of f.debuff.effects) catalog.registerEffect(e.id, e)
  const ready = new Promise<void>(resolve =>
    f.battle.registerListener(m => {
      if (m.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  const run = f.battle.startBattle().catch(() => {})
  await ready
  const skills = f.a.activePet.skills
  const inputs = [
    skills[0].attributeSystem.getAttribute$('power') as ReactiveValue<number>,
    skills[0].attributeSystem.getAttribute$('accuracy') as ReactiveValue<number>,
  ]
  const avg = new ChainableSelector(() => inputs, 'Observable<number>').avg().build()(f.ctx)[0]
  f.a.activePet.attributeSystem.addModifier('atk', new Modifier(DurationType.binding, 'average-test', avg, 'delta', 0))
  const before = f.a.activePet.stat.atk
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog)))
  await f.battle.cleanup()
  await run
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  expect(restored.playerA.activePet.stat.atk).toBe(before)
  const skill = restored.playerA.activePet.skills[0]
  skill.power += 20
  expect(restored.playerA.activePet.stat.atk).toBe(before + 10)
})
it('pins the historical sampleBetween body', () => {
  const s = readFileSync(new URL('../../src/v4/legacy/effectBuilder/src/selector.ts', import.meta.url), 'utf8')
  const body = s.slice(s.indexOf('  sampleBetween('), s.indexOf('  /** 对目标列表乱序')).replace(/\s+/g, '')
  expect(createHash('sha256').update(body).digest('hex')).toBe(
    '4dd73ed6970dd71c66f31ef71f94e38eacca12cb0be7d73b00576435f67430c8',
  )
})
it('sampleBetween re-queries its source and rejects nonnumeric bounds before drawing', () => {
  const f = fixture()
  let bounds = [1, 1]
  const selector = new ChainableSelector(() => bounds, 'number').sampleBetween()
  expect(selector.build()(f.ctx)).toEqual([1])
  bounds = [8, 8]
  expect(selector.build()(f.ctx)).toEqual([8])
  const rng = new GameRng(317)
  rng.next()
  rng.next()
  bounds = ['invalid' as unknown as number, 10]
  expect(selector.build()(f.ctx)).toEqual([])
  expect(f.battle.random()).toBe(rng.next())
})
