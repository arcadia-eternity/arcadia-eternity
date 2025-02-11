import { EffectTrigger } from '@/core/effect'
import { CompareOperator } from '@/effectBuilder/condition'
import { Operators } from '@/effectBuilder/operator'
import { Primitive } from 'zod'

export { EffectTrigger }

export interface EffectDSL {
  id: string
  trigger: EffectTrigger
  priority: number
  apply: ActionDSL
  condition?: ConditionDSL
  consumesStacks?: number
}

export type ActionDSL = {
  operator: keyof typeof Operators
  target?: SelectorDSL // 操作目标选择器
  source?: SelectorDSL // 操作来源选择器（可选）
  args?: Array<
    // 操作参数，支持动态值
    Primitive | { selector: SelectorDSL } | { value: DynamicValueDSL }
  >
}

export type DynamicValueDSL = {
  selector: string // 使用点分路径语法：如 "foe.hp"、"self.marks[].duration"
  filters?: ConditionDSL[] // 过滤条件
  operation?: 'sum' | 'avg' // 聚合操作
  then?: [CompareOperator, number] // 后续数值处理
  multiplier?: number // 数值乘数
}

export type BaseSelector = 'self' | 'foe' | 'petOwners' | 'usingSkillContext' | 'mark'

export type SelectorDSL =
  | BaseSelector
  | {
      base: BaseSelector
      chain: Array<{
        type: 'select' | 'where' | 'randomPick'
        arg?: string | number | ConditionDSL
      }>
    }

type ConditionDSL =
  | { type: 'compare'; target: string; operator: CompareOperator; value: number }
  | { type: 'hasOne'; value: Primitive }
  | { type: 'any'; conditions: ConditionDSL[] }
  | { type: 'all'; conditions: ConditionDSL[] }
