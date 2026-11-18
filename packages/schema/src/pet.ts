import { Gender } from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { Type, type Static } from '@sinclair/typebox'
import { StringEnum, parseWithErrors } from './utils'

const NANOID_PATTERN = '^[A-Za-z0-9_-]{21}$'

export const StatOutBattleEVSSchema = Type.Object({
  hp: Type.Integer({ minimum: 0, maximum: 255 }),
  atk: Type.Integer({ minimum: 0, maximum: 255 }),
  def: Type.Integer({ minimum: 0, maximum: 255 }),
  spa: Type.Integer({ minimum: 0, maximum: 255 }),
  spd: Type.Integer({ minimum: 0, maximum: 255 }),
  spe: Type.Integer({ minimum: 0, maximum: 255 }),
})

export const StatOutBattleIVSSchema = Type.Object({
  hp: Type.Integer({ minimum: 0, maximum: 120 }),
  atk: Type.Integer({ minimum: 0, maximum: 120 }),
  def: Type.Integer({ minimum: 0, maximum: 120 }),
  spa: Type.Integer({ minimum: 0, maximum: 120 }),
  spd: Type.Integer({ minimum: 0, maximum: 120 }),
  spe: Type.Integer({ minimum: 0, maximum: 120 }),
})

export const PetSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  id: Type.String({ pattern: NANOID_PATTERN, default: nanoid() }),
  // Official IDs retain their historical prefix; content packs use namespace:local-id.
  species: Type.String({ pattern: '^(?:pet_.*|[a-z0-9][a-z0-9_.-]{0,79}:[a-z0-9][a-z0-9_./-]{0,119})$' }),
  level: Type.Integer({ minimum: 1 }),
  evs: StatOutBattleEVSSchema,
  ivs: StatOutBattleIVSSchema,
  nature: Type.String({ minLength: 1, maxLength: 256 }),
  gender: Type.Optional(StringEnum(Object.values(Gender))),
  height: Type.Optional(Type.Number()),
  weight: Type.Optional(Type.Number()),
  enhancement: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  inheritedSkill: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  skills: Type.Array(Type.String(), { minItems: 0, maxItems: 5 }),
  maxHp: Type.Optional(Type.Integer({ exclusiveMinimum: 0 })),
  ability: Type.Optional(Type.String()),
  emblem: Type.Optional(Type.String()),
})
// 推导 TypeScript 类型
export type PetSchemaType = Static<typeof PetSchema>

// 技能集合校验
export const PetSetSchema = Type.Array(PetSchema)

// 推导数据集类型
export type PetSet = Static<typeof PetSetSchema>

export function validatePet(data: unknown): PetSchemaType {
  return parseWithErrors(PetSchema, data)
}

export function validatePetSet(data: unknown): PetSet {
  return parseWithErrors(PetSetSchema, data)
}
