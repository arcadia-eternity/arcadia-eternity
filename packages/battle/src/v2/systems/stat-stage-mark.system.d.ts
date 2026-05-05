import type { World, AttributeSystem } from '@arcadia-eternity/engine';
import type { MarkSystem } from './mark.system.js';
export type CleanStageStrategy = 'all' | 'positive' | 'negative';
export declare class StatStageMarkSystem {
    private attrSystem;
    private markSystem;
    private static STAGE_MODIFIER_PREFIX;
    constructor(attrSystem: AttributeSystem, markSystem: MarkSystem);
    getStage(world: World, entityId: string, stat: string): number;
    applyStage(world: World, entityId: string, stat: string, delta: number): number;
    setStage(world: World, entityId: string, stat: string, value: number): void;
    clearStages(world: World, entityId: string, strategy?: CleanStageStrategy, stats?: string[]): void;
    reverseStages(world: World, entityId: string, strategy?: CleanStageStrategy, stats?: string[]): void;
    transferStages(world: World, sourceEntityId: string, targetEntityId: string, strategy?: CleanStageStrategy, stats?: string[]): {
        stat: string;
        stage: number;
    }[];
    getTrackedStats(world: World, entityId: string): string[];
    private stageModifierId;
    private syncStageModifier;
    private ensureBaseMarkEntity;
    private ensureMarkWithStack;
}
//# sourceMappingURL=stat-stage-mark.system.d.ts.map