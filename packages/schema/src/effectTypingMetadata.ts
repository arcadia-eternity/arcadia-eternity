import type { EffectDslTypingContract, StringEnumOption } from './effectTypingContract'
import {
  CleanStageStrategy,
  ContinuousUseSkillStrategy,
  IgnoreStageStrategy,
  SetStageStrategy,
  StackStrategy,
  StatTypeWithoutHp,
} from '@arcadia-eternity/const'

// Type-safe enum-to-options mapper.
// Adding a new member to any source enum WITHOUT updating the
// corresponding labels map = TypeScript compile error.  Exhaustive.
function mapEnumOptions<TEnum extends Record<string, string>>(labels: {
  [K in TEnum[keyof TEnum]]: string | { label: string; description?: string }
}): StringEnumOption[] {
  return (Object.entries(labels) as [string, string | { label: string; description?: string }][]).map(
    ([value, info]) => {
      const resolved = typeof info === 'string' ? { label: info } : info
      return { value, label: resolved.label, description: resolved.description } as StringEnumOption
    },
  )
}

// Pseudo-enums (values not in @arcadia-eternity/const yet)
const ModifierType = { add: 'add', multiply: 'multiply', replace: 'replace', set: 'set' } as const
const TransformTypeValues = { temporary: 'temporary', permanent: 'permanent' } as const
const PermanentStrategyValues = {
  preserve_temporary: 'preserve_temporary',
  clear_temporary: 'clear_temporary',
} as const
const StatKey = {
  atk: 'atk',
  def: 'def',
  spa: 'spa',
  spd: 'spd',
  speed: 'speed',
  hp: 'hp',
  hitRate: 'hitRate',
  critRate: 'critRate',
  recoverHp: 'recoverHp',
  damageReduce: 'damageReduce',
  damageBoost: 'damageBoost',
  healBoost: 'healBoost',
} as const

// ── Enum option registries (all type-safe) ──────────────────────────

const ENUM_ModifierType = mapEnumOptions<typeof ModifierType>({
  [ModifierType.add]: '加',
  [ModifierType.multiply]: '乘',
  [ModifierType.replace]: '替换',
  [ModifierType.set]: '设',
})

const ENUM_StatType = mapEnumOptions<typeof StatKey>({
  [StatKey.atk]: '攻击',
  [StatKey.def]: '防御',
  [StatKey.spa]: '特攻',
  [StatKey.spd]: '特防',
  [StatKey.speed]: '速度',
  [StatKey.hp]: '体力',
  [StatKey.hitRate]: '命中率',
  [StatKey.critRate]: '暴击率',
  [StatKey.recoverHp]: '恢复体力',
  [StatKey.damageReduce]: '减伤',
  [StatKey.damageBoost]: '增伤',
  [StatKey.healBoost]: '治疗加成',
})

const ENUM_CleanStageStrategy = mapEnumOptions<typeof CleanStageStrategy>({
  [CleanStageStrategy.all]: '全部',
  [CleanStageStrategy.positive]: '有利',
  [CleanStageStrategy.negative]: '负面',
  [CleanStageStrategy.reverse]: '反转',
})

const ENUM_TransformType = mapEnumOptions<typeof TransformTypeValues>({
  [TransformTypeValues.temporary]: '临时',
  [TransformTypeValues.permanent]: '永久',
})

const ENUM_PermanentStrategy = mapEnumOptions<typeof PermanentStrategyValues>({
  [PermanentStrategyValues.preserve_temporary]: '保留临时效果',
  [PermanentStrategyValues.clear_temporary]: '清除临时效果',
})

const ENUM_IgnoreStageStrategy = mapEnumOptions<typeof IgnoreStageStrategy>({
  [IgnoreStageStrategy.none]: '无',
  [IgnoreStageStrategy.all]: '全部',
  [IgnoreStageStrategy.positive]: '有利',
  [IgnoreStageStrategy.negative]: '负面',
})

const ENUM_ContinuousUseSkillStrategy = mapEnumOptions<typeof ContinuousUseSkillStrategy>({
  [ContinuousUseSkillStrategy.Periodic]: '周期',
  [ContinuousUseSkillStrategy.Once]: '一次',
  [ContinuousUseSkillStrategy.Continuous]: '持续',
})

