import { AttackTargetOpinion } from './const'
import { Pet } from './pet'
import { Player } from './player'
import { Skill } from './skill'

export type PlayerSelection = UseSkillSelection | SwitchPetSelection | DoNothingSelection | SurrunderSelection
export type PlayerSelections = { player: Player; selections: PlayerSelection[] }

export type UseSkillSelection = { source: Player; type: 'use-skill'; skill: Skill; target: AttackTargetOpinion }
export type SwitchPetSelection = { source: Player; type: 'switch-pet'; pet: Pet }
export type DoNothingSelection = { source: Player; type: 'do-nothing' }
export type SurrunderSelection = { source: Player; type: 'surrunder' }
