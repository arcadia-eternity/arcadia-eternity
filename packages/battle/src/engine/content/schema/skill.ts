import { z } from 'zod'
import { BehaviorUseSchema } from './behaviorUse'
import { ElementSchema } from './element'
import { Category, IgnoreStageStrategy } from '@arcadia-eternity/const'
import { AttackTargetOpinion } from '@arcadia-eternity/const'

const CategorySchema = z.nativeEnum(Category)

const AttackTargetOpinionSchema = z.nativeEnum(AttackTargetOpinion)

const ignoreStageStrategySchema = z.nativeEnum(IgnoreStageStrategy)

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
  behaviors: z.array(BehaviorUseSchema).optional(),
})
