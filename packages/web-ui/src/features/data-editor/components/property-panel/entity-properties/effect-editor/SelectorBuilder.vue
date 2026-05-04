<script setup lang="ts">
import { computed } from 'vue'
import {
  BASE_SELECTOR_KEYS,
  BASE_EXTRACTOR_KEYS,
} from '@arcadia-eternity/schema'
import type {
  BaseSelectorKey,
  SelectorDSL,
  SelectorChain,
  ExtractorDSL,
} from '@arcadia-eternity/schema'
import { useEffectTyping } from './composables/useEffectTyping'

const { resolveSelectorOptions } = useEffectTyping()

const props = withDefaults(
  defineProps<{
    modelValue: SelectorDSL
    allowedBases?: string[]
    label?: string
  }>(),
  {
    allowedBases: () => [],
    label: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: SelectorDSL]
}>()

const CHAIN_STEP_TYPES = [
  { value: 'select', label: '筛选', group: 'extract' },
  { value: 'selectPath', label: '路径选择', group: 'extract' },
  { value: 'selectProp', label: '属性选择', group: 'extract' },
  { value: 'selectObservable', label: '可观察选择', group: 'extract' },
  { value: 'selectAttribute$', label: '动态属性', group: 'extract' },
  { value: 'configGet', label: '配置获取', group: 'extract' },
  { value: 'where', label: '条件过滤', group: 'filter' },
  { value: 'whereAttr', label: '属性过滤', group: 'filter' },
  { value: 'flat', label: '展平', group: 'transform' },
  { value: 'sum', label: '求和', group: 'math' },
  { value: 'avg', label: '平均', group: 'math' },
  { value: 'add', label: '加法', group: 'math' },
  { value: 'multiply', label: '乘法', group: 'math' },
  { value: 'divide', label: '除法', group: 'math' },
  { value: 'shuffled', label: '乱序', group: 'transform' },
  { value: 'asStatLevelMark', label: '等级标记', group: 'transform' },
  { value: 'sampleBetween', label: '区间采样', group: 'transform' },
  { value: 'and', label: '交集', group: 'set' },
  { value: 'or', label: '并集', group: 'set' },
  { value: 'randomPick', label: '随机选取', group: 'random' },
  { value: 'randomSample', label: '随机采样', group: 'random' },
  { value: 'limit', label: '限制数量', group: 'limit' },
  { value: 'clampMax', label: '上限', group: 'limit' },
  { value: 'clampMin', label: '下限', group: 'limit' },
  { value: 'when', label: '条件分支', group: 'flow' },
] as const

const EXTRACTOR_TYPES = [
  { value: 'base', label: '基础' },
  { value: 'attribute', label: '属性' },
  { value: 'relation', label: '关联' },
  { value: 'field', label: '字段' },
  { value: 'dynamic', label: '动态' },
] as const

const NO_PARAM_TYPES = new Set([
  'flat', 'sum', 'avg', 'shuffled', 'asStatLevelMark', 'sampleBetween',
])

const TEXT_INPUT_TYPES = new Set([
  'selectPath', 'selectProp', 'selectObservable', 'selectAttribute$',
])

const VALUE_SLOT_TYPES = new Set([
  'randomPick', 'randomSample', 'limit', 'clampMax', 'clampMin',
  'add', 'multiply', 'divide', 'configGet',
])

const RECURSIVE_TYPES = new Set(['and', 'or'])

const BASE_EXTRACTOR_OPTIONS = BASE_EXTRACTOR_KEYS.map(k => ({ value: k, label: k }))

const allSelectorOptions = computed(() => {
  const opts = resolveSelectorOptions(undefined)
  if (props.allowedBases && props.allowedBases.length > 0) {
    return opts.filter(o => props.allowedBases!.includes(o.value))
  }
  return opts
})

const isBareString = computed(() => typeof props.modelValue === 'string')

const isChain = computed(
  () =>
    typeof props.modelValue === 'object' &&
    props.modelValue !== null &&
    'base' in props.modelValue,
)

const isConditional = computed(
  () =>
    typeof props.modelValue === 'object' &&
    props.modelValue !== null &&
    'condition' in props.modelValue &&
    'trueSelector' in props.modelValue,
)

