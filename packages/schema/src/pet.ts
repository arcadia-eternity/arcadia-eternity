import { Gender, Nature } from '@arcadia-eternity/const'
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
  hp: Type.Integer({ minimum: 0, maximum: 31 }),
  atk: Type.Integer({ minimum: 0, maximum: 31 }),
  def: Type.Integer({ minimum: 0, maximum: 31 }),
  spa: Type.Integer({ minimum: 0, maximum: 31 }),
  spd: Type.Integer({ minimum: 0, maximum: 31 }),
  spe: Type.Integer({ minimum: 0, maximum: 31 }),
})

export const PetSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  id: Type.String({ pattern: NANOID_PATTERN, default: nanoid() }),
  species: Type.String({ pattern: '^pet_' }), //种族的编号
  level: Type.Integer({ minimum: 1 }),
  evs: StatOutBattleEVSSchema,
  ivs: StatOutBattleIVSSchema,
  nature: StringEnum(Object.values(Nature)),
  gender: Type.Optional(StringEnum(Object.values(Gender))),
  height: Type.Optional(Type.Number()),
  weight: Type.Optional(Type.Number()),
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
