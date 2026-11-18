import { Type, type Static } from '@sinclair/typebox'
import { PetSchema, StatOutBattleEVSSchema, StatOutBattleIVSSchema } from './pet'

const id = Type.String({ minLength: 1, maxLength: 256 })
const optionalChoice = Type.Optional(Type.Union([id, Type.Null()]))
const fields = Type.Object(
  {
    nature: Type.Optional(id),
    ivs: Type.Optional(Type.Partial(StatOutBattleIVSSchema, { additionalProperties: false })),
    evs: Type.Optional(Type.Partial(StatOutBattleEVSSchema, { additionalProperties: false })),
    skills: Type.Optional(PetSchema.properties.skills),
    inheritedSkill: optionalChoice,
    ability: optionalChoice,
    emblem: optionalChoice,
    enhancement: optionalChoice,
  },
  { additionalProperties: false, minProperties: 1 },
)

export const TeamPetPresetSchema = Type.Object(
  {
    format: Type.Literal('arcadia.pet-preset'),
    version: Type.Literal(1),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    species: id,
    requiredContent: Type.Optional(
      Type.Object(
        {
          species: Type.Optional(Type.Array(id, { uniqueItems: true })),
          skills: Type.Optional(Type.Array(id, { uniqueItems: true })),
          marks: Type.Optional(Type.Array(id, { uniqueItems: true })),
          natures: Type.Optional(Type.Array(id, { uniqueItems: true })),
          enhancements: Type.Optional(Type.Array(id, { uniqueItems: true })),
        },
        { additionalProperties: false },
      ),
    ),
    capabilities: Type.Optional(Type.Array(id, { uniqueItems: true, maxItems: 64 })),
    fields,
  },
  { additionalProperties: false },
)

export type TeamPetPreset = Static<typeof TeamPetPresetSchema>
