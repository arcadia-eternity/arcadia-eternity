import { Kind, Type, type TObject, type TSchema } from '@sinclair/typebox'
import type { ConfigModifierType } from '../config'
import { validateParameterContract } from './parameters'

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
