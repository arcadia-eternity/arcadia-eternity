import type { InterpreterContext } from './context.js';
import { type OperatorDSL } from '@arcadia-eternity/schema';
import type { World } from '@arcadia-eternity/engine';
export declare function registerDefaultOperatorHandlers(world: World): void;
/**
 * Execute one operator node.
 * Control-flow operators are always built-in, others are resolved from registry.
 */
export declare function executeOperator(ctx: InterpreterContext, operator: ExecutableOperator): Promise<void>;
type InterpreterOperator = {
    type: 'sequence';
    operators: ExecutableOperator[];
} | {
    type: 'noop';
};
type ExecutableOperator = OperatorDSL | InterpreterOperator;
export {};
//# sourceMappingURL=operators.d.ts.map