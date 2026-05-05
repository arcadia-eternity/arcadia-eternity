import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import { type PlayerSelection } from '@arcadia-eternity/const';
import type { PlayerSystem } from '../systems/player.system.js';
import type { PetSystem } from '../systems/pet.system.js';
import type { SkillSystem } from '../systems/skill.system.js';
import type { MarkSystem } from '../systems/mark.system.js';
export interface TurnData {
    turnNumber: number;
    selections?: Record<string, PlayerSelection>;
    plannedSkillPetIds?: string[];
    executedSkillPetIds?: string[];
}
export declare class TurnHandler implements PhaseHandler<TurnData> {
    private playerSystem;
    private petSystem;
    private skillSystem;
    private markSystem;
    private phaseManager;
    private effectPipeline;
    readonly type = "turn";
    constructor(playerSystem: PlayerSystem, petSystem: PetSystem, skillSystem: SkillSystem, markSystem: MarkSystem, phaseManager: PhaseManager, effectPipeline: EffectPipeline);
    initialize(world: World, phase: PhaseDef): TurnData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=turn.handler.d.ts.map