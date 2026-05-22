import { getEffectDslManifest } from '@arcadia-eternity/schema'
import type { OperatorDSL, OperatorDSLView } from '@arcadia-eternity/schema'

export interface FieldConfig {
  key: keyof OperatorDSLView
  label: string
  kind: 'selector' | 'value' | 'condition' | 'evaluator' | 'operator' | 'inline'
  optional?: boolean // true if the field is NOT in requiredFields
  component?: 'el-select' | 'el-switch' | 'el-input-number'
  componentOptions?: readonly { value: string; label: string }[]
  componentProps?: Record<string, unknown>
}

type OpField = keyof OperatorDSLView

const FIELD_LABELS: Partial<Record<OpField, string>> = {
  target: '目标',
  value: '值',
  mark: '标记',
  duration: '持续回合',
  stat: '属性',
  modifierType: '修正类型',
  priority: '优先级',
  statType: '能力类型',
  source: '来源',
  newBase: '新物种',
  stack: '堆叠数',
  attribute: '属性',
  observableValue: '可观察值',
  newTarget: '新目标',
  condition: '条件',
  trueOperator: '真分支',
  falseOperator: '假分支',
  config: '配置',
  configKey: '配置键',
  initialValue: '初始值',
  tags: '标签',
  tag: '标签',
  effect: '效果',
  delta: '增量',
  percent: '百分比',
  min: '最小值',
  max: '最大值',
  maxValue: '上限值',
  minValue: '下限值',
  newDuration: '新持续',
  newStacks: '新堆叠数',
  strategy: '策略',
}

// ── Inline field configurations (fields that render el-select/switches, not DslNode) ──
const MODIFIER_TYPE_OPTIONS = [
  { value: 'add', label: '加' },
  { value: 'multiply', label: '乘' },
  { value: 'replace', label: '替换' },
  { value: 'set', label: '设置' },
]

const STAT_TYPE_OPTIONS = [
  { value: 'hp', label: 'hp' },
  { value: 'attack', label: 'attack' },
  { value: 'defense', label: 'defense' },
  { value: 'spAttack', label: 'spAttack' },
  { value: 'spDefense', label: 'spDefense' },
  { value: 'speed', label: 'speed' },
]

const STAT_TYPE_WITHOUT_HP_OPTIONS = [
  { value: 'attack', label: 'attack' },
  { value: 'defense', label: 'defense' },
  { value: 'spAttack', label: 'spAttack' },
  { value: 'spDefense', label: 'spDefense' },
  { value: 'speed', label: 'speed' },
]

const STACK_STRATEGY_OPTIONS = [
  { value: 'add', label: 'add' },
  { value: 'max', label: 'max' },
  { value: 'replace', label: 'replace' },
]

const CLEAN_STAGE_STRATEGY_OPTIONS = [
  { value: 'all', label: 'all' },
  { value: 'positive', label: 'positive' },
  { value: 'negative', label: 'negative' },
]

// Map of `${operatorType}@${fieldName}` → inline FieldConfig
const INLINE_FIELDS: Record<string, FieldConfig> = {
  'addAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addAttributeModifier@stat': {
    key: 'stat',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'addDynamicAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addDynamicAttributeModifier@stat': {
    key: 'stat',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'addSkillAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addDynamicSkillAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addClampMaxModifier@stat': {
    key: 'stat',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'addClampMinModifier@stat': {
    key: 'stat',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'addClampModifier@stat': {
    key: 'stat',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'addSkillClampMaxModifier@attribute': {
    key: 'attribute',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'addSkillClampMinModifier@attribute': {
    key: 'attribute',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'addSkillClampModifier@attribute': {
    key: 'attribute',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'statStageBuff@statType': {
    key: 'statType',
    label: '能力类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_WITHOUT_HP_OPTIONS,
  },
  'clearStatStage@statType': {
    key: 'statType',
    label: '能力类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_WITHOUT_HP_OPTIONS,
  },
  'reverseStatStage@statType': {
    key: 'statType',
    label: '能力类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_WITHOUT_HP_OPTIONS,
  },
  'transferStatStage@statType': {
    key: 'statType',
    label: '能力类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_WITHOUT_HP_OPTIONS,
  },
  'addConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addDynamicConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addTaggedConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addPhaseConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addPhaseDynamicConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addPhaseTypeConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'addDynamicPhaseTypeConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: MODIFIER_TYPE_OPTIONS,
  },
  'setMarkStackStrategy@value': {
    key: 'value',
    label: '策略',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STACK_STRATEGY_OPTIONS,
  },
  'setIgnoreStageStrategy@value': {
    key: 'value',
    label: '策略',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CLEAN_STAGE_STRATEGY_OPTIONS,
  },
}

// Fields that should render DslNode kind='evaluator' instead of 'value'
const EVALUATOR_FIELDS = new Set(['condition'])

/**
 * Get the field configuration for a specific operator type and field name.
 * Auto-derives kind='selector' or kind='value' from the manifest.
 * Falls back to inline config if defined.
 */
export function getFieldConfig(opType: OperatorDSL['type'], fieldName: string): FieldConfig {
  const fk = fieldName as OpField
  const inlineKey = `${opType}@${fieldName}`
  const inline = INLINE_FIELDS[inlineKey]

  const manifest = getEffectDslManifest()
  const nodeTyping = manifest.operator[opType]
  const label = FIELD_LABELS[fk] ?? fieldName
  const optional = nodeTyping?.requiredFields ? !nodeTyping.requiredFields.includes(fieldName) : false

  if (inline) return { ...inline, optional }

  if (nodeTyping?.selectorFields?.[fieldName]) {
    return { key: fk, label, kind: 'selector', optional }
  }
  if (nodeTyping?.valueFields?.[fieldName]) {
    return { key: fk, label, kind: 'value', optional }
  }

  if (EVALUATOR_FIELDS.has(fieldName)) {
    return { key: fk, label, kind: 'evaluator', optional }
  }
  if (fieldName === 'trueOperator' || fieldName === 'falseOperator') {
    return { key: fk, label, kind: 'operator', optional }
  }
  if (fieldName === 'condition' && opType === 'conditional') {
    return { key: fk, label, kind: 'evaluator', optional }
  }

  return { key: fk, label, kind: 'value', optional }
}

/**
 * Get the ordered list of fields for an operator type.
 * Order: selectorFields first, then valueFields, from the manifest.
 * Falls back to all nodeTyping fields if manifest doesn't have the type.
 */
export function getFieldList(opType: OperatorDSL['type']): FieldConfig[] {
  const fields: FieldConfig[] = []
  const manifest = getEffectDslManifest()
  const nodeTyping = manifest.operator[opType]

  if (nodeTyping) {
    // Add selector fields first
    if (nodeTyping.selectorFields) {
      for (const fieldName of Object.keys(nodeTyping.selectorFields)) {
        fields.push(getFieldConfig(opType, fieldName))
      }
    }
    // Then value fields
    if (nodeTyping.valueFields) {
      for (const fieldName of Object.keys(nodeTyping.valueFields)) {
        fields.push(getFieldConfig(opType, fieldName))
      }
    }
  }

  // If no fields from manifest, try to fish out any known fields from INLINE_FIELDS
  if (fields.length === 0) {
    const knownFields = new Set<string>()
    for (const key of Object.keys(INLINE_FIELDS)) {
      if (key.startsWith(`${opType}@`)) {
        knownFields.add(key.split('@')[1])
      }
    }
    for (const fieldName of knownFields) {
      fields.push(getFieldConfig(opType, fieldName))
    }
  }

  return fields
}
