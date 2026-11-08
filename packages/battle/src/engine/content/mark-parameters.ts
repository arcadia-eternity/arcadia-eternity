import { type Static, type TObject } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { BaseMark, type MarkInstance } from '../mark'
import type { ConfigSystem } from '../config'
import { freezeContent } from './immutable'
import { defineParameter, normalizeParams, ParameterCatalog } from './parameters'
import { validateParameterSlots, type PublicParameterSlot } from './capability-parameters'

export type MarkInstanceParams = Readonly<Record<string, string | number | boolean>>
const contracts = new WeakMap<BaseMark, ReturnType<typeof createContract>>()

function createContract<S extends TObject>(
  base: BaseMark,
  inputSchema: S,
  slots: Readonly<Record<string, PublicParameterSlot>>,
) {
  const schema = Value.Clone(inputSchema)
  const fields = Object.keys(schema.properties)
  if (
    fields.length > 64 ||
    fields.some(field => !Object.hasOwn(slots, field)) ||
    (schema.required?.length ?? 0) !== fields.length
  )
    throw new Error('Mark instance parameters require at most 64 required public scalar slots')
  validateParameterSlots(schema, slots)
  const defaults = normalizeParams(schema, {})
  const definitions = fields.map(field =>
    defineParameter({
      address: `ae:mark-param:${JSON.stringify([base.id, field])}`,
      schema: schema.properties[field],
      effectiveSchema: slots[field].effectiveSchema,
      value: defaults[field],
      operations: slots[field].operations,
      tags: slots[field].tags,
    }),
  )
  const parameters = new ParameterCatalog(definitions)
  const captureSchema = {
    ...schema,
    properties: Object.fromEntries(
      fields.map(field => [
        field,
        {
          ...Value.Clone(slots[field].effectiveSchema),
          default: defaults[field],
        },
      ]),
    ),
  } as TObject
  // Runtime transfer captures evaluated values, which may exceed the authoring range.
  const capture = (input: unknown): MarkInstanceParams => normalizeParams(captureSchema, input) as MarkInstanceParams

  const normalize = (input: unknown): Readonly<Static<S>> => {
    const values = normalizeParams(schema, input)
    for (const field of fields)
      if (!Value.Check(slots[field].effectiveSchema, values[field])) throw new Error(`Invalid mark parameter: ${field}`)
    return values
  }
  return Object.freeze({
    schema: freezeContent(Value.Clone(schema)),
    publicParams: freezeContent(Value.Clone(slots)),
    parameters,
    parameterDefinitions: Object.freeze(definitions),
    normalize,
    capture,
    address(field: keyof Static<S> & string): string {
      const index = fields.indexOf(field)
      if (index < 0) throw new Error(`Unknown mark parameter: ${field}`)
      return definitions[index].address
    },
    assertInstalled(config: ConfigSystem): void {
      if (config.isDisposed || definitions.some(definition => !config.hasRegisteredConfig(definition.address)))
        throw new Error('Mark instance parameters must be installed before adding the mark')
    },
    installScope(config: ConfigSystem, mark: MarkInstance): void {
      this.assertInstalled(config)
      const values = capture(mark.instanceParams)
      for (const [index, field] of fields.entries())
        config.set(definitions[index].address, values[field] as string | number | boolean, mark)
    },
    validateScope(state: ReturnType<ConfigSystem['exportSnapshotState']>, mark: MarkInstance): void {
      const values = capture(mark.instanceParams)
      const saved = state.scopedBase.get(mark)
      for (const [index, field] of fields.entries())
        if (!state.base.has(definitions[index].address) || saved?.get(definitions[index].address) !== values[field])
          throw new Error('Invalid mark instance parameter scope')
    },
    read<K extends keyof Static<S> & string>(config: ConfigSystem, mark: MarkInstance, field: K): Static<S>[K] {
      if (mark.base !== base) throw new Error('Mark parameter source does not match its definition')
      const address = this.address(field)
      if (!config.hasScopedConfig(address, mark)) throw new Error('Mark parameter scope is not active')
      return parameters.read(config, address, mark) as Static<S>[K]
    },
  })
}

/** Register once with trusted content; install its ParameterCatalog in each battle before use. */
export function defineMarkInstanceParams<S extends TObject>(
  base: BaseMark,
  schema: S,
  slots: Readonly<Record<keyof Static<S> & string, PublicParameterSlot>>,
) {
  if (Object.getPrototypeOf(base) !== BaseMark.prototype)
    throw new Error(
      'Instance parameters require a standard BaseMark; specialized marks need a dedicated implementation',
    )
  if (contracts.has(base)) throw new Error('Mark instance parameters already declared')
  // Keep schema metadata private and detached from the author's mutable objects.
  const contract = createContract(base, schema, Value.Clone(slots))
  contracts.set(base, contract)
  return contract
}
export function markParameterContract(base: BaseMark) {
  return contracts.get(base)
}
export function normalizeMarkInstanceParams(base: BaseMark, input?: unknown): MarkInstanceParams | undefined {
  const contract = contracts.get(base)
  if (contract) return contract.capture(input === undefined ? {} : input)
  if (input !== undefined) throw new Error('Mark does not declare instance parameters')
  return undefined
}
export function sameMarkInstanceParams(a: MarkInstanceParams | undefined, b: MarkInstanceParams | undefined): boolean {
  if (!a || !b) return a === b
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && a[key] === b[key])
}
