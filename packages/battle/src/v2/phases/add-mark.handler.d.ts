import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { MarkSystem } from '../systems/mark.system.js';
import type { AddMarkContextData } from '../schemas/context.schema.js';
export interface AddMarkPhaseData {
    context: AddMarkContextData;
}
export declare class AddMarkHandler implements PhaseHandler<AddMarkPhaseData> {
    private markSystem;
    private phaseManager;
    private effectPipeline;
    readonly type = "addMark";
    constructor(markSystem: MarkSystem, phaseManager: PhaseManager, effectPipeline: EffectPipeline);
    initialize(_world: World, phase: PhaseDef): AddMarkPhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=add-mark.handler.d.ts.map