const ENUM_SetStageStrategy = mapEnumOptions<typeof SetStageStrategy>({
  [SetStageStrategy.add]: '累加',
  [SetStageStrategy.set]: '强制设置',
})

const ENUM_StackStrategy = mapEnumOptions<typeof StackStrategy>({
  [StackStrategy.stack]: '叠加',
  [StackStrategy.refresh]: '刷新',
  [StackStrategy.extend]: '延长',
  [StackStrategy.max]: '取最大',
  [StackStrategy.replace]: '替换',
  [StackStrategy.none]: '无',
  [StackStrategy.remove]: '移除',
})

const ENUM_StatTypeWithoutHp = mapEnumOptions<typeof StatTypeWithoutHp>({
  [StatTypeWithoutHp.atk]: '攻击',
  [StatTypeWithoutHp.def]: '防御',
  [StatTypeWithoutHp.spa]: '特攻',
  [StatTypeWithoutHp.spd]: '特防',
  [StatTypeWithoutHp.spe]: '速度',
})

// ── All string enums union (deduplicated by value) ──────────────────
// Used by evaluators (anyOf/compare/same/notSame) as a baseline
// dropdown when no operator context is available to determine the
// more specific enum to show.
const ALL_STRING_ENUMS: readonly StringEnumOption[] = (() => {
  const seen = new Map<string, StringEnumOption>()
  const registries: { name: string; values: readonly StringEnumOption[] }[] = [
    { name: 'ModifierType', values: ENUM_ModifierType },
    { name: 'StatType', values: ENUM_StatType },
    { name: 'CleanStageStrategy', values: ENUM_CleanStageStrategy },
    { name: 'TransformType', values: ENUM_TransformType },
    { name: 'PermanentStrategy', values: ENUM_PermanentStrategy },
    { name: 'IgnoreStageStrategy', values: ENUM_IgnoreStageStrategy },
    { name: 'ContinuousUseSkillStrategy', values: ENUM_ContinuousUseSkillStrategy },
    { name: 'SetStageStrategy', values: ENUM_SetStageStrategy },
    { name: 'StackStrategy', values: ENUM_StackStrategy },
    { name: 'StatTypeWithoutHp', values: ENUM_StatTypeWithoutHp },
  ]
  for (const { name, values } of registries) {
    for (const opt of values) {
      if (!seen.has(opt.value)) {
        seen.set(opt.value, {
          value: opt.value,
          label: opt.label,
          description: `来源: ${name}`,
        })
      }
    }
  }
  return [...seen.values()]
})()

// ── Constraint helpers ──────────────────────────────────────────────

const STRING_ENUM = (values: readonly StringEnumOption[]) =>
  ({
    allow: [
      { kind: 'scalar' as const, valueTypes: ['string' as const] },
      { kind: 'stringEnum' as const, values },
    ],
  }) as const

