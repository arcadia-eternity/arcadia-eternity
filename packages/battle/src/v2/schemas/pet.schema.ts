// battle/src/schemas/pet.schema.ts
// TypeBox schema for Pet entity (instance in battle)

import { Type, type Static } from '@sinclair/typebox'
import { StringEnum } from './utils.js'
import {
  Element,
  Gender,
  Nature,
} from '@arcadia-eternity/const'

const ElementValues = Object.values(Element) as [string, ...string[]]
const GenderValues = Object.values(Gender) as [string, ...string[]]
const NatureValues = Object.values(Nature) as [string, ...string[]]

export const StatOutBattleSchema = Type.Object({
  hp: Type.Number(),
  atk: Type.Number(),
  def: Type.Number(),
  spa: Type.Number(),
  spd: Type.Number(),
  spe: Type.Number(),
})

export const PetSchema = Type.Object({
  type: Type.Literal('pet'),
  id: Type.String(),
  speciesId: Type.String(),
  name: Type.String(),
  level: Type.Number(),
  element: StringEnum(ElementValues),
  gender: StringEnum(GenderValues),
  nature: StringEnum(NatureValues),
  ownerId: Type.String(),
  evs: StatOutBattleSchema,
  ivs: StatOutBattleSchema,
  skillIds: Type.Array(Type.String()),
  markIds: Type.Array(Type.String()),
  currentHp: Type.Number(),
  isAlive: Type.Boolean({ default: true }),
  appeared: Type.Boolean({ default: false }),
  lastSkillId: Type.Optional(Type.String()),
  lastBaseSkillId: Type.Optional(Type.String()),
  lastSkillUsedTimes: Type.Number({ default: 0 }),
  skillHistorySkillIds: Type.Array(Type.String(), { default: [] }),
  skillHistoryBaseIds: Type.Array(Type.String(), { default: [] }),
  overrideMaxHp: Type.Optional(Type.Number()),
  weight: Type.Optional(Type.Number()),
  height: Type.Optional(Type.Number()),
  abilityId: Type.Optional(Type.String()),
  emblemId: Type.Optional(Type.String()),
}, { $id: 'Pet' })

export type PetData = Static<typeof PetSchema>