const isSelectorValue = computed(
  () =>
    typeof props.modelValue === 'object' &&
    props.modelValue !== null &&
    'type' in props.modelValue &&
    (props.modelValue as Record<string, unknown>).type === 'selectorValue',
)

function ensureChainSelector(): { base: BaseSelectorKey; chain: SelectorChain[] } {
  if (isChain.value) {
    const cs = props.modelValue as { base: BaseSelectorKey; chain?: SelectorChain[] }
    return { base: cs.base, chain: cs.chain ?? [] }
  }
  const base: BaseSelectorKey = isBareString.value
    ? (props.modelValue as BaseSelectorKey)
    : 'self'
  return { base, chain: [] }
}

function makeExtractorStep(): SelectorChain {
  return { type: 'select', arg: 'currentHp' } as SelectorChain
}

function makeStep(type: string): SelectorChain {
  if (type === 'select') {
    return { type: 'select', arg: 'currentHp' } as SelectorChain
  }
  if (type === 'selectPath' || type === 'selectProp' || type === 'selectObservable' || type === 'selectAttribute$') {
    return { type: type as SelectorChain['type'], arg: '' } as SelectorChain
  }
  if (type === 'configGet') {
    return { type: 'configGet', key: { type: 'raw:string', value: '' } } as SelectorChain
  }
  if (type === 'where') {
    return { type: 'where', arg: { type: 'exist' } } as SelectorChain
  }
  if (type === 'whereAttr') {
    return {
      type: 'whereAttr',
      extractor: 'currentHp' as ExtractorDSL,
      evaluator: { type: 'exist' },
    } as SelectorChain
  }
  if (RECURSIVE_TYPES.has(type)) {
    return { type: type as SelectorChain['type'], arg: 'self' } as SelectorChain
  }
  if (VALUE_SLOT_TYPES.has(type)) {
    return { type: type as SelectorChain['type'], arg: { type: 'raw:number', value: 0 } } as SelectorChain
  }
  if (type === 'when') {
    return {
      type: 'when',
      condition: { type: 'petIsActive' },
      trueValue: { type: 'raw:number', value: 0 },
      falseValue: { type: 'raw:number', value: 0 },
    } as SelectorChain
  }
  return { type: type as SelectorChain['type'] } as SelectorChain
}

function emitValue(v: SelectorDSL) {
  emit('update:modelValue', v)
}

function onBaseChange(val: string) {
  if (isBareString.value) {
    emitValue(val as BaseSelectorKey)
    return
  }
  if (isChain.value) {
    const cs = ensureChainSelector()
    emitValue({ base: val as BaseSelectorKey, chain: cs.chain })
    return
  }
  emitValue(val as BaseSelectorKey)
}

function expandToChain() {
  const base = isBareString.value
    ? (props.modelValue as BaseSelectorKey)
    : 'self' as BaseSelectorKey
  emitValue({ base, chain: [] })
}

function collapseToString() {
  if (isChain.value) {
    const cs = props.modelValue as { base: BaseSelectorKey; chain?: SelectorChain[] }
    if (!cs.chain || cs.chain.length === 0) {
      emitValue(cs.base)
    }
  }
}

function addStep() {
  const cs = ensureChainSelector()
  const newStep = makeStep('select')
  emitValue({ base: cs.base, chain: [...cs.chain, newStep] })
}

function removeStep(index: number) {
  const cs = ensureChainSelector()
  const chain = [...cs.chain]
  chain.splice(index, 1)
  emitValue({ base: cs.base, chain })
}

function moveStepUp(index: number) {
  if (index <= 0) return
  const cs = ensureChainSelector()
  const chain = [...cs.chain]
  const temp = chain[index]
  chain[index] = chain[index - 1]
  chain[index - 1] = temp
  emitValue({ base: cs.base, chain })
}

function moveStepDown(index: number) {
  const cs = ensureChainSelector()
  const chain = cs.chain
  if (index >= chain.length - 1) return
  const swapped = [...chain]
  const temp = swapped[index]
  swapped[index] = swapped[index + 1]
  swapped[index + 1] = temp
  emitValue({ base: cs.base, chain: swapped })
}

function onStepTypeChange(index: number, newType: string) {
  const cs = ensureChainSelector()
  const chain = [...cs.chain]
  chain[index] = makeStep(newType)
  emitValue({ base: cs.base, chain })
}

