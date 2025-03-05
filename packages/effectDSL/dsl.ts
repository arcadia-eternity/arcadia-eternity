import { EffectTrigger } from '@test-battle/const'
import { BaseSelector, Extractor, type CompareOperator } from '@test-battle/effect-builder'

export { EffectTrigger }
export type { CompareOperator }

export interface EffectDSL {
  id: string
  trigger: EffectTrigger
  priority: number
  apply: OperatorDSL
  condition?: ConditionDSL
  consumesStacks?: number
}

export type OperatorDSL =
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

export type ChainSelector = {
  base: BaseSelector
  chain?: Array<SelectorChain>
}

export type SelectorDSL = BaseSelector | ChainSelector

export type SelectStepDSL = {
  type: 'select'
  arg: ExtractorDSL
}

export type SelectPathDSL = {
  type: 'selectPath'
  arg: string
}

export type SelectPropDSL = {
  type: 'selectProp'
  arg: string
}

export type ExtractorDSL =
  | {
      type: 'base'
      arg: keyof typeof Extractor
    }
  | {
      type: 'dynamic'
      arg: string
    }

export type SelectorChain =
  | SelectStepDSL
  | SelectPathDSL
  | SelectPropDSL
  | {
      type: 'where'
      arg: EvaluatorDSL
    }
  | {
      type: 'whereAttr'
      extractor: ExtractorDSL
      evaluator: EvaluatorDSL
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
      arg: Value
    }
  | {
      type: 'randomSample'
      arg: Value
    }
  | {
      type: 'sum' // 数值求和（无参数）
    }
  | {
      type: 'add'
      arg: Value
    }
  | {
      type: 'multiply'
      arg: Value
    }
  | {
      type: 'divide'
      arg: Value
    }
  | {
      type: 'shuffled' // 乱序（无参数）
    }
  | {
      type: 'clampMax'
      arg: Value
    }
  | {
      type: 'clampMin'
      arg: Value
    }

export type EvaluatorDSL =
  | {
      type: 'compare'
      operator: CompareOperator
      value: Value
    }
  | { type: 'same'; value: Value }
  | { type: 'any'; conditions: EvaluatorDSL[] }
  | { type: 'all'; conditions: EvaluatorDSL[] }
  | { type: 'probability'; percent: Value }

export type ConditionDSL =
  | {
      type: 'evaluate'
      target: SelectorDSL
      evaluator: EvaluatorDSL
    }
  | {
      type: 'some'
      conditions: ConditionDSL[]
    }
  | {
      type: 'every'
      conditions: ConditionDSL[]
    }
  | {
      type: 'not'
      condition: ConditionDSL
    }
  | {
      type: 'selfUse'
    }
