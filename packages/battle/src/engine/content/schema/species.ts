import { z } from 'zod'
import { ElementSchema } from './element'

const LearnableSkillSchema = z.object({
  skill_id: z.string(),
  level: z.number(),
  hidden: z.boolean(),
})

export const SpeciesSchema = z.object({
  id: z.string().min(1),
  num: z.number(),
  element: ElementSchema,
  baseStats: z.object({
    hp: z.number(),
    atk: z.number(),
    spa: z.number(),
    def: z.number(),
    spd: z.number(),
    spe: z.number(),
  }),
  genderRatio: z.tuple([z.number(), z.number()]).nullable(),
  heightRange: z.tuple([z.number(), z.number()]).refine(([min, max]) => min < max, {
    message: '第一个元素必须小于第二个元素',
  }),
  weightRange: z.tuple([z.number(), z.number()]).refine(([min, max]) => min < max, {
    message: '第一个元素必须小于第二个元素',
  }),
  learnable_skills: z.array(LearnableSkillSchema),
  ability: z.array(z.string()),
  emblem: z.array(z.string()),
})
