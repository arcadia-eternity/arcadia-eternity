import { z } from 'zod'
import { ElementSchema } from './element'
import { Category } from 'packages/core/skill'
import { AttackTargetOpinion } from 'packages/core/const'

export const CategorySchema = z.nativeEnum(Category)

export const AttackTargetOpinionSchema = z.nativeEnum(AttackTargetOpinion)

export const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  element: ElementSchema,
  category: CategorySchema,
  power: z.number().int().min(0),
  rage: z.number().int().min(0),
  accuracy: z.number().min(0).max(100),
  description: z.string(),
  priority: z.number().int().optional(),
  target: AttackTargetOpinionSchema.optional(),
  multihit: z
    .union([
      z.number(),
      z.tuple([z.number(), z.number()]).refine(arr => arr[0] < arr[1], {
        message: '第一个元素必须小于第二个元素',
      }),
    ])
    .optional(),
  sureHit: z.boolean().default(false),
  ignoreShield: z.boolean().default(false),
  tag: z.array(z.string()).default([]),
  effect: z.array(z.string()).optional(),
})

export type Skill = z.infer<typeof SkillSchema>

export const SkillDataSetSchema = z.array(SkillSchema)

export type SkillDataSet = z.infer<typeof SkillDataSetSchema>
