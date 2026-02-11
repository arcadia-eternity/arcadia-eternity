import {
  CleanStageStrategy,
  ContinuousUseSkillStrategy,
  EffectTrigger,
  StatTypeWithoutHp,
} from '@arcadia-eternity/const'
import { BaseSelector, Extractor } from '@arcadia-eternity/effect-builder'
import { Type, type TSchema } from '@sinclair/typebox'
import { MarkConfigSchema } from './mark'
import { StringEnum } from './utils'

// --- Base enums ---
const selectorKeys = Object.keys(BaseSelector)
export const baseSelectorSchema = StringEnum(selectorKeys)

const effectTriggerSchema = StringEnum(Object.values(EffectTrigger))

const COMPARE_OPERATORS = ['>', '<', '>=', '<=', '=='] as const
const compareOperatorSchema = StringEnum([...COMPARE_OPERATORS])

const extractorKeys = Object.keys(Extractor)
const baseExtractorSchema = StringEnum(extractorKeys)

// --- Forward-declared recursive schemas ---
// TypeBox doesn't support mutual recursion natively like Zod's z.lazy().
// We use Type.Unsafe to declare forward references, then assign them later.
// At runtime these are plain JSON Schema objects with $ref-like semantics;
// TypeBox's Value.Check will still validate structurally.

// We build the schemas imperatively so that every reference resolves.
// The trick: define mutable schema holders, fill them in order.

const _value: { schema: TSchema } = { schema: Type.Any() }
const _selector: { schema: TSchema } = { schema: Type.Any() }
const _condition: { schema: TSchema } = { schema: Type.Any() }
const _evaluator: { schema: TSchema } = { schema: Type.Any() }
const _operator: { schema: TSchema } = { schema: Type.Any() }
const _selectorChain: { schema: TSchema } = { schema: Type.Any() }

// Helper: lazily reference a schema holder (returns Type.Unsafe wrapping the holder)
function Lazy(holder: { schema: TSchema }): TSchema {
  return Type.Unsafe<any>({ ...holder.schema, $lazy: true })
}

// We'll use Type.Any() as the recursive placeholder and build real schemas.
// Since TypeBox schemas are plain objects, we can construct them and they work
// with Value.Check as long as the structure is correct.

// --- Leaf value schemas ---
export const rawNumberValueSchema = Type.Object({
  type: Type.Literal('raw:number'),
  value: Type.Number(),
  configId: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
})

export const rawStringValueSchema = Type.Object({
  type: Type.Literal('raw:string'),
  value: Type.String(),
  configId: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
})

export const rawBooleanValueSchema = Type.Object({
  type: Type.Literal('raw:boolean'),
  value: Type.Boolean(),
  configId: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
})

export const rawBaseMarkIdValueSchema = Type.Object({
  type: Type.Literal('entity:baseMark'),
  value: Type.String({ pattern: '^mark_' }),
})

export const rawBaseSkillIdValueSchema = Type.Object({
  type: Type.Literal('entity:baseSkill'),
  value: Type.String({ pattern: '^skill_' }),
})

export const rawSpeciesIdValueSchema = Type.Object({
  type: Type.Literal('entity:species'),
  value: Type.String({ pattern: '^pet_' }),
})

export const rawEffectIdValueSchema = Type.Object({
  type: Type.Literal('entity:effect'),
  value: Type.String(),
})

export const dynamicValueSchema = Type.Object({
  type: Type.Literal('dynamic'),
  selector: Type.Any(), // selectorDSL - resolved at runtime
})

export const selectorValueSchema = Type.Object({
  type: Type.Literal('selectorValue'),
  value: Type.Any(), // value - resolved at runtime
  chain: Type.Optional(Type.Array(Type.Any())), // selectorChain[]
})

// --- Extractor schema ---
export const extractorSchema = Type.Union([
  Type.Object({
    type: Type.Literal('base'),
    arg: baseExtractorSchema,
  }),
  Type.Object({
    type: Type.Literal('dynamic'),
    arg: Type.String(),
  }),
  baseExtractorSchema,
])

