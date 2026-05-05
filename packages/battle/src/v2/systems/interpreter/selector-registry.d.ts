import type { World } from '@arcadia-eternity/engine';
import type { SelectorChain } from '@arcadia-eternity/schema';
import type { InterpreterContext } from './context.js';
export type SelectorBaseHandler = (ctx: InterpreterContext, base: string) => unknown[];
export type SelectorChainHandler = (ctx: InterpreterContext, current: unknown[], step: SelectorChain) => unknown[];
export declare function registerSelectorBaseHandler(world: World, base: string, handler: SelectorBaseHandler): void;
export declare function registerSelectorBaseHandlers(world: World, handlers: Record<string, SelectorBaseHandler>): void;
export declare function registerSelectorChainHandler(world: World, stepType: string, handler: SelectorChainHandler): void;
export declare function registerSelectorChainHandlers(world: World, handlers: Record<string, SelectorChainHandler>): void;
export declare function getSelectorBaseHandler(world: World, base: string): SelectorBaseHandler | undefined;
export declare function getSelectorChainHandler(world: World, stepType: string): SelectorChainHandler | undefined;
export declare function clearSelectorHandlers(world: World): void;
//# sourceMappingURL=selector-registry.d.ts.map