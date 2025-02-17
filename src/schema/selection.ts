import { z } from 'zod'
import { AttackTargetOpinionSchema } from './skill'

export const UseSkillSelectionSchema = z
  .object({
    type: z.literal('use-skill'),
    source: z.string().nanoid(),
    skill: z.string(),
    target: AttackTargetOpinionSchema,
  })
  .strict()

export const SwitchPetSelectionSchema = z
  .object({
    type: z.literal('switch-pet'),
    source: z.string().nanoid(),
    pet: z.string().nanoid(),
  })
  .strict()

export const DoNothingSelectionSchema = z
  .object({
    type: z.literal('do-nothing'),
    source: z.string().nanoid(),
  })
  .strict()

export const SurrenderSelectionSchema = z
  .object({
    type: z.literal('surrender'),
    source: z.string().nanoid(),
  })
  .strict()

export const PlayerSelectionSchema = z.discriminatedUnion('type', [
  UseSkillSelectionSchema,
  SwitchPetSelectionSchema,
  DoNothingSelectionSchema,
  SurrenderSelectionSchema,
])

// 最终命令结构
export const PlayerSelectionsSchema = z.object({
  playerId: z.string().nanoid(),
  selections: PlayerSelectionSchema,
})