const ANY_ID = { allow: [{ kind: 'id' }] } as const
const PET_ID = { allow: [{ kind: 'id', targets: ['pet'] }] } as const
const MARK_ID = { allow: [{ kind: 'id', targets: ['mark'] }] } as const
const SKILL_ID = { allow: [{ kind: 'id', targets: ['skill'] }] } as const
const BASE_MARK_REF = {
  allow: [
    { kind: 'id', targets: ['baseMark'] },
    { kind: 'scalar', valueTypes: ['string'] },
  ],
} as const
const BASE_SKILL_REF = {
  allow: [
    { kind: 'id', targets: ['baseSkill'] },
    { kind: 'scalar', valueTypes: ['string'] },
  ],
} as const
const NUMERIC = { allow: [{ kind: 'scalar', valueTypes: ['number'] }] } as const
const STRINGY = { allow: [{ kind: 'scalar', valueTypes: ['string'] }] } as const
const BOOLEAN = { allow: [{ kind: 'scalar', valueTypes: ['boolean'] }] } as const
const PROPERTY_REF = { allow: [{ kind: 'propertyRef' }] } as const
const ANY_SELECTOR_RESULT = {
  allow: [{ kind: 'id' }, { kind: 'owner' }, { kind: 'scalar' }, { kind: 'object' }, { kind: 'propertyRef' }],
} as const
const JSON_RECORD_OBJECT = {
  allow: [{ kind: 'object', classes: ['json:record'] }],
} as const
const STRING_OR_STRING_ARRAY = {
  allow: [
    { kind: 'scalar', valueTypes: ['string'] },
    { kind: 'object', classes: ['json:stringArray'] },
  ],
} as const
const DSL_OPERATOR_OBJECT = {
  allow: [{ kind: 'object', classes: ['dsl:operator'] }],
} as const
const DSL_EVALUATOR_OBJECT = {
  allow: [{ kind: 'object', classes: ['dsl:evaluator'] }],
} as const
const EFFECT_DEF_ID_OR_OBJECT = {
  allow: [
    { kind: 'id', targets: ['effectDef'] },
    { kind: 'object', classes: ['dsl:effectDef'] },
  ],
} as const
const CONTEXT_OWNER = {
  allow: [
    {
      kind: 'owner',
      owners: [
        'useSkillContext',
        'damageContext',
        'healContext',
        'rageContext',
        'addMarkContext',
        'switchPetContext',
        'turnContext',
        'stackContext',
        'consumeStackContext',
        'effectContext',
      ],
    },
  ],
} as const
const USE_SKILL_CONTEXT_OWNER = {
  allow: [{ kind: 'owner', owners: ['useSkillContext'] }],
} as const
const DAMAGE_CONTEXT_OWNER = {
  allow: [{ kind: 'owner', owners: ['damageContext'] }],
} as const
const ADD_MARK_CONTEXT_OWNER = {
  allow: [{ kind: 'owner', owners: ['addMarkContext'] }],
} as const

