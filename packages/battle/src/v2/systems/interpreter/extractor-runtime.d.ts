import type { World } from '@arcadia-eternity/engine';
import type { BattleSystems } from './context.js';
export declare function resolveExtractorByKind(world: World, systems: BattleSystems, entity: unknown, kind: 'attribute' | 'field' | 'relation', key: string): unknown[];
export declare function ensureAttributeWriteAllowed(world: World, systems: BattleSystems, entity: unknown, key: string): boolean;
//# sourceMappingURL=extractor-runtime.d.ts.map