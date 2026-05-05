import { type BattleConfig, type BattleInstance } from '../game.js';
import { V2DataRepository } from './v2-data-repository.js';
import type { TeamConfig } from './team-config.js';
/**
 * Create a BattleInstance from two team configurations and a data repository.
 *
 * Flow:
 * 1. Create empty battle
 * 2. Register all base data (species, skills, marks) as entities
 * 3. Create pet entities for each player
 * 4. Create skill instances and attach to pets
 * 5. Create mark instances (ability/emblem) and attach to pets
 * 6. Create player entities
 * 7. Attach effects to skill/mark instances
 * 8. Return BattleInstance
 */
export declare function createBattleFromConfig(playerAConfig: TeamConfig, playerBConfig: TeamConfig, repo: V2DataRepository, battleConfig?: BattleConfig): BattleInstance;
//# sourceMappingURL=battle-factory.d.ts.map