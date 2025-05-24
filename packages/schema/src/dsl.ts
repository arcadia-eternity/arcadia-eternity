import type { MarkInstance } from '@arcadia-eternity/battle'
import { CleanStageStrategy, ContinuousUseSkillStrategy, EffectTrigger } from '@arcadia-eternity/const'
import { BaseSelector, Extractor, type CompareOperator, type ValueSource } from '@arcadia-eternity/effect-builder'

export { EffectTrigger }
export type { CompareOperator }

export interface EffectDSL {
  id: string
  trigger: EffectTrigger
  priority: number
  apply: OperatorDSL | Array<OperatorDSL>
  condition?: ConditionDSL
  consumesStacks?: number
  tags?: string[]
}

export type TODOOpreator = {
  type: 'TODO'
}

export type DealDamageOpreator = {
  type: 'dealDamage'
  target: SelectorDSL
  value: Value
}

export type HealOpreator = {
  type: 'heal'
  target: SelectorDSL
  value: Value
}

export type AddMarkOpreator = {
  type: 'addMark'
  target: SelectorDSL
  mark: Value
  stack?: Value
  duration?: Value
}

export type AddStacksOpreator = {
  type: 'addStacks'
  target: SelectorDSL
  value: Value
}

export type ConsumeStacksOpreator = {
  type: 'consumeStacks'
  target: SelectorDSL
  value: Value
}

export type ModifyStatOpreator = {
  type: 'modifyStat'
  target: SelectorDSL
  statType: Value
  delta?: Value
  percent?: Value
}

export type AddAttributeModifierOpreator = {
  type: 'addAttributeModifier'
  target: SelectorDSL
  stat: Value
  modifierType: Value
  value: Value
  priority?: Value
}

export type AddDynamicAttributeModifierOpreator = {
  type: 'addDynamicAttributeModifier'
  target: SelectorDSL
  stat: Value
  modifierType: Value
  observableValue: SelectorDSL
  priority?: Value
}

export type AddClampMaxModifierOpreator = {
  type: 'addClampMaxModifier'
  target: SelectorDSL
  stat: Value
  maxValue: Value
  priority?: Value
}

export type AddClampMinModifierOpreator = {
  type: 'addClampMinModifier'
  target: SelectorDSL
  stat: Value
  minValue: Value
  priority?: Value
}

export type AddClampModifierOpreator = {
  type: 'addClampModifier'
  target: SelectorDSL
  stat: Value
  minValue: Value
  maxValue: Value
  priority?: Value
}

export type StatStageBuffOpreator = {
  type: 'statStageBuff'
  target: SelectorDSL
  statType: Value
  value: Value
}
export type ClearStatStageOpreator = {
  type: 'clearStatStage'
  target: SelectorDSL
  statType?: Value
  cleanStageStrategy?: CleanStageStrategy
}

export type AddRageOpreator = {
  type: 'addRage'
  target: SelectorDSL
  value: Value
}

export type AmplifyPowerOpreator = {
  type: 'amplifyPower'
  target: SelectorDSL
  value: Value
}

export type AddPowerOpreator = {
  type: 'addPower'
  target: SelectorDSL
  value: Value
}

export type AddCritRateOpreator = {
  type: 'addCritRate'
  target: SelectorDSL
  value: Value
}

export type AddMultihitResultOpreator = {
  type: 'addMultihitResult'
  target: SelectorDSL
  value: Value
}

export type SetMultihitOpreator = {
  type: 'setMultihit'
  target: SelectorDSL
  value: Value
}

export type TransferMarkOpreator = {
  type: 'transferMark'
  target: SelectorDSL
  mark: DynamicValue
}

export type DestroyMarkOpreator = {
  type: 'destroyMark'
  target: SelectorDSL
}

export type StunOpreator = {
  type: 'stun'
  target: SelectorDSL
}

export type SetSureHitOpreator = {
  type: 'setSureHit'
  target: SelectorDSL
  priority: number
}

export type SetSureCritOpreator = {
  type: 'setSureCrit'
  target: SelectorDSL
  priority: number
}

export type SetSureMissOpreator = {
  type: 'setSureMiss'
  target: SelectorDSL
  priority: number
}

export type SetSureNoCritOpreator = {
  type: 'setSureNoCrit'
  target: SelectorDSL
  priority: number
}

export type SetSkillOpreator = {
  type: 'setSkill'
  target: SelectorDSL
  value: Value
}

