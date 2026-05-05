import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { MarkSystem } from '../systems/mark.system.js';
import type { RemoveMarkContextData } from '../schemas/context.schema.js';
export interface RemoveMarkPhaseData {
    context: RemoveMarkContextData;
}
export declare class RemoveMarkHandler implements PhaseHandler<RemoveMarkPhaseData> {
    private markSystem;
    private effectPipeline;
    readonly type = "removeMark";
    constructor(markSystem: MarkSystem, effectPipeline: EffectPipeline);
    initialize(_world: World, phase: PhaseDef): RemoveMarkPhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=remove-mark.handler.d.ts.map