function updateStep(index: number, updated: SelectorChain) {
  const cs = ensureChainSelector()
  const chain = [...cs.chain]
  chain[index] = updated
  emitValue({ base: cs.base, chain })
}

function updateStepArg(index: number, arg: unknown) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.arg = arg
  updateStep(index, step as SelectorChain)
}

function updateStepKey(index: number, key: unknown) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.key = key
  updateStep(index, step as SelectorChain)
}

function updateStepExtractor(index: number, extractor: ExtractorDSL) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.extractor = extractor
  updateStep(index, step as SelectorChain)
}

function updateStepEvaluator(index: number, evaluator: unknown) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.evaluator = evaluator
  updateStep(index, step as SelectorChain)
}

function updateStepCondition(index: number, condition: unknown) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.condition = condition
  updateStep(index, step as SelectorChain)
}

function updateStepTrueValue(index: number, value: unknown) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.trueValue = value
  updateStep(index, step as SelectorChain)
}

function updateStepFalseValue(index: number, value: unknown) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.falseValue = value
  updateStep(index, step as SelectorChain)
}

function updateStepArgText(index: number, value: string) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.arg = value
  updateStep(index, step as SelectorChain)
}

function updateExtractorType(index: number, extractorType: string) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  const stepType = cs.chain[index].type

  if (stepType === 'select') {
    if (extractorType === 'base') {
      step.arg = 'currentHp'
    } else if (extractorType === 'attribute' || extractorType === 'relation') {
      step.arg = { type: extractorType, key: '' }
    } else if (extractorType === 'field') {
      step.arg = { type: 'field', path: '' }
    } else if (extractorType === 'dynamic') {
      step.arg = { type: 'dynamic', arg: '' }
    }
  } else if (stepType === 'whereAttr') {
    if (extractorType === 'base') {
      step.extractor = 'currentHp'
    } else if (extractorType === 'attribute' || extractorType === 'relation') {
      step.extractor = { type: extractorType, key: '' }
    } else if (extractorType === 'field') {
      step.extractor = { type: 'field', path: '' }
    } else if (extractorType === 'dynamic') {
      step.extractor = { type: 'dynamic', arg: '' }
    }
  }
  updateStep(index, step as SelectorChain)
}

function updateExtractorBaseArg(index: number, val: string) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  step.arg = val
  updateStep(index, step as SelectorChain)
}

function updateExtractorKey(index: number, key: string) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  const arg = step.arg as Record<string, unknown> | undefined
  if (arg && typeof arg === 'object') {
    step.arg = { ...arg, key }
  }
  updateStep(index, step as SelectorChain)
}

function updateExtractorPath(index: number, path: string) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  const arg = step.arg as Record<string, unknown> | undefined
  if (arg && typeof arg === 'object') {
    step.arg = { ...arg, path }
  }
  updateStep(index, step as SelectorChain)
}

