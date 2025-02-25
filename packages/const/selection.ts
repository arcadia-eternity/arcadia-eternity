import { AttackTargetOpinion, type petId, type playerId, type skillId } from './const'

export type PlayerSelection = UseSkillSelection | SwitchPetSelection | DoNothingSelection | SurrenderSelection
export type PlayerSelections = { player: playerId; selections: PlayerSelection[] }

export type UseSkillSelection = { player: playerId; type: 'use-skill'; skill: skillId; target: AttackTargetOpinion }
export type SwitchPetSelection = { player: playerId; type: 'switch-pet'; pet: petId }
export type DoNothingSelection = { player: playerId; type: 'do-nothing' }
export type SurrenderSelection = { player: playerId; type: 'surrender' }
