import { EffectScope, EffectTrigger } from '@test-battle/const'
import { BaseSelector, Extractor, type CompareOperator } from '@test-battle/battle/effectBuilder'

export { EffectTrigger }
export type { SelectorChain }

export interface EffectDSL {
  id: string
  trigger: EffectTrigger
  priority: number
  apply: ActionDSL
  scope: EffectScope
  condition?: ConditionDSL
  consumesStacks?: number
}

export type ActionDSL =
  | {
      type: 'dealDamage'
      target: SelectorDSL
      value: Value
    }
  | {
      type: 'heal'
      target: SelectorDSL
      value: Value
    }
  | {
      type: 'addMark'
      target: SelectorDSL
      mark: string //id
      duration: number
    }
  | {
      type: 'addStacks'
      target: SelectorDSL
      value: number
    }
  | {
      type: 'consumeStacks'
      target: SelectorDSL
      value: number
    }
  | {
      type: 'modifyStat'
      target: SelectorDSL
      statType: Value
      value: Value
      percent: Value
    }
  | {
      type: 'statStageBuff'
      target: SelectorDSL
      statType: Value
      value: Value
    }
  | {
      type: 'addRage'
      target: SelectorDSL
      value: Value
    }
  | {
      type: 'amplifyPower'
      target: SelectorDSL
      value: Value
    }
  | {
      type: 'addPower'
      target: SelectorDSL
      value: Value
    }
  | {
      type: 'transferMark'
      target: SelectorDSL
      mark: DynamicValue
    }

export type RawNumberValue = {
  type: 'raw:number'
  value: number
}

export type RawStringValue = {
  type: 'raw:string'
  value: string
}

export type RawBooleanValue = {
  type: 'raw:boolean'
  value: boolean
}

export type RawMarkIdValue = {
  type: 'raw:markId'
  value: string // Mark的ID需符合特定格式
}

export type DynamicValue = {
  type: 'dynamic'
  selector: SelectorDSL
}

export type Value = RawNumberValue | RawStringValue | RawBooleanValue | RawMarkIdValue | DynamicValue

export type BaseSelector = keyof typeof BaseSelector

export type SelectorDSL =
  | BaseSelector
  | {
      base: BaseSelector
      chain?: Array<SelectorChain>
    }

export type SelectStepDSL = {
  type: 'select'
  arg: keyof typeof Extractor
}

export type SelectPathDSL = {
  type: 'selectPath'
  arg: string
}

export type SelectPropDSL = {
  type: 'selectProp'
  arg: string
}

type SelectorChain =
  | SelectStepDSL
  | SelectPathDSL
  | SelectPropDSL
  | {
      type: 'where'
      arg: EvaluatorDSL
    }
  | {
      type: 'whereAttr'
      extractor: keyof typeof Extractor | string
      condition: EvaluatorDSL
    }
  | {
      type: 'and'
      arg: SelectorDSL // 交集
    }
  | {
      type: 'or'
      arg: SelectorDSL // 并集
      duplicate?: boolean
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

export type EvaluatorDSL =
  | {
      type: 'compare'
      target: string
      operator: CompareOperator
      value: Value
    }
  | { type: 'same'; value: Value }
  | { type: 'any'; conditions: EvaluatorDSL[] }
  | { type: 'all'; conditions: EvaluatorDSL[] }
  | { type: 'probability'; percent: Value }

export type ConditionDSL = {
  target: SelectorDSL
  evaluator: EvaluatorDSL
}
