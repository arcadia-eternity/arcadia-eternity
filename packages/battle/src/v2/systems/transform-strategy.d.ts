import type { World } from '@arcadia-eternity/engine';
import type { TransformRecord, TransformStrategy } from '@arcadia-eternity/plugin-transformation';
export declare class V2TransformStrategy implements TransformStrategy {
    canHandle(entityType: string): boolean;
    performTransform(world: World, targetId: string, newBaseId: string, record: TransformRecord): void;
    restoreOriginal(world: World, targetId: string, originalBaseId: string, record: TransformRecord): void;
}
//# sourceMappingURL=transform-strategy.d.ts.map