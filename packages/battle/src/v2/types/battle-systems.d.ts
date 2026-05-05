import type { GameRng } from '@arcadia-eternity/engine';
import type { PetSystem } from '../systems/pet.system.js';
import type { SkillSystem } from '../systems/skill.system.js';
import type { MarkSystem } from '../systems/mark.system.js';
import type { PlayerSystem } from '../systems/player.system.js';
import type { PhaseManager, EventBus, AttributeSystem, EffectPipeline } from '@arcadia-eternity/engine';
import type { TransformStrategy } from '@arcadia-eternity/plugin-transformation';
import type { BattleConfig } from '../game.js';
import type { StatStageMarkSystem } from '../systems/stat-stage-mark.system.js';
/**
 * All systems and runtime references for a battle.
 * Stored in world.systems (non-serializable).
 */
export interface BattleSystems {
    petSystem: PetSystem;
    skillSystem: SkillSystem;
    markSystem: MarkSystem;
    playerSystem: PlayerSystem;
    attrSystem: AttributeSystem;
    statStageSystem: StatStageMarkSystem;
    phaseManager: PhaseManager;
    eventBus: EventBus;
    effectPipeline: EffectPipeline;
    rng: GameRng;
    transformStrategy?: TransformStrategy;
    config: BattleConfig;
}
//# sourceMappingURL=battle-systems.d.ts.map