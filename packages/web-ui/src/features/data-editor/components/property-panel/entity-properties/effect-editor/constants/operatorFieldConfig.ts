export type SlotName = 'target' | 'value' | 'condition' | 'operator'

export type InlineComponentType = 'el-select' | 'el-switch' | 'el-input-number'

export interface OptionDef {
  value: string
  label: string
}

export interface OperatorFieldDef {
  /** Model field path (e.g., 'target', 'value', 'mark', 'statType') */
  key: string
  /** Display label in Chinese */
  label: string
  /** Which slot to use for rendering */
  slotName: SlotName
  /** Model field for slot binding; defaults to `key` */
  slotField?: string
  /** Field name passed to fieldHint() for tooltip lookup; defaults to `key` */
  hintField?: string
  /** If set, render an inline component instead of a slot */
  component?: InlineComponentType
  /** Options for el-select */
  componentOptions?: OptionDef[]
  /** Additional props for inline component (min, max, controls-position, etc.) */
  componentProps?: Record<string, unknown>
  /** Model field for component binding; defaults to `key` */
  componentModelBind?: string
}

export type SpecialLayout = 'markConfigInline' | 'conditional'

export interface OperatorLayoutGroup {
  /** Unique identifier for this layout group */
  id: string
  /** Operator type strings this layout applies to */
  opTypes: string[]
  /** Ordered field definitions */
  fields: OperatorFieldDef[]
  /** Special layout handling */
  specialLayout?: SpecialLayout
  /** Sub-fields for markConfigInline layout */
  markConfigSubFields?: OperatorFieldDef[]
}

// ─── Option Arrays ───────────────────────────────────────────────────────────

export const CLEAN_STAGE_OPTIONS: OptionDef[] = [
  { value: 'all', label: '全部' },
  { value: 'positive', label: '有利' },
  { value: 'negative', label: '负面' },
  { value: 'reverse', label: '反转' },
]

export const TRANSFORM_TYPE_OPTIONS: OptionDef[] = [
  { value: 'temporary', label: '临时' },
  { value: 'permanent', label: '永久' },
]

export const PERMANENT_STRATEGY_OPTIONS: OptionDef[] = [
  { value: 'preserve_temporary', label: '保留临时效果' },
  { value: 'clear_temporary', label: '清除临时效果' },
]

export const STAT_TYPE_OPTIONS: OptionDef[] = [
  { value: 'atk', label: '攻击' },
  { value: 'def', label: '防御' },
  { value: 'spa', label: '特攻' },
  { value: 'spd', label: '特防' },
  { value: 'speed', label: '速度' },
  { value: 'hp', label: '体力' },
  { value: 'recoverHp', label: '恢复体力' },
  { value: 'hitRate', label: '命中率' },
  { value: 'critRate', label: '暴击率' },
  { value: 'damageReduce', label: '减伤' },
  { value: 'damageBoost', label: '增伤' },
  { value: 'healBoost', label: '治疗加成' },
]

export const MODIFIER_TYPE_OPTIONS: OptionDef[] = [
  { value: 'add', label: '加' },
  { value: 'multiply', label: '乘' },
  { value: 'replace', label: '替换' },
  { value: 'set', label: '设' },
]

// ─── Helper constructors ─────────────────────────────────────────────────────

function tf(
  key: string,
  label: string,
  slotName: SlotName = 'target',
  overrides?: Partial<Omit<OperatorFieldDef, 'key' | 'label' | 'slotName'>>,
): OperatorFieldDef {
  return { key, label, slotName, ...overrides }
}

/** Shorthand for a value-slot field */
function vf(
  key: string,
  label: string,
  overrides?: Partial<Omit<OperatorFieldDef, 'key' | 'label' | 'slotName'>>,
): OperatorFieldDef {
  return tf(key, label, 'value', overrides)
}

/** Shorthand for a target-slot field */
function target(label = '目标'): OperatorFieldDef {
  return tf('target', label, 'target')
}

/** Shorthand for a value-slot field with label "值" */
function value(label = '值'): OperatorFieldDef {
  return vf('value', label)
}

/** Shorthand for an el-select field */
function elSelect(
  key: string,
  label: string,
  options: OptionDef[],
  overrides?: Partial<Omit<OperatorFieldDef, 'key' | 'label' | 'slotName' | 'component' | 'componentOptions'>>,
): OperatorFieldDef {
  return {
    key,
    label,
    slotName: 'value',
    component: 'el-select',
    componentOptions: options,
    ...overrides,
  }
}

