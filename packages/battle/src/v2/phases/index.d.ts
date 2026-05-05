import type { PhaseManager, EffectPipeline } from '@arcadia-eternity/engine';
import type { PetSystem } from '../systems/pet.system.js';
import type { PlayerSystem } from '../systems/player.system.js';
import type { MarkSystem } from '../systems/mark.system.js';
import type { SkillSystem } from '../systems/skill.system.js';
import type { StatStageMarkSystem } from '../systems/stat-stage-mark.system.js';
import { BattleStartHandler } from './battle-start.handler.js';
import { TurnHandler } from './turn.handler.js';
import { SelectionHandler } from './selection.handler.js';
import { SkillHandler } from './skill.handler.js';
import { SwitchHandler } from './switch.handler.js';
import { DamageHandler } from './damage.handler.js';
import { HealHandler } from './heal.handler.js';
import { RageHandler } from './rage.handler.js';
import { AddMarkHandler } from './add-mark.handler.js';
import { RemoveMarkHandler } from './remove-mark.handler.js';
import { MarkUpdateHandler } from './mark-update.handler.js';
import { MarkCleanupHandler } from './mark-cleanup.handler.js';
import { StatStageHandler } from './stat-stage.handler.js';
import { BattleSwitchHandler } from './battle-switch.handler.js';
export interface Seer2Systems {
    petSystem: PetSystem;
    playerSystem: PlayerSystem;
    markSystem: MarkSystem;
    skillSystem: SkillSystem;
    statStageSystem: StatStageMarkSystem;
    effectPipeline: EffectPipeline;
}
/**
 * Register all Seer2 phase handlers with the engine's PhaseManager.
 */
export declare function registerSeer2Phases(pm: PhaseManager, systems: Seer2Systems): void;
export { BattleStartHandler, TurnHandler, SelectionHandler, SkillHandler, SwitchHandler, DamageHandler, HealHandler, RageHandler, AddMarkHandler, RemoveMarkHandler, MarkUpdateHandler, MarkCleanupHandler, StatStageHandler, BattleSwitchHandler, };
//# sourceMappingURL=index.d.ts.map