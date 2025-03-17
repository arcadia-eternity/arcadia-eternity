import { z } from 'zod'
import { AttackTargetOpinionSchema } from './skill'

export const UseSkillSelectionSchema = z
  .object({
    type: z.literal('use-skill'),
    player: z.string().nanoid(),
    skill: z.string(),
    target: AttackTargetOpinionSchema,
  })
  .strict()

export const SwitchPetSelectionSchema = z
  .object({
    type: z.literal('switch-pet'),
    player: z.string().nanoid(),
    pet: z.string().nanoid(),
  })
  .strict()

export const DoNothingSelectionSchema = z
  .object({
    type: z.literal('do-nothing'),
    player: z.string().nanoid(),
  })
  .strict()

export const SurrenderSelectionSchema = z
  .object({
    type: z.literal('surrender'),
    player: z.string().nanoid(),
  })
  .strict()

export const PlayerSelectionSchema = z.discriminatedUnion('type', [
  UseSkillSelectionSchema,
  SwitchPetSelectionSchema,
  DoNothingSelectionSchema,
  SurrenderSelectionSchema,
])

export type PlayerSelectionSchemaType = z.infer<typeof PlayerSelectionSchema>

// 最终命令结构
export const PlayerSelectionsSchema = z.object({
  playerId: z.string().nanoid(),
  selections: PlayerSelectionSchema,
})
