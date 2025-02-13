import { z } from 'zod'
import { ElementSchema } from './element'

const SkillSchema = z.object({
  skill_id: z.string(),
  level: z.number(),
  hidden: z.boolean(),
})

export const SpeciesSchema = z.object({
  id: z.string().min(1),
  num: z.number(),
  name: z.string(),
  element: ElementSchema,
  star: z.number(),
  baseStats: z.object({
    hp: z.number(),
    atk: z.number(),
    spa: z.number(),
    def: z.number(),
    spd: z.number(),
    spe: z.number(),
  }),
  previous_form: z.number(),
  next_form: z.number(),
  evolution_level: z.number(),
  exp_type: z.number(),
  exp_yield: z.number(),
  catchable: z.string(),
  catch_rate: z.string(),
  rideable: z.string(),
  team_limit: z.string(),
  god_transform_id: z.string(),
  learnable_skills: z.array(SkillSchema),
  description: z.string(),
  obtain_method: z.string(),
  race_values: z.null(),
  abilities: z.array(z.string()),
  emblems: z.array(z.string()),
})

export type Species = z.infer<typeof SpeciesSchema>
