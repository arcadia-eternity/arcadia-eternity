import { getEffectDslManifest } from '@arcadia-eternity/schema'
import type { OperatorDSL, OperatorDSLView } from '@arcadia-eternity/schema'
import {
  AttrModType,
  CleanStageStrategy,
  ConfigModType,
  IgnoreStageStrategy,
  PermanentStrategy,
  SetStageStrategy,
  StackStrategy,
  StatType,
  StatTypeOnlyBattle,
  StatTypeWithoutHp,
  TransformType,
} from '@arcadia-eternity/const'

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

function toOptions<E extends string>(labels: Record<E, string>): { value: E; label: string }[] {
  return (Object.entries(labels) as [E, string][]).map(([value, label]) => ({ value, label }))
}

const STAT_TYPE_LABELS: Record<StatType, string> = {
  [StatType.atk]: '攻击',
  [StatType.def]: '防御',
  [StatType.spa]: '特攻',
  [StatType.spd]: '特防',
  [StatType.spe]: '速度',
  [StatType.hp]: '体力',
}

const STAT_TYPE_WITHOUT_HP_LABELS: Record<StatTypeWithoutHp, string> = {
  [StatTypeWithoutHp.atk]: '攻击',
  [StatTypeWithoutHp.def]: '防御',
  [StatTypeWithoutHp.spa]: '特攻',
  [StatTypeWithoutHp.spd]: '特防',
  [StatTypeWithoutHp.spe]: '速度',
}

const STAT_TYPE_OPTIONS = [
  ...toOptions(STAT_TYPE_LABELS),
  ...toOptions({
    [StatTypeOnlyBattle.maxHp]: '最大体力',
    [StatTypeOnlyBattle.accuracy]: '命中',
    [StatTypeOnlyBattle.evasion]: '回避',
    [StatTypeOnlyBattle.critRate]: '暴击率',
    [StatTypeOnlyBattle.ragePerTurn]: '每回合怒气',
    [StatTypeOnlyBattle.weight]: '体重',
    [StatTypeOnlyBattle.height]: '身高',
  } satisfies Record<StatTypeOnlyBattle, string>),
] as const

const STAT_TYPE_WITHOUT_HP_OPTIONS = toOptions(STAT_TYPE_WITHOUT_HP_LABELS)

const ATTR_MOD_TYPE_OPTIONS = toOptions({
  [AttrModType.delta]: '加算',
  [AttrModType.percent]: '乘算',
  [AttrModType.override]: '覆写',
  [AttrModType.clampMax]: '上限',
  [AttrModType.clampMin]: '下限',
  [AttrModType.clamp]: '钳制',
} satisfies Record<AttrModType, string>)

const CONFIG_MOD_TYPE_OPTIONS = toOptions({
  [ConfigModType.override]: '覆写',
  [ConfigModType.delta]: '加算',
  [ConfigModType.append]: '追加',
  [ConfigModType.prepend]: '前置',
} satisfies Record<ConfigModType, string>)

const STACK_STRATEGY_OPTIONS = toOptions({
  [StackStrategy.stack]: '叠加',
  [StackStrategy.refresh]: '刷新',
  [StackStrategy.extend]: '延长',
  [StackStrategy.max]: '取最大',
  [StackStrategy.replace]: '替换',
  [StackStrategy.none]: '无',
  [StackStrategy.remove]: '移除',
} satisfies Record<StackStrategy, string>)

const CLEAN_STAGE_STRATEGY_OPTIONS = toOptions({
  [CleanStageStrategy.all]: '全部',
  [CleanStageStrategy.positive]: '有利',
  [CleanStageStrategy.negative]: '负面',
  [CleanStageStrategy.reverse]: '反转',
} satisfies Record<CleanStageStrategy, string>)

const IGNORE_STAGE_STRATEGY_OPTIONS = toOptions({
  [IgnoreStageStrategy.none]: '无',
  [IgnoreStageStrategy.all]: '全部',
  [IgnoreStageStrategy.positive]: '有利',
  [IgnoreStageStrategy.negative]: '负面',
} satisfies Record<IgnoreStageStrategy, string>)

