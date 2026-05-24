// battle/src/v2/types/battle-state.ts
// Battle state types for world.state

import type { WorldState } from '@arcadia-eternity/engine'
import type { PlayerSelection } from '@arcadia-eternity/const'

export interface BattleState extends WorldState {
  [key: string]: unknown
  // Player IDs
  playerAId: string
  playerBId: string

  // Battle status
  status: 'pending' | 'active' | 'ended'
  currentTurn: number
  currentPhase?: 'switch' | 'selection' | 'teamSelection' | 'turn' | 'execution'

  // End state
  victor?: string
  endReason?: 'surrender' | 'allFainted' | 'timeout'

  // Selection state
  selections: Record<string, PlayerSelection>
  waitingPlayerIds?: string[]

  // Switch state
  pendingForcedSwitchPlayerIds: string[]
  pendingFaintSwitchPlayerId?: string
  lastKillerId?: string

  // Config
  allowFaintSwitch: boolean
  customConfig?: Record<string, unknown>
}

export interface BattleStateInitOptions {
  allowFaintSwitch?: boolean
}

export function createBattleState(
  playerAId: string,
  playerBId: string,
  options: BattleStateInitOptions = {},
): BattleState {
  return {
    playerAId,
    playerBId,
    status: 'pending',
    currentTurn: 0,
    selections: {},
    pendingForcedSwitchPlayerIds: [],
    allowFaintSwitch: options.allowFaintSwitch ?? true,
  }
}
