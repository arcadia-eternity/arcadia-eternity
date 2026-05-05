import type { TUnion, TLiteral } from '@sinclair/typebox';
/**
 * Convert a string array to a TypeBox Union of Literals.
 * Local copy to avoid battle → schema → effect-builder → battle circular dep.
 */
export declare function StringEnum<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]>;
//# sourceMappingURL=utils.d.ts.map