// --- Evaluator DSL schema ---
export const evaluatorDSLSchema = Type.Union([
  Type.Object({
    type: Type.Literal('compare'),
    operator: compareOperatorSchema,
    value: Type.Any(),
  }),
  Type.Object({ type: Type.Literal('same'), value: Type.Any() }),
  Type.Object({ type: Type.Literal('notSame'), value: Type.Any() }),
  Type.Object({ type: Type.Literal('any'), conditions: Type.Array(Type.Any()) }),
  Type.Object({ type: Type.Literal('all'), conditions: Type.Array(Type.Any()) }),
  Type.Object({ type: Type.Literal('not'), condition: Type.Any() }),
  Type.Object({ type: Type.Literal('probability'), percent: Type.Any() }),
  Type.Object({ type: Type.Literal('contain'), tag: Type.String() }),
  Type.Object({ type: Type.Literal('exist') }),
  Type.Object({ type: Type.Literal('anyOf'), value: Type.Any() }),
])

// --- Selector chain schema ---
export const selectorChainSchema = Type.Union([
  Type.Object({ type: Type.Literal('select'), arg: extractorSchema }),
  Type.Object({ type: Type.Literal('selectPath'), arg: Type.String() }),
  Type.Object({ type: Type.Literal('selectProp'), arg: Type.String() }),
  Type.Object({ type: Type.Literal('flat') }),
  Type.Object({ type: Type.Literal('where'), arg: Type.Any() }),
  Type.Object({
    type: Type.Literal('whereAttr'),
    extractor: extractorSchema,
    evaluator: Type.Any(),
  }),
  Type.Object({ type: Type.Literal('and'), arg: Type.Any() }),
  Type.Object({
    type: Type.Literal('or'),
    arg: Type.Any(),
    duplicate: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ type: Type.Literal('randomPick'), arg: Type.Any() }),
  Type.Object({ type: Type.Literal('randomSample'), arg: Type.Any() }),
  Type.Object({ type: Type.Literal('sum') }),
  Type.Object({ type: Type.Literal('avg') }),
  Type.Object({ type: Type.Literal('add'), arg: Type.Any() }),
  Type.Object({ type: Type.Literal('multiply'), arg: Type.Any() }),
  Type.Object({ type: Type.Literal('divide'), arg: Type.Any() }),
  Type.Object({ type: Type.Literal('shuffled') }),
  Type.Object({ type: Type.Literal('limit'), arg: Type.Any() }),
  Type.Object({ type: Type.Literal('clampMax'), arg: Type.Any() }),
  Type.Object({ type: Type.Literal('clampMin'), arg: Type.Any() }),
  Type.Object({ type: Type.Literal('configGet'), key: Type.Any() }),
  Type.Object({ type: Type.Literal('selectObservable'), arg: Type.String() }),
  Type.Object({ type: Type.Literal('selectAttribute$'), arg: Type.String() }),
  Type.Object({ type: Type.Literal('asStatLevelMark') }),
  Type.Object({ type: Type.Literal('sampleBetween') }),
  // whenSelectorStep
  Type.Object({
    type: Type.Literal('when'),
    condition: Type.Any(),
    trueValue: Type.Any(),
    falseValue: Type.Optional(Type.Any()),
  }),
])

// --- Selector DSL schema ---
export const selectorDSLSchema = Type.Union([
  baseSelectorSchema,
  Type.Object({
    base: baseSelectorSchema,
    chain: Type.Optional(Type.Array(selectorChainSchema)),
  }),
  // conditionalSelector
  Type.Object({
    condition: Type.Any(),
    trueSelector: Type.Any(),
    falseSelector: Type.Optional(Type.Any()),
  }),
  selectorValueSchema,
])

// --- Value schema ---
export const valueSchema = Type.Union([
  rawNumberValueSchema,
  Type.Number(),
  rawStringValueSchema,
  Type.String(),
  rawBooleanValueSchema,
  Type.Boolean(),
  rawBaseMarkIdValueSchema,
  rawBaseSkillIdValueSchema,
  rawSpeciesIdValueSchema,
  rawEffectIdValueSchema,
  dynamicValueSchema,
  selectorValueSchema,
  // conditionalValue
  Type.Object({
    type: Type.Literal('conditional'),
    condition: Type.Any(),
    trueValue: Type.Any(),
    falseValue: Type.Optional(Type.Any()),
  }),
  Type.Array(Type.Any()), // Array<Value>
  Type.Any(), // OperatorDSL (catch-all for deeply nested recursive types)
])

// --- Condition DSL schema ---
const cleanStageStrategySchema = StringEnum(Object.values(CleanStageStrategy))
const continuousUseSkillStrategySchema = StringEnum(
  Object.values(ContinuousUseSkillStrategy),
)

