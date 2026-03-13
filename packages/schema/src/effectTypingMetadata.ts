import type { EffectDslTypingContract } from './effectTypingContract'

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
  allow: [
    { kind: 'id' },
    { kind: 'owner' },
    { kind: 'scalar' },
    { kind: 'object' },
    { kind: 'propertyRef' },
  ],
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
    },
    selfHasMark: {
      valueFields: {
        baseId: BASE_MARK_REF,
      },
    },
    opponentHasMark: {
      valueFields: {
        baseId: BASE_MARK_REF,
      },
    },
    continuousUseSkill: {
      valueFields: {
        times: NUMERIC,
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
    },
  },
  operator: {
    dealDamage: {
      selectorFields: { target: PET_ID },
      valueFields: { value: NUMERIC },
    },
    heal: {
      selectorFields: { target: PET_ID },
      valueFields: { value: NUMERIC },
    },
    executeKill: {
      selectorFields: { target: PET_ID },
    },
    addMark: {
      selectorFields: {
        target: {
          allow: [
            { kind: 'id', targets: ['pet', 'battle'] },
          ],
        },
      },
      valueFields: {
        mark: BASE_MARK_REF,
        duration: NUMERIC,
        stack: NUMERIC,
      },
    },
    addStacks: {
      selectorFields: { target: MARK_ID },
      valueFields: { value: NUMERIC },
    },
    consumeStacks: {
      selectorFields: { target: MARK_ID },
      valueFields: { value: NUMERIC },
    },
    modifyStackResult: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
      valueFields: {
        newStacks: NUMERIC,
        newDuration: NUMERIC,
      },
    },
    addRage: {
      selectorFields: { target: ANY_ID },
      valueFields: { value: NUMERIC },
    },
    setRage: {
      selectorFields: { target: ANY_ID },
      valueFields: { value: NUMERIC },
    },
    modifyStat: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        statType: STRINGY,
        delta: NUMERIC,
        percent: NUMERIC,
      },
    },
    statStageBuff: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        statType: STRINGY,
        value: NUMERIC,
      },
    },
    clearStatStage: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        statType: STRINGY,
      },
    },
    reverseStatStage: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        statType: STRINGY,
      },
    },
    transferStatStage: {
      selectorFields: {
        source: ANY_ID,
        target: ANY_ID,
      },
      valueFields: {
        statType: STRINGY,
      },
    },
    transferMark: {
      selectorFields: {
        target: PET_ID,
      },
      valueFields: {
        mark: MARK_ID,
      },
    },
    destroyMark: {
      selectorFields: {
        target: MARK_ID,
      },
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
    },
    setActualTarget: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        newTarget: PET_ID,
      },
    },
    amplifyPower: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
    },
    addPower: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
    },
    addCritRate: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
    },
    addMultihitResult: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
    },
    setMultihit: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
    },
    addModified: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
      valueFields: {
        percent: NUMERIC,
        delta: NUMERIC,
      },
    },
    addThreshold: {
      selectorFields: {
        target: DAMAGE_CONTEXT_OWNER,
      },
      valueFields: {
        min: NUMERIC,
        max: NUMERIC,
      },
    },
    overrideMarkConfig: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: {
        config: JSON_RECORD_OBJECT,
      },
    },
    addAccuracy: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
    },
    setAccuracy: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: NUMERIC,
      },
    },
    setIgnoreStageStrategy: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        value: STRINGY,
      },
    },
    setSureHit: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        priority: NUMERIC,
      },
    },
    setSureCrit: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        priority: NUMERIC,
      },
    },
    setSureMiss: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        priority: NUMERIC,
      },
    },
    setSureNoCrit: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
      valueFields: {
        priority: NUMERIC,
      },
    },
    setIgnoreShield: {
      selectorFields: {
        target: USE_SKILL_CONTEXT_OWNER,
      },
    },
    stun: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
    },
    preventDamage: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
    },
    disableContext: {
      selectorFields: {
        target: CONTEXT_OWNER,
      },
    },
    setMarkDuration: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: NUMERIC },
    },
    setMarkStack: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: NUMERIC },
    },
    setMarkMaxStack: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: NUMERIC },
    },
    setMarkPersistent: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
    },
    setMarkStackable: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
    },
    setMarkStackStrategy: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: STRINGY },
    },
    setMarkDestroyable: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
    },
    setMarkIsShield: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
    },
    setMarkKeepOnSwitchOut: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
    },
    setMarkTransferOnSwitch: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
    },
    setMarkInheritOnFaint: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: BOOLEAN },
    },
    setStatLevelMarkLevel: {
      selectorFields: {
        target: ADD_MARK_CONTEXT_OWNER,
      },
      valueFields: { value: NUMERIC },
    },
    addAttributeModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        stat: STRINGY,
        modifierType: STRINGY,
        value: NUMERIC,
        priority: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        phaseId: STRINGY,
      },
    },
    addDynamicAttributeModifier: {
      selectorFields: {
        target: ANY_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        stat: STRINGY,
        modifierType: STRINGY,
        priority: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        phaseId: STRINGY,
      },
    },
    addClampMaxModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        stat: STRINGY,
        maxValue: NUMERIC,
        priority: NUMERIC,
      },
    },
    addClampMinModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        stat: STRINGY,
        minValue: NUMERIC,
        priority: NUMERIC,
      },
    },
    addClampModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        stat: STRINGY,
        minValue: NUMERIC,
        maxValue: NUMERIC,
        priority: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        phaseId: STRINGY,
      },
    },
    addSkillAttributeModifier: {
      selectorFields: { target: SKILL_ID },
      valueFields: {
        attribute: STRINGY,
        modifierType: STRINGY,
        value: NUMERIC,
        priority: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        phaseId: STRINGY,
      },
    },
    addDynamicSkillAttributeModifier: {
      selectorFields: {
        target: SKILL_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        attribute: STRINGY,
        modifierType: STRINGY,
        priority: NUMERIC,
      },
    },
    addSkillClampMaxModifier: {
      selectorFields: { target: SKILL_ID },
      valueFields: {
        attribute: STRINGY,
        maxValue: NUMERIC,
        priority: NUMERIC,
      },
    },
    addSkillClampMinModifier: {
      selectorFields: { target: SKILL_ID },
      valueFields: {
        attribute: STRINGY,
        minValue: NUMERIC,
        priority: NUMERIC,
      },
    },
    addSkillClampModifier: {
      selectorFields: { target: SKILL_ID },
      valueFields: {
        attribute: STRINGY,
        minValue: NUMERIC,
        maxValue: NUMERIC,
        priority: NUMERIC,
      },
    },
    setConfig: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        key: STRINGY,
      },
    },
    registerConfig: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
      },
    },
    registerTaggedConfig: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
        tags: STRING_OR_STRING_ARRAY,
      },
    },
    addConfigModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRINGY,
        value: NUMERIC,
        priority: NUMERIC,
      },
    },
    addDynamicConfigModifier: {
      selectorFields: {
        target: ANY_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRINGY,
        priority: NUMERIC,
      },
    },
    addTaggedConfigModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        tag: STRINGY,
        modifierType: STRINGY,
        value: NUMERIC,
        priority: NUMERIC,
      },
    },
    addPhaseConfigModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRINGY,
        value: NUMERIC,
        priority: NUMERIC,
      },
    },
    addPhaseDynamicConfigModifier: {
      selectorFields: {
        target: ANY_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRINGY,
        priority: NUMERIC,
      },
    },
    addPhaseTypeConfigModifier: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRINGY,
        value: NUMERIC,
        phaseType: STRINGY,
        scope: STRINGY,
        priority: NUMERIC,
        phaseId: STRINGY,
      },
    },
    addDynamicPhaseTypeConfigModifier: {
      selectorFields: {
        target: ANY_ID,
        observableValue: NUMERIC,
      },
      valueFields: {
        configKey: STRINGY,
        modifierType: STRINGY,
        phaseType: STRINGY,
        scope: STRINGY,
        priority: NUMERIC,
        phaseId: STRINGY,
      },
    },
    transform: {
      selectorFields: { target: ANY_ID },
      valueFields: { newBase: BASE_SKILL_REF, priority: NUMERIC },
    },
    transformWithPreservation: {
      selectorFields: { target: ANY_ID },
      valueFields: { newBase: BASE_SKILL_REF, priority: NUMERIC },
    },
    removeTransformation: {
      selectorFields: { target: ANY_ID },
    },
    executeActions: {
      selectorFields: { target: DSL_OPERATOR_OBJECT },
    },
    addTemporaryEffect: {
      selectorFields: { target: ANY_ID },
      valueFields: {
        effect: EFFECT_DEF_ID_OR_OBJECT,
      },
    },
    setValue: {
      selectorFields: { target: PROPERTY_REF },
    },
    addValue: {
      selectorFields: { target: PROPERTY_REF },
      valueFields: { value: NUMERIC },
    },
    toggle: {
      selectorFields: { target: PROPERTY_REF },
    },
  },
} as const satisfies EffectDslTypingContract
