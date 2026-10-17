import { afterEach, beforeAll, expect, it } from 'vitest'
import {
  type SkillInstance,
  Signal,
  derived,
  DurationType,
  Modifier,
  ModifierHelpers,
  ConfigModifier,
  ConfigDurationType,
  ConfigModifierType,
  EffectContext,
  EffectTrigger,
  TurnContext,
  setGlobalLogger,
  type Battle,
  type ReactiveValue,
} from '@arcadia-eternity/battle/v4'
import { ChainableSelector, EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import { makeScenario } from './scenario'
const battles: Battle[] = []
function fixture() {
  const f = makeScenario()
  battles.push(f.battle)
  return f
}
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})
it('switches dynamic dependencies and disconnects the unused branch and last observer', () => {
  const choose = new Signal(true),
    a = new Signal(1),
    b = new Signal(5)
  const value = derived(() => (choose.value ? a.value : b.value))
  const received: number[] = [],
    sub = value.subscribe(v => received.push(v))
  a.next(2)
  choose.next(false)
  a.next(9)
  b.next(6)
  expect(received).toEqual([1, 2, 5, 6])
  expect(a.observerCount).toBe(0)
  sub.unsubscribe()
  expect(choose.observerCount).toBe(0)
  expect(b.observerCount).toBe(0)
})
it('reads a diamond dependency graph without emitting a stale intermediate result', () => {
  const source = new Signal(1),
    left = derived(() => source.value * 2),
    right = derived(() => source.value + 2)
  const combined = derived(() => left.value + right.value),
    values: number[] = []
  const sub = combined.subscribe(v => values.push(v))
  source.next(2)
  expect(values).toEqual([5, 8])
  sub.unsubscribe()
  expect(source.observerCount).toBe(0)
})
it('retains dynamic attribute binding and releases source subscriptions when removed', () => {
  const { a } = fixture(),
    delta = new Signal(3),
    values: (number | boolean | string)[] = []
  const cleanup = a.activePet.attributeSystem.addModifier(
    'atk',
    new Modifier(DurationType.binding, 'delta', delta, 'delta', 0),
  )
  const sub = a.activePet.attributeSystem.getAttribute$('atk').subscribe(v => values.push(v))
  delta.next(7)
  cleanup()
  delta.next(99)
  expect(values).toEqual([58, 62, 55])
  expect(delta.observerCount).toBe(0)
  sub.unsubscribe()
})
it('updates reactive clamps and releases their bound subscriptions on modifier cleanup', () => {
  const { a } = fixture(),
    min = new Signal(0),
    max = new Signal(50)
  const { modifier } = ModifierHelpers.createReactiveClamp('bounds', min, max)
  const remove = a.activePet.attributeSystem.addModifier('atk', modifier),
    values: unknown[] = []
  const sub = a.activePet.attributeSystem.getAttribute$('atk').subscribe(v => values.push(v))
  max.next(40)
  min.next(60)
  expect(values).toEqual([50, 40, 60])
  remove()
  sub.unsubscribe()
  expect(min.observerCount).toBe(0)
  expect(max.observerCount).toBe(0)
})
it('keeps config values dynamic without leaking a second subscription per modifier', () => {
  const { a, battle } = fixture(),
    source = new Signal(3)
  battle.configSystem.registerConfig('dynamic', 10)
  const remove = battle.configSystem.addScopedConfigModifier(
    'dynamic',
    new ConfigModifier(ConfigDurationType.binding, 'dynamic', source, ConfigModifierType.delta, 0),
    a,
  )
  expect(battle.configSystem.get('dynamic', a.activePet)).toBe(13)
  source.next(9)
  expect(battle.configSystem.get('dynamic', a.activePet)).toBe(19)
  remove()
  expect(battle.configSystem.get('dynamic', a.activePet)).toBe(10)
  expect(source.observerCount).toBe(0)
})
it('executes a real legacy DSL dynamic modifier and updates it when the source attribute changes', () => {
  const { a, b, battle } = fixture()
  const effect = EffectParser.parse({
    id: 'dynamic-dsl',
    trigger: 'TurnStart',
    priority: 0,
    apply: {
      type: 'addDynamicAttributeModifier',
      target: 'self',
      stat: 'atk',
      modifierType: 'override',
      observableValue: {
        base: 'opponent',
        chain: [
          { type: 'selectAttribute$', arg: 'def' },
          { type: 'multiply', arg: 2 },
        ],
      },
    },
  })
  a.activePet.skills[0].effects.push(effect)
  battle.applyEffects(new TurnContext(battle), EffectTrigger.TurnStart)
  expect(a.activePet.stat.atk).toBe(b.activePet.stat.def * 2)
  b.activePet.attributeSystem.updateBaseValue('def', 77)
  expect(a.activePet.stat.atk).toBe(154)
})
it('keeps legacy sum/add/divide/clamp projections live on the same value sources', () => {
  const { battle, a } = fixture(),
    x = new Signal(10),
    y = new Signal(20)
  const selector = new ChainableSelector<ReactiveValue<number>>(() => [x, y], 'Observable<number>')
    .sum()
    .add(5)
    .divide(5)
    .clampMax(8)
    .clampMin(2)
  const ctx = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, a.activePet.skills[0])
  const [result] = selector.build()(ctx)
  expect(result.value).toBe(7)
  y.next(40)
  expect(result.value).toBe(8)
})

it('disposes bound clamp inputs on bulk mark-source removal', () => {
  const { a } = fixture(),
    source = a.activePet.skills[0],
    min = new Signal(0),
    max = new Signal(20)
  const { modifier } = ModifierHelpers.createReactiveClamp('bulk', min, max, 0, source)
  a.activePet.attributeSystem.addModifier('atk', modifier)
  expect(a.activePet.stat.atk).toBe(20)
  a.activePet.attributeSystem.removeModifiersFromSource(source.id)
  expect(a.activePet.stat.atk).toBe(55)
  expect(min.observerCount).toBe(0)
  expect(max.observerCount).toBe(0)
})
it('disconnects the graph if initial subscription evaluation fails', () => {
  const source = new Signal(0),
    value = derived(() => {
      const n = source.value
      if (!n) throw new Error('empty')
      return n
    })
  expect(() => value.subscribe(() => {})).toThrow('empty')
  expect(source.observerCount).toBe(0)
  source.next(2)
  expect(value.value).toBe(2)
})

it('preserves the legacy selectObservable selector name and live attribute reference', () => {
  const { a, battle } = fixture()
  const skill = a.activePet.skills[0]
  const selector = new ChainableSelector<SkillInstance>(() => [skill], 'SkillInstance').selectObservable('power')
  const ctx = new EffectContext(new TurnContext(battle), EffectTrigger.TurnStart, skill)
  const [reference] = selector.build()(ctx)
  const value = reference.get$()
  expect(value.value).toBe(skill.power)
  skill.attributeSystem.updateBaseValue('power', 77)
  expect(value.value).toBe(77)
})