function updateExtractorDynamicArg(index: number, val: string) {
  const cs = ensureChainSelector()
  const step = { ...cs.chain[index] } as Record<string, unknown>
  const arg = step.arg as Record<string, unknown> | undefined
  if (arg && typeof arg === 'object') {
    step.arg = { ...arg, arg: val }
  }
  updateStep(index, step as SelectorChain)
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
  <div class="selector-builder">
    <label v-if="label" class="selector-label">{{ label }}</label>

    <div v-if="isBareString" class="selector-compact">
      <el-select
        :model-value="modelValue as string"
        class="selector-base-input"
        @update:model-value="onBaseChange"
      >
        <el-option
          v-for="opt in allSelectorOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <button type="button" class="selector-expand-btn" title="展开管道" @click="expandToChain">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>

    <div v-else-if="isChain" class="selector-pipeline">
      <div class="pipeline-base">
        <div class="pipeline-base-row">
          <el-select
            :model-value="(modelValue as { base: BaseSelectorKey }).base"
            class="selector-base-input"
            @update:model-value="onBaseChange"
          >
            <el-option
              v-for="opt in allSelectorOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <button
            type="button"
            class="selector-collapse-btn"
            :disabled="!((modelValue as { chain?: SelectorChain[] }).chain?.length ?? 0)"
            title="折叠为文本"
            @click="collapseToString"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 15 12 9 18 15" />
            </svg>
          </button>
        </div>
      </div>

      <div
        v-for="(step, i) in (modelValue as { chain?: SelectorChain[] }).chain ?? []"
        :key="i"
        class="pipeline-step"
      >
        <div class="pipeline-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
        </div>
        <div class="pipeline-card">
          <div class="card-header">
            <span class="card-drag-handle" title="拖拽排序">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="5" r="2" />
                <circle cx="15" cy="5" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="15" cy="12" r="2" />
                <circle cx="9" cy="19" r="2" />
                <circle cx="15" cy="19" r="2" />
              </svg>
            </span>
            <button type="button" class="card-move-btn" title="上移" :disabled="i === 0" @click="moveStepUp(i)">▲</button>
            <button type="button" class="card-move-btn" title="下移" :disabled="i >= ((modelValue as { chain?: any[] }).chain?.length ?? 0) - 1" @click="moveStepDown(i)">▼</button>
            <el-select
              :model-value="step.type"
              class="card-type-select"
              @update:model-value="(v: string) => onStepTypeChange(i, v)"
            >
              <el-option-group
                v-for="group in [
                  { label: '提取', types: ['select', 'selectPath', 'selectProp', 'selectObservable', 'selectAttribute$', 'configGet'] },
                  { label: '过滤', types: ['where', 'whereAttr'] },
                  { label: '变换', types: ['flat', 'shuffled', 'asStatLevelMark', 'sampleBetween'] },
                  { label: '运算', types: ['sum', 'avg', 'add', 'multiply', 'divide'] },
                  { label: '集合', types: ['and', 'or'] },
                  { label: '随机', types: ['randomPick', 'randomSample'] },
                  { label: '限制', types: ['limit', 'clampMax', 'clampMin'] },
                  { label: '流程', types: ['when'] },
                ]"
                :key="group.label"
                :label="group.label"
              >
                <el-option
                  v-for="t in group.types"
                  :key="t"
                  :label="CHAIN_STEP_TYPES.find(s => s.value === t)?.label ?? t"
                  :value="t"
                />
              </el-option-group>
            </el-select>
            <button type="button" class="card-delete-btn" title="删除步骤" @click="removeStep(i)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="card-body">

            <template v-if="step.type === 'select'">
              <div class="card-field-row">
                <el-select
                  :model-value="getExtractorType(step)"
                  class="card-field-select"
                  @update:model-value="(v: string) => updateExtractorType(i, v)"
                >
                  <el-option
                    v-for="et in EXTRACTOR_TYPES"
                    :key="et.value"
                    :label="et.label"
                    :value="et.value"
                  />
                </el-select>
                <template v-if="getExtractorType(step) === 'base'">
                  <el-select
                    :model-value="getExtractorArg(step) ?? ''"
                    class="card-field-select"
                    filterable
                    @update:model-value="(v: string) => updateExtractorBaseArg(i, v)"
                  >
                    <el-option
                      v-for="bk in BASE_EXTRACTOR_OPTIONS"
                      :key="bk.value"
                      :label="bk.label"
                      :value="bk.value"
                    />
                  </el-select>
                </template>
                <el-input
                  v-else-if="getExtractorType(step) === 'attribute' || getExtractorType(step) === 'relation'"
                  :model-value="getExtractorKey(step) ?? ''"
                  placeholder="键名"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorKey(i, v)"
                />
                <el-input
                  v-else-if="getExtractorType(step) === 'field'"
                  :model-value="getExtractorPath(step) ?? ''"
                  placeholder="字段路径"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorPath(i, v)"
                />
                <el-input
                  v-else-if="getExtractorType(step) === 'dynamic'"
                  :model-value="getExtractorDynamicArg(step) ?? ''"
                  placeholder="动态参数"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorDynamicArg(i, v)"
                />
              </div>
            </template>

            <template v-else-if="TEXT_INPUT_TYPES.has(step.type)">
              <el-input
                :model-value="(step as { arg: string }).arg"
                placeholder="输入参数"
                class="card-field-input"
                @update:model-value="(v: string) => updateStepArgText(i, v)"
              />
            </template>

            <template v-else-if="step.type === 'where'">
              <slot
                name="evaluator"
                :model-value="(step as { arg: unknown }).arg"
                :update="(v: unknown) => updateStepArg(i, v)"
              />
            </template>

            <template v-else-if="step.type === 'whereAttr'">
              <div class="card-field-row">
                <el-select
                  :model-value="getExtractorType(step)"
                  class="card-field-select"
                  @update:model-value="(v: string) => updateExtractorType(i, v)"
                >
                  <el-option
                    v-for="et in EXTRACTOR_TYPES"
                    :key="et.value"
                    :label="et.label"
                    :value="et.value"
                  />
                </el-select>
                <template v-if="getExtractorType(step) === 'base'">
                  <el-select
                    :model-value="getExtractorArg(step) ?? ''"
                    class="card-field-select"
                    filterable
                    @update:model-value="(v: string) => updateExtractorBaseArg(i, v)"
                  >
                    <el-option
                      v-for="bk in BASE_EXTRACTOR_OPTIONS"
                      :key="bk.value"
                      :label="bk.label"
                      :value="bk.value"
                    />
                  </el-select>
                </template>
                <el-input
                  v-else-if="getExtractorType(step) === 'attribute' || getExtractorType(step) === 'relation'"
                  :model-value="getExtractorKey(step) ?? ''"
                  placeholder="键名"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorKey(i, v)"
                />
                <el-input
                  v-else-if="getExtractorType(step) === 'field'"
                  :model-value="getExtractorPath(step) ?? ''"
                  placeholder="字段路径"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorPath(i, v)"
                />
                <el-input
                  v-else-if="getExtractorType(step) === 'dynamic'"
                  :model-value="getExtractorDynamicArg(step) ?? ''"
                  placeholder="动态参数"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorDynamicArg(i, v)"
                />
              </div>
              <div class="card-field-row card-field-indent">
                <slot
                  name="evaluator"
                  :model-value="(step as { evaluator: unknown }).evaluator"
                  :update="(v: unknown) => updateStepEvaluator(i, v)"
                />
              </div>
            </template>

            <template v-else-if="RECURSIVE_TYPES.has(step.type)">
              <SelectorBuilder
                :model-value="(step as { arg: SelectorDSL }).arg"
                class="card-recursive-builder"
                @update:model-value="(v: SelectorDSL) => updateStepArg(i, v)"
              />
            </template>

            <template v-else-if="step.type === 'configGet'">
              <slot
                name="value"
                :model-value="(step as { key: unknown }).key"
                :update="(v: unknown) => updateStepKey(i, v)"
              />
            </template>

            <template v-else-if="VALUE_SLOT_TYPES.has(step.type)">
              <slot
                name="value"
                :model-value="(step as { arg: unknown }).arg"
                :update="(v: unknown) => updateStepArg(i, v)"
              />
            </template>

            <template v-else-if="step.type === 'when'">
              <div class="card-when-grid">
                <div class="card-when-label">条件</div>
                <slot
                  name="condition"
                  :model-value="(step as { condition: unknown }).condition"
                  :update="(v: unknown) => updateStepCondition(i, v)"
                />
                <div class="card-when-label">为真时</div>
                <slot
                  name="trueValue"
                  :model-value="(step as { trueValue: unknown }).trueValue"
                  :update="(v: unknown) => updateStepTrueValue(i, v)"
                />
                <div class="card-when-label">为假时</div>
                <slot
                  name="falseValue"
                  :model-value="(step as { falseValue: unknown }).falseValue"
                  :update="(v: unknown) => updateStepFalseValue(i, v)"
                />
              </div>
            </template>

          </div>

          <div class="card-preview">{{ previewStep(step) }}</div>
        </div>
      </div>

      <button type="button" class="pipeline-add-btn" @click="addStep">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>添加步骤</span>
      </button>
    </div>

    <div v-else-if="isConditional" class="selector-conditional">
      <div class="conditional-row">
        <span class="conditional-label">条件</span>
        <slot
          name="condition"
          :model-value="(modelValue as { condition: unknown }).condition"
          :update="(v: unknown) => emitValue({ ...(modelValue as Record<string, unknown>), condition: v } as SelectorDSL)"
        />
      </div>
      <div class="conditional-row">
        <span class="conditional-label">为真</span>
        <SelectorBuilder
          :model-value="(modelValue as { trueSelector: SelectorDSL }).trueSelector"
          @update:model-value="(v: SelectorDSL) => emitValue({ ...(modelValue as Record<string, unknown>), trueSelector: v } as SelectorDSL)"
        />
      </div>
      <div class="conditional-row">
        <span class="conditional-label">为假</span>
        <SelectorBuilder
          :model-value="(modelValue as { falseSelector?: SelectorDSL }).falseSelector ?? 'self'"
          @update:model-value="(v: SelectorDSL) => emitValue({ ...(modelValue as Record<string, unknown>), falseSelector: v } as SelectorDSL)"
        />
      </div>
    </div>

    <div v-else-if="isSelectorValue" class="selector-pipeline">
      <div class="pipeline-base">
        <div class="pipeline-base-row">
          <span class="selector-value-label">值</span>
          <slot
            name="value"
            :model-value="(modelValue as { value: unknown }).value"
            :update="(v: unknown) => emitValue({ ...(modelValue as Record<string, unknown>), value: v } as SelectorDSL)"
          />
        </div>
      </div>

      <div
        v-for="(step, i) in (modelValue as { chain?: SelectorChain[] }).chain ?? []"
        :key="i"
        class="pipeline-step"
      >
        <div class="pipeline-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
        </div>
        <div class="pipeline-card">
          <div class="card-header">
            <span class="card-drag-handle" title="拖拽排序">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="5" r="2" />
                <circle cx="15" cy="5" r="2" />
                <circle cx="9" cy="12" r="2" />
                <circle cx="15" cy="12" r="2" />
                <circle cx="9" cy="19" r="2" />
                <circle cx="15" cy="19" r="2" />
              </svg>
            </span>
            <button type="button" class="card-move-btn" title="上移" :disabled="i === 0" @click="moveStepUp(i)">▲</button>
            <button type="button" class="card-move-btn" title="下移" :disabled="i >= ((modelValue as { chain?: any[] }).chain?.length ?? 0) - 1" @click="moveStepDown(i)">▼</button>
            <el-select
              :model-value="step.type"
              class="card-type-select"
              @update:model-value="(v: string) => onStepTypeChange(i, v)"
            >
              <el-option-group
                v-for="group in [
                  { label: '提取', types: ['select', 'selectPath', 'selectProp', 'selectObservable', 'selectAttribute$', 'configGet'] },
                  { label: '过滤', types: ['where', 'whereAttr'] },
                  { label: '变换', types: ['flat', 'shuffled', 'asStatLevelMark', 'sampleBetween'] },
                  { label: '运算', types: ['sum', 'avg', 'add', 'multiply', 'divide'] },
                  { label: '集合', types: ['and', 'or'] },
                  { label: '随机', types: ['randomPick', 'randomSample'] },
                  { label: '限制', types: ['limit', 'clampMax', 'clampMin'] },
                  { label: '流程', types: ['when'] },
                ]"
                :key="group.label"
                :label="group.label"
              >
                <el-option
                  v-for="t in group.types"
                  :key="t"
                  :label="CHAIN_STEP_TYPES.find(s => s.value === t)?.label ?? t"
                  :value="t"
                />
              </el-option-group>
            </el-select>
            <button type="button" class="card-delete-btn" title="删除步骤" @click="removeStep(i)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="card-body">

            <template v-if="step.type === 'select'">
              <div class="card-field-row">
                <el-select
                  :model-value="getExtractorType(step)"
                  class="card-field-select"
                  @update:model-value="(v: string) => updateExtractorType(i, v)"
                >
                  <el-option
                    v-for="et in EXTRACTOR_TYPES"
                    :key="et.value"
                    :label="et.label"
                    :value="et.value"
                  />
                </el-select>
                <template v-if="getExtractorType(step) === 'base'">
                  <el-select
                    :model-value="getExtractorArg(step) ?? ''"
                    class="card-field-select"
                    filterable
                    @update:model-value="(v: string) => updateExtractorBaseArg(i, v)"
                  >
                    <el-option
                      v-for="bk in BASE_EXTRACTOR_OPTIONS"
                      :key="bk.value"
                      :label="bk.label"
                      :value="bk.value"
                    />
                  </el-select>
                </template>
                <el-input
                  v-else-if="getExtractorType(step) === 'attribute' || getExtractorType(step) === 'relation'"
                  :model-value="getExtractorKey(step) ?? ''"
                  placeholder="键名"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorKey(i, v)"
                />
                <el-input
                  v-else-if="getExtractorType(step) === 'field'"
                  :model-value="getExtractorPath(step) ?? ''"
                  placeholder="字段路径"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorPath(i, v)"
                />
                <el-input
                  v-else-if="getExtractorType(step) === 'dynamic'"
                  :model-value="getExtractorDynamicArg(step) ?? ''"
                  placeholder="动态参数"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorDynamicArg(i, v)"
                />
              </div>
            </template>

            <template v-else-if="TEXT_INPUT_TYPES.has(step.type)">
              <el-input
                :model-value="(step as { arg: string }).arg"
                placeholder="输入参数"
                class="card-field-input"
                @update:model-value="(v: string) => updateStepArgText(i, v)"
              />
            </template>

            <template v-else-if="step.type === 'where'">
              <slot
                name="evaluator"
                :model-value="(step as { arg: unknown }).arg"
                :update="(v: unknown) => updateStepArg(i, v)"
              />
            </template>

            <template v-else-if="step.type === 'whereAttr'">
              <div class="card-field-row">
                <el-select
                  :model-value="getExtractorType(step)"
                  class="card-field-select"
                  @update:model-value="(v: string) => updateExtractorType(i, v)"
                >
                  <el-option
                    v-for="et in EXTRACTOR_TYPES"
                    :key="et.value"
                    :label="et.label"
                    :value="et.value"
                  />
                </el-select>
                <template v-if="getExtractorType(step) === 'base'">
                  <el-select
                    :model-value="getExtractorArg(step) ?? ''"
                    class="card-field-select"
                    filterable
                    @update:model-value="(v: string) => updateExtractorBaseArg(i, v)"
                  >
                    <el-option
                      v-for="bk in BASE_EXTRACTOR_OPTIONS"
                      :key="bk.value"
                      :label="bk.label"
                      :value="bk.value"
                    />
                  </el-select>
                </template>
                <el-input
                  v-else-if="getExtractorType(step) === 'attribute' || getExtractorType(step) === 'relation'"
                  :model-value="getExtractorKey(step) ?? ''"
                  placeholder="键名"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorKey(i, v)"
                />
                <el-input
                  v-else-if="getExtractorType(step) === 'field'"
                  :model-value="getExtractorPath(step) ?? ''"
                  placeholder="字段路径"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorPath(i, v)"
                />
                <el-input
                  v-else-if="getExtractorType(step) === 'dynamic'"
                  :model-value="getExtractorDynamicArg(step) ?? ''"
                  placeholder="动态参数"
                  class="card-field-input"
                  @update:model-value="(v: string) => updateExtractorDynamicArg(i, v)"
                />
              </div>
              <div class="card-field-row card-field-indent">
                <slot
                  name="evaluator"
                  :model-value="(step as { evaluator: unknown }).evaluator"
                  :update="(v: unknown) => updateStepEvaluator(i, v)"
                />
              </div>
            </template>

            <template v-else-if="RECURSIVE_TYPES.has(step.type)">
              <SelectorBuilder
                :model-value="(step as { arg: SelectorDSL }).arg"
                class="card-recursive-builder"
                @update:model-value="(v: SelectorDSL) => updateStepArg(i, v)"
              />
            </template>

            <template v-else-if="step.type === 'configGet'">
              <slot
                name="value"
                :model-value="(step as { key: unknown }).key"
                :update="(v: unknown) => updateStepKey(i, v)"
              />
            </template>

            <template v-else-if="VALUE_SLOT_TYPES.has(step.type)">
              <slot
                name="value"
                :model-value="(step as { arg: unknown }).arg"
                :update="(v: unknown) => updateStepArg(i, v)"
              />
            </template>

            <template v-else-if="step.type === 'when'">
              <div class="card-when-grid">
                <div class="card-when-label">条件</div>
                <slot
                  name="condition"
                  :model-value="(step as { condition: unknown }).condition"
                  :update="(v: unknown) => updateStepCondition(i, v)"
                />
                <div class="card-when-label">为真时</div>
                <slot
                  name="trueValue"
                  :model-value="(step as { trueValue: unknown }).trueValue"
                  :update="(v: unknown) => updateStepTrueValue(i, v)"
                />
                <div class="card-when-label">为假时</div>
                <slot
                  name="falseValue"
                  :model-value="(step as { falseValue: unknown }).falseValue"
                  :update="(v: unknown) => updateStepFalseValue(i, v)"
                />
              </div>
            </template>

          </div>

          <div class="card-preview">{{ previewStep(step) }}</div>
        </div>
      </div>

      <button type="button" class="pipeline-add-btn" @click="addStep">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>添加步骤</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.selector-builder {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.selector-label {
  font-size: var(--ae-font-xs, 11px);
  color: var(--ae-text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.selector-compact {
  display: flex;
  align-items: center;
  gap: 2px;
}

.selector-base-input {
  flex: 1;
}

.selector-expand-btn,
.selector-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--ae-text-muted);
  cursor: pointer;
  border-radius: var(--ae-radius-sm, 4px);
  padding: 0;
  flex-shrink: 0;
  transition: color 0.12s ease, background 0.12s ease;
}

.selector-expand-btn:hover,
.selector-collapse-btn:hover {
  color: var(--ae-text-primary);
  background: var(--ae-hover, rgba(255, 255, 255, 0.06));
}

.selector-collapse-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.selector-pipeline {
  display: flex;
  flex-direction: column;
}

.pipeline-base {
  padding: 6px 8px;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md, 6px);
}

