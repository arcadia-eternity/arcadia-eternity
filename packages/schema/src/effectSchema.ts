import {
  CleanStageStrategy,
  ContinuousUseSkillStrategy,
  EffectTrigger,
  StatTypeWithoutHp,
} from '@arcadia-eternity/const'
import { BaseSelector, Extractor } from '@arcadia-eternity/effect-builder'
import { z } from 'zod'
import type {
  OperatorDSL,
  ConditionDSL,
  DynamicValue,
  EffectDSL,
  EvaluatorDSL,
  ExtractorDSL,
  RawBooleanValue,
  RawBaseMarkIdValue,
  RawNumberValue,
  RawStringValue,
  SelectorChain,
  SelectorDSL,
  Value,
  RawBaseSkillIdValue,
} from './effectDsl'
import { MarkConfigSchema } from './mark'

const selectorKeys = Object.keys(BaseSelector)
export const baseSelectorSchema = z.enum(selectorKeys as [keyof typeof BaseSelector])

const effectTriggerSchema = z.nativeEnum(EffectTrigger)

const COMPARE_OPERATORS = ['>', '<', '>=', '<=', '=='] as const
const compareOperatorSchema = z.enum(COMPARE_OPERATORS)

const extractorKeys = Object.keys(Extractor)
const baseExtractorSchema = z.enum(extractorKeys as [keyof typeof Extractor])

// const operatorKeys = Object.keys(Operators)
// const operatorSchema = z.enum(operatorKeys as [keyof typeof Operators])

export const rawNumberValueSchema: z.ZodSchema<RawNumberValue> = z.object({
  type: z.literal('raw:number'),
  value: z.number(),
  configId: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export const rawStringValueSchema: z.ZodSchema<RawStringValue> = z.object({
  type: z.literal('raw:string'),
  value: z.string(),
  configId: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export const rawBooleanValueSchema: z.ZodSchema<RawBooleanValue> = z.object({
  type: z.literal('raw:boolean'),
  value: z.boolean(),
  configId: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export const rawBaseMarkIdValueSchema: z.ZodSchema<RawBaseMarkIdValue> = z.object({
  type: z.literal('entity:baseMark'),
  value: z.string().refine(v => v.startsWith('mark_')),
})

export const rawBaseSkillIdValueSchema: z.ZodSchema<RawBaseSkillIdValue> = z.object({
  type: z.literal('entity:baseSkill'),
  value: z.string().refine(v => v.startsWith('skill_'), {
    message: "Skill ID must start with 'skill_'",
  }),
})

export const dynamicValueSchema: z.ZodSchema<DynamicValue> = z.lazy(() =>
  z.object({
    type: z.literal('dynamic'),
    selector: selectorDSLSchema,
  }),
)

const conditionalValueSchema = z.lazy(() =>
  z.object({
    type: z.literal('conditional'),
    condition: conditionDSLSchema,
    trueValue: valueSchema,
    falseValue: valueSchema.optional(),
  }),
)

export const valueSchema: z.ZodSchema<Value> = z.lazy(() =>
  z.union([
    rawNumberValueSchema,
    z.number(),
    rawStringValueSchema,
    z.string(),
    rawBooleanValueSchema,
    z.boolean(),
    rawBaseMarkIdValueSchema,
    rawBaseSkillIdValueSchema,
    dynamicValueSchema,
    conditionalValueSchema,
    z.array(valueSchema),
  ]),
)

export const extractorSchema: z.ZodSchema<ExtractorDSL> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('base'),
      arg: baseExtractorSchema,
    }),
    z.object({
      type: z.literal('dynamic'),
      arg: z.string(),
    }),
    baseExtractorSchema,
  ]),
)

export const selectorChainSchema: z.ZodSchema<SelectorChain> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('select'),
      arg: extractorSchema,
    }),
    z.object({
      type: z.literal('selectPath'),
      arg: z.string(),
    }),
    z.object({
      type: z.literal('selectProp'),
      arg: z.string(),
    }),
    z.object({
      type: z.literal('flat'),
    }),
    z.object({
      type: z.literal('where'),
      arg: evaluatorDSLSchema,
    }),
    z.object({
      type: z.literal('whereAttr'),
      extractor: extractorSchema,
      evaluator: evaluatorDSLSchema,
    }),
    z.object({
      type: z.literal('and'),
      arg: z.lazy(() => selectorDSLSchema),
    }),
    z.object({
      type: z.literal('or'),
      arg: z.lazy(() => selectorDSLSchema),
      duplicate: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('randomPick'),
      arg: valueSchema,
    }),
    z.object({
      type: z.literal('randomSample'),
      arg: valueSchema,
    }),
    z.object({
      type: z.literal('sum'),
    }),
    z.object({
      type: z.literal('add'),
      arg: valueSchema,
    }),
    z.object({
      type: z.literal('multiply'),
      arg: valueSchema,
    }),
    z.object({
      type: z.literal('divide'),
      arg: valueSchema,
    }),
    z.object({
      type: z.literal('shuffled'),
    }),
    z.object({
      type: z.literal('limit'),
      arg: valueSchema,
    }),
    z.object({
      type: z.literal('clampMax'),
      arg: valueSchema,
    }),
    z.object({
      type: z.literal('clampMin'),
      arg: valueSchema,
    }),
    z.object({
      type: z.literal('configGet'),
      key: valueSchema,
    }),
    z.object({
      type: z.literal('selectObservable'),
      arg: z.string(),
    }),
    z.object({
      type: z.literal('selectAttribute$'),
      arg: z.string(),
    }),
    z.object({
      type: z.literal('asStatLevelMark'),
    }),
    whenSelectorStepSchema,
  ]),
)

