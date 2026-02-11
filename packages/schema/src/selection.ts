import { Type, type Static } from '@sinclair/typebox'
import { AttackTargetOpinionSchema } from './skill'

const NANOID_PATTERN = '^[A-Za-z0-9_-]{21}$'
const NanoidString = Type.String({ pattern: NANOID_PATTERN })

export const UseSkillSelectionSchema = Type.Object(
  {
    type: Type.Literal('use-skill'),
    player: NanoidString,
    skill: Type.String(),
    target: AttackTargetOpinionSchema,
  },
  { additionalProperties: false },
)

export const SwitchPetSelectionSchema = Type.Object(
  {
    type: Type.Literal('switch-pet'),
    player: NanoidString,
    pet: NanoidString,
  },
  { additionalProperties: false },
)

export const DoNothingSelectionSchema = Type.Object(
  {
    type: Type.Literal('do-nothing'),
    player: NanoidString,
  },
  { additionalProperties: false },
)

export const SurrenderSelectionSchema = Type.Object(
  {
    type: Type.Literal('surrender'),
    player: NanoidString,
  },
  { additionalProperties: false },
)

export const TeamSelectionSchema = Type.Object(
  {
    type: Type.Literal('team-selection'),
    player: NanoidString,
    selectedPets: Type.Array(NanoidString),
    starterPetId: NanoidString,
  },
  { additionalProperties: false },
)

export const PlayerSelectionSchema = Type.Union([
  UseSkillSelectionSchema,
  SwitchPetSelectionSchema,
  DoNothingSelectionSchema,
  SurrenderSelectionSchema,
  TeamSelectionSchema,
])

export type PlayerSelectionSchemaType = Static<typeof PlayerSelectionSchema>

// 最终命令结构
export const PlayerSelectionsSchema = Type.Object({
  playerId: NanoidString,
  selections: PlayerSelectionSchema,
})