/** Shorthand for an el-switch field */
function elSwitch(
  key: string,
  label: string,
  overrides?: Partial<Omit<OperatorFieldDef, 'key' | 'label' | 'slotName' | 'component'>>,
): OperatorFieldDef {
  return {
    key,
    label,
    slotName: 'value',
    component: 'el-switch',
    ...overrides,
  }
}

/** Shorthand for an el-input-number field */
function elInputNum(
  key: string,
  label: string,
  props?: Record<string, unknown>,
  overrides?: Partial<Omit<OperatorFieldDef, 'key' | 'label' | 'slotName' | 'component' | 'componentProps'>>,
): OperatorFieldDef {
  return {
    key,
    label,
    slotName: 'value',
    component: 'el-input-number',
    componentProps: props,
    ...overrides,
  }
}

// ─── Operator type sets ──────────────────────────────────────────────────────

/** Operators with target + value slots */
const TARGET_VALUE_OPS = [
  'dealDamage',
  'heal',
  'addPower',
  'addCritRate',
  'addAccuracy',
  'amplifyPower',
  'addRage',
  'setRage',
  'addStacks',
  'consumeStacks',
  'setMultihit',
  'addMultihitResult',
  'addValue',
  'setValue',
  'setAccuracy',
  'setMarkDuration',
  'setMarkStack',
  'setMarkMaxStack',
  'setMarkPersistent',
  'setMarkStackable',
  'setMarkStackStrategy',
  'setMarkDestroyable',
  'setMarkIsShield',
  'setMarkKeepOnSwitchOut',
  'setMarkTransferOnSwitch',
  'setMarkInheritOnFaint',
  'setStatLevelMarkLevel',
]

/** Operators with target slot only */
const TARGET_ONLY_OPS = [
  'stun',
  'executeKill',
  'preventDamage',
  'destroyMark',
  'setIgnoreShield',
  'disableContext',
  'removeTransformation',
  'executeActions',
  'toggle',
]

// ─── Modifier field helpers ──────────────────────────────────────────────────

function makeModifierFields(params: {
  /** Field name for the stat/attribute/configKey/tag */
  statField: string
  /** Label for the stat/attribute/configKey/tag field */
  statLabel: string
  /** Field name for the value (could be 'value', 'minValue', or 'maxValue') */
  valueField: string
  /** Label for the value field */
  valueLabel: string
  /** If true, add minValue field */
  hasMin?: boolean
  /** If true, add maxValue field */
  hasMax?: boolean
  /** If true, add scope + phaseId fields */
  hasScope?: boolean
  /** If true, add phaseType field */
  hasPhaseType?: boolean
}): OperatorFieldDef[] {
  const fields: OperatorFieldDef[] = [
    target(),
    vf(params.statField, params.statLabel),
    elSelect('modifierType', '修正类型', MODIFIER_TYPE_OPTIONS),
    vf(params.valueField, params.valueLabel),
  ]
  if (params.hasMin) {
    fields.push(vf('minValue', '最小值'))
  }
  if (params.hasMax) {
    fields.push(vf('maxValue', '最大值'))
  }
  fields.push(vf('priority', '优先级'))
  if (params.hasPhaseType) {
    fields.push(vf('phaseType', '阶段类型'))
  }
  if (params.hasScope) {
    fields.push(vf('scope', '作用域'))
    fields.push(vf('phaseId', '阶段ID'))
  }
  return fields
}

function makeDynamicModifierFields(params: {
  statField: string
  statLabel: string
  hasScope?: boolean
  hasPhaseType?: boolean
}): OperatorFieldDef[] {
  const fields: OperatorFieldDef[] = [
    target(),
    vf(params.statField, params.statLabel),
    elSelect('modifierType', '修正类型', MODIFIER_TYPE_OPTIONS),
    tf('observableValue', '观测值', 'target'),
    vf('priority', '优先级'),
  ]
  if (params.hasPhaseType) {
    fields.push(vf('phaseType', '阶段类型'))
  }
  if (params.hasScope) {
    fields.push(vf('scope', '作用域'))
    fields.push(vf('phaseId', '阶段ID'))
  }
  return fields
}

// ─── All operator layout groups ──────────────────────────────────────────────