.pipeline-base-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.selector-value-label {
  font-size: var(--ae-font-xs, 11px);
  color: var(--ae-text-muted);
  font-weight: 500;
  margin-right: 4px;
  flex-shrink: 0;
}

.pipeline-step {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pipeline-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 20px;
  color: var(--ae-text-muted);
  opacity: 0.5;
}

.pipeline-card {
  width: 100%;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md, 6px);
  overflow: hidden;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px 4px 4px;
  background: var(--ae-bg-overlay, rgba(255, 255, 255, 0.03));
  border-bottom: 1px solid var(--ae-border-subtle);
}

.card-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--ae-text-muted);
  cursor: grab;
  flex-shrink: 0;
  opacity: 0.4;
  transition: opacity 0.12s ease;
}

.card-drag-handle:hover {
  opacity: 0.8;
}

.card-type-select {
  flex: 1;
}

.card-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--ae-text-muted);
  cursor: pointer;
  border-radius: var(--ae-radius-sm, 4px);
  padding: 0;
  flex-shrink: 0;
  transition: color 0.12s ease, background 0.12s ease;
}

.card-delete-btn:hover {
  color: var(--ae-error);
  background: var(--ae-hover, rgba(255, 255, 255, 0.06));
}

.card-move-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: none;
  color: var(--ae-text-muted);
  cursor: pointer;
  font-size: 8px;
  border-radius: 3px;
  padding: 0;
  flex-shrink: 0;
  transition: color 0.12s ease, background 0.12s ease;
}

.card-move-btn:hover:not(:disabled) {
  color: var(--ae-text-primary);
  background: var(--ae-hover, rgba(255, 255, 255, 0.06));
}

.card-move-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

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

.pipeline-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  padding: 6px 0;
  border: 1px dashed var(--ae-border-subtle);
  border-radius: var(--ae-radius-md, 6px);
  background: transparent;
  color: var(--ae-text-muted);
  cursor: pointer;
  font-size: var(--ae-font-xs, 11px);
  transition: color 0.12s ease, border-color 0.12s ease, background 0.12s ease;
  margin-top: 2px;
}

.pipeline-add-btn:hover {
  color: var(--ae-accent, #409eff);
  border-color: var(--ae-accent, #409eff);
  background: var(--ae-hover, rgba(255, 255, 255, 0.03));
}

.selector-conditional {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--ae-bg-elevated);
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md, 6px);
}

.conditional-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conditional-label {
  font-size: var(--ae-font-xs, 10px);
  color: var(--ae-text-muted);
  font-weight: 500;
  text-transform: uppercase;
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
</style>
