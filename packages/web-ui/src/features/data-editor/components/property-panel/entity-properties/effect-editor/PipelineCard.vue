<script setup lang="ts">
import { computed } from 'vue'
import { BASE_EXTRACTOR_KEYS } from '@arcadia-eternity/schema'
import type {
  ExtractorDSL,
  SelectorChain,
  SelectorDSL,
  Value,
  EvaluatorDSL,
  ConditionDSL,
} from '@arcadia-eternity/schema'
import type { CompileState } from '@arcadia-eternity/battle'
import SelectorBuilder from './SelectorBuilder.vue'

const props = defineProps<{
  step: SelectorChain
  index: number
  stepWarnings: Map<number, string>
  selectorStates: Map<number, CompileState[]>
  validExtractorKeys: Set<string>
  onUpdateExtractorType: (index: number, value: string) => void
  onUpdateExtractorBaseArg: (index: number, value: string) => void
  onUpdateExtractorKey: (index: number, value: string) => void
  onUpdateExtractorPath: (index: number, value: string) => void
  onUpdateExtractorDynamicArg: (index: number, value: string) => void
  onUpdateStepArgText: (index: number, value: string) => void
  onUpdateStepEvaluator: (index: number, value: unknown) => void
  onUpdateStepArg: (index: number, value: unknown) => void
  onUpdateStepKey: (index: number, value: unknown) => void
  onUpdateStepCondition: (index: number, value: unknown) => void
  onUpdateStepTrueValue: (index: number, value: unknown) => void
  onUpdateStepFalseValue: (index: number, value: unknown) => void
}>()

defineSlots<{
  evaluator(props: { modelValue: EvaluatorDSL; update: (v: EvaluatorDSL) => void }): unknown
  value(props: { modelValue: Value; update: (v: Value) => void }): unknown
  condition(props: { modelValue: ConditionDSL; update: (v: ConditionDSL) => void }): unknown
  trueValue(props: { modelValue: Value; update: (v: Value) => void }): unknown
  falseValue(props: { modelValue: Value; update: (v: Value) => void }): unknown
}>()

// ── Constants (duplicated from SelectorBuilder.vue) ──

interface ChainStepMeta {
  value: string
  label: string
  group: string
  description: string
}

