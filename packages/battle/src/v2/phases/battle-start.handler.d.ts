import type { PhaseHandler, PhaseDef, PhaseResult, World, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { PlayerSystem } from '../systems/player.system.js';
import type { PetSystem } from '../systems/pet.system.js';
export interface BattleStartData {
    playerAId: string;
    playerBId: string;
}
export declare class BattleStartHandler implements PhaseHandler<BattleStartData> {
    private effectPipeline;
    private playerSystem;
    private petSystem;
    readonly type = "battleStart";
    constructor(effectPipeline: EffectPipeline, playerSystem: PlayerSystem, petSystem: PetSystem);
    initialize(_world: World, phase: PhaseDef): BattleStartData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=battle-start.handler.d.ts.map