import type { World } from '@arcadia-eternity/engine';
import type { OperatorDSL } from '@arcadia-eternity/schema';
import type { InterpreterContext } from './context.js';
export type OperatorHandler = (ctx: InterpreterContext, operator: OperatorDSL) => Promise<void> | void;
export declare function registerOperatorHandler(world: World, type: string, handler: OperatorHandler): void;
export declare function registerOperatorHandlers(world: World, handlers: Record<string, OperatorHandler>): void;
export declare function getOperatorHandler(world: World, type: string): OperatorHandler | undefined;
export declare function clearOperatorHandlers(world: World): void;
//# sourceMappingURL=operator-registry.d.ts.map