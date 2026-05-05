import type { PhaseHandler, PhaseDef, PhaseResult, World } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { MarkSystem } from '../systems/mark.system.js';
export interface MarkCleanupPhaseData {
    removedMarkIds: string[];
}
export declare class MarkCleanupHandler implements PhaseHandler<MarkCleanupPhaseData> {
    private markSystem;
    readonly type = "markCleanup";
    constructor(markSystem: MarkSystem);
    initialize(world: World, phase: PhaseDef): MarkCleanupPhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): PhaseResult;
}
//# sourceMappingURL=mark-cleanup.handler.d.ts.map