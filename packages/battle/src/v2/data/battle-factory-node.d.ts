import type { BattleConfig } from '../game.js';
import { LocalBattleSystemV2 } from '../local-battle.js';
import type { TeamConfig } from './team-config.js';
export declare function createLocalBattleFromYAML(packRef: string | undefined, playerAConfig: TeamConfig, playerBConfig: TeamConfig, battleConfig?: BattleConfig): Promise<LocalBattleSystemV2>;
//# sourceMappingURL=battle-factory-node.d.ts.map