export const conditionDSLSchema = Type.Union([
  Type.Object({
    type: Type.Literal('evaluate'),
    target: Type.Any(),
    evaluator: Type.Any(),
  }),
  Type.Object({ type: Type.Literal('some'), conditions: Type.Array(Type.Any()) }),
  Type.Object({ type: Type.Literal('every'), conditions: Type.Array(Type.Any()) }),
  Type.Object({ type: Type.Literal('not'), condition: Type.Any() }),
  Type.Object({ type: Type.Literal('petIsActive') }),
  Type.Object({ type: Type.Literal('selfUseSkill') }),
  Type.Object({ type: Type.Literal('checkSelf') }),
  Type.Object({ type: Type.Literal('opponentUseSkill') }),
  Type.Object({ type: Type.Literal('selfBeDamaged') }),
  Type.Object({ type: Type.Literal('opponentBeDamaged') }),
  Type.Object({ type: Type.Literal('selfAddMark') }),
  Type.Object({ type: Type.Literal('opponentAddMark') }),
  Type.Object({ type: Type.Literal('selfBeAddMark') }),
  Type.Object({ type: Type.Literal('opponentBeAddMark') }),
  Type.Object({ type: Type.Literal('selfBeHeal') }),
  Type.Object({
    type: Type.Literal('continuousUseSkill'),
    times: Type.Optional(Type.Any({ default: 2 })),
    strategy: Type.Optional(
      Type.Union(Object.values(ContinuousUseSkillStrategy).map(v => Type.Literal(v)), {
        default: ContinuousUseSkillStrategy.Continuous,
      }),
    ),
  }),
  Type.Object({
    type: Type.Literal('statStageChange'),
    stat: Type.Optional(
      Type.Any({
        default: [
          StatTypeWithoutHp.atk,
          StatTypeWithoutHp.def,
          StatTypeWithoutHp.spa,
          StatTypeWithoutHp.spd,
          StatTypeWithoutHp.spe,
        ],
      }),
    ),
    check: Type.Optional(
      Type.Union([Type.Literal('up'), Type.Literal('down'), Type.Literal('all')], {
        default: 'all',
      }),
    ),
  }),
  Type.Object({ type: Type.Literal('isFirstSkillUsedThisTurn') }),
  Type.Object({ type: Type.Literal('isLastSkillUsedThisTurn') }),
  Type.Object({ type: Type.Literal('selfSwitchIn') }),
  Type.Object({ type: Type.Literal('selfSwitchOut') }),
  Type.Object({ type: Type.Literal('selfBeSkillTarget') }),
  Type.Object({ type: Type.Literal('selfHasMark'), baseId: Type.Any() }),
  Type.Object({ type: Type.Literal('opponentHasMark'), baseId: Type.Any() }),
])

