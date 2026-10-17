import { afterEach, beforeAll, expect, it } from 'vitest'
import { Type } from '@sinclair/typebox'
import {
  normalizeParams,
  defineParameter,
  ParameterCatalog,
  parameterAddress,
  ConfigModifier,
  ConfigModifierType,
  ConfigDurationType,
  type Battle,
  setGlobalLogger,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'

beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
const battles: Battle[] = []
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
})

it('uses schema defaults while preserving zero/false and rejecting unknown or invalid input', () => {
  const schema = Type.Object(
    {
      ratio: Type.Number({ minimum: 0, maximum: 1, default: 0.1 }),
      enabled: Type.Boolean({ default: true }),
    },
    { additionalProperties: false },
  )
  expect(normalizeParams(schema, {})).toEqual({ ratio: 0.1, enabled: true })
  const input = { ratio: 0, enabled: false }
  const normalized = normalizeParams(schema, input)
  expect(normalized).toEqual(input)
  expect(Object.isFrozen(normalized)).toBe(true)
  expect(normalized).not.toBe(input)
  expect(() => normalizeParams(schema, { ratio: '0.2' })).toThrow()
  expect(() => normalizeParams(schema, { ratio: Infinity })).toThrow()
  expect(() => normalizeParams(schema, { ratio: 2 })).toThrow()
  expect(() => normalizeParams(schema, { extra: 1 })).toThrow()
})

it('isolates two uses of a parameter and reads scoped modifiers through the real battle config', () => {
  const { battle, a } = makeScenario()
  battles.push(battle)
  const schema = Type.Number({ minimum: 0, maximum: 1, default: 0.1 })
  const first = defineParameter({
    address: parameterAddress('heal', 'first', 'ratio'),
    schema,
    effectiveSchema: schema,
    value: 0.2,
    operations: [ConfigModifierType.delta],
    aliases: ['old.heal'],
  })
  const second = defineParameter({
    address: parameterAddress('heal', 'second', 'ratio'),
    schema,
    effectiveSchema: schema,
    value: 0.4,
    operations: [ConfigModifierType.delta],
  })
  const catalog = new ParameterCatalog([first, second])
  catalog.install(battle.configSystem)
  expect(catalog.read(battle.configSystem, first.address, a.activePet)).toBe(0.2)
  const remove = catalog.modify(
    battle.configSystem,
    first.address,
    new ConfigModifier(ConfigDurationType.binding, 'ratio-increase', 0.1, ConfigModifierType.delta, 0),
    a.activePet,
  )
  expect(catalog.read(battle.configSystem, 'old.heal', a.activePet)).toBeCloseTo(0.3)
  expect(catalog.read(battle.configSystem, second.address, a.activePet)).toBe(0.4)
  expect(catalog.read(battle.configSystem, first.address, a.team[1])).toBe(0.2)
  remove()
  expect(catalog.read(battle.configSystem, first.address, a.activePet)).toBe(0.2)
  expect(() =>
    catalog.modify(
      battle.configSystem,
      first.address,
      new ConfigModifier(ConfigDurationType.binding, 'invalid-op', 1, ConfigModifierType.override, 0),
    ),
  ).toThrow('operation')
  expect(() => catalog.install(battle.configSystem)).toThrow('already registered')
})

it('rejects ambiguous aliases before installation and reports invalid effective results without clamping', () => {
  const { battle } = makeScenario()
  battles.push(battle)
  const schema = Type.Number({ minimum: 0, maximum: 1 })
  const make = (node: string) =>
    defineParameter({
      address: parameterAddress('effect', node, 'ratio'),
      schema,
      effectiveSchema: schema,
      value: 0.5,
      operations: [ConfigModifierType.delta],
      aliases: ['legacy.ratio'],
    })
  expect(() => new ParameterCatalog([make('a'), make('b')])).toThrow('alias')
  const definition = make('a')
  const catalog = new ParameterCatalog([definition])
  catalog.install(battle.configSystem)
  const remove = catalog.modify(
    battle.configSystem,
    definition.address,
    new ConfigModifier(ConfigDurationType.binding, 'out-of-range', 1, ConfigModifierType.delta, 0),
  )
  expect(() => catalog.read(battle.configSystem, definition.address)).toThrow('effective')
  remove()
  expect(catalog.read(battle.configSystem, definition.address)).toBe(0.5)
  expect(parameterAddress('a/b', 'c', 'd')).not.toBe(parameterAddress('a', 'b/c', 'd'))
})

it('preflights all registrations and snapshots mutable definition inputs', async () => {
  const { battle } = makeScenario()
  battles.push(battle)
  const schema = Type.Number({ minimum: 0, maximum: 1, default: 0 })
  const first = defineParameter({
    address: parameterAddress('effect', 'a', 'ratio'),
    schema,
    effectiveSchema: Type.Number({ minimum: 0, maximum: 2 }),
    operations: [ConfigModifierType.delta],
  })
  const mutable = { ...first, aliases: ['old'], operations: [ConfigModifierType.delta] }
  const catalog = new ParameterCatalog([mutable])
  mutable.aliases.push('added-later')
  mutable.operations.length = 0
  catalog.install(battle.configSystem)
  expect(() => catalog.read(battle.configSystem, 'added-later')).toThrow('Unknown')
  const remove = catalog.modify(
    battle.configSystem,
    mutable,
    new ConfigModifier(ConfigDurationType.binding, 'beyond-content-range', 1.5, ConfigModifierType.delta, 0),
  )
  const result: number = catalog.read(battle.configSystem, mutable)
  expect(result).toBe(1.5)
  remove()
  const second = defineParameter({ ...first, address: parameterAddress('effect', 'b', 'ratio') })
  const conflict = new ParameterCatalog([second, first])
  expect(() => conflict.install(battle.configSystem)).toThrow('already registered')
  expect(battle.configSystem.hasRegisteredConfig(second.address)).toBe(false)
  await battle.cleanup()
  expect(() => conflict.install(battle.configSystem)).toThrow('disposed')
})
