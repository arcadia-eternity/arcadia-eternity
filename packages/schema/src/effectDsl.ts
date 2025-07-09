import type { MarkInstance } from '@arcadia-eternity/battle'
import { CleanStageStrategy, ContinuousUseSkillStrategy, EffectTrigger } from '@arcadia-eternity/const'
import { BaseSelector, Extractor, type CompareOperator } from '@arcadia-eternity/effect-builder'

export { EffectTrigger }
export type { CompareOperator }

export interface EffectDSL {
  id: string
  trigger: EffectTrigger | EffectTrigger[]
  priority: number
  apply: OperatorDSL | Array<OperatorDSL>
  condition?: ConditionDSL
  consumesStacks?: number
  tags?: string[]
}

export type TODOOperator = {
  type: 'TODO'
}

export type DealDamageOperator = {
  type: 'dealDamage'
  target: SelectorDSL
  value: Value
}

export type HealOperator = {
  type: 'heal'
  target: SelectorDSL
  value: Value
}

export type ExecuteKillOperator = {
  type: 'executeKill'
  target: SelectorDSL
}

export type AddMarkOperator = {
  type: 'addMark'
  target: SelectorDSL
  mark: Value
  stack?: Value
  duration?: Value
}

export type AddStacksOperator = {
  type: 'addStacks'
  target: SelectorDSL
  value: Value
}

export type ConsumeStacksOperator = {
  type: 'consumeStacks'
  target: SelectorDSL
  value: Value
}

export type ModifyStatOperator = {
  type: 'modifyStat'
  target: SelectorDSL
  statType: Value
  delta?: Value
  percent?: Value
}

export type AddAttributeModifierOperator = {
  type: 'addAttributeModifier'
  target: SelectorDSL
  stat: Value
  modifierType: Value
  value: Value
  priority?: Value
  // 🆕 Phase-aware parameters
  phaseType?: Value
  scope?: Value
  phaseId?: Value
}

export type AddDynamicAttributeModifierOperator = {
  type: 'addDynamicAttributeModifier'
  target: SelectorDSL
  stat: Value
  modifierType: Value
  observableValue: SelectorDSL
  priority?: Value
  // 🆕 Phase-aware parameters
  phaseType?: Value
  scope?: Value
  phaseId?: Value
}

export type AddClampMaxModifierOperator = {
  type: 'addClampMaxModifier'
  target: SelectorDSL
  stat: Value
  maxValue: Value
  priority?: Value
}

export type AddClampMinModifierOperator = {
  type: 'addClampMinModifier'
  target: SelectorDSL
  stat: Value
  minValue: Value
  priority?: Value
}

export type AddClampModifierOperator = {
  type: 'addClampModifier'
  target: SelectorDSL
  stat: Value
  minValue?: Value // 🆕 Made optional to support min-only or max-only
  maxValue?: Value // 🆕 Made optional to support min-only or max-only
  priority?: Value
  // 🆕 Phase-aware parameters
  phaseType?: Value
  scope?: Value
  phaseId?: Value
}

export type AddSkillAttributeModifierOperator = {
  type: 'addSkillAttributeModifier'
  target: SelectorDSL
  attribute: Value
  modifierType: Value
  value: Value
  priority?: Value
  // 🆕 Phase-aware parameters
  phaseType?: Value
  scope?: Value
  phaseId?: Value
}

export type AddDynamicSkillAttributeModifierOperator = {
  type: 'addDynamicSkillAttributeModifier'
  target: SelectorDSL
  attribute: Value
  modifierType: Value
  observableValue: SelectorDSL
  priority?: Value
}

export type AddSkillClampMaxModifierOperator = {
  type: 'addSkillClampMaxModifier'
  target: SelectorDSL
  attribute: Value
  maxValue: Value
  priority?: Value
}

export type AddSkillClampMinModifierOperator = {
  type: 'addSkillClampMinModifier'
  target: SelectorDSL
  attribute: Value
  minValue: Value
  priority?: Value
}

export type AddSkillClampModifierOperator = {
  type: 'addSkillClampModifier'
  target: SelectorDSL
  attribute: Value
  minValue: Value
  maxValue: Value
  priority?: Value
}

export type StatStageBuffOperator = {
  type: 'statStageBuff'
  target: SelectorDSL
  statType: Value
  value: Value
  strategy?: Value
}
export type ClearStatStageOperator = {
  type: 'clearStatStage'
  target: SelectorDSL
  statType?: Value
  cleanStageStrategy?: CleanStageStrategy
}

