import { AttackTargetOpinion } from './const'

export type PlayerSelection = UseSkillSelection | SwitchPetSelection | DoNothingSelection | SurrenderSelection
export type PlayerSelections = { player: string; selections: PlayerSelection[] }

export type UseSkillSelection = { player: string; type: 'use-skill'; skill: string; target: AttackTargetOpinion }
export type SwitchPetSelection = { player: string; type: 'switch-pet'; pet: string }
export type DoNothingSelection = { player: string; type: 'do-nothing' }
export type SurrenderSelection = { player: string; type: 'surrender' }
