import { EffectTrigger } from '@/core/effect'
import { CompareOperator } from '@/effectBuilder/condition'
import { Operators } from '@/effectBuilder/operator'
import { BaseSelector, Extractor } from '@/effectBuilder/selector'

export { EffectTrigger, SelectorChain }

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
  target: SelectorDSL // 操作目标选择器
  args?: Array<Value>
}

export type Value = RawValue | DynamicValue

export type RawValue = {
  type: 'raw'
  value: number | string
}

export type DynamicValue = {
  type: 'dynamic'
  selector: SelectorDSL
}

export type BaseSelector = keyof typeof BaseSelector

export type SelectorDSL =
  | BaseSelector
  | {
      base: BaseSelector
      chain: Array<SelectorChain>
    }

type SelectorChain =
  | {
      type: 'select'
      arg: keyof typeof Extractor | string
    }
  | {
      type: 'where'
      arg: ConditionDSL
    }
  | {
      type: 'whereAttr'
      extractor: keyof typeof Extractor | string
      condition: ConditionDSL
    }
  | {
      type: 'and'
      arg: SelectorDSL // 交集
    }
  | {
      type: 'or'
      arg: SelectorDSL // 并集
    }
  | {
      type: 'randomPick'
      arg: number // 随机选取数量
    }
  | {
      type: 'randomSample'
      arg: number // 百分比概率筛选
    }
  | {
      type: 'sum' // 数值求和（无参数）
    }
  | {
      type: 'add'
      arg: number | SelectorDSL // 数值加法
    }
  | {
      type: 'multiply'
      arg: number | SelectorDSL // 数值乘法
    }
  | {
      type: 'divide'
      arg: number | SelectorDSL // 数值除法
    }
  | {
      type: 'shuffled' // 乱序（无参数）
    }
  | {
      type: 'clampMax'
      arg: number // 最大值限制
    }
  | {
      type: 'clampMin'
      arg: number // 最小值限制
    }

export type ConditionDSL =
  | {
      type: 'compare'
      target: string
      operator: CompareOperator
      value: Value
    }
  | { type: 'same'; value: Value }
  | { type: 'any'; conditions: ConditionDSL[] }
  | { type: 'all'; conditions: ConditionDSL[] }
  | { type: 'probability'; percent: Value }