export const selectorDSLSchema: z.ZodSchema<SelectorDSL> = z.lazy(() =>
  z.union([
    baseSelectorSchema,
    z.object({
      base: baseSelectorSchema,
      chain: z.array(selectorChainSchema).optional(),
    }),
    conditionalSelectorSchema,
  ]),
)

const whenSelectorStepSchema = z.lazy(() =>
  z.object({
    type: z.literal('when'),
    condition: conditionDSLSchema,
    trueValue: z.lazy(() => valueSchema),
    falseValue: z.lazy(() => valueSchema).optional(),
  }),
)

export const evaluatorDSLSchema: z.ZodSchema<EvaluatorDSL> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('compare'),
      operator: compareOperatorSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('same'),
      value: valueSchema,
    }),
    z.object({
      type: z.literal('notSame'),
      value: valueSchema,
    }),
    z.object({
      type: z.literal('any'),
      conditions: z.array(evaluatorDSLSchema),
    }),
    z.object({
      type: z.literal('all'),
      conditions: z.array(evaluatorDSLSchema),
    }),
    z.object({
      type: z.literal('not'),
      condition: evaluatorDSLSchema,
    }),
    z.object({
      type: z.literal('probability'),
      percent: valueSchema,
    }),
    z.object({
      type: z.literal('contain'),
      tag: z.string(),
    }),
    z.object({
      type: z.literal('exist'),
    }),
  ]),
)