export type ReverseStatStageOperator = {
  type: 'reverseStatStage'
  target: SelectorDSL
  statType?: Value
  cleanStageStrategy?: CleanStageStrategy
}

export type TransferStatStageOperator = {
  type: 'transferStatStage'
  source: SelectorDSL
  target: SelectorDSL
  statType?: Value
  cleanStageStrategy?: CleanStageStrategy
}

export type AddRageOperator = {
  type: 'addRage'
  target: SelectorDSL
  value: Value
}

export type AmplifyPowerOperator = {
  type: 'amplifyPower'
  target: SelectorDSL
  value: Value
}

export type AddPowerOperator = {
  type: 'addPower'
  target: SelectorDSL
  value: Value
}

export type AddCritRateOperator = {
  type: 'addCritRate'
  target: SelectorDSL
  value: Value
}

export type AddMultihitResultOperator = {
  type: 'addMultihitResult'
  target: SelectorDSL
  value: Value
}

export type SetMultihitOperator = {
  type: 'setMultihit'
  target: SelectorDSL
  value: Value
}

export type TransferMarkOperator = {
  type: 'transferMark'
  target: SelectorDSL
  mark: DynamicValue
}

export type DestroyMarkOperator = {
  type: 'destroyMark'
  target: SelectorDSL
}

export type ModifyStackResultOperator = {
  type: 'modifyStackResult'
  target: SelectorDSL
  newStacks?: Value
  newDuration?: Value
}

export type StunOperator = {
  type: 'stun'
  target: SelectorDSL
}

export type SetSureHitOperator = {
  type: 'setSureHit'
  target: SelectorDSL
  priority: number
}

export type SetSureCritOperator = {
  type: 'setSureCrit'
  target: SelectorDSL
  priority: number
}

export type SetSureMissOperator = {
  type: 'setSureMiss'
  target: SelectorDSL
  priority: number
}

export type SetSureNoCritOperator = {
  type: 'setSureNoCrit'
  target: SelectorDSL
  priority: number
}

export type SetSkillOperator = {
  type: 'setSkill'
  target: SelectorDSL
  value: Value
  updateConfig?: boolean
}

export type PreventDamageOperator = {
  type: 'preventDamage'
  target: SelectorDSL
}

export type SetActualTargetOperator = {
  type: 'setActualTarget'
  target: SelectorDSL
  newTarget: DynamicValue
}

export type AddModifiedOperator = {
  type: 'addModified'
  target: SelectorDSL
  delta: Value
  percent: Value
}

export type AddThresholdOperator = {
  type: 'addThreshold'
  target: SelectorDSL
  min?: Value
  max?: Value
}

export type OverrideMarkConfigOperator = {
  type: 'overrideMarkConfig'
  target: SelectorDSL
  config: Partial<MarkInstance['config']>
}

export type SetMarkDurationOperator = {
  type: 'setMarkDuration'
  target: SelectorDSL
  value: Value
}

export type SetMarkStackOperator = {
  type: 'setMarkStack'
  target: SelectorDSL
  value: Value
}

export type SetMarkMaxStackOperator = {
  type: 'setMarkMaxStack'
  target: SelectorDSL
  value: Value
}

export type SetMarkPersistentOperator = {
  type: 'setMarkPersistent'
  target: SelectorDSL
  value: Value
}

export type SetMarkStackableOperator = {
  type: 'setMarkStackable'
  target: SelectorDSL
  value: Value
}

export type SetMarkStackStrategyOperator = {
  type: 'setMarkStackStrategy'
  target: SelectorDSL
  value: Value
}

export type SetMarkDestroyableOperator = {
  type: 'setMarkDestroyable'
  target: SelectorDSL
  value: Value
}

export type SetMarkIsShieldOperator = {
  type: 'setMarkIsShield'
  target: SelectorDSL
  value: Value
}

export type SetMarkKeepOnSwitchOutOperator = {
  type: 'setMarkKeepOnSwitchOut'
  target: SelectorDSL
  value: Value
}

export type SetMarkTransferOnSwitchOperator = {
  type: 'setMarkTransferOnSwitch'
  target: SelectorDSL
  value: Value
}

export type SetMarkInheritOnFaintOperator = {
  type: 'setMarkInheritOnFaint'
  target: SelectorDSL
  value: Value
}

