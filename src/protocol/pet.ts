import { Nature } from '@/core/nature'
import { z } from 'zod'
import { SkillSchema } from './skill'

const StatOutBattleSchema = z.object({
  hp: z.number().int().nonnegative(),
  atk: z.number().int().nonnegative(),
  def: z.number().int().nonnegative(),
  spa: z.number().int().nonnegative(),
  spd: z.number().int().nonnegative(),
  spe: z.number().int().nonnegative(),
})

export const PetSchema = z.object({
  name: z.string().min(1),
  species: z.number().int(), //种族的编号
  level: z.number().int().min(1).max(100),
  evs: StatOutBattleSchema,
  ivs: StatOutBattleSchema,
  nature: z.nativeEnum(Nature),
  skills: z.array(SkillSchema).min(1).max(4), // 假设最多4个技能
  maxHp: z.number().int().positive().optional(),
  abilities: z.string(),
  emblem: z.string(),
})
// 推导 TypeScript 类型
export type Pet = z.infer<typeof PetSchema>

// 技能集合校验
export const PetSetSchema = z.array(PetSchema)

// 推导数据集类型
export type PetSet = z.infer<typeof PetSchema>
