import { z } from 'zod'
import { ElementSchema } from './element'
import { Category, IgnoreStageStrategy } from '@arcadia-eternity/const'
import { AttackTargetOpinion } from '@arcadia-eternity/const'

export const CategorySchema = z.enum(Category)

export const AttackTargetOpinionSchema = z.enum(AttackTargetOpinion)

export const ignoreStageStrategySchema = z.enum(IgnoreStageStrategy)

export const SkillSchema = z.object({
  id: z.string().min(1),
  element: ElementSchema,
  category: CategorySchema,
  power: z.number().int().min(0),
  rage: z.number().int().min(0),
  accuracy: z.number().min(0).max(100),
  priority: z.number().int().optional(),
  target: AttackTargetOpinionSchema.optional(),
  multihit: z
    .union([
      z.number(),
      z.tuple([z.number(), z.number()]).refine(([min, max]) => min < max, {
        message: '第一个元素必须小于第二个元素',
      }),
    ])
    .optional(),
  sureHit: z.boolean().default(false),
  sureCrit: z.boolean().default(false),
  ignoreShield: z.boolean().default(false),
  ignoreOpponentStageStrategy: ignoreStageStrategySchema.default(IgnoreStageStrategy.none),
  tags: z.array(z.string()).default([]),
  effect: z.array(z.string()).optional(),
})

export type SkillSchemaType = z.infer<typeof SkillSchema>

export const SkillDataSetSchema = z.array(SkillSchema)

export type SkillDataSet = z.infer<typeof SkillDataSetSchema>
