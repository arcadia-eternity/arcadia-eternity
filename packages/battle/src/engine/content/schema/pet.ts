import { Gender, maxEquippedSkills } from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { z } from 'zod'

const StatOutBattleEVSSchema = z.object({
  hp: z.number().int().nonnegative().min(0).max(255),
  atk: z.number().int().nonnegative().min(0).max(255),
  def: z.number().int().nonnegative().min(0).max(255),
  spa: z.number().int().nonnegative().min(0).max(255),
  spd: z.number().int().nonnegative().min(0).max(255),
  spe: z.number().int().nonnegative().min(0).max(255),
})

const StatOutBattleIVSSchema = z.object({
  hp: z.number().int().nonnegative().min(0).max(120),
  atk: z.number().int().nonnegative().min(0).max(120),
  def: z.number().int().nonnegative().min(0).max(120),
  spa: z.number().int().nonnegative().min(0).max(120),
  spd: z.number().int().nonnegative().min(0).max(120),
  spe: z.number().int().nonnegative().min(0).max(120),
})

export const PetSchema = z.object({
  name: z.string().min(1),
  id: z
    .string()
    .nanoid()
    .default(() => nanoid()),
  species: z.string().min(1), //种族的稳定内容 ID，由当前内容目录解析
  level: z.number().int().min(1).max(100),
  evs: StatOutBattleEVSSchema.refine(
    evs => Object.values(evs).reduce((a, b) => a + b, 0) <= 510,
    '学习力总和不能超过510',
  ),
  ivs: StatOutBattleIVSSchema,
  ivMax: StatOutBattleIVSSchema.optional(),
  nature: z.string().min(1).max(256),
  gender: z.nativeEnum(Gender).optional(),
  height: z.number().optional(),
  weight: z.number().optional(),
  enhancement: z.string().min(1).max(256).optional(),
  inheritedSkill: z.string().min(1).max(256).optional(),
  skills: z.array(z.string()).min(0).max(maxEquippedSkills),
  maxHp: z.number().int().positive().optional(),
  ability: z.string().optional(),
  emblem: z.string().optional(),
})