const CHAIN_STEP_TYPES: readonly ChainStepMeta[] = [
  {
    value: 'select',
    label: '筛选',
    group: 'extract',
    description: '从每个实体中提取指定属性（如当前生命值、怒气等）。输入为实体列表，输出为属性值列表。',
  },
  {
    value: 'selectPath',
    label: '路径选择',
    group: 'extract',
    description: '通过 JSON 路径从对象中提取嵌套值。输入为对象列表，输出为路径对应的值列表。',
  },
  {
    value: 'selectProp',
    label: '属性选择',
    group: 'extract',
    description: '通过对象属性名从每个实体中提取属性值。输入为对象列表，输出为属性值列表。',
  },
  {
    value: 'selectObservable',
    label: '可观察选择',
    group: 'extract',
    description: '从每个实体中提取可观察的运行时动态值。输入为上下文对象，输出为对应值列表。',
  },
  {
    value: 'selectAttribute$',
    label: '动态属性',
    group: 'extract',
    description: '从每个实体中提取动态属性（基于运行时状态计算）。输入为实体列表，输出为动态属性值列表。',
  },
  {
    value: 'configGet',
    label: '配置获取',
    group: 'extract',
    description: '从每个实体的配置存储中按 key 获取值。输入为含配置的对象，输出为配置值列表。',
  },
  {
    value: 'where',
    label: '条件过滤',
    group: 'filter',
    description: '按条件过滤实体列表。保留满足条件的实体，输出仍为实体列表。',
  },
  {
    value: 'whereAttr',
    label: '属性过滤',
    group: 'filter',
    description: '先提取属性值再按条件过滤实体。适用于需要通过属性值比较来筛选的场景。',
  },
  {
    value: 'flat',
    label: '展平',
    group: 'transform',
    description: '将嵌套数组展平为一维数组。',
  },
  {
    value: 'sum',
    label: '求和',
    group: 'math',
    description: '对数组中的所有数值求和，输出单个数值。',
  },
  {
    value: 'avg',
    label: '平均',
    group: 'math',
    description: '计算数组的平均值，输出单个数值。',
  },
  {
    value: 'add',
    label: '加法',
    group: 'math',
    description: '将数组中的每个数值加上指定值。',
  },
  {
    value: 'multiply',
    label: '乘法',
    group: 'math',
    description: '将数组中的每个数值乘以指定值。',
  },
  {
    value: 'divide',
    label: '除法',
    group: 'math',
    description: '将数组中的每个数值除以指定值。',
  },
  {
    value: 'shuffled',
    label: '乱序',
    group: 'transform',
    description: '随机打乱数组顺序。',
  },
  {
    value: 'asStatLevelMark',
    label: '等级标记',
    group: 'transform',
    description: '将实体标记转换为统计等级标记对象进行计数。',
  },
  {
    value: 'sampleBetween',
    label: '区间采样',
    group: 'transform',
    description: '在数组相邻元素之间进行插值采样。',
  },
  {
    value: 'and',
    label: '交集',
    group: 'set',
    description: '计算当前实体列表与另一个选择器结果的交集，输出共同的实体。',
  },
  {
    value: 'or',
    label: '并集',
    group: 'set',
    description: '计算当前实体列表与另一个选择器结果的并集，输出去重后的实体。',
  },
  {
    value: 'randomPick',
    label: '随机选取',
    group: 'random',
    description: '从数组中随机选取指定数量的元素。',
  },
  {
    value: 'randomSample',
    label: '随机采样',
    group: 'random',
    description: '从数组中随机采样指定比例的元素。',
  },
  {
    value: 'limit',
    label: '限制数量',
    group: 'limit',
    description: '限制数组长度为指定值，超过则截断前 N 个。',
  },
  {
    value: 'clampMax',
    label: '上限',
    group: 'limit',
    description: '将每个值限制在最大上限以内，超过上限的改为上限值。',
  },
  {
    value: 'clampMin',
    label: '下限',
    group: 'limit',
    description: '将每个值限制在最小下限以上，低于下限的改为下限值。',
  },
  {
    value: 'when',
    label: '条件分支',
    group: 'flow',
    description: '根据条件选择不同的值输出，类似 if/else 逻辑。',
  },
] as const

const EXTRACTOR_TYPES = [
  { value: 'base', label: '基础' },
  { value: 'attribute', label: '属性' },
  { value: 'relation', label: '关联' },
  { value: 'field', label: '字段' },
  { value: 'dynamic', label: '动态' },
] as const

const NO_PARAM_TYPES = new Set(['flat', 'sum', 'avg', 'shuffled', 'asStatLevelMark', 'sampleBetween'])

const TEXT_INPUT_TYPES = new Set(['selectPath', 'selectProp', 'selectObservable', 'selectAttribute$'])

const VALUE_SLOT_TYPES = new Set([
  'randomPick',
  'randomSample',
  'limit',
  'clampMax',
  'clampMin',
  'add',
  'multiply',
  'divide',
  'configGet',
])

const RECURSIVE_TYPES = new Set(['and', 'or'])

const BASE_EXTRACTOR_OPTIONS = BASE_EXTRACTOR_KEYS.map(k => ({ value: k, label: k }))

