// engine/src/dsl/types.ts
// Shared DSL runtime types.

export type CompareOperator = '>' | '>=' | '<' | '<=' | '==' | '!='

export interface RuntimeEvaluatorCompare<TValue = never> {
  type: 'compare'
  operator: CompareOperator
  value: TValue
}

export interface RuntimeEvaluatorSame<TValue = never> {
  type: 'same'
  value: TValue
}

export interface RuntimeEvaluatorNotSame<TValue = never> {
  type: 'notSame'
  value: TValue
}

export interface RuntimeEvaluatorAny<TValue = never> {
  type: 'any'
  conditions: RuntimeEvaluator<TValue>[]
}

export interface RuntimeEvaluatorAll<TValue = never> {
  type: 'all'
  conditions: RuntimeEvaluator<TValue>[]
}

export interface RuntimeEvaluatorNot<TValue = never> {
  type: 'not'
  condition: RuntimeEvaluator<TValue>
}

export interface RuntimeEvaluatorProbability<TValue = never> {
  type: 'probability'
  percent: TValue
}

export interface RuntimeEvaluatorContain {
  type: 'contain'
  tag: string
}

export interface RuntimeEvaluatorExist {
  type: 'exist'
}

export interface RuntimeEvaluatorAnyOf<TValue = never> {
  type: 'anyOf'
  value: TValue
}

export type RuntimeEvaluator<TValue = never> =
  | RuntimeEvaluatorCompare<TValue>
  | RuntimeEvaluatorSame<TValue>
  | RuntimeEvaluatorNotSame<TValue>
  | RuntimeEvaluatorAny<TValue>
  | RuntimeEvaluatorAll<TValue>
  | RuntimeEvaluatorNot<TValue>
  | RuntimeEvaluatorProbability<TValue>
  | RuntimeEvaluatorContain
  | RuntimeEvaluatorExist
  | RuntimeEvaluatorAnyOf<TValue>

export interface EvaluatorRuntimeHooks<TValue = never> {
  resolveValue: (value: TValue) => unknown
  randomPercent: (percent: number) => boolean
}

export interface CommonConditionEvery<TCondition> {
  type: 'every'
  conditions: TCondition[]
}

export interface CommonConditionSome<TCondition> {
  type: 'some'
  conditions: TCondition[]
}

export interface CommonConditionNot<TCondition> {
  type: 'not'
  condition: TCondition
}

export interface CommonConditionEvaluate<TSelector, TEvaluator> {
  type: 'evaluate'
  target: TSelector
  evaluator: TEvaluator
}

export type CommonCondition<TCondition, TSelector, TEvaluator> =
  | CommonConditionEvery<TCondition>
  | CommonConditionSome<TCondition>
  | CommonConditionNot<TCondition>
  | CommonConditionEvaluate<TSelector, TEvaluator>

export interface CommonConditionHooks<TCondition, TSelector, TEvaluator> {
  evaluateCondition: (condition: TCondition) => boolean
  resolveSelector: (selector: TSelector) => unknown[]
  evaluateEvaluator: (value: unknown, evaluator: TEvaluator) => boolean
}

export interface SelectorChainStepSelect<TExtractor> {
  type: 'select'
  arg: TExtractor
}

export interface SelectorChainStepSelectPath {
  type: 'selectPath'
  arg: string
}

export interface SelectorChainStepSelectProp {
  type: 'selectProp'
  arg: string
}

export interface SelectorChainStepWhere<TEvaluator> {
  type: 'where'
  arg: TEvaluator
}

export interface SelectorChainStepWhereAttr<TExtractor, TEvaluator> {
  type: 'whereAttr'
  extractor: TExtractor
  evaluator: TEvaluator
}

export interface SelectorChainStepFlat {
  type: 'flat'
}

export interface SelectorChainStepAnd<TSelector> {
  type: 'and'
  arg: TSelector
}

export interface SelectorChainStepOr<TSelector> {
  type: 'or'
  arg: TSelector
  duplicate?: boolean
}

export interface SelectorChainStepSum {
  type: 'sum'
}

export interface SelectorChainStepAvg {
  type: 'avg'
}

export interface SelectorChainStepAdd<TValue> {
  type: 'add'
  arg: TValue
}

export interface SelectorChainStepMultiply<TValue> {
  type: 'multiply'
  arg: TValue
}

export interface SelectorChainStepDivide<TValue> {
  type: 'divide'
  arg: TValue
}

export interface SelectorChainStepShuffled {
  type: 'shuffled'
}

export interface SelectorChainStepLimit<TValue> {
  type: 'limit'
  arg: TValue
}

export interface SelectorChainStepClampMax<TValue> {
  type: 'clampMax'
  arg: TValue
}