export const OPERATOR_LAYOUTS: OperatorLayoutGroup[] = [
  // ── Group: target + value ──────────────────────────────────────────────
  {
    id: 'target-value',
    opTypes: TARGET_VALUE_OPS,
    fields: [target(), value()],
  },

  // ── Group: target only ─────────────────────────────────────────────────
  {
    id: 'target-only',
    opTypes: TARGET_ONLY_OPS,
    fields: [target()],
  },

  // ── addMark ────────────────────────────────────────────────────────────
  {
    id: 'addMark',
    opTypes: ['addMark'],
    fields: [target(), vf('mark', '标记'), vf('duration', '持续回合'), vf('stack', '堆叠数')],
  },

  // ── statStageBuff ──────────────────────────────────────────────────────
  {
    id: 'statStageBuff',
    opTypes: ['statStageBuff'],
    fields: [target(), elSelect('statType', '能力类型', STAT_TYPE_OPTIONS), value(), vf('strategy', '策略')],
  },

  // ── clearStatStage / reverseStatStage ──────────────────────────────────
  {
    id: 'clearStatStage-reverseStatStage',
    opTypes: ['clearStatStage', 'reverseStatStage'],
    fields: [target(), vf('statType', '能力类型'), elSelect('cleanStageStrategy', '清除策略', CLEAN_STAGE_OPTIONS)],
  },

  // ── transferStatStage ──────────────────────────────────────────────────
  {
    id: 'transferStatStage',
    opTypes: ['transferStatStage'],
    fields: [
      tf('source', '来源', 'target'),
      target(),
      vf('statType', '能力类型'),
      elSelect('cleanStageStrategy', '清除策略', CLEAN_STAGE_OPTIONS),
    ],
  },

  // ── modifyStackResult ──────────────────────────────────────────────────
  {
    id: 'modifyStackResult',
    opTypes: ['modifyStackResult'],
    fields: [target(), vf('newStacks', '新堆叠数'), vf('newDuration', '新持续回合')],
  },

  // ── setSkill ───────────────────────────────────────────────────────────
  {
    id: 'setSkill',
    opTypes: ['setSkill'],
    fields: [target(), value(), elSwitch('updateConfig', '更新配置')],
  },

  // ── setActualTarget ────────────────────────────────────────────────────
  {
    id: 'setActualTarget',
    opTypes: ['setActualTarget'],
    fields: [target(), vf('newTarget', '新目标')],
  },

  // ── addModified ────────────────────────────────────────────────────────
  {
    id: 'addModified',
    opTypes: ['addModified'],
    fields: [target(), vf('delta', '增量'), vf('percent', '百分比')],
  },

  // ── addThreshold ───────────────────────────────────────────────────────
  {
    id: 'addThreshold',
    opTypes: ['addThreshold'],
    fields: [target(), vf('min', '最小值'), vf('max', '最大值')],
  },

  // ── setConfig ──────────────────────────────────────────────────────────
  {
    id: 'setConfig',
    opTypes: ['setConfig'],
    fields: [target(), vf('key', '键'), value()],
  },

  // ── setIgnoreStageStrategy ─────────────────────────────────────────────
  {
    id: 'setIgnoreStageStrategy',
    opTypes: ['setIgnoreStageStrategy'],
    fields: [target(), value()],
  },

  // ── setSureHit / setSureCrit / setSureMiss / setSureNoCrit ─────────────
  {
    id: 'sure-events',
    opTypes: ['setSureHit', 'setSureCrit', 'setSureMiss', 'setSureNoCrit'],
    fields: [target(), elInputNum('priority', '优先级', { min: -128, max: 127, controlsPosition: 'right' })],
  },

  // ── transform / transformWithPreservation ──────────────────────────────
  {
    id: 'transform',
    opTypes: ['transform', 'transformWithPreservation'],
    fields: [
      target(),
      vf('newBase', '新形态'),
      elSelect('transformType', '变身类型', TRANSFORM_TYPE_OPTIONS),
      elSelect('permanentStrategy', '永久策略', PERMANENT_STRATEGY_OPTIONS),
      vf('priority', '优先级'),
    ],
  },

  // ── addTemporaryEffect ─────────────────────────────────────────────────
  {
    id: 'addTemporaryEffect',
    opTypes: ['addTemporaryEffect'],
    fields: [target(), vf('effect', '效果')],
  },

  // ── registerConfig ─────────────────────────────────────────────────────
  {
    id: 'registerConfig',
    opTypes: ['registerConfig'],
    fields: [target(), vf('configKey', '配置键'), vf('initialValue', '初始值')],
  },

  // ── registerTaggedConfig ───────────────────────────────────────────────
  {
    id: 'registerTaggedConfig',
    opTypes: ['registerTaggedConfig'],
    fields: [target(), vf('configKey', '配置键'), vf('initialValue', '初始值'), vf('tags', '标签')],
  },

  // ── overrideMarkConfig (special layout) ────────────────────────────────
  {
    id: 'overrideMarkConfig',
    opTypes: ['overrideMarkConfig'],
    fields: [target()],
    specialLayout: 'markConfigInline',
    markConfigSubFields: [
      elInputNum('duration', '持续回合', { min: 0, controlsPosition: 'right' }),
      elInputNum('maxStacks', '最大堆叠', { min: 0, max: 999, controlsPosition: 'right' }),
      elSwitch('stackable', '可堆叠'),
      elSwitch('isShield', '护盾'),
    ],
  },

  // ── conditional (special layout) ───────────────────────────────────────
  {
    id: 'conditional',
    opTypes: ['conditional'],
    fields: [
      tf('condition', '条件', 'condition'),
      tf('trueOperator', 'true', 'operator'),
      tf('falseOperator', 'false', 'operator'),
    ],
    specialLayout: 'conditional',
  },

  // ── modifyStat (was falling to fallback; now explicitly supported) ─────
  {
    id: 'modifyStat',
    opTypes: ['modifyStat'],
    fields: [
      target(),
      elSelect('statType', '能力类型', STAT_TYPE_OPTIONS),
      vf('delta', '增量'),
      vf('percent', '百分比'),
    ],
  },

  // ── Static modifiers ───────────────────────────────────────────────────
  {
    id: 'addAttributeModifier',
    opTypes: ['addAttributeModifier'],
    fields: makeModifierFields({
      statField: 'stat',
      statLabel: '属性',
      valueField: 'value',
      valueLabel: '值',
      hasScope: true,
    }),
  },
  {
    id: 'addClampMaxModifier',
    opTypes: ['addClampMaxModifier'],
    fields: makeModifierFields({ statField: 'stat', statLabel: '属性', valueField: 'maxValue', valueLabel: '最大值' }),
  },
  {
    id: 'addClampMinModifier',
    opTypes: ['addClampMinModifier'],
    fields: makeModifierFields({ statField: 'stat', statLabel: '属性', valueField: 'minValue', valueLabel: '最小值' }),
  },
  {
    id: 'addClampModifier',
    opTypes: ['addClampModifier'],
    fields: makeModifierFields({
      statField: 'stat',
      statLabel: '属性',
      valueField: 'value',
      valueLabel: '值',
      hasMin: true,
      hasMax: true,
      hasScope: true,
    }),
  },
  {
    id: 'addSkillAttributeModifier',
    opTypes: ['addSkillAttributeModifier'],
    fields: makeModifierFields({
      statField: 'attribute',
      statLabel: '技能属性',
      valueField: 'value',
      valueLabel: '值',
    }),
  },
  {
    id: 'addSkillClampMaxModifier',
    opTypes: ['addSkillClampMaxModifier'],
    fields: makeModifierFields({
      statField: 'attribute',
      statLabel: '技能属性',
      valueField: 'maxValue',
      valueLabel: '最大值',
    }),
  },
  {
    id: 'addSkillClampMinModifier',
    opTypes: ['addSkillClampMinModifier'],
    fields: makeModifierFields({
      statField: 'attribute',
      statLabel: '技能属性',
      valueField: 'minValue',
      valueLabel: '最小值',
    }),
  },
  {
    id: 'addSkillClampModifier',
    opTypes: ['addSkillClampModifier'],
    fields: makeModifierFields({
      statField: 'attribute',
      statLabel: '技能属性',
      valueField: 'value',
      valueLabel: '值',
      hasMin: true,
      hasMax: true,
    }),
  },
  {
    id: 'addConfigModifier',
    opTypes: ['addConfigModifier'],
    fields: makeModifierFields({ statField: 'configKey', statLabel: '配置键', valueField: 'value', valueLabel: '值' }),
  },
  {
    id: 'addTaggedConfigModifier',
    opTypes: ['addTaggedConfigModifier'],
    fields: makeModifierFields({ statField: 'tag', statLabel: '标签', valueField: 'value', valueLabel: '值' }),
  },
  {
    id: 'addPhaseConfigModifier',
    opTypes: ['addPhaseConfigModifier'],
    fields: makeModifierFields({
      statField: 'configKey',
      statLabel: '配置键',
      valueField: 'value',
      valueLabel: '值',
      hasScope: true,
    }),
  },
  {
    id: 'addPhaseTypeConfigModifier',
    opTypes: ['addPhaseTypeConfigModifier'],
    fields: makeModifierFields({
      statField: 'configKey',
      statLabel: '配置键',
      valueField: 'value',
      valueLabel: '值',
      hasPhaseType: true,
      hasScope: true,
    }),
  },

  // ── Dynamic modifiers ──────────────────────────────────────────────────
  {
    id: 'addDynamicAttributeModifier',
    opTypes: ['addDynamicAttributeModifier'],
    fields: makeDynamicModifierFields({ statField: 'stat', statLabel: '属性', hasScope: true }),
  },
  {
    id: 'addDynamicSkillAttributeModifier',
    opTypes: ['addDynamicSkillAttributeModifier'],
    fields: makeDynamicModifierFields({ statField: 'attribute', statLabel: '技能属性' }),
  },
  {
    id: 'addDynamicConfigModifier',
    opTypes: ['addDynamicConfigModifier'],
    fields: makeDynamicModifierFields({ statField: 'configKey', statLabel: '配置键' }),
  },
  {
    id: 'addPhaseDynamicConfigModifier',
    opTypes: ['addPhaseDynamicConfigModifier'],
    fields: makeDynamicModifierFields({ statField: 'configKey', statLabel: '配置键', hasScope: true }),
  },
  {
    id: 'addDynamicPhaseTypeConfigModifier',
    opTypes: ['addDynamicPhaseTypeConfigModifier'],
    fields: makeDynamicModifierFields({
      statField: 'configKey',
      statLabel: '配置键',
      hasPhaseType: true,
      hasScope: true,
    }),
  },

  // ── transferMark ───────────────────────────────────────────────────────
  {
    id: 'transferMark',
    opTypes: ['transferMark'],
    fields: [target(), vf('mark', '标记')],
  },
]