const TRANSFORM_TYPE_OPTIONS = toOptions({
  [TransformType.temporary]: '临时',
  [TransformType.permanent]: '永久',
} satisfies Record<TransformType, string>)

const PERMANENT_STRATEGY_OPTIONS = toOptions({
  [PermanentStrategy.preserve_temporary]: '保留临时效果',
  [PermanentStrategy.clear_temporary]: '清除临时效果',
} satisfies Record<PermanentStrategy, string>)

const SET_STAGE_STRATEGY_OPTIONS = toOptions({
  [SetStageStrategy.add]: '累加',
  [SetStageStrategy.set]: '强制设置',
} satisfies Record<SetStageStrategy, string>)

const INLINE_FIELDS: Record<string, FieldConfig> = {
  'addAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: ATTR_MOD_TYPE_OPTIONS,
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
    componentOptions: ATTR_MOD_TYPE_OPTIONS,
  },
  'addDynamicAttributeModifier@stat': {
    key: 'stat',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
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

  'addSkillAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: ATTR_MOD_TYPE_OPTIONS,
  },
  'addSkillAttributeModifier@attribute': {
    key: 'attribute',
    label: '属性',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_OPTIONS,
  },
  'addDynamicSkillAttributeModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: ATTR_MOD_TYPE_OPTIONS,
  },
  'addDynamicSkillAttributeModifier@attribute': {
    key: 'attribute',
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
  'statStageBuff@strategy': {
    key: 'strategy',
    label: '策略',
    kind: 'inline',
    component: 'el-select',
    componentOptions: SET_STAGE_STRATEGY_OPTIONS,
  },
  'modifyStat@statType': {
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
  'clearStatStage@cleanStageStrategy': {
    key: 'cleanStageStrategy',
    label: '清除策略',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CLEAN_STAGE_STRATEGY_OPTIONS,
  },
  'reverseStatStage@statType': {
    key: 'statType',
    label: '能力类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_WITHOUT_HP_OPTIONS,
  },
  'reverseStatStage@cleanStageStrategy': {
    key: 'cleanStageStrategy',
    label: '清除策略',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CLEAN_STAGE_STRATEGY_OPTIONS,
  },
  'transferStatStage@statType': {
    key: 'statType',
    label: '能力类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: STAT_TYPE_WITHOUT_HP_OPTIONS,
  },
  'transferStatStage@cleanStageStrategy': {
    key: 'cleanStageStrategy',
    label: '清除策略',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CLEAN_STAGE_STRATEGY_OPTIONS,
  },

  'addConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CONFIG_MOD_TYPE_OPTIONS,
  },
  'addDynamicConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CONFIG_MOD_TYPE_OPTIONS,
  },
  'addTaggedConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CONFIG_MOD_TYPE_OPTIONS,
  },
  'addPhaseConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CONFIG_MOD_TYPE_OPTIONS,
  },
  'addPhaseDynamicConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CONFIG_MOD_TYPE_OPTIONS,
  },
  'addPhaseTypeConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CONFIG_MOD_TYPE_OPTIONS,
  },
  'addDynamicPhaseTypeConfigModifier@modifierType': {
    key: 'modifierType',
    label: '修正类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: CONFIG_MOD_TYPE_OPTIONS,
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
    componentOptions: IGNORE_STAGE_STRATEGY_OPTIONS,
  },

  'transform@transformType': {
    key: 'transformType',
    label: '变身类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: TRANSFORM_TYPE_OPTIONS,
  },
  'transform@permanentStrategy': {
    key: 'permanentStrategy',
    label: '永久化策略',
    kind: 'inline',
    component: 'el-select',
    componentOptions: PERMANENT_STRATEGY_OPTIONS,
  },
  'transformWithPreservation@transformType': {
    key: 'transformType',
    label: '变身类型',
    kind: 'inline',
    component: 'el-select',
    componentOptions: TRANSFORM_TYPE_OPTIONS,
  },
  'transformWithPreservation@permanentStrategy': {
    key: 'permanentStrategy',
    label: '永久化策略',
    kind: 'inline',
    component: 'el-select',
    componentOptions: PERMANENT_STRATEGY_OPTIONS,
  },
}

const EVALUATOR_FIELDS = new Set(['condition'])

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