export type PreventDamageOpreator = {
  type: 'preventDamage'
  target: SelectorDSL
}

export type SetActualTargetOpreator = {
  type: 'setActualTarget'
  target: SelectorDSL
  newTarget: DynamicValue
}

export type AddModifiedOpreator = {
  type: 'addModified'
  target: SelectorDSL
  delta: Value
  percent: Value
}

export type AddThresholdOpreator = {
  type: 'addThreshold'
  target: SelectorDSL
  min?: Value
  max?: Value
}

export type OverrideMarkConfigOpreator = {
  type: 'overrideMarkConfig'
  target: SelectorDSL
  config: Partial<MarkInstance['config']>
}

export type SetMarkDurationOpreator = {
  type: 'setMarkDuration'
  target: SelectorDSL
  value: Value
}

export type SetMarkStackOpreator = {
  type: 'setMarkStack'
  target: SelectorDSL
  value: Value
}

export type SetMarkMaxStackOpreator = {
  type: 'setMarkMaxStack'
  target: SelectorDSL
  value: Value
}

export type SetMarkPersistentOpreator = {
  type: 'setMarkPersistent'
  target: SelectorDSL
  value: Value
}

export type SetMarkStackableOpreator = {
  type: 'setMarkStackable'
  target: SelectorDSL
  value: Value
}

export type SetMarkStackStrategyOpreator = {
  type: 'setMarkStackStrategy'
  target: SelectorDSL
  value: Value
}

export type SetMarkDestroyableOpreator = {
  type: 'setMarkDestroyable'
  target: SelectorDSL
  value: Value
}

export type SetMarkIsShieldOpreator = {
  type: 'setMarkIsShield'
  target: SelectorDSL
  value: Value
}

export type SetMarkKeepOnSwitchOutOpreator = {
  type: 'setMarkKeepOnSwitchOut'
  target: SelectorDSL
  value: Value
}

export type SetMarkTransferOnSwitchOpreator = {
  type: 'setMarkTransferOnSwitch'
  target: SelectorDSL
  value: Value
}

export type SetMarkInheritOnFaintOpreator = {
  type: 'setMarkInheritOnFaint'
  target: SelectorDSL
  value: Value
}

export type SetStatLevelMarkLevelOpreator = {
  type: 'setStatLevelMarkLevel'
  target: SelectorDSL
  value: Value
}

export type AddValueOpreator = {
  type: 'addValue'
  target: SelectorDSL
  value: Value
}

export type SetValueOpreator = {
  type: 'setValue'
  target: SelectorDSL
  value: Value
}

export type ToggleOpreator = {
  type: 'toggle'
  target: SelectorDSL
}

export type SetConfigOpreator = {
  type: 'setConfig'
  target: SelectorDSL
  key: Value
  value: Value
}

export type SetIgnoreStageStrategyOpreator = {
  type: 'setIgnoreStageStrategy'
  target: SelectorDSL
  value: Value
}

export type AddAccuracyOpreator = {
  type: 'addAccuracy'
  target: SelectorDSL
  value: Value
}

export type SetAccuracyOpreator = {
  type: 'setAccuracy'
  target: SelectorDSL
  value: Value
}

export type DisableContextOpreator = {
  type: 'disableContext'
  target: SelectorDSL
}

export type OperatorDSL =
  | TODOOpreator
  | ConditionalOperator
  | DealDamageOpreator
  | HealOpreator
  | AddMarkOpreator
  | AddStacksOpreator
  | ConsumeStacksOpreator
  | ModifyStatOpreator
  | AddAttributeModifierOpreator
  | AddDynamicAttributeModifierOpreator
  | AddClampMaxModifierOpreator
  | AddClampMinModifierOpreator
  | AddClampModifierOpreator
  | StatStageBuffOpreator
  | ClearStatStageOpreator
  | AddRageOpreator
  | AmplifyPowerOpreator
  | AddPowerOpreator
  | AddCritRateOpreator
  | AddMultihitResultOpreator
  | SetMultihitOpreator
  | TransferMarkOpreator
  | DestroyMarkOpreator
  | StunOpreator
  | SetSureHitOpreator
  | SetSureCritOpreator
  | SetSureMissOpreator
  | SetSureNoCritOpreator
  | SetSkillOpreator
  | PreventDamageOpreator
  | SetActualTargetOpreator
  | AddModifiedOpreator
  | AddThresholdOpreator
  | OverrideMarkConfigOpreator
  | SetMarkDurationOpreator
  | SetMarkStackOpreator
  | SetMarkMaxStackOpreator
  | SetMarkPersistentOpreator
  | SetMarkStackableOpreator
  | SetMarkStackStrategyOpreator
  | SetMarkDestroyableOpreator
  | SetMarkIsShieldOpreator
  | SetMarkKeepOnSwitchOutOpreator
  | SetMarkTransferOnSwitchOpreator
  | SetMarkInheritOnFaintOpreator
  | SetStatLevelMarkLevelOpreator
  | AddValueOpreator
  | SetValueOpreator
  | ToggleOpreator
  | SetConfigOpreator
  | SetIgnoreStageStrategyOpreator
  | AddAccuracyOpreator
  | SetAccuracyOpreator
  | DisableContextOpreator