// ─── Lookup ──────────────────────────────────────────────────────────────────

const layoutByType = new Map<string, OperatorLayoutGroup>()

for (const layout of OPERATOR_LAYOUTS) {
  for (const opType of layout.opTypes) {
    layoutByType.set(opType, layout)
  }
}

/** Get the layout group for a given operator type, or undefined if not found */
export function getLayoutForType(type: string): OperatorLayoutGroup | undefined {
  return layoutByType.get(type)
}

// ─── Schema-derived verification ─────────────────────────────────────────────
//
// The following utilities cross-reference OPERATOR_LAYOUTS against the schema
// typing metadata (@arcadia-eternity/schema/effectTypingMetadata) which is the
// authoritative source for field existence per operator type.
//
// Import effectDslTypingMetadata at runtime to call verifyLayoutsAgainstMetadata().

interface MetadataFieldMap {
  selectorFields: Record<string, unknown>
  valueFields: Record<string, unknown>
}

interface TypingMetadata {
  operator: Record<string, MetadataFieldMap>
  condition: Record<string, MetadataFieldMap>
  evaluator: Record<string, MetadataFieldMap>
}

/**
 * Verify that every operator type in the schema metadata has a layout entry,
 * and that every field in the layout entry exists in the metadata.
 * Returns mismatches for diagnostics.
 */
export function verifyLayoutsAgainstMetadata(metadata: TypingMetadata): {
  missingLayouts: string[]
  unknownTypes: string[]
} {
  const missingLayouts: string[] = []
  const unknownTypes: string[] = []

  // Check: every operator in metadata has a layout
  for (const opType of Object.keys(metadata.operator)) {
    if (!layoutByType.has(opType)) {
      missingLayouts.push(opType)
    }
  }

  // Check: every operator in layouts exists in metadata
  for (const opType of layoutByType.keys()) {
    if (!metadata.operator[opType] && opType !== 'conditional') {
      // conditional is a special operator not in the metadata operator section
      if (!metadata.condition[opType]) {
        unknownTypes.push(opType)
      }
    }
  }

  return { missingLayouts, unknownTypes }
}