export const effectDslTypingMetadata = {
  condition: {
    evaluate: {
      selectorFields: {
        target: ANY_SELECTOR_RESULT,
      },
      valueFields: {
        evaluator: DSL_EVALUATOR_OBJECT,
      },
      requiredFields: ['target', 'evaluator'],
    },
    selfHasMark: {
      valueFields: {
        baseId: BASE_MARK_REF,
      },
      requiredFields: ['baseId'],
    },
    opponentHasMark: {
      valueFields: {
        baseId: BASE_MARK_REF,
      },
      requiredFields: ['baseId'],
    },
    continuousUseSkill: {
      valueFields: {
        times: NUMERIC,
        strategy: STRING_ENUM(ENUM_ContinuousUseSkillStrategy),
      },
    },
    skillSequence: {
      valueFields: {
        maxGap: NUMERIC,
        window: NUMERIC,
      },
    },
  },
  evaluator: {
    probability: {
      valueFields: {
        percent: NUMERIC,
      },
      requiredFields: ['percent'],
    },
    anyOf: {
      valueFields: {
        value: STRING_ENUM(ALL_STRING_ENUMS),
      },
      requiredFields: ['value'],
    },
    compare: {
      valueFields: {
        value: {
          allow: [...ANY_SELECTOR_RESULT.allow, { kind: 'stringEnum' as const, values: ALL_STRING_ENUMS }],
        },
      },
      requiredFields: ['value'],
    },
    same: {
      valueFields: {
        value: {
          allow: [...ANY_SELECTOR_RESULT.allow, { kind: 'stringEnum' as const, values: ALL_STRING_ENUMS }],
        },
      },
      requiredFields: ['value'],
    },
    notSame: {
      valueFields: {
        value: {
          allow: [...ANY_SELECTOR_RESULT.allow, { kind: 'stringEnum' as const, values: ALL_STRING_ENUMS }],
        },
      },
      requiredFields: ['value'],
    },
  },
  operator: {
    dealDamage: {
      selectorFields: { target: PET_ID },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    heal: {
      selectorFields: { target: PET_ID },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    executeKill: {
      selectorFields: { target: PET_ID },
      requiredFields: ['target'],
    },
    addMark: {
      selectorFields: {
        target: {
          allow: [{ kind: 'id', targets: ['pet', 'battle'] }],
        },
      },
      valueFields: {
        mark: BASE_MARK_REF,
        duration: NUMERIC,
        stack: NUMERIC,
      },
      requiredFields: ['target', 'mark'],
    },
    addStacks: {
      selectorFields: { target: MARK_ID },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    conditional: {
      valueFields: {
        condition: { allow: [{ kind: 'object', classes: ['dsl:condition'] }] },
        trueOperator: { allow: [{ kind: 'object', classes: ['dsl:operator'] }] },
        falseOperator: { allow: [{ kind: 'object', classes: ['dsl:operator'] }, { kind: 'scalar' }] },
      },
      requiredFields: ['condition', 'trueOperator'],
    },
    consumeStacks: {
      selectorFields: { target: MARK_ID },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    modifyStackResult: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
      valueFields: {
        newStacks: NUMERIC,
        newDuration: NUMERIC,
      },
      requiredFields: ['target'],
    },
    addRage: {
      selectorFields: { target: ANY_ID },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    setRage: {
      selectorFields: { target: ANY_ID },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    modifyStat: {
      selectorFields: { target: PET_ID },
      valueFields: {
        statType: STRING_ENUM(ENUM_StatTypeWithoutHp),
        delta: NUMERIC,
        percent: NUMERIC,
      },
      requiredFields: ['target', 'statType'],
    },
    statStageBuff: {
      selectorFields: { target: PET_ID },
      valueFields: {
        statType: STRING_ENUM(ENUM_StatTypeWithoutHp),
        value: NUMERIC,
        strategy: STRING_ENUM(ENUM_SetStageStrategy),
      },
      requiredFields: ['target', 'statType', 'value'],
    },
    clearStatStage: {
      selectorFields: { target: PET_ID },
      valueFields: {
        statType: STRING_ENUM(ENUM_StatTypeWithoutHp),
        cleanStageStrategy: STRING_ENUM(ENUM_CleanStageStrategy),
      },
      requiredFields: ['target'],
    },
    reverseStatStage: {
      selectorFields: { target: PET_ID },
      valueFields: {
        statType: STRING_ENUM(ENUM_StatTypeWithoutHp),
        cleanStageStrategy: STRING_ENUM(ENUM_CleanStageStrategy),
      },
      requiredFields: ['target'],
    },
    transferStatStage: {
      selectorFields: {
        source: PET_ID,
        target: PET_ID,
      },
      valueFields: {
        statType: STRING_ENUM(ENUM_StatTypeWithoutHp),
        cleanStageStrategy: STRING_ENUM(ENUM_CleanStageStrategy),
      },
      requiredFields: ['source', 'target'],
    },
    transferMark: {
      selectorFields: {
        target: PET_ID,
      },
      valueFields: {
        mark: MARK_ID,
      },
      requiredFields: ['target', 'mark'],
    },
    destroyMark: {
      selectorFields: {
        target: MARK_ID,
      },
      requiredFields: ['target'],
    },
    setSkill: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: {
          allow: [
            { kind: 'id', targets: ['skill'] },
            { kind: 'scalar', valueTypes: ['string'] },
          ],
        },
      },
      requiredFields: ['target', 'value'],
    },
    setActualTarget: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        newTarget: PET_ID,
      },
      requiredFields: ['target', 'newTarget'],
    },
    amplifyPower: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
      requiredFields: ['target', 'value'],
    },
    addPower: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
      requiredFields: ['target', 'value'],
    },
    addCritRate: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
      requiredFields: ['target', 'value'],
    },
    addMultihitResult: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
      requiredFields: ['target', 'value'],
    },
    setMultihit: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
      requiredFields: ['target', 'value'],
    },
    addModified: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
      valueFields: {
        percent: NUMERIC,
        delta: NUMERIC,
      },
      requiredFields: ['target', 'delta', 'percent'],
    },
    addThreshold: {
      selectorFields: {
        target: DAMAGE_CONTEXT_OWNER,
      },
      valueFields: {
        min: NUMERIC,
        max: NUMERIC,
      },
      requiredFields: ['target'],
    },
    overrideMarkConfig: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: {
        config: JSON_RECORD_OBJECT,
      },
      requiredFields: ['target', 'config'],
    },
    addAccuracy: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
      requiredFields: ['target', 'value'],
    },
    setAccuracy: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
      requiredFields: ['target', 'value'],
    },
    setIgnoreStageStrategy: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: STRING_ENUM(ENUM_IgnoreStageStrategy),
      },
      requiredFields: ['target', 'value'],
    },
    setSureHit: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        priority: NUMERIC,
      },
      requiredFields: ['target', 'priority'],
    },
    setSureCrit: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        priority: NUMERIC,
      },
      requiredFields: ['target', 'priority'],
    },
    setSureMiss: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        priority: NUMERIC,
      },
      requiredFields: ['target', 'priority'],
    },
    setSureNoCrit: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        priority: NUMERIC,
      },
      requiredFields: ['target', 'priority'],
    },
    setIgnoreShield: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      requiredFields: ['target'],
    },
    stun: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
      requiredFields: ['target'],
    },
    preventDamage: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
      requiredFields: ['target'],
    },
    disableContext: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
      requiredFields: ['target'],
    },
    setMarkDuration: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    setMarkStack: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    setMarkMaxStack: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    setMarkPersistent: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
      requiredFields: ['target', 'value'],
    },
    setMarkStackable: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
      requiredFields: ['target', 'value'],
    },
    setMarkStackStrategy: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: STRING_ENUM(ENUM_StackStrategy) },
      requiredFields: ['target', 'value'],
    },
    setMarkDestroyable: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
      requiredFields: ['target', 'value'],
    },
    setMarkIsShield: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
      requiredFields: ['target', 'value'],
    },
    setMarkKeepOnSwitchOut: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
      requiredFields: ['target', 'value'],
    },
    setMarkTransferOnSwitch: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
      requiredFields: ['target', 'value'],
    },
    setMarkInheritOnFaint: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
      requiredFields: ['target', 'value'],
    },
    setStatLevelMarkLevel: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    addAttributeModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        stat: STRING_ENUM(ENUM_StatType),
        modifierType: STRING_ENUM(ENUM_ModifierType),
        value: NUMERIC,
        priority: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        phaseId: STRINGY,
      },
      requiredFields: ['target', 'stat', 'modifierType', 'value'],
    },
    addDynamicAttributeModifier: {
      selectorFields: {
        target: ANY_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        stat: STRING_ENUM(ENUM_StatType),
        modifierType: STRING_ENUM(ENUM_ModifierType),
        priority: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        phaseId: STRINGY,
      },
      requiredFields: ['target', 'observableValue', 'stat', 'modifierType'],
    },
    addClampMaxModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        stat: STRING_ENUM(ENUM_StatType),
        maxValue: NUMERIC,
        priority: NUMERIC,
      },
      requiredFields: ['target', 'stat', 'maxValue'],
    },
    addClampMinModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        stat: STRING_ENUM(ENUM_StatType),
        minValue: NUMERIC,
        priority: NUMERIC,
      },
      requiredFields: ['target', 'stat', 'minValue'],
    },
    addClampModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        stat: STRING_ENUM(ENUM_StatType),
        minValue: NUMERIC,
        maxValue: NUMERIC,
        priority: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        phaseId: STRINGY,
      },
      requiredFields: ['target', 'stat'],
    },
    addSkillAttributeModifier: {
      selectorFields: { target: SKILL_ID },
      valueFields: {
        attribute: STRING_ENUM(ENUM_StatType),
        modifierType: STRING_ENUM(ENUM_ModifierType),
        value: NUMERIC,
        priority: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        phaseId: STRINGY,
      },
      requiredFields: ['target', 'attribute', 'modifierType', 'value'],
    },
    addDynamicSkillAttributeModifier: {
      selectorFields: {
        target: SKILL_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        attribute: STRING_ENUM(ENUM_StatType),
        modifierType: STRING_ENUM(ENUM_ModifierType),
        priority: NUMERIC,
      },
      requiredFields: ['target', 'observableValue', 'attribute', 'modifierType'],
    },
    addSkillClampMaxModifier: {
      selectorFields: { target: SKILL_ID },
      valueFields: {
        attribute: STRING_ENUM(ENUM_StatType),
        maxValue: NUMERIC,
        priority: NUMERIC,
      },
      requiredFields: ['target', 'attribute', 'maxValue'],
    },
    addSkillClampMinModifier: {
      selectorFields: { target: SKILL_ID },
      valueFields: {
        attribute: STRING_ENUM(ENUM_StatType),
        minValue: NUMERIC,
        priority: NUMERIC,
      },
      requiredFields: ['target', 'attribute', 'minValue'],
    },
    addSkillClampModifier: {
      selectorFields: { target: SKILL_ID },
      valueFields: {
        attribute: STRING_ENUM(ENUM_StatType),
        minValue: NUMERIC,
        maxValue: NUMERIC,
        priority: NUMERIC,
      },
      requiredFields: ['target', 'attribute', 'minValue', 'maxValue'],
    },
    setConfig: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        key: STRINGY,
      },
      requiredFields: ['target', 'key'],
    },
    registerConfig: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
      },
      requiredFields: ['target', 'configKey'],
    },
    registerTaggedConfig: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
        tags: STRING_OR_STRING_ARRAY,
      },
      requiredFields: ['target', 'configKey', 'tags'],
    },
    addConfigModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRING_ENUM(ENUM_ModifierType),
        value: NUMERIC,
        priority: NUMERIC,
      },
      requiredFields: ['target', 'configKey', 'modifierType', 'value'],
    },
    addDynamicConfigModifier: {
      selectorFields: {
        target: ANY_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRING_ENUM(ENUM_ModifierType),
        priority: NUMERIC,
      },
      requiredFields: ['target', 'observableValue', 'configKey', 'modifierType'],
    },
    addTaggedConfigModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        tag: STRINGY,
        modifierType: STRING_ENUM(ENUM_ModifierType),
        value: NUMERIC,
        priority: NUMERIC,
      },
      requiredFields: ['target', 'tag', 'modifierType', 'value'],
    },
    addPhaseConfigModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRING_ENUM(ENUM_ModifierType),
        value: NUMERIC,
        priority: NUMERIC,
      },
      requiredFields: ['target', 'configKey', 'modifierType', 'value'],
    },
    addPhaseDynamicConfigModifier: {
      selectorFields: {
        target: ANY_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRING_ENUM(ENUM_ModifierType),
        priority: NUMERIC,
      },
      requiredFields: ['target', 'observableValue', 'configKey', 'modifierType'],
    },
    addPhaseTypeConfigModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRING_ENUM(ENUM_ModifierType),
        value: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        priority: NUMERIC,
        phaseId: STRINGY,
      },
      requiredFields: ['target', 'configKey', 'modifierType', 'value', 'phaseType'],
    },
    addDynamicPhaseTypeConfigModifier: {
      selectorFields: {
        target: ANY_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRING_ENUM(ENUM_ModifierType),
        phaseType: STRINGY,
        scope: STRINGY,
        priority: NUMERIC,
        phaseId: STRINGY,
      },
      requiredFields: ['target', 'observableValue', 'configKey', 'modifierType', 'phaseType'],
    },
    transform: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        newBase: BASE_SKILL_REF,
        priority: NUMERIC,
        transformType: STRING_ENUM(ENUM_TransformType),
        permanentStrategy: STRING_ENUM(ENUM_PermanentStrategy),
      },
      requiredFields: ['target', 'newBase'],
    },
    transformWithPreservation: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        newBase: BASE_SKILL_REF,
        priority: NUMERIC,
        transformType: STRING_ENUM(ENUM_TransformType),
        permanentStrategy: STRING_ENUM(ENUM_PermanentStrategy),
      },
      requiredFields: ['target', 'newBase'],
    },
    removeTransformation: {
      selectorFields: { target: ANY_ID },
      requiredFields: ['target'],
    },
    executeActions: {
      selectorFields: { target: DSL_OPERATOR_OBJECT },
      requiredFields: ['target'],
    },
    addTemporaryEffect: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        effect: EFFECT_DEF_ID_OR_OBJECT,
      },
      requiredFields: ['target', 'effect'],
    },
    setValue: {
      selectorFields: { target: PROPERTY_REF },
      requiredFields: ['target'],
    },
    addValue: {
      selectorFields: { target: PROPERTY_REF },
      valueFields: { value: NUMERIC },
      requiredFields: ['target', 'value'],
    },
    toggle: {
      selectorFields: { target: PROPERTY_REF },
      requiredFields: ['target'],
    },
  },
} as const satisfies EffectDslTypingContract
