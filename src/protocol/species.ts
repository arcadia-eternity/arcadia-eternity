import { z } from 'zod'
import { Element } from './element'

const SkillSchema = z.object({
  skill_id: z.number(),
  level: z.number(),
  hidden: z.boolean(),
})

export const SpeciesSchema = z.object({
  id: z.number(),
  name: z.string(),
  element: z.nativeEnum(Element),
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
  ability: z.string(),
  emblems: z.array(z.string()),
})
