import { Type, type TObject, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { ConfigModifierType } from '../config'
import type { ActionRuntime } from './capabilities'
import { normalizeParams, validateParameterContract } from './parameters'
import { freezeContent } from './immutable'

export interface PublicParameterSlot {
  readonly effectiveSchema: TSchema
  readonly operations: readonly ConfigModifierType[]
  readonly tags?: readonly string[]
}
export type ParameterLinker = (
  id: string,
  schema: TSchema,
  slot: PublicParameterSlot,
) => {
  readonly base: unknown
  readonly read: (runtime: ActionRuntime) => unknown
}
const referenceSchema = Type.Object({ parameter: Type.String({ minLength: 1 }) }, { additionalProperties: false })

export function validateParameterSlots(schema: TObject, slots: Readonly<Record<string, PublicParameterSlot>>): void {
  for (const [field, slot] of Object.entries(slots)) {
    const property = schema.properties[field]
    if (!property) throw new Error(`Unknown public parameter slot: ${field}`)
    validateParameterContract(property, slot.effectiveSchema, slot.operations)
    // Delegate structural type assignability to TypeBox. Range limits remain separate runtime contracts.
    const compatible = Type.Extends(slot.effectiveSchema, property, Type.Literal(true), Type.Literal(false))
    if (!('const' in compatible) || compatible.const !== true)
      throw new Error(`Effective parameter type widens capability argument: ${field}`)
  }
}

export function compileParameterArguments(
  schema: TObject,
  slots: Readonly<Record<string, PublicParameterSlot>>,
  input: unknown,
  linker?: ParameterLinker,
) {
  const rawSchema = Type.Object(
    Object.fromEntries(Object.keys(schema.properties).map(key => [key, Type.Optional(Type.Unknown())])),
    { additionalProperties: false },
  )
  const raw = normalizeParams(rawSchema, input)
  const baseInput = { ...raw }
  const readers = new Map<string, ReturnType<ParameterLinker>>()
  for (const [field, slot] of Object.entries(slots)) {
    const value = raw[field]
    if (value && typeof value === 'object' && 'parameter' in value) {
      const reference = normalizeParams(referenceSchema, value)
      if (!linker) throw new Error(`MISSING_REFERENCE: ${reference.parameter}`)
      const linked = linker(reference.parameter, schema.properties[field], slot)
      baseInput[field] = linked.base
      readers.set(field, linked)
    }
  }
  const base = normalizeParams(schema, baseInput)
  const content = { ...base }
  for (const field of readers.keys()) content[field] = raw[field]
  return {
    base,
    content: freezeContent(content),
    read(runtime: ActionRuntime) {
      if (readers.size === 0) return base
      const result = { ...base }
      for (const [field, reader] of readers) {
        const value = reader.read(runtime)
        if (!Value.Check(slots[field].effectiveSchema, value))
          throw new Error(`Invalid effective capability parameter: ${field}`)
        result[field] = value
      }
      return freezeContent(result)
    },
  }
}
