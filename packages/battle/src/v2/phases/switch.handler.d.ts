import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { PlayerSystem } from '../systems/player.system.js';
import type { PetSystem } from '../systems/pet.system.js';
import type { MarkSystem } from '../systems/mark.system.js';
import type { SwitchPetContextData } from '../schemas/context.schema.js';
export interface SwitchPhaseData {
    context: SwitchPetContextData;
}
export declare class SwitchHandler implements PhaseHandler<SwitchPhaseData> {
    private playerSystem;
    private petSystem;
    private markSystem;
    private phaseManager;
    private effectPipeline;
    readonly type = "switch";
    constructor(playerSystem: PlayerSystem, petSystem: PetSystem, markSystem: MarkSystem, phaseManager: PhaseManager, effectPipeline: EffectPipeline);
    initialize(_world: World, phase: PhaseDef): SwitchPhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=switch.handler.d.ts.map