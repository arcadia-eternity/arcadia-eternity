// battle/src/schemas/utils.ts
// Local schema utilities to avoid circular dependency with @arcadia-eternity/schema

import { Type } from '@sinclair/typebox'
import type { TUnion, TLiteral } from '@sinclair/typebox'

/**
 * Convert a string array to a TypeBox Union of Literals.
 * Local copy to avoid battle → schema → effect-builder → battle circular dep.
 */
export function StringEnum<T extends string>(values: readonly T[]) {
  return Type.Union(values.map(v => Type.Literal(v as T))) as TUnion<TLiteral<T>[]>
}
