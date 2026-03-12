// battle/src/v2/data/team-config.ts
// TypeBox schemas for player team configuration.

import { Type, type Static } from '@sinclair/typebox'
import { StringEnum } from '../schemas/utils.js'
import { Nature, Gender } from '@arcadia-eternity/const'

const NatureValues = Object.values(Nature) as [string, ...string[]]
const GenderValues = Object.values(Gender) as [string, ...string[]]

export const StatOutBattleSchema = Type.Object({
  hp: Type.Number(),
  atk: Type.Number(),
  def: Type.Number(),
  spa: Type.Number(),
  spd: Type.Number(),
  spe: Type.Number(),
})

export const PetConfigSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  species: Type.String({ minLength: 1 }),
  level: Type.Integer({ minimum: 1 }),
  evs: StatOutBattleSchema,
  ivs: StatOutBattleSchema,
  nature: StringEnum(NatureValues),
  skills: Type.Array(Type.String(), { minItems: 1, maxItems: 5 }),
  ability: Type.Optional(Type.String()),
  emblem: Type.Optional(Type.String()),
  gender: Type.Optional(StringEnum(GenderValues)),
  weight: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  maxHp: Type.Optional(Type.Number()),
})

export const TeamConfigSchema = Type.Object({
  id: Type.Optional(Type.String({ minLength: 1 })),
  name: Type.String({ minLength: 1 }),
  team: Type.Array(PetConfigSchema, { minItems: 1, maxItems: 6 }),
})

export type PetConfig = Static<typeof PetConfigSchema>
export type TeamConfig = Static<typeof TeamConfigSchema>
