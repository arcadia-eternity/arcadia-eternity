import { type petId, type playerId } from './const'

/**
 * Team selection result containing selected pets and starter
 */
export interface BattleTeamSelection {
  /** Selected pet IDs in battle order (first is starter by default) */
  selectedPets: petId[]
  /** ID of the starter pet (must be in selectedPets) */
  starterPetId: petId
}

/**
 * Team selection configuration for rules
 */
export interface TeamSelectionConfig {
  /** Selection mode */
  mode: 'FULL_TEAM' | 'TEAM_SELECTION' | 'VIEW_ONLY'
  /** Maximum number of pets that can be selected for battle */
  maxTeamSize?: number
  /** Minimum number of pets that must be selected for battle */
  minTeamSize?: number
  /** Whether players can choose their starter pet */
  allowStarterSelection: boolean
  /** Whether to show opponent's team information */
  showOpponentTeam: boolean
  /** Level of team information visibility */
  teamInfoVisibility: 'FULL' | 'BASIC' | 'HIDDEN'
  /** Time limit for selection in seconds */
  timeLimit?: number
}

/**
 * Team selection action for PlayerSelection
 */
export interface TeamSelectionAction {
  type: 'team-selection'
  player: playerId
  /** Selected pet IDs in battle order */
  selectedPets: petId[]
  /** ID of the starter pet */
  starterPetId: petId
}
