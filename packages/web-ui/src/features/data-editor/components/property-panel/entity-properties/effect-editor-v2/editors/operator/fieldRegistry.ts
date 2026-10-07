import { getEffectDslManifest } from '@arcadia-eternity/schema'
import type { OperatorDSL, OperatorDSLView } from '@arcadia-eternity/schema'

export interface FieldConfig {
  key: keyof OperatorDSLView
  label: string
  kind: 'selector' | 'value' | 'condition' | 'evaluator' | 'operator' | 'inline'
  optional?: boolean
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
  phaseType: '阶段类型',
  scope: '作用域',
  phaseId: '阶段ID',
  cleanStageStrategy: '清除策略',
  transformType: '变身类型',
  permanentStrategy: '永久化策略',
  key: '键名',
  updateConfig: '更新配置',
}

const EVALUATOR_FIELDS = new Set(['condition'])

function deriveStringEnumOptions(
  nodeTyping: ReturnType<typeof getEffectDslManifest>['operator'][string],
  fieldName: string,
): readonly { value: string; label: string }[] | undefined {
  const constraints = nodeTyping?.valueFields?.[fieldName]?.allow
  if (!constraints) return undefined
  for (const c of constraints) {
    if (c.kind === 'stringEnum' && 'values' in c && Array.isArray(c.values)) {
      return c.values as readonly { value: string; label: string }[]
    }
  }
  return undefined
}

const INLINE_FIELDS: Record<string, FieldConfig> = {
  'addAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addAttributeModifier@stat': { key: 'stat', label: '属性', kind: 'inline', component: 'el-select' },
  'addDynamicAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addDynamicAttributeModifier@stat': { key: 'stat', label: '属性', kind: 'inline', component: 'el-select' },
  'addClampMaxModifier@stat': { key: 'stat', label: '属性', kind: 'inline', component: 'el-select' },
  'addClampMinModifier@stat': { key: 'stat', label: '属性', kind: 'inline', component: 'el-select' },
  'addClampModifier@stat': { key: 'stat', label: '属性', kind: 'inline', component: 'el-select' },
  'addSkillAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addSkillAttributeModifier@attribute': { key: 'attribute', label: '属性', kind: 'inline', component: 'el-select' },
  'addDynamicSkillAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addDynamicSkillAttributeModifier@attribute': {
    key: 'attribute',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
  },
  'addSkillClampMaxModifier@attribute': { key: 'attribute', label: '属性', kind: 'inline', component: 'el-select' },
  'addSkillClampMinModifier@attribute': { key: 'attribute', label: '属性', kind: 'inline', component: 'el-select' },
  'addSkillClampModifier@attribute': { key: 'attribute', label: '属性', kind: 'inline', component: 'el-select' },
  'statStageBuff@statType': { key: 'statType', label: '能力类型', kind: 'inline', component: 'el-select' },
  'statStageBuff@strategy': { key: 'strategy', label: '策略', kind: 'inline', component: 'el-select' },
  'modifyStat@statType': { key: 'statType', label: '能力类型', kind: 'inline', component: 'el-select' },
  'clearStatStage@statType': { key: 'statType', label: '能力类型', kind: 'inline', component: 'el-select' },
  'clearStatStage@cleanStageStrategy': {
    key: 'cleanStageStrategy',
    label: '清除策略',
    kind: 'inline',
    component: 'el-select',
  },
  'reverseStatStage@statType': { key: 'statType', label: '能力类型', kind: 'inline', component: 'el-select' },
  'reverseStatStage@cleanStageStrategy': {
    key: 'cleanStageStrategy',
    label: '清除策略',
    kind: 'inline',
    component: 'el-select',
  },
  'transferStatStage@statType': { key: 'statType', label: '能力类型', kind: 'inline', component: 'el-select' },
  'transferStatStage@cleanStageStrategy': {
    key: 'cleanStageStrategy',
    label: '清除策略',
    kind: 'inline',
    component: 'el-select',
  },
  'addConfigModifier@modifierType': { key: 'modifierType', label: '修正类型', kind: 'inline', component: 'el-select' },
  'addDynamicConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addTaggedConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addPhaseConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addPhaseDynamicConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addPhaseTypeConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'addDynamicPhaseTypeConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
  },
  'setMarkStackStrategy@value': { key: 'value', label: '策略', kind: 'inline', component: 'el-select' },
  'setIgnoreStageStrategy@value': { key: 'value', label: '策略', kind: 'inline', component: 'el-select' },
  'transform@transformType': { key: 'transformType', label: '变身类型', kind: 'inline', component: 'el-select' },
  'transform@permanentStrategy': {
    key: 'permanentStrategy',
    label: '永久化策略',
    kind: 'inline',
    component: 'el-select',
  },
  'transformWithPreservation@transformType': {
    key: 'transformType',
    label: '变身类型',
    kind: 'inline',
    component: 'el-select',
  },
  'transformWithPreservation@permanentStrategy': {
    key: 'permanentStrategy',
    label: '永久化策略',
    kind: 'inline',
    component: 'el-select',
  },
}

export function getFieldConfig(opType: OperatorDSL['type'], fieldName: string): FieldConfig {
  const fk = fieldName as OpField
  const inlineKey = `${opType}@${fieldName}`
  const inline = INLINE_FIELDS[inlineKey]

  const manifest = getEffectDslManifest()
  const nodeTyping = manifest.operator[opType]
  const label = FIELD_LABELS[fk] ?? fieldName
  const optional = nodeTyping?.requiredFields ? !nodeTyping.requiredFields.includes(fieldName) : false

  const stringEnumOptions = deriveStringEnumOptions(nodeTyping, fieldName)

  if (inline) {
    return { ...inline, optional, componentOptions: stringEnumOptions }
  }

  if (nodeTyping?.selectorFields?.[fieldName]) {
    return { key: fk, label, kind: 'selector', optional }
  }
  if (nodeTyping?.valueFields?.[fieldName]) {
    return { key: fk, label, kind: 'value', optional, componentOptions: stringEnumOptions }
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

export function getFieldList(opType: OperatorDSL['type']): FieldConfig[] {
  const fields: FieldConfig[] = []
  const manifest = getEffectDslManifest()
  const nodeTyping = manifest.operator[opType]

  if (nodeTyping) {
    if (nodeTyping.selectorFields) {
      for (const fieldName of Object.keys(nodeTyping.selectorFields)) {
        fields.push(getFieldConfig(opType, fieldName))
      }
    }
    if (nodeTyping.valueFields) {
      for (const fieldName of Object.keys(nodeTyping.valueFields)) {
        fields.push(getFieldConfig(opType, fieldName))
      }
    }
  }

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
