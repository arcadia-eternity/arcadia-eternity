import type { PhaseHandler, PhaseDef, PhaseResult, World } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { StatStageMarkSystem, CleanStageStrategy } from '../systems/stat-stage-mark.system.js';
export type StatStageOperation = 'add' | 'set' | 'clear' | 'reverse' | 'transfer';
export interface StatStagePhaseData {
    operation?: StatStageOperation;
    entityId: string;
    stat?: string;
    delta?: number;
    value?: number;
    stats?: string[];
    cleanStageStrategy?: CleanStageStrategy;
    sourceEntityId?: string;
    targetEntityId?: string;
}
export declare class StatStageHandler implements PhaseHandler<StatStagePhaseData> {
    private statStageSystem;
    readonly type = "statStage";
    constructor(statStageSystem: StatStageMarkSystem);
    initialize(_world: World, phase: PhaseDef): StatStagePhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): PhaseResult;
    private executeAdd;
    private executeSet;
    private executeClear;
    private executeReverse;
    private executeTransfer;
}
//# sourceMappingURL=stat-stage.handler.d.ts.map