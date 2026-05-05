import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { PlayerSystem } from '../systems/player.system.js';
import type { RageContextData } from '../schemas/context.schema.js';
export interface RagePhaseData {
    context: RageContextData;
}
export declare class RageHandler implements PhaseHandler<RagePhaseData> {
    private playerSystem;
    private effectPipeline;
    readonly type = "rage";
    constructor(playerSystem: PlayerSystem, effectPipeline: EffectPipeline);
    initialize(_world: World, phase: PhaseDef): RagePhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=rage.handler.d.ts.map