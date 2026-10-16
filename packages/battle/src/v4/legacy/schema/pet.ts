import { Gender, Nature } from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { z } from 'zod'

export const StatOutBattleEVSSchema = z.object({
  hp: z.number().int().nonnegative().min(0).max(255),
  atk: z.number().int().nonnegative().min(0).max(255),
  def: z.number().int().nonnegative().min(0).max(255),
  spa: z.number().int().nonnegative().min(0).max(255),
  spd: z.number().int().nonnegative().min(0).max(255),
  spe: z.number().int().nonnegative().min(0).max(255),
})

export const StatOutBattleIVSSchema = z.object({
  hp: z.number().int().nonnegative().min(0).max(31),
  atk: z.number().int().nonnegative().min(0).max(31),
  def: z.number().int().nonnegative().min(0).max(31),
  spa: z.number().int().nonnegative().min(0).max(31),
  spd: z.number().int().nonnegative().min(0).max(31),
  spe: z.number().int().nonnegative().min(0).max(31),
})

export const PetSchema = z.object({
  name: z.string().min(1),
  id: z
    .string()
    .nanoid()
    .default(() => nanoid()),
  species: z.string().regex(/^pet_/), //种族的编号
  level: z.number().int().min(1).max(100),
  evs: StatOutBattleEVSSchema.refine(
    evs => Object.values(evs).reduce((a, b) => a + b, 0) <= 510,
    '学习力总和不能超过510',
  ),
  ivs: StatOutBattleIVSSchema,
  nature: z.nativeEnum(Nature),
  gender: z.nativeEnum(Gender).optional(),
  height: z.number().optional(),
  weight: z.number().optional(),
  skills: z.array(z.string()).min(0).max(5),
  maxHp: z.number().int().positive().optional(),
  ability: z.string().optional(),
  emblem: z.string().optional(),
})
// 推导 TypeScript 类型
export type PetSchemaType = z.infer<typeof PetSchema>

// 技能集合校验
export const PetSetSchema = z.array(PetSchema)

// 推导数据集类型
export type PetSet = z.infer<typeof PetSetSchema>

export function validatePet(data: unknown): PetSchemaType {
  return PetSchema.parse(data)
}

export function validatePetSet(data: unknown): PetSet {
  return PetSetSchema.parse(data)
}
