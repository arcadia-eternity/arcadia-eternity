import type { InterpreterContext } from './context.js';
import { type ConditionDSL, type EvaluatorDSL } from '@arcadia-eternity/schema';
import { type World } from '@arcadia-eternity/engine';
export declare function registerDefaultConditionHandlers(world: World): void;
/**
 * Evaluate a ConditionDSL to a boolean result.
 * Common combinators stay built-in; non-common conditions are resolved by registry.
 */
export declare function evaluateCondition(ctx: InterpreterContext, condition: ConditionDSL | boolean | undefined | null): boolean;
/**
 * Evaluate an EvaluatorDSL against a single value.
 */
export declare function evaluateEvaluator(ctx: InterpreterContext, value: unknown, evaluator: EvaluatorDSL | undefined | null): boolean;
//# sourceMappingURL=conditions.d.ts.map