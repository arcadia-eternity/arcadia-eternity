import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { MarkSystem } from '../systems/mark.system.js';
export interface MarkUpdatePhaseData {
    markId: string;
}
export declare class MarkUpdateHandler implements PhaseHandler<MarkUpdatePhaseData> {
    private markSystem;
    private effectPipeline;
    readonly type = "markUpdate";
    constructor(markSystem: MarkSystem, effectPipeline: EffectPipeline);
    initialize(_world: World, phase: PhaseDef): MarkUpdatePhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=mark-update.handler.d.ts.map