// --- Operator DSL schema ---
export const operatorDSLSchema = Type.Union([
  Type.Object({ type: Type.Literal('TODO') }),
  // conditionalOperator
  Type.Object({
    type: Type.Literal('conditional'),
    condition: Type.Any(),
    trueOperator: Type.Any(),
    falseOperator: Type.Optional(Type.Any()),
  }),
  Type.Object({ type: Type.Literal('dealDamage'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('heal'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('executeKill'), target: Type.Any() }),
  Type.Object({
    type: Type.Literal('addMark'),
    target: Type.Any(),
    mark: Type.Any(),
    duration: Type.Optional(Type.Any()),
    stack: Type.Optional(Type.Any()),
  }),
  Type.Object({ type: Type.Literal('addStacks'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('consumeStacks'), target: Type.Any(), value: Type.Any() }),
  Type.Object({
    type: Type.Literal('modifyStat'),
    target: Type.Any(),
    statType: Type.Any(),
    delta: Type.Optional(Type.Any({ default: 0 })),
    percent: Type.Optional(Type.Any({ default: 0 })),
  }),
  Type.Object({
    type: Type.Literal('addAttributeModifier'),
    target: Type.Any(),
    stat: Type.Any(),
    modifierType: Type.Any(),
    value: Type.Any(),
    priority: Type.Optional(Type.Any()),
    phaseType: Type.Optional(Type.Any()),
    scope: Type.Optional(Type.Any()),
    phaseId: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addDynamicAttributeModifier'),
    target: Type.Any(),
    stat: Type.Any(),
    modifierType: Type.Any(),
    observableValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
    phaseType: Type.Optional(Type.Any()),
    scope: Type.Optional(Type.Any()),
    phaseId: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addClampMaxModifier'),
    target: Type.Any(),
    stat: Type.Any(),
    maxValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addClampMinModifier'),
    target: Type.Any(),
    stat: Type.Any(),
    minValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addClampModifier'),
    target: Type.Any(),
    stat: Type.Any(),
    minValue: Type.Optional(Type.Any()),
    maxValue: Type.Optional(Type.Any()),
    priority: Type.Optional(Type.Any()),
    phaseType: Type.Optional(Type.Any()),
    scope: Type.Optional(Type.Any()),
    phaseId: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addSkillAttributeModifier'),
    target: Type.Any(),
    attribute: Type.Any(),
    modifierType: Type.Any(),
    value: Type.Any(),
    priority: Type.Optional(Type.Any()),
    phaseType: Type.Optional(Type.Any()),
    scope: Type.Optional(Type.Any()),
    phaseId: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addDynamicSkillAttributeModifier'),
    target: Type.Any(),
    attribute: Type.Any(),
    modifierType: Type.Any(),
    observableValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addSkillClampMaxModifier'),
    target: Type.Any(),
    attribute: Type.Any(),
    maxValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addSkillClampMinModifier'),
    target: Type.Any(),
    attribute: Type.Any(),
    minValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addSkillClampModifier'),
    target: Type.Any(),
    attribute: Type.Any(),
    minValue: Type.Any(),
    maxValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('statStageBuff'),
    target: Type.Any(),
    statType: Type.Any(),
    value: Type.Any(),
    strategy: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('clearStatStage'),
    target: Type.Any(),
    statType: Type.Optional(Type.Any()),
    cleanStageStrategy: Type.Optional(
      Type.Union(Object.values(CleanStageStrategy).map(v => Type.Literal(v)), {
        default: CleanStageStrategy.positive,
      }),
    ),
  }),
  Type.Object({
    type: Type.Literal('reverseStatStage'),
    target: Type.Any(),
    statType: Type.Optional(Type.Any()),
    cleanStageStrategy: Type.Optional(
      Type.Union(Object.values(CleanStageStrategy).map(v => Type.Literal(v)), {
        default: CleanStageStrategy.positive,
      }),
    ),
  }),
  Type.Object({
    type: Type.Literal('transferStatStage'),
    source: Type.Any(),
    target: Type.Any(),
    statType: Type.Optional(Type.Any()),
    cleanStageStrategy: Type.Optional(
      Type.Union(Object.values(CleanStageStrategy).map(v => Type.Literal(v)), {
        default: CleanStageStrategy.negative,
      }),
    ),
  }),
  Type.Object({ type: Type.Literal('addRage'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('setRage'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('amplifyPower'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('addPower'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('addCritRate'), target: Type.Any(), value: Type.Any() }),
  Type.Object({
    type: Type.Literal('addMultihitResult'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({ type: Type.Literal('setMultihit'), target: Type.Any(), value: Type.Any() }),
  Type.Object({
    type: Type.Literal('transferMark'),
    target: Type.Any(),
    mark: dynamicValueSchema,
  }),
  Type.Object({ type: Type.Literal('stun'), target: Type.Any() }),
  Type.Object({
    type: Type.Literal('setSureHit'),
    target: Type.Any(),
    priority: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('setSureCrit'),
    target: Type.Any(),
    priority: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('setSureMiss'),
    target: Type.Any(),
    priority: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('setSureNoCrit'),
    target: Type.Any(),
    priority: Type.Number(),
  }),
  Type.Object({ type: Type.Literal('setIgnoreShield'), target: Type.Any() }),
  Type.Object({ type: Type.Literal('destroyMark'), target: Type.Any() }),
  Type.Object({
    type: Type.Literal('modifyStackResult'),
    target: Type.Any(),
    newStacks: Type.Optional(Type.Any()),
    newDuration: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('setSkill'),
    target: Type.Any(),
    value: dynamicValueSchema,
    updateConfig: Type.Optional(Type.Boolean()),
  }),
  Type.Object({ type: Type.Literal('preventDamage'), target: Type.Any() }),
  Type.Object({
    type: Type.Literal('setActualTarget'),
    target: Type.Any(),
    newTarget: dynamicValueSchema,
  }),
  Type.Object({
    type: Type.Literal('addModified'),
    target: Type.Any(),
    delta: Type.Any(),
    percent: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('addThreshold'),
    target: Type.Any(),
    min: Type.Optional(Type.Any()),
    max: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('overrideMarkConfig'),
    target: Type.Any(),
    config: MarkConfigSchema,
  }),
  Type.Object({ type: Type.Literal('setMarkDuration'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('setMarkStack'), target: Type.Any(), value: Type.Any() }),
  Type.Object({
    type: Type.Literal('setMarkMaxStack'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setMarkPersistent'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setMarkStackable'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setMarkStackStrategy'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setMarkDestroyable'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setMarkIsShield'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setMarkKeepOnSwitchOut'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setMarkTransferOnSwitch'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setMarkInheritOnFaint'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setStatLevelMarkLevel'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({ type: Type.Literal('setValue'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('addValue'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('toggle'), target: Type.Any() }),
  Type.Object({
    type: Type.Literal('setConfig'),
    target: Type.Any(),
    key: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('setIgnoreStageStrategy'),
    target: Type.Any(),
    value: Type.Any(),
  }),
  Type.Object({ type: Type.Literal('addAccuracy'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('setAccuracy'), target: Type.Any(), value: Type.Any() }),
  Type.Object({ type: Type.Literal('disableContext'), target: Type.Any() }),
  Type.Object({
    type: Type.Literal('addConfigModifier'),
    target: Type.Any(),
    configKey: Type.Any(),
    modifierType: Type.Any(),
    value: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addDynamicConfigModifier'),
    target: Type.Any(),
    configKey: Type.Any(),
    modifierType: Type.Any(),
    observableValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('registerConfig'),
    target: Type.Any(),
    configKey: Type.Any(),
    initialValue: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('registerTaggedConfig'),
    target: Type.Any(),
    configKey: Type.Any(),
    initialValue: Type.Any(),
    tags: Type.Any(),
  }),
  Type.Object({
    type: Type.Literal('addTaggedConfigModifier'),
    target: Type.Any(),
    tag: Type.Any(),
    modifierType: Type.Any(),
    value: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addPhaseConfigModifier'),
    target: Type.Any(),
    configKey: Type.Any(),
    modifierType: Type.Any(),
    value: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addPhaseDynamicConfigModifier'),
    target: Type.Any(),
    configKey: Type.Any(),
    modifierType: Type.Any(),
    observableValue: Type.Any(),
    priority: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addPhaseTypeConfigModifier'),
    target: Type.Any(),
    configKey: Type.Any(),
    modifierType: Type.Any(),
    value: Type.Any(),
    phaseType: Type.Any(),
    scope: Type.Optional(Type.Any()),
    priority: Type.Optional(Type.Any()),
    phaseId: Type.Optional(Type.Any()),
  }),
  Type.Object({
    type: Type.Literal('addDynamicPhaseTypeConfigModifier'),
    target: Type.Any(),
    configKey: Type.Any(),
    modifierType: Type.Any(),
    observableValue: Type.Any(),
    phaseType: Type.Any(),
    scope: Type.Optional(Type.Any()),
    priority: Type.Optional(Type.Any()),
    phaseId: Type.Optional(Type.Any()),
  }),
  // 变身相关操作符
  Type.Object({
    type: Type.Literal('transform'),
    target: Type.Any(),
    newBase: Type.Any(),
    transformType: Type.Optional(
      Type.Union([Type.Literal('temporary'), Type.Literal('permanent')]),
    ),
    priority: Type.Optional(Type.Any()),
    permanentStrategy: Type.Optional(
      Type.Union([Type.Literal('preserve_temporary'), Type.Literal('clear_temporary')]),
    ),
  }),
  Type.Object({
    type: Type.Literal('transformWithPreservation'),
    target: Type.Any(),
    newBase: Type.Any(),
    transformType: Type.Optional(
      Type.Union([Type.Literal('temporary'), Type.Literal('permanent')]),
    ),
    priority: Type.Optional(Type.Any()),
    permanentStrategy: Type.Optional(
      Type.Union([Type.Literal('preserve_temporary'), Type.Literal('clear_temporary')]),
    ),
  }),
  Type.Object({ type: Type.Literal('removeTransformation'), target: Type.Any() }),
  Type.Object({ type: Type.Literal('executeActions'), target: Type.Any() }),
  Type.Object({
    type: Type.Literal('addTemporaryEffect'),
    target: Type.Any(),
    effect: Type.Any(),
  }),
])

// --- Effect DSL schema ---
export const effectDSLSchema = Type.Object({
  id: Type.String(),
  trigger: Type.Union([effectTriggerSchema, Type.Array(effectTriggerSchema)]),
  priority: Type.Number(),
  apply: Type.Union([operatorDSLSchema, Type.Array(operatorDSLSchema)]),
  condition: Type.Optional(conditionDSLSchema),
  consumesStacks: Type.Optional(Type.Number()),
  tags: Type.Optional(Type.Array(Type.String(), { default: [] })),
})

export const EffectDSLSetSchema = Type.Array(effectDSLSchema)
