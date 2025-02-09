import { z } from 'zod'
import type { ConditionOperator } from '../effectBuilder/condition'
import type { ValueOperator } from '../effectBuilder/operator'

// 效果类型定义
const EffectTypeSchema = z.enum(['STAT_MODIFIER', 'TRIGGERED_ABILITY', 'AURA'])

// 基础效果结构
const BaseEffectSchema = z.object({
  type: EffectTypeSchema,
  condition: z.custom<Condition>().optional(),
  description: z.string(),
})

// 属性修改效果
const StatModifierEffectSchema = BaseEffectSchema.extend({
  type: z.literal('STAT_MODIFIER'),
  target: z.enum(['SELF', 'ALLY', 'ENEMY']),
  stat: z.enum(['ATK', 'DEF', 'SPD', 'HP']),
  operator: z.custom<ConditionOperator>(),
  value: z.number().positive(),
  duration: z.number().int().min(1).optional(),
})

// 触发型技能效果
const TriggeredAbilityEffectSchema = BaseEffectSchema.extend({
  type: z.literal('TRIGGERED_ABILITY'),
  trigger: z.enum(['ON_HIT', 'ON_ATTACK', 'ON_DAMAGE']),
  abilityId: z.string(),
  chance: z.number().min(0).max(1).default(1),
})

// 光环效果
const AuraEffectSchema = BaseEffectSchema.extend({
  type: z.literal('AURA'),
  radius: z.number().int().min(1),
  affect: z.enum(['ALLIES', 'ENEMIES', 'ALL']),
  modifier: StatModifierEffectSchema.omit({ type: true }),
})

export const MarkSchema = z.object({
  id: z.string().regex(/^MARK_\w+$/),
  name: z.string().min(2).max(24),
  description: z.string().max(200),
  effects: z.union([StatModifierEffectSchema, TriggeredAbilityEffectSchema, AuraEffectSchema]).array().nonempty(),
})

export type Mark = z.infer<typeof MarkSchema>
export type EffectType = z.infer<typeof EffectTypeSchema>

export function validateMark(data: unknown) {
  return MarkSchema.safeParse(data)
}
