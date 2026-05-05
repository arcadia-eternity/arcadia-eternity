import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager, EffectPipeline } from '@arcadia-eternity/engine';
import type { EventBus } from '@arcadia-eternity/engine';
import type { PlayerSystem } from '../systems/player.system.js';
import type { PetSystem } from '../systems/pet.system.js';
import type { SkillSystem } from '../systems/skill.system.js';
import type { StatStageMarkSystem } from '../systems/stat-stage-mark.system.js';
import type { UseSkillContextData } from '../schemas/context.schema.js';
export interface SkillPhaseData {
    context: UseSkillContextData;
}
export declare class SkillHandler implements PhaseHandler<SkillPhaseData> {
    private playerSystem;
    private petSystem;
    private skillSystem;
    private statStageSystem;
    private phaseManager;
    private effectPipeline;
    readonly type = "skill";
    private readonly historyLimit;
    constructor(playerSystem: PlayerSystem, petSystem: PetSystem, skillSystem: SkillSystem, statStageSystem: StatStageMarkSystem, phaseManager: PhaseManager, effectPipeline: EffectPipeline);
    private shouldIgnoreStage;
    private getStatValueWithStrategy;
    private applyDefeatIfNeeded;
    initialize(_world: World, phase: PhaseDef): SkillPhaseData;
    execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult>;
}
//# sourceMappingURL=skill.handler.d.ts.map