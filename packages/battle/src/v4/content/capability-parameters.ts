import { Kind, Type, type TObject, type TSchema } from '@sinclair/typebox'
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
export interface PublicParameterGroup {
  readonly fields: PublicParameterBindings
}
export type PublicParameterBindings = Readonly<Record<string, PublicParameterSlot | PublicParameterGroup>>
export type ParameterBindingsFor<S extends TObject> = {
  readonly [K in keyof S['properties']]?: S['properties'][K] extends TObject
    ? { readonly fields: ParameterBindingsFor<S['properties'][K]> }
    : PublicParameterSlot
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

export function validateParameterSlots(schema: TObject, slots: PublicParameterBindings): void {
  let nodes = 0
  const visit = (object: TObject, bindings: PublicParameterBindings, depth: number) => {
    if (depth > 8) throw new Error('Public parameter binding depth exceeded')
    for (const [field, slot] of Object.entries(bindings)) {
      if (++nodes > 128) throw new Error('Public parameter binding count exceeded')
      const property = object.properties[field]
      if (!property) throw new Error(`Unknown public parameter slot: ${field}`)
      if ('fields' in slot) {
        if (property[Kind] !== 'Object') throw new Error(`Nested parameter slots require an object: ${field}`)
        visit(property as TObject, slot.fields, depth + 1)
        continue
      }
      validateParameterContract(property, slot.effectiveSchema, slot.operations)
      const compatible = Type.Extends(slot.effectiveSchema, property, Type.Literal(true), Type.Literal(false))
      if (!('const' in compatible) || compatible.const !== true)
        throw new Error(`Effective parameter type widens capability argument: ${field}`)
    }
  }
  visit(schema, slots, 1)
}

interface ArgumentPlan {
  readonly base: Readonly<Record<string, unknown>>
  readonly content: Readonly<Record<string, unknown>>
  readonly read: (runtime: ActionRuntime) => Readonly<Record<string, unknown>>
}
export function compileParameterArguments(
  schema: TObject,
  slots: PublicParameterBindings,
  input: unknown,
  linker?: ParameterLinker,
): ArgumentPlan {
  const rawSchema = Type.Object(
    Object.fromEntries(Object.keys(schema.properties).map(key => [key, Type.Optional(Type.Unknown())])),
    { additionalProperties: false },
  )
  const raw = normalizeParams(rawSchema, input)
  const baseInput = { ...raw }
  const readers = new Map<string, (runtime: ActionRuntime) => unknown>()
  const linkedContent = new Map<string, unknown>()
  for (const [field, slot] of Object.entries(slots)) {
    const value = raw[field]
    if ('fields' in slot) {
      const property = schema.properties[field] as TObject
      // Optional absent objects stay absent; required objects use their declared defaults only.
      if (value === undefined && property.default === undefined && !schema.required?.includes(field)) continue
      const child = compileParameterArguments(
        property,
        slot.fields,
        value === undefined ? property.default : value,
        linker,
      )
      baseInput[field] = child.base
      linkedContent.set(field, child.content)
      readers.set(field, child.read)
    } else if (value && typeof value === 'object' && 'parameter' in value) {
      const reference = normalizeParams(referenceSchema, value)
      if (!linker) throw new Error(`MISSING_REFERENCE: ${reference.parameter}`)
      const linked = linker(reference.parameter, schema.properties[field], slot)
      baseInput[field] = linked.base
      linkedContent.set(field, value)
      readers.set(field, runtime => {
        const result = linked.read(runtime)
        if (!Value.Check(slot.effectiveSchema, result))
          throw new Error(`Invalid effective capability parameter: ${field}`)
        return result
      })
    }
  }
  const base = normalizeParams(schema, baseInput)
  const content = { ...base }
  for (const [field, value] of linkedContent) content[field] = value
  return {
    base,
    content: freezeContent(content),
    read(runtime: ActionRuntime) {
      if (readers.size === 0) return base
      const result = { ...base }
      for (const [field, read] of readers) result[field] = read(runtime)
      return freezeContent(result)
    },
  }
}