export interface SelectorChainStepClampMin<TValue> {
  type: 'clampMin'
  arg: TValue
}

export interface SelectorChainStepRandomPick<TValue> {
  type: 'randomPick'
  arg: TValue
}

export interface SelectorChainStepRandomSample<TValue> {
  type: 'randomSample'
  arg: TValue
}

export interface SelectorChainStepWhen<TCondition, TValue> {
  type: 'when'
  condition: TCondition
  trueValue: TValue
  falseValue?: TValue
}

export interface SelectorChainStepConfigGet<TValue> {
  type: 'configGet'
  key: TValue
}

export type CommonSelectorChainStep<
  TValue = never,
  TSelector = never,
  TCondition = never,
  TEvaluator = RuntimeEvaluator<TValue>,
  TExtractor = never,
> =
  | SelectorChainStepSelect<TExtractor>
  | SelectorChainStepSelectPath
  | SelectorChainStepSelectProp
  | SelectorChainStepWhere<TEvaluator>
  | SelectorChainStepWhereAttr<TExtractor, TEvaluator>
  | SelectorChainStepFlat
  | SelectorChainStepAnd<TSelector>
  | SelectorChainStepOr<TSelector>
  | SelectorChainStepSum
  | SelectorChainStepAvg
  | SelectorChainStepAdd<TValue>
  | SelectorChainStepMultiply<TValue>
  | SelectorChainStepDivide<TValue>
  | SelectorChainStepShuffled
  | SelectorChainStepLimit<TValue>
  | SelectorChainStepClampMax<TValue>
  | SelectorChainStepClampMin<TValue>
  | SelectorChainStepRandomPick<TValue>
  | SelectorChainStepRandomSample<TValue>
  | SelectorChainStepWhen<TCondition, TValue>
  | SelectorChainStepConfigGet<TValue>

export interface SelectorChainRuntimeHooks<
  TValue = never,
  TSelector = never,
  TCondition = never,
  TEvaluator = RuntimeEvaluator<TValue>,
  TExtractor = never,
> {
  resolveValue: (value: TValue) => unknown
  resolveSelector: (selector: TSelector) => unknown[]
  evaluateCondition: (condition: TCondition) => boolean
  evaluateEvaluator: (value: unknown, evaluator: TEvaluator) => boolean
  applyExtractor: (item: unknown, extractor: TExtractor) => unknown[]
  shuffle: (items: unknown[]) => unknown[]
  getConfigValue: (key: string) => unknown
}

export interface RuntimeValueRaw {
  type: 'raw:number' | 'raw:string' | 'raw:boolean'
  value: number | string | boolean
  configId?: string
  tags?: string[]
}

export interface RuntimeValueEntity {
  type: 'entity:baseMark' | 'entity:baseSkill' | 'entity:species' | 'entity:effect'
  value: string
}

export interface RuntimeValueDynamic<TSelector> {
  type: 'dynamic'
  selector: TSelector
}

export interface RuntimeValueSelectorValue<TValue, TChain> {
  type: 'selectorValue'
  value: TValue
  chain?: TChain[]
}

export interface RuntimeValueConditional<TCondition, TValue> {
  type: 'conditional'
  condition: TCondition
  trueValue: TValue
  falseValue?: TValue
}

export interface RuntimeValueHooks<TSelector = never, TChain = never, TCondition = never> {
  resolveSelector: (selector: TSelector) => unknown[]
  applyChain: (results: unknown[], chain: TChain[]) => unknown[]
  evaluateCondition: (condition: TCondition) => boolean
  resolveRawValue?: (raw: RuntimeValueRaw) => unknown
}

export interface RuntimeSelectorChain<TBase extends string, TChain> {
  base: TBase
  chain?: TChain[]
}

export interface RuntimeSelectorConditional<TSelector, TCondition> {
  condition: TCondition
  trueSelector: TSelector
  falseSelector?: TSelector
}

export interface RuntimeSelectorValue<TValue, TChain> {
  type: 'selectorValue'
  value: TValue
  chain?: TChain[]
}

export interface RuntimeSelectorHooks<
  TBase extends string = string,
  TChain = never,
  TCondition = never,
  TValue = never,
> {
  resolveBase: (base: TBase) => unknown[]
  applyChain: (results: unknown[], chain: TChain[]) => unknown[]
  evaluateCondition: (condition: TCondition) => boolean
  resolveValue: (value: TValue) => unknown
}

export interface NumericEvalHooks<TSelector = never, TValue = never> {
  resolveRef: (entityId: string, attribute: string) => number
  resolveSelector?: (selector: TSelector) => number
  resolveValue?: (value: TValue) => number
}
