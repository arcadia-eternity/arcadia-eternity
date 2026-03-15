// battle/src/v2/data/battle-factory-node.ts
// Node-only convenience factory (depends on fs-based YAML loader).

import type { BattleConfig } from '../game.js'
import { LocalBattleSystemV2 } from '../local-battle.js'
import { loadV2GameDataFromPack } from './v2-data-loader.js'
import { createBattleFromConfig } from './battle-factory.js'
import type { TeamConfig } from './team-config.js'

export async function createLocalBattleFromYAML(
  packRef = 'builtin:base',
  playerAConfig: TeamConfig,
  playerBConfig: TeamConfig,
  battleConfig?: BattleConfig,
): Promise<LocalBattleSystemV2> {
  const { repository, errors } = await loadV2GameDataFromPack(packRef)

  if (errors.length > 0) {
    console.warn(`Data loading warnings (${errors.length}):`)
    for (const err of errors.slice(0, 10)) {
      console.warn(`  - ${err}`)
    }
    if (errors.length > 10) {
      console.warn(`  ... and ${errors.length - 10} more`)
    }
  }

  const battle = createBattleFromConfig(playerAConfig, playerBConfig, repository, battleConfig)
  return new LocalBattleSystemV2(battle)
}
