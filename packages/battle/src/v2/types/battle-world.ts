import type { World } from '@arcadia-eternity/engine'
import type { BattleState } from './battle-state.js'
import type { BattleSystems } from './battle-systems.js'

export type BattleWorld = World<BattleState, BattleSystems>