export type SetStatLevelMarkLevelOperator = {
  type: 'setStatLevelMarkLevel'
  target: SelectorDSL
  value: Value
}

export type AddValueOperator = {
  type: 'addValue'
  target: SelectorDSL
  value: Value
}

export type SetValueOperator = {
  type: 'setValue'
  target: SelectorDSL
  value: Value
}

export type ToggleOperator = {
  type: 'toggle'
  target: SelectorDSL
}

export type SetConfigOperator = {
  type: 'setConfig'
  target: SelectorDSL
  key: Value
  value: Value
}

export type SetIgnoreStageStrategyOperator = {
  type: 'setIgnoreStageStrategy'
  target: SelectorDSL
  value: Value
}

export type AddAccuracyOperator = {
  type: 'addAccuracy'
  target: SelectorDSL
  value: Value
}

export type SetAccuracyOperator = {
  type: 'setAccuracy'
  target: SelectorDSL
  value: Value
}

export type DisableContextOperator = {
  type: 'disableContext'
  target: SelectorDSL
}

export type AddConfigModifierOperator = {
  type: 'addConfigModifier'
  target: SelectorDSL
  configKey: Value
  modifierType: Value
  value: Value
  priority?: Value
}

export type AddDynamicConfigModifierOperator = {
  type: 'addDynamicConfigModifier'
  target: SelectorDSL
  configKey: Value
  modifierType: Value
  observableValue: SelectorDSL
  priority?: Value
}

export type RegisterConfigOperator = {
  type: 'registerConfig'
  target: SelectorDSL
  configKey: Value
  initialValue: Value
}

export type RegisterTaggedConfigOperator = {
  type: 'registerTaggedConfig'
  target: SelectorDSL
  configKey: Value
  initialValue: Value
  tags: Value
}

export type AddTaggedConfigModifierOperator = {
  type: 'addTaggedConfigModifier'
  target: SelectorDSL
  tag: Value
  modifierType: Value
  value: Value
  priority?: Value
}

export type AddPhaseConfigModifierOperator = {
  type: 'addPhaseConfigModifier'
  target: SelectorDSL
  configKey: Value
  modifierType: Value
  value: Value
  priority?: Value
}

export type AddPhaseDynamicConfigModifierOperator = {
  type: 'addPhaseDynamicConfigModifier'
  target: SelectorDSL
  configKey: Value
  modifierType: Value
  observableValue: SelectorDSL
  priority?: Value
}

export type AddPhaseTypeConfigModifierOperator = {
  type: 'addPhaseTypeConfigModifier'
  target: SelectorDSL
  configKey: Value
  modifierType: Value
  value: Value
  phaseType: Value
  scope?: Value
  priority?: Value
  phaseId?: Value
}

export type AddDynamicPhaseTypeConfigModifierOperator = {
  type: 'addDynamicPhaseTypeConfigModifier'
  target: SelectorDSL
  configKey: Value
  modifierType: Value
  observableValue: SelectorDSL
  phaseType: Value
  scope?: Value
  priority?: Value
  phaseId?: Value
}

// 变身相关操作符
export type TransformOperator = {
  type: 'transform'
  target: SelectorDSL
  newBase: Value
  transformType?: 'temporary' | 'permanent'
  priority?: Value
  permanentStrategy?: 'preserve_temporary' | 'clear_temporary'
}

export type TransformWithPreservationOperator = {
  type: 'transformWithPreservation'
  target: SelectorDSL
  newBase: Value
  transformType?: 'temporary' | 'permanent'
  priority?: Value
  permanentStrategy?: 'preserve_temporary' | 'clear_temporary'
}

export type RemoveTransformationOperator = {
  type: 'removeTransformation'
  target: SelectorDSL
}

