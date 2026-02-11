import { Type, type Static } from '@sinclair/typebox'
import { ElementSchema } from './element'

export const LearnableSkillSchema = Type.Object({
  skill_id: Type.String(),
  level: Type.Number(),
  hidden: Type.Boolean(),
})

export const SpeciesSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  num: Type.Number(),
  element: ElementSchema,
  baseStats: Type.Object({
    hp: Type.Number(),
    atk: Type.Number(),
    spa: Type.Number(),
    def: Type.Number(),
    spd: Type.Number(),
    spe: Type.Number(),
  }),
  genderRatio: Type.Union([Type.Tuple([Type.Number(), Type.Number()]), Type.Null()]),
  heightRange: Type.Tuple([Type.Number(), Type.Number()]),
  weightRange: Type.Tuple([Type.Number(), Type.Number()]),
  learnable_skills: Type.Array(LearnableSkillSchema),
  ability: Type.Array(Type.String()),
  emblem: Type.Array(Type.String()),
})

export type LearnableSkill = Static<typeof LearnableSkillSchema>

export type SpeciesSchemaType = Static<typeof SpeciesSchema>

export const SpeciesDataSetSchema = Type.Array(SpeciesSchema)

export type SpeciesDataSet = Static<typeof SpeciesDataSetSchema>
