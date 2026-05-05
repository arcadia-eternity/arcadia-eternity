// battle/src/schemas/species.schema.ts
// TypeBox schema for Species (pet prototype/base definition)

import { Type, type Static } from '@sinclair/typebox'
import { StringEnum } from './utils.js'
import { Element } from '@arcadia-eternity/const'

const ElementValues = Object.values(Element) as [string, ...string[]]

export const StatOutBattleSchema = Type.Object({
  hp: Type.Number(),
  atk: Type.Number(),
  def: Type.Number(),
  spa: Type.Number(),
  spd: Type.Number(),
  spe: Type.Number(),
})

export const SpeciesSchema = Type.Object(
  {
    type: Type.Literal('species'),
    id: Type.String(),
    num: Type.Number(),
    assetRef: Type.Optional(Type.String()),
    element: StringEnum(ElementValues),
    baseStats: StatOutBattleSchema,
    genderRatio: Type.Union([Type.Tuple([Type.Number(), Type.Number()]), Type.Null()]),
    heightRange: Type.Tuple([Type.Number(), Type.Number()]),
    weightRange: Type.Tuple([Type.Number(), Type.Number()]),
    abilityIds: Type.Array(Type.String(), { default: [] }),
    emblemIds: Type.Array(Type.String(), { default: [] }),
    learnableSkills: Type.Array(
      Type.Object({
        skill_id: Type.String(),
        level: Type.Number({ default: 1 }),
        hidden: Type.Boolean({ default: false }),
      }),
      { default: [] },
    ),
  },
  { $id: 'Species' },
)

export type SpeciesData = Static<typeof SpeciesSchema>