const COMMON_EXTRACTOR_KEYS = [
  { value: 'hp', label: 'hp (生命值)' },
  { value: 'maxHp', label: 'maxHp (最大生命值)' },
  { value: 'attack', label: 'attack (攻击)' },
  { value: 'defense', label: 'defense (防御)' },
  { value: 'spAttack', label: 'spAttack (特攻)' },
  { value: 'spDefense', label: 'spDefense (特防)' },
  { value: 'speed', label: 'speed (速度)' },
  { value: 'level', label: 'level (等级)' },
  { value: 'type', label: 'type (类型/元素)' },
  { value: 'element', label: 'element (元素)' },
  { value: 'gender', label: 'gender (性别)' },
  { value: 'stage', label: 'stage (阶段/等级)' },
  { value: 'value', label: 'value (值)' },
  { value: 'count', label: 'count (计数)' },
  { value: 'id', label: 'id (ID)' },
  { value: 'name', label: 'name (名称)' },
  { value: 'owner', label: 'owner (所有者)' },
  { value: 'config', label: 'config (配置)' },
  { value: 'stacks', label: 'stacks (堆叠数)' },
  { value: 'duration', label: 'duration (持续时间)' },
  { value: 'power', label: 'power (威力)' },
  { value: 'priority', label: 'priority (优先级)' },
  { value: 'tags', label: 'tags (标签)' },
  { value: 'marks', label: 'marks (标记列表)' },
  { value: 'skills', label: 'skills (技能列表)' },
  { value: 'activePet', label: 'activePet (当前宠物)' },
  { value: 'rage', label: 'rage (怒气)' },
  { value: 'rageCost', label: 'rageCost (怒气消耗)' },
  { value: 'baseId', label: 'baseId (基础ID)' },
] as const

const COMMON_FIELD_PATHS = [
  { value: 'hp', label: 'hp' },
  { value: 'maxHp', label: 'maxHp' },
  { value: 'attack', label: 'attack' },
  { value: 'defense', label: 'defense' },
  { value: 'stats', label: 'stats' },
  { value: 'config.value', label: 'config.value' },
  { value: 'config.stacks', label: 'config.stacks' },
  { value: 'config.duration', label: 'config.duration' },
  { value: 'config.power', label: 'config.power' },
  { value: 'stage.value', label: 'stage.value' },
  { value: 'modifiers.flat', label: 'modifiers.flat' },
  { value: 'modifiers.percent', label: 'modifiers.percent' },
] as const

// ── Computed ──

const filteredBaseOptions = computed(() => {
  if (props.validExtractorKeys.size === 0) return BASE_EXTRACTOR_OPTIONS
  return BASE_EXTRACTOR_OPTIONS.filter(o => props.validExtractorKeys.has(o.value))
})

// ── Utility functions (duplicated from SelectorBuilder.vue) ──

function getChainStepMeta(type: string): ChainStepMeta | undefined {
  return CHAIN_STEP_TYPES.find(t => t.value === type)
}

function formatCompileState(state: CompileState): string {
  switch (state.kind) {
    case 'id':
      return state.target
    case 'owner':
      return state.owner
    case 'scalar':
      return state.valueType
    case 'object':
      return state.objectClass
    case 'propertyRef':
      return '属性引用'
  }
}

function getExtractorType(step: SelectorChain): string {
  const extractor: ExtractorDSL | undefined =
    step.type === 'select'
      ? (step as { arg: ExtractorDSL }).arg
      : step.type === 'whereAttr'
        ? (step as { extractor: ExtractorDSL }).extractor
        : undefined
  if (!extractor) return 'base'
  if (typeof extractor === 'string') return 'base'
  return extractor.type
}

function getExtractorArg(step: SelectorChain): string | undefined {
  const extractor: ExtractorDSL | undefined =
    step.type === 'select'
      ? (step as { arg: ExtractorDSL }).arg
      : step.type === 'whereAttr'
        ? (step as { extractor: ExtractorDSL }).extractor
        : undefined
  if (!extractor) return undefined
  if (typeof extractor === 'string') return extractor
  if (typeof extractor === 'object' && 'type' in extractor && extractor.type === 'base' && 'arg' in extractor) {
    return (extractor as { arg: string }).arg
  }
  return undefined
}

function getExtractorKey(step: SelectorChain): string | undefined {
  const extractor: ExtractorDSL | undefined =
    step.type === 'select'
      ? (step as { arg: ExtractorDSL }).arg
      : step.type === 'whereAttr'
        ? (step as { extractor: ExtractorDSL }).extractor
        : undefined
  if (!extractor || typeof extractor === 'string') return undefined
  return (extractor as { key?: string }).key
}

