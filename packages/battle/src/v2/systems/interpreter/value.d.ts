import type { InterpreterContext } from './context.js';
import type { Value } from '@arcadia-eternity/schema';
/**
 * Resolve a Value to its actual runtime value.
 *
 * Value types:
 * - number/string/boolean — literal primitives
 * - { type: 'raw:number/string/boolean', value } — wrapped primitives
 * - { type: 'entity:baseMark/baseSkill/...', value } — entity ID strings
 * - { type: 'dynamic', selector } — resolve selector, return first result
 * - { type: 'selectorValue', value, chain? } — resolve value, apply chain
 * - { type: 'conditional', condition, trueValue, falseValue } — conditional branch
 * - Array<Value> — map resolveValue over array
 * - OperatorDSL — return as-is (for nested operators)
 */
export declare function resolveValue(ctx: InterpreterContext, value: Value | null | undefined): unknown;
//# sourceMappingURL=value.d.ts.map