export const operatorDSLSchema: z.ZodSchema<OperatorDSL> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('TODO'),
    }),
    conditionalOperatorSchema,
    z.object({
      type: z.literal('dealDamage'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('heal'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('addMark'),
      target: selectorDSLSchema,
      mark: valueSchema,
      duration: valueSchema.optional(),
      stack: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addStacks'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('consumeStacks'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('modifyStat'),
      target: selectorDSLSchema,
      statType: valueSchema,
      delta: valueSchema.default(0),
      percent: valueSchema.default(0),
    }),
    z.object({
      type: z.literal('addAttributeModifier'),
      target: selectorDSLSchema,
      stat: valueSchema,
      modifierType: valueSchema,
      value: valueSchema,
      priority: valueSchema.optional(),
      // 🆕 Phase-aware parameters
      phaseType: valueSchema.optional(),
      scope: valueSchema.optional(),
      phaseId: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addDynamicAttributeModifier'),
      target: selectorDSLSchema,
      stat: valueSchema,
      modifierType: valueSchema,
      observableValue: selectorDSLSchema,
      priority: valueSchema.optional(),
      // 🆕 Phase-aware parameters
      phaseType: valueSchema.optional(),
      scope: valueSchema.optional(),
      phaseId: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addClampMaxModifier'),
      target: selectorDSLSchema,
      stat: valueSchema,
      maxValue: valueSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addClampMinModifier'),
      target: selectorDSLSchema,
      stat: valueSchema,
      minValue: valueSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addClampModifier'),
      target: selectorDSLSchema,
      stat: valueSchema,
      minValue: valueSchema.optional(), // 🆕 Made optional
      maxValue: valueSchema.optional(), // 🆕 Made optional
      priority: valueSchema.optional(),
      // 🆕 Phase-aware parameters
      phaseType: valueSchema.optional(),
      scope: valueSchema.optional(),
      phaseId: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addSkillAttributeModifier'),
      target: selectorDSLSchema,
      attribute: valueSchema,
      modifierType: valueSchema,
      value: valueSchema,
      priority: valueSchema.optional(),
      // 🆕 Phase-aware parameters
      phaseType: valueSchema.optional(),
      scope: valueSchema.optional(),
      phaseId: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addDynamicSkillAttributeModifier'),
      target: selectorDSLSchema,
      attribute: valueSchema,
      modifierType: valueSchema,
      observableValue: selectorDSLSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addSkillClampMaxModifier'),
      target: selectorDSLSchema,
      attribute: valueSchema,
      maxValue: valueSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addSkillClampMinModifier'),
      target: selectorDSLSchema,
      attribute: valueSchema,
      minValue: valueSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addSkillClampModifier'),
      target: selectorDSLSchema,
      attribute: valueSchema,
      minValue: valueSchema,
      maxValue: valueSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('statStageBuff'),
      target: selectorDSLSchema,
      statType: valueSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('clearStatStage'),
      target: selectorDSLSchema,
      statType: valueSchema.optional(),
      cleanStageStrategy: z.nativeEnum(CleanStageStrategy).optional().default(CleanStageStrategy.positive),
    }),
    z.object({
      type: z.literal('transferStatStage'),
      source: selectorDSLSchema,
      target: selectorDSLSchema,
      statType: valueSchema.optional(),
      cleanStageStrategy: z.nativeEnum(CleanStageStrategy).optional().default(CleanStageStrategy.negative),
    }),
    z.object({
      type: z.literal('addRage'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('amplifyPower'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('addPower'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('addCritRate'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('addMultihitResult'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMultihit'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('transferMark'),
      target: selectorDSLSchema,
      mark: dynamicValueSchema,
    }),
    z.object({
      type: z.literal('stun'),
      target: selectorDSLSchema,
    }),
    z.object({
      type: z.literal('setSureHit'),
      target: selectorDSLSchema,
      priority: z.number(),
    }),
    z.object({
      type: z.literal('setSureCrit'),
      target: selectorDSLSchema,
      priority: z.number(),
    }),
    z.object({
      type: z.literal('setSureMiss'),
      target: selectorDSLSchema,
      priority: z.number(),
    }),
    z.object({
      type: z.literal('setSureNoCrit'),
      target: selectorDSLSchema,
      priority: z.number(),
    }),
    z.object({
      type: z.literal('destroyMark'),
      target: selectorDSLSchema,
    }),
    z.object({
      type: z.literal('modifyStackResult'),
      target: selectorDSLSchema,
      newStacks: valueSchema.optional(),
      newDuration: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('setSkill'),
      target: selectorDSLSchema,
      value: dynamicValueSchema,
      updateConfig: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('preventDamage'),
      target: selectorDSLSchema,
    }),
    z.object({
      type: z.literal('setActualTarget'),
      target: selectorDSLSchema,
      newTarget: dynamicValueSchema,
    }),
    z.object({
      type: z.literal('addModified'),
      target: selectorDSLSchema,
      delta: valueSchema,
      percent: valueSchema,
    }),
    z.object({
      type: z.literal('addThreshold'),
      target: selectorDSLSchema,
      min: valueSchema.optional(),
      max: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('overrideMarkConfig'),
      target: selectorDSLSchema,
      config: MarkConfigSchema,
    }),
    z.object({
      type: z.literal('setMarkDuration'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkStack'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkMaxStack'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkPersistent'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkStackable'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkStackStrategy'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkDestroyable'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkIsShield'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkKeepOnSwitchOut'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkTransferOnSwitch'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setMarkInheritOnFaint'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setStatLevelMarkLevel'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setValue'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('addValue'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('toggle'),
      target: selectorDSLSchema,
    }),
    z.object({
      type: z.literal('setConfig'),
      target: selectorDSLSchema,
      key: valueSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setIgnoreStageStrategy'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('addAccuracy'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('setAccuracy'),
      target: selectorDSLSchema,
      value: valueSchema,
    }),
    z.object({
      type: z.literal('disableContext'),
      target: selectorDSLSchema,
    }),
    z.object({
      type: z.literal('addConfigModifier'),
      target: selectorDSLSchema,
      configKey: valueSchema,
      modifierType: valueSchema,
      value: valueSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addDynamicConfigModifier'),
      target: selectorDSLSchema,
      configKey: valueSchema,
      modifierType: valueSchema,
      observableValue: selectorDSLSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('registerConfig'),
      target: selectorDSLSchema,
      configKey: valueSchema,
      initialValue: valueSchema,
    }),
    z.object({
      type: z.literal('registerTaggedConfig'),
      target: selectorDSLSchema,
      configKey: valueSchema,
      initialValue: valueSchema,
      tags: valueSchema,
    }),
    z.object({
      type: z.literal('addTaggedConfigModifier'),
      target: selectorDSLSchema,
      tag: valueSchema,
      modifierType: valueSchema,
      value: valueSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addPhaseConfigModifier'),
      target: selectorDSLSchema,
      configKey: valueSchema,
      modifierType: valueSchema,
      value: valueSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addPhaseDynamicConfigModifier'),
      target: selectorDSLSchema,
      configKey: valueSchema,
      modifierType: valueSchema,
      observableValue: selectorDSLSchema,
      priority: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addPhaseTypeConfigModifier'),
      target: selectorDSLSchema,
      configKey: valueSchema,
      modifierType: valueSchema,
      value: valueSchema,
      phaseType: valueSchema,
      scope: valueSchema.optional(),
      priority: valueSchema.optional(),
      phaseId: valueSchema.optional(),
    }),
    z.object({
      type: z.literal('addDynamicPhaseTypeConfigModifier'),
      target: selectorDSLSchema,
      configKey: valueSchema,
      modifierType: valueSchema,
      observableValue: selectorDSLSchema,
      phaseType: valueSchema,
      scope: valueSchema.optional(),
      priority: valueSchema.optional(),
      phaseId: valueSchema.optional(),
    }),
  ]),
)

const conditionalSelectorSchema = z.lazy(() =>
  z.object({
    condition: conditionDSLSchema,
    trueSelector: z.lazy(() => selectorDSLSchema),
    falseSelector: z.lazy(() => selectorDSLSchema).optional(),
  }),
)

const conditionalOperatorSchema = z.lazy(() =>
  z.object({
    type: z.literal('conditional'),
    condition: conditionDSLSchema,
    trueOperator: z.lazy(() => operatorDSLSchema),
    falseOperator: z.lazy(() => operatorDSLSchema).optional(),
  }),
)

export const conditionDSLSchema: z.ZodSchema<ConditionDSL> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('evaluate'),
      target: selectorDSLSchema,
      evaluator: evaluatorDSLSchema,
    }),
    z.object({
      type: z.literal('some'),
      conditions: z.array(conditionDSLSchema),
    }),
    z.object({
      type: z.literal('every'),
      conditions: z.array(conditionDSLSchema),
    }),
    z.object({
      type: z.literal('not'),
      condition: conditionDSLSchema,
    }),
    z.object({
      type: z.literal('petIsActive'),
    }),
    z.object({
      type: z.literal('selfUseSkill'),
    }),
    z.object({
      type: z.literal('checkSelf'),
    }),
    z.object({
      type: z.literal('foeUseSkill'),
    }),
    z.object({
      type: z.literal('selfBeDamaged'),
    }),
    z.object({
      type: z.literal('foeBeDamaged'),
    }),
    z.object({
      type: z.literal('selfAddMark'),
    }),
    z.object({
      type: z.literal('foeAddMark'),
    }),
    z.object({
      type: z.literal('selfBeAddMark'),
    }),
    z.object({
      type: z.literal('foeBeAddMark'),
    }),
    z.object({
      type: z.literal('selfBeHeal'),
    }),
    z.object({
      type: z.literal('continuousUseSkill'),
      times: valueSchema.default(2),
      strategy: z.nativeEnum(ContinuousUseSkillStrategy).default(ContinuousUseSkillStrategy.Continuous),
    }),
    z.object({
      type: z.literal('statStageChange'),
      stat: valueSchema
        .default([
          StatTypeWithoutHp.atk,
          StatTypeWithoutHp.def,
          StatTypeWithoutHp.spa,
          StatTypeWithoutHp.spd,
          StatTypeWithoutHp.spe,
        ])
        .optional(),
      check: z.enum(['up', 'down', 'all']).default('all').optional(),
    }),
    z.object({
      type: z.literal('isFirstSkillUsedThisTurn'),
    }),
    z.object({
      type: z.literal('isLastSkillUsedThisTurn'),
    }),
    z.object({
      type: z.literal('selfSwitchIn'),
    }),
    z.object({
      type: z.literal('selfSwitchOut'),
    }),
    z.object({
      type: z.literal('selfBeSkillTarget'),
    }),
  ]),
)

export const effectDSLSchema: z.ZodSchema<EffectDSL> = z.lazy(() =>
  z.object({
    id: z.string(),
    trigger: effectTriggerSchema,
    priority: z.number(),
    apply: z.union([operatorDSLSchema, z.array(operatorDSLSchema)]),
    condition: conditionDSLSchema.optional(),
    consumesStacks: z.number().optional(),
    tags: z.array(z.string()).optional().default([]),
  }),
)

export const EffectDSLSetSchema = z.array(effectDSLSchema)
