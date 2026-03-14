// Shared DSL primitive keys/types.
// Keep this file independent from v1 runtime packages.

export const BASE_SELECTOR_KEYS = [
  'target',
  'self',
  'opponent',
  'selfTeam',
  'opponentTeam',
  'selfPlayer',
  'opponentPlayer',
  'useSkillContext',
  'damageContext',
  'effectContext',
  'mark',
  'selfMarks',
  'opponentMarks',
  'skill',
  'selfSkills',
  'opponentSkills',
  'selfAvailableSkills',
  'opponentAvailableSkills',
  'dataMarks',
  'healContext',
  'addMarkContext',
  'rageContext',
  'stackContext',
  'consumeStackContext',
  'switchPetContext',
  'battle',
  'turnContext',
  'currentPhase',
  'allPhases',
] as const

export type BaseSelectorKey = (typeof BASE_SELECTOR_KEYS)[number]

export const BASE_EXTRACTOR_KEYS = [
  'currentTurn',
  'currentHp',
  'maxHp',
  'rage',
  'owner',
  'type',
  'element',
  'level',
  'gender',
  'marks',
  'stats',
  'stack',
  'duration',
  'power',
  'priority',
  'id',
  'baseId',
  'tags',
  'activePet',
  'skills',
  'rageCost',
] as const

export type BaseExtractorKey = (typeof BASE_EXTRACTOR_KEYS)[number]

export const COMPARE_OPERATORS = ['>', '<', '>=', '<=', '=='] as const

export type CompareOperator = (typeof COMPARE_OPERATORS)[number]
