import { MarkDataSetSchema, MarkDefinitionSchema } from './mark'
import { SkillDataSetSchema, SkillDefinitionSchema } from './skill'
import { SpeciesDataSetSchema, SpeciesDefinitionSchema } from './species'

export type SchemaType = keyof typeof DATA_SCHEMA_MAP

export const DATA_SCHEMA_MAP = {
  mark: MarkDataSetSchema,
  skill: SkillDataSetSchema,
  species: SpeciesDataSetSchema,
} as const

export const SCHEMA_MAP = {
  mark: MarkDefinitionSchema,
  skill: SkillDefinitionSchema,
  species: SpeciesDefinitionSchema,
} as const