export type OperatorDSL =
  | TODOOperator
  | ConditionalOperator
  | DealDamageOperator
  | HealOperator
  | ExecuteKillOperator
  | AddMarkOperator
  | AddStacksOperator
  | ConsumeStacksOperator
  | ModifyStatOperator
  | AddAttributeModifierOperator
  | AddDynamicAttributeModifierOperator
  | AddClampMaxModifierOperator
  | AddClampMinModifierOperator
  | AddClampModifierOperator
  | AddSkillAttributeModifierOperator
  | AddDynamicSkillAttributeModifierOperator
  | AddSkillClampMaxModifierOperator
  | AddSkillClampMinModifierOperator
  | AddSkillClampModifierOperator
  | StatStageBuffOperator
  | ClearStatStageOperator
  | ReverseStatStageOperator
  | TransferStatStageOperator
  | AddRageOperator
  | AmplifyPowerOperator
  | AddPowerOperator
  | AddCritRateOperator
  | AddMultihitResultOperator
  | SetMultihitOperator
  | TransferMarkOperator
  | DestroyMarkOperator
  | ModifyStackResultOperator
  | StunOperator
  | SetSureHitOperator
  | SetSureCritOperator
  | SetSureMissOperator
  | SetSureNoCritOperator
  | SetSkillOperator
  | PreventDamageOperator
  | SetActualTargetOperator
  | AddModifiedOperator
  | AddThresholdOperator
  | OverrideMarkConfigOperator
  | SetMarkDurationOperator
  | SetMarkStackOperator
  | SetMarkMaxStackOperator
  | SetMarkPersistentOperator
  | SetMarkStackableOperator
  | SetMarkStackStrategyOperator
  | SetMarkDestroyableOperator
  | SetMarkIsShieldOperator
  | SetMarkKeepOnSwitchOutOperator
  | SetMarkTransferOnSwitchOperator
  | SetMarkInheritOnFaintOperator
  | SetStatLevelMarkLevelOperator
  | AddValueOperator
  | SetValueOperator
  | ToggleOperator
  | SetConfigOperator
  | SetIgnoreStageStrategyOperator
  | AddAccuracyOperator
  | SetAccuracyOperator
  | DisableContextOperator
  | AddConfigModifierOperator
  | AddDynamicConfigModifierOperator
  | RegisterConfigOperator
  | RegisterTaggedConfigOperator
  | AddTaggedConfigModifierOperator
  | AddPhaseConfigModifierOperator
  | AddPhaseDynamicConfigModifierOperator
  | AddPhaseTypeConfigModifierOperator
  | AddDynamicPhaseTypeConfigModifierOperator
  | TransformOperator
  | TransformWithPreservationOperator
  | RemoveTransformationOperator

export type RawNumberValue = {
  type: 'raw:number'
  value: number
  configId?: string
  tags?: string[]
}

export type RawStringValue = {
  type: 'raw:string'
  value: string
  configId?: string
  tags?: string[]
}

export type RawBooleanValue = {
  type: 'raw:boolean'
  value: boolean
  configId?: string
  tags?: string[]
}

export type RawBaseMarkIdValue = {
  type: 'entity:baseMark'
  value: string // Mark的ID需符合特定格式
}

export type RawBaseSkillIdValue = {
  type: 'entity:baseSkill'
  value: string // Skill的ID需符合特定格式
}

export type RawSpeciesIdValue = {
  type: 'entity:species'
  value: string // Species的ID需符合特定格式
}

export type DynamicValue = {
  type: 'dynamic'
  selector: SelectorDSL
}

export type SelectorValue = {
  type: 'selector'
  value: Value
  chain?: Array<SelectorChain>
}

export type Value =
  | RawNumberValue
  | RawStringValue
  | RawBooleanValue
  | RawBaseMarkIdValue
  | RawBaseSkillIdValue
  | RawSpeciesIdValue
  | DynamicValue
  | SelectorValue
  | Array<Value>
  | number
  | string
  | boolean
  | ConditionalValue

export type BaseSelectorKey = keyof typeof BaseSelector

export type ChainSelector = {
  base: BaseSelectorKey
  chain?: Array<SelectorChain>
}

export type SelectorDSL = BaseSelectorKey | ChainSelector | ConditionalSelector | SelectorValue

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
      type: 'avg' // 数值求平均值（无参数）
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
  | { type: 'anyOf'; value: Value }

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
      type: 'opponentUseSkill'
    }
  | {
      type: 'selfBeDamaged'
    }
  | {
      type: 'opponentBeDamaged'
    }
  | {
      type: 'selfAddMark'
    }
  | {
      type: 'opponentAddMark'
    }
  | {
      type: 'selfBeAddMark'
    }
  | {
      type: 'opponentBeAddMark'
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
  | {
      type: 'selfSwitchIn'
    }
  | {
      type: 'selfSwitchOut'
    }
  | {
      type: 'selfBeSkillTarget'
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

export type { EffectDSL as Effect }
import { effectDSLSchema, EffectDSLSetSchema } from './effectSchema'
export { effectDSLSchema as EffectSchema, EffectDSLSetSchema as EffectSetSchema }
