import { z } from 'zod'
import { Element } from './element'
import { Category } from '@/core/skill'

// 导出原始 Category 类型（根据实际需要保留）
export { Category }

const ElementSchema = z.nativeEnum(Element)

// 分类校验（假设 Category 是枚举类型）
const CategorySchema = z.nativeEnum(Category)

// 技能基础校验
const BaseSkillSchema = z.object({
  /** 技能ID */
  id: z.number().int().positive(),
  /** 技能名称 */
  name: z.string().min(1),
  /** 技能元素属性 */
  element: ElementSchema,
  /** 技能分类 */
  category: CategorySchema,
  /** 基础威力（状态技能为0） */
  power: z.number().int().min(0),
  /** 消耗怒气值 */
  rage: z.number().int().min(0),
  /** 命中率（百分比数值） */
  accuracy: z.number().min(0).max(100),
  /** 技能描述 */
  description: z.string(),
})

// 扩展技能校验（包含可选字段）
export const SkillSchema = BaseSkillSchema.extend({
  /** 先制度（仅部分技能有） */
  priority: z.number().int().optional(),
})

// 推导 TypeScript 类型
export type Skill = z.infer<typeof SkillSchema>

// 技能集合校验
export const SkillDataSetSchema = z.array(SkillSchema)

// 推导数据集类型
export type SkillDataSet = z.infer<typeof SkillDataSetSchema>