function getExtractorPath(step: SelectorChain): string | undefined {
  const extractor: ExtractorDSL | undefined =
    step.type === 'select'
      ? (step as { arg: ExtractorDSL }).arg
      : step.type === 'whereAttr'
        ? (step as { extractor: ExtractorDSL }).extractor
        : undefined
  if (!extractor || typeof extractor === 'string') return undefined
  return (extractor as { path?: string }).path
}

function getExtractorDynamicArg(step: SelectorChain): string | undefined {
  const extractor: ExtractorDSL | undefined =
    step.type === 'select'
      ? (step as { arg: ExtractorDSL }).arg
      : step.type === 'whereAttr'
        ? (step as { extractor: ExtractorDSL }).extractor
        : undefined
  if (!extractor || typeof extractor === 'string') return undefined
  return (extractor as { arg?: string }).arg
}

function previewStep(step: SelectorChain): string {
  const typeLabel = CHAIN_STEP_TYPES.find(t => t.value === step.type)?.label ?? step.type
  if (NO_PARAM_TYPES.has(step.type)) return typeLabel
  if (TEXT_INPUT_TYPES.has(step.type)) {
    const s = step as { arg: string }
    return `${typeLabel}: ${s.arg || '…'}`
  }
  if (step.type === 'select') {
    const s = step as { arg: ExtractorDSL }
    if (typeof s.arg === 'string') return `${typeLabel}: ${s.arg}`
    if (typeof s.arg === 'object' && s.arg.type === 'base' && 'arg' in s.arg) {
      return `${typeLabel}: ${(s.arg as { arg: string }).arg}`
    }
    if (typeof s.arg === 'object' && (s.arg.type === 'attribute' || s.arg.type === 'relation')) {
      return `${typeLabel}: ${String((s.arg as { key?: string }).key || s.arg.type)}`
    }
    if (typeof s.arg === 'object' && s.arg.type === 'field') {
      return `${typeLabel}: ${String((s.arg as { path?: string }).path || s.arg.type)}`
    }
    if (typeof s.arg === 'object' && s.arg.type === 'dynamic') {
      return `${typeLabel}: ${String((s.arg as { arg?: string }).arg || s.arg.type)}`
    }
    // @ts-expect-error never
    return `${typeLabel}: ${s.arg.type}`
  }
  if (step.type === 'where') return `${typeLabel}: …`
  if (step.type === 'whereAttr') return `${typeLabel}: …`
  if (RECURSIVE_TYPES.has(step.type)) return `${typeLabel}`
  if (VALUE_SLOT_TYPES.has(step.type)) return `${typeLabel}: …`
  if (step.type === 'when') return `${typeLabel}: …`
  return typeLabel
}
</script>

