import { Battle } from './battle'
import type { Player } from './player'
import type { ConfigSystem } from './config'

export type BattleOptions = ConstructorParameters<typeof Battle>[2]

/** Construct the original V1 Battle; lifecycle and rules remain on that class. */
export function createBattle(
  playerA: Player,
  playerB: Player,
  options?: BattleOptions,
  configSystem?: ConfigSystem,
): Battle {
  return new Battle(playerA, playerB, options, configSystem)
}
