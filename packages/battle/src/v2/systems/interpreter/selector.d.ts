import type { InterpreterContext } from './context.js';
import { type SelectorDSL, type SelectorChain } from '@arcadia-eternity/schema';
import { type World } from '@arcadia-eternity/engine';
/**
 * Resolve a SelectorDSL to an array of entity IDs.
 *
 * Base selectors return entity IDs based on fireCtx:
 * - self: source entity's owner pet ID
 * - opponent: opponent's active pet ID
 * - target: actualTargetId from context
 * - selfPlayer: source entity's owner player ID
 * - opponentPlayer: opponent player ID
 * - selfTeam: source owner's full team pet IDs
 * - opponentTeam: opponent's full team pet IDs
 * - selfMarks: marks on source owner
 * - opponentMarks: marks on opponent active pet
 * - selfSkills: source owner's skill IDs
 * - useSkillContext/damageContext/etc: context entity ID (via fireCtx.contextId)
 * - mark: current mark entity ID (when source is mark)
 * - skill: current skill entity ID (when source is skill)
 * - battle: special battle owner ID
 *
 * Chain steps apply transformations to the result array.
 */
export declare function resolveSelector(ctx: InterpreterContext, selector: SelectorDSL | undefined): unknown[];
export declare function registerDefaultSelectorHandlers(world: World): void;
export declare function applyChain(ctx: InterpreterContext, results: unknown[], chain: SelectorChain[]): unknown[];
//# sourceMappingURL=selector.d.ts.map