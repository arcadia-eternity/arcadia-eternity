import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { PetSystem } from '../systems/pet.system.js';
import type { HealContextData } from '../schemas/context.schema.js';
export interface HealPhaseData {
    context: HealContextData;
}
export declare class HealHandler implements PhaseHandler<HealPhaseData> {
    private petSystem;
    private effectPipeline;
    readonly type = "heal";
    constructor(petSystem: PetSystem, effectPipeline: EffectPipeline);
    initialize(_world: World, phase: PhaseDef): HealPhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=heal.handler.d.ts.map