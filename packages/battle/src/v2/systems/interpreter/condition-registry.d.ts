import type { World } from '@arcadia-eternity/engine';
import type { ConditionDSL } from '@arcadia-eternity/schema';
import type { InterpreterContext } from './context.js';
export type ConditionHandler = (ctx: InterpreterContext, condition: ConditionDSL) => boolean;
export declare function registerConditionHandler(world: World, type: string, handler: ConditionHandler): void;
export declare function registerConditionHandlers(world: World, handlers: Record<string, ConditionHandler>): void;
export declare function getConditionHandler(world: World, type: string): ConditionHandler | undefined;
export declare function clearConditionHandlers(world: World): void;
//# sourceMappingURL=condition-registry.d.ts.map