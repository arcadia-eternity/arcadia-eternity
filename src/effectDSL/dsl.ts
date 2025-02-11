import { EffectTrigger } from '@/core/effect'
import { CompareOperator } from '@/effectBuilder/condition'
import { Operators } from '@/effectBuilder/operator'
import { BaseSelector, Extractor } from '@/effectBuilder/selector'
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
  target: SelectorDSL // 操作目标选择器
  args?: Array<Value>
}

export type Value = PrimitiveValue | DynamicValue

export type PrimitiveValue = {
  type: 'primitive'
  value: Primitive
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
