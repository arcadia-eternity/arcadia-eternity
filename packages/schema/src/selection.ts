import { Type, type Static } from '@sinclair/typebox'
import { AttackTargetOpinionSchema } from './skill'

const RuntimeEntityIdSchema = Type.String({ minLength: 1, pattern: '^[A-Za-z0-9_-]+$' })

export const UseSkillSelectionSchema = Type.Object(
  {
    type: Type.Literal('use-skill'),
    player: RuntimeEntityIdSchema,
    skill: Type.String(),
    target: AttackTargetOpinionSchema,
  },
  { additionalProperties: false },
)

export const SwitchPetSelectionSchema = Type.Object(
  {
    type: Type.Literal('switch-pet'),
    player: RuntimeEntityIdSchema,
    pet: RuntimeEntityIdSchema,
  },
  { additionalProperties: false },
)

export const DoNothingSelectionSchema = Type.Object(
  {
    type: Type.Literal('do-nothing'),
    player: RuntimeEntityIdSchema,
  },
  { additionalProperties: false },
)

export const SurrenderSelectionSchema = Type.Object(
  {
    type: Type.Literal('surrender'),
    player: RuntimeEntityIdSchema,
  },
  { additionalProperties: false },
)

export const TeamSelectionSchema = Type.Object(
  {
    type: Type.Literal('team-selection'),
    player: RuntimeEntityIdSchema,
    selectedPets: Type.Array(RuntimeEntityIdSchema),
    starterPetId: RuntimeEntityIdSchema,
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
  playerId: RuntimeEntityIdSchema,
  selections: PlayerSelectionSchema,
})
