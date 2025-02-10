import { z } from 'zod'
import { ElementSchema } from './element'
import { Category } from '@/core/skill'

export const CategorySchema = z.nativeEnum(Category)

export const SkillSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  element: ElementSchema,
  category: CategorySchema,
  power: z.number().int().min(0),
  rage: z.number().int().min(0),
  accuracy: z.number().min(0).max(100),
  description: z.string(),
  effect: z.array(z.string()).optional(),
  priority: z.number().int().optional(),
})

export type Skill = z.infer<typeof SkillSchema>

export const SkillDataSetSchema = z.array(SkillSchema)

export type SkillDataSet = z.infer<typeof SkillDataSetSchema>

export function validateSkill(data: unknown): Skill {
  return SkillSchema.parse(data)
}

export function validateSkillSet(data: unknown): SkillDataSet {
  return SkillDataSetSchema.parse(data)
}
