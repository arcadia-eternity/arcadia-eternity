import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { PetSystem } from '../systems/pet.system.js';
import type { MarkSystem } from '../systems/mark.system.js';
import type { DamageContextData } from '../schemas/context.schema.js';
export interface DamagePhaseData {
    context: DamageContextData;
}
export declare class DamageHandler implements PhaseHandler<DamagePhaseData> {
    private petSystem;
    private markSystem;
    private effectPipeline;
    readonly type = "damage";
    constructor(petSystem: PetSystem, markSystem: MarkSystem, effectPipeline: EffectPipeline);
    initialize(_world: World, phase: PhaseDef): DamagePhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=damage.handler.d.ts.map