<template>
  <div class="card-body">
    <div v-if="stepWarnings.has(index)" class="card-step-warning">⚠ {{ stepWarnings.get(index) }}</div>
    <div v-if="getChainStepMeta(step.type)?.description" class="card-step-hint">
      {{ getChainStepMeta(step.type)!.description }}
    </div>
    <template v-if="step.type === 'select'">
      <div class="card-field-row">
        <el-select
          :model-value="getExtractorType(step)"
          class="card-field-select"
          @update:model-value="(v: string) => onUpdateExtractorType(index, v)"
        >
          <el-option v-for="et in EXTRACTOR_TYPES" :key="et.value" :label="et.label" :value="et.value" />
        </el-select>
        <template v-if="getExtractorType(step) === 'base'">
          <el-select
            :model-value="getExtractorArg(step) ?? ''"
            class="card-field-select"
            filterable
            @update:model-value="(v: string) => onUpdateExtractorBaseArg(index, v)"
          >
            <el-option v-for="bk in filteredBaseOptions" :key="bk.value" :label="bk.label" :value="bk.value" />
          </el-select>
        </template>
        <el-select
          v-else-if="getExtractorType(step) === 'attribute' || getExtractorType(step) === 'relation'"
          :model-value="getExtractorKey(step) ?? ''"
          class="card-field-select"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入键名"
          @update:model-value="(v: string) => onUpdateExtractorKey(index, v)"
        >
          <el-option v-for="opt in COMMON_EXTRACTOR_KEYS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-select
          v-else-if="getExtractorType(step) === 'field'"
          :model-value="getExtractorPath(step) ?? ''"
          class="card-field-select"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入字段路径"
          @update:model-value="(v: string) => onUpdateExtractorPath(index, v)"
        >
          <el-option v-for="opt in COMMON_FIELD_PATHS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-input
          v-else-if="getExtractorType(step) === 'dynamic'"
          :model-value="getExtractorDynamicArg(step) ?? ''"
          placeholder="动态参数"
          class="card-field-input"
          @update:model-value="(v: string) => onUpdateExtractorDynamicArg(index, v)"
        />
      </div>
    </template>

    <template v-else-if="TEXT_INPUT_TYPES.has(step.type)">
      <el-input
        :model-value="(step as { arg: string }).arg"
        placeholder="输入参数"
        class="card-field-input"
        @update:model-value="(v: string) => onUpdateStepArgText(index, v)"
      />
    </template>

    <template v-else-if="step.type === 'where'">
      <slot
        name="evaluator"
        :model-value="(step as { arg: unknown }).arg"
        :update="(v: unknown) => onUpdateStepArg(index, v)"
      />
    </template>

    <template v-else-if="step.type === 'whereAttr'">
      <div class="card-field-row">
        <el-select
          :model-value="getExtractorType(step)"
          class="card-field-select"
          @update:model-value="(v: string) => onUpdateExtractorType(index, v)"
        >
          <el-option v-for="et in EXTRACTOR_TYPES" :key="et.value" :label="et.label" :value="et.value" />
        </el-select>
        <template v-if="getExtractorType(step) === 'base'">
          <el-select
            :model-value="getExtractorArg(step) ?? ''"
            class="card-field-select"
            filterable
            @update:model-value="(v: string) => onUpdateExtractorBaseArg(index, v)"
          >
            <el-option v-for="bk in filteredBaseOptions" :key="bk.value" :label="bk.label" :value="bk.value" />
          </el-select>
        </template>
        <el-select
          v-else-if="getExtractorType(step) === 'attribute' || getExtractorType(step) === 'relation'"
          :model-value="getExtractorKey(step) ?? ''"
          class="card-field-select"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入键名"
          @update:model-value="(v: string) => onUpdateExtractorKey(index, v)"
        >
          <el-option v-for="opt in COMMON_EXTRACTOR_KEYS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-select
          v-else-if="getExtractorType(step) === 'field'"
          :model-value="getExtractorPath(step) ?? ''"
          class="card-field-select"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入字段路径"
          @update:model-value="(v: string) => onUpdateExtractorPath(index, v)"
        >
          <el-option v-for="opt in COMMON_FIELD_PATHS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-input
          v-else-if="getExtractorType(step) === 'dynamic'"
          :model-value="getExtractorDynamicArg(step) ?? ''"
          placeholder="动态参数"
          class="card-field-input"
          @update:model-value="(v: string) => onUpdateExtractorDynamicArg(index, v)"
        />
      </div>
      <div class="card-field-row card-field-indent">
        <slot
          name="evaluator"
          :model-value="(step as { evaluator: unknown }).evaluator"
          :update="(v: unknown) => onUpdateStepEvaluator(index, v)"
        />
      </div>
    </template>

    <template v-else-if="RECURSIVE_TYPES.has(step.type)">
      <SelectorBuilder
        :model-value="(step as { arg: SelectorDSL }).arg"
        class="card-recursive-builder"
        @update:model-value="(v: SelectorDSL) => onUpdateStepArg(index, v)"
      />
    </template>

    <template v-else-if="step.type === 'configGet'">
      <slot
        name="value"
        :model-value="(step as { key: unknown }).key as Value"
        :update="(v: unknown) => onUpdateStepKey(index, v)"
      />
    </template>

    <template v-else-if="VALUE_SLOT_TYPES.has(step.type)">
      <slot
        name="value"
        :model-value="(step as { arg: unknown }).arg"
        :update="(v: unknown) => onUpdateStepArg(index, v)"
      />
    </template>

    <template v-else-if="step.type === 'when'">
      <div class="card-when-grid">
        <div class="card-when-label">条件</div>
        <slot
          name="condition"
          :model-value="(step as { condition: unknown }).condition"
          :update="(v: unknown) => onUpdateStepCondition(index, v)"
        />
        <div class="card-when-label">为真时</div>
        <slot
          name="trueValue"
          :model-value="(step as { trueValue: unknown }).trueValue"
          :update="(v: unknown) => onUpdateStepTrueValue(index, v)"
        />
        <div class="card-when-label">为假时</div>
        <slot
          name="falseValue"
          :model-value="(step as { falseValue: unknown }).falseValue"
          :update="(v: unknown) => onUpdateStepFalseValue(index, v)"
        />
      </div>
    </template>
  </div>

  <div class="card-preview">
    {{ previewStep(step) }}
    <span
      v-if="selectorStates.has(index) && selectorStates.get(index)!.length > 0"
      class="card-state-tag"
      :class="[`state-${selectorStates.get(index)![0].kind}`, { 'state-dimmed': stepWarnings.has(index) }]"
    >
      → {{ selectorStates.get(index)!.map(formatCompileState).join(', ') }}
    </span>
  </div>