export type RawNumberValue = {
  type: 'raw:number'
  value: number
  configId?: string
}

export type RawStringValue = {
  type: 'raw:string'
  value: string
  configId?: string
}

export type RawBooleanValue = {
  type: 'raw:boolean'
  value: boolean
  configId?: string
}

export type RawBaseMarkIdValue = {
  type: 'entity:baseMark'
  value: string // Mark的ID需符合特定格式
}

export type RawBaseSkillIdValue = {
  type: 'entity:baseSkill'
  value: string // Mark的ID需符合特定格式
}

export type DynamicValue = {
  type: 'dynamic'
  selector: SelectorDSL
}

export type Value =
  | RawNumberValue
  | RawStringValue
  | RawBooleanValue
  | RawBaseMarkIdValue
  | RawBaseSkillIdValue
  | DynamicValue
  | Array<Value>
  | number
  | string
  | boolean
  | ConditionalValue

export type BaseSelector = keyof typeof BaseSelector

export type ChainSelector = {
  base: BaseSelector
  chain?: Array<SelectorChain>
}

export type SelectorDSL = BaseSelector | ChainSelector | ConditionalSelector

export type ConditionalSelector = {
  condition: ConditionDSL
  trueSelector: SelectorDSL
  falseSelector?: SelectorDSL
}

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
  | keyof typeof Extractor

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
      type: 'flat'
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
      type: 'limit'
      arg: Value
    }
  | {
      type: 'clampMax'
      arg: Value
    }
  | {
      type: 'clampMin'
      arg: Value
    }
  | {
      type: 'configGet'
      key: Value
    }
  | {
      type: 'selectObservable'
      arg: string
    }
  | {
      type: 'selectAttribute$'
      arg: string
    }
  | {
      type: 'asStatLevelMark'
    }
  | WhenSelectorStep

export type EvaluatorDSL =
  | {
      type: 'compare'
      operator: CompareOperator
      value: Value
    }
  | { type: 'same'; value: Value }
  | { type: 'notSame'; value: Value }
  | { type: 'any'; conditions: EvaluatorDSL[] }
  | { type: 'all'; conditions: EvaluatorDSL[] }
  | { type: 'not'; condition: EvaluatorDSL }
  | { type: 'probability'; percent: Value }
  | { type: 'contain'; tag: string }
  | { type: 'exist' }

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
      type: 'petIsActive'
    }
  | {
      type: 'selfUseSkill'
    }
  | {
      type: 'checkSelf'
    }
  | {
      type: 'foeUseSkill'
    }
  | {
      type: 'selfBeDamaged'
    }
  | {
      type: 'selfAddMark'
    }
  | {
      type: 'foeAddMark'
    }
  | {
      type: 'selfBeAddMark'
    }
  | {
      type: 'foeBeAddMark'
    }
  | {
      type: 'selfBeHeal'
    }
  | {
      type: 'continuousUseSkill'
      times?: Value
      strategy?: ContinuousUseSkillStrategy
    }
  | {
      type: 'statStageChange'
      stat?: Value
      check?: 'up' | 'down' | 'all'
    }
  | {
      type: 'isFirstSkillUsedThisTurn'
    }
  | {
      type: 'isLastSkillUsedThisTurn'
    }

export type WhenSelectorStep = {
  type: 'when'
  condition: ConditionDSL
  trueValue: Value
  falseValue?: Value
}

export type ConditionalOperator = {
  type: 'conditional'
  condition: ConditionDSL
  trueOperator: OperatorDSL
  falseOperator?: OperatorDSL
}

export type ConditionalValue = {
  type: 'conditional'
  condition: ConditionDSL
  trueValue: Value
  falseValue?: Value
}
