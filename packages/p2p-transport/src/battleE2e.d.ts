export interface BattleTeamMemberLike {
  name: string
  species: string
  level: number
  evs: Record<string, number>
  ivs: Record<string, number>
  nature: string
  skills: string[]
  ability?: string
  emblem?: string
  gender?: string
  weight?: number
  height?: number
}

export interface TeamConfigLike {
  id?: string
  name: string
  team: BattleTeamMemberLike[]
}

export interface BattleConfigLike {
  allowFaintSwitch?: boolean
  showHidden?: boolean
  seed?: string
  timerConfig?: {
    enabled?: boolean
    turnTimeLimit?: number
    totalTimeLimit?: number
    animationPauseEnabled?: boolean
    maxAnimationDuration?: number
  }
}

export interface InMemoryP2PBattleE2EOptions {
  packRef?: string
  playerATeam: TeamConfigLike
  playerBTeam: TeamConfigLike
  rounds?: number
  peerActionMode?: 'normal' | 'skip'
  battleConfig?: BattleConfigLike
}

export interface InMemoryP2PBattleE2EResult {
  playerAId: string
  playerBId: string
  roundsPlayed: number
  finalState: any
  playerASelections: any[]
  playerBSelections: any[]
  hostEvents: any[]
  peerEvents: any[]
}

export declare function runInMemoryP2PBattleE2E(
  options: InMemoryP2PBattleE2EOptions,
): Promise<InMemoryP2PBattleE2EResult>