</template>

<style scoped>
.card-body {
  padding: 6px 8px;
}

.card-field-row {
  display: flex;
  gap: 4px;
}

.card-field-indent {
  margin-top: 6px;
  padding-left: 4px;
  border-left: 2px solid var(--ae-border-subtle);
}

.card-field-select {
  flex: 1;
  min-width: 0;
}

.card-field-input {
  flex: 1;
}

.card-preview {
  padding: 3px 8px 4px;
  font-size: var(--ae-font-xs, 10px);
  color: var(--ae-text-muted);
  font-family: monospace;
  border-top: 1px solid var(--ae-border-subtle);
  background: var(--ae-bg-base, rgba(0, 0, 0, 0.15));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: italic;
}

.card-recursive-builder {
  width: 100%;
}

.card-when-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-when-label {
  font-size: var(--ae-font-xs, 10px);
  color: var(--ae-text-muted);
  font-weight: 500;
  text-transform: uppercase;
}

.card-step-hint {
  padding: 3px 6px;
  margin-bottom: 5px;
  font-size: var(--ae-font-xs, 10px);
  color: var(--ae-text-muted);
  background: var(--ae-bg-overlay, rgba(255, 255, 255, 0.02));
  border-radius: var(--ae-radius-sm, 4px);
  line-height: 1.4;
  border-left: 2px solid var(--ae-border-subtle);
}

.card-step-warning {
  padding: 3px 6px;
  margin-bottom: 5px;
  font-size: var(--ae-font-xs, 10px);
  color: #e6a23c;
  background: rgba(230, 162, 60, 0.08);
  border-radius: var(--ae-radius-sm, 4px);
  line-height: 1.4;
  border-left: 2px solid #e6a23c;
}

.card-state-tag {
  display: inline-block;
  font-size: 9px;
  font-style: normal;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 6px;
  white-space: nowrap;
  vertical-align: middle;
  line-height: 1.5;
}

.state-id {
  background: rgba(64, 158, 255, 0.12);
  color: #409eff;
}

.state-owner {
  background: rgba(230, 162, 60, 0.12);
  color: #e6a23c;
}

.state-scalar {
  background: rgba(103, 194, 58, 0.12);
  color: #67c23a;
}

.state-object {
  background: rgba(144, 147, 153, 0.12);
  color: #909399;
}

.state-propertyRef {
  background: rgba(144, 147, 153, 0.12);
  color: #909399;
}

.state-dimmed {
  opacity: 0.45;
  text-decoration: line-through;
}
</style>
