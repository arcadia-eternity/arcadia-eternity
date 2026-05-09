<script setup lang="ts">
import { computed } from 'vue'
import type {
  BaseSelectorKey,
  ConditionDSL,
  EvaluatorDSL,
  ExtractorDSL,
  SelectorChain,
  SelectorDSL,
  Value,
} from '@arcadia-eternity/schema'
import {
  createSelectorValidator,
  seer2EffectCompileTypingEnvironment,
  type CompileState,
} from '@arcadia-eternity/battle'
import { useEffectTyping } from './composables/useEffectTyping'
import { CHAIN_STEP_TYPES, VALUE_SLOT_TYPES, RECURSIVE_TYPES, getChainStepMeta } from './constants/selectorConstants'
import PipelineCard from './PipelineCard.vue'

const { resolveSelectorOptions } = useEffectTyping()

const selectorValidator = createSelectorValidator(seer2EffectCompileTypingEnvironment)

const props = withDefaults(
  defineProps<{
    modelValue: SelectorDSL
    allowedBases?: string[]
    label?: string
    expectedValueType?: 'number' | 'string' | 'boolean'
  }>(),
  {
    modelValue: undefined,
    label: undefined,
    allowedBases: undefined,
    expectedValueType: undefined,
  },
)

defineSlots<{
  default(props: { modelValue: SelectorDSL; update: (v: SelectorDSL) => void }): unknown
  evaluator(props: { modelValue: EvaluatorDSL; update: (v: EvaluatorDSL) => void }): unknown
  value(props: { modelValue: Value; update: (v: Value) => void }): unknown
  condition(props: { modelValue: ConditionDSL; update: (v: ConditionDSL) => void }): unknown
  trueValue(props: { modelValue: Value; update: (v: Value) => void }): unknown
  falseValue(props: { modelValue: Value; update: (v: Value) => void }): unknown
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SelectorDSL]
}>()

function getValidKeysForStep(stepIndex: number): Set<string> {
  const prevStates = selectorStates.value.get(stepIndex - 1)
  if (!prevStates || prevStates.length === 0) return new Set()
  return selectorValidator.getValidKeys(prevStates)
}

const allSelectorOptions = computed(() => {
  const opts = resolveSelectorOptions(undefined)
  if (props.allowedBases && props.allowedBases.length > 0) {
    return opts.filter(o => props.allowedBases!.includes(o.value))
  }
  return opts
})

/** Computed step-level warnings for compatibility issues. */
const selectorStates = computed((): Map<number, CompileState[]> => {
  const states = new Map<number, CompileState[]>()
  if (!isChain.value && !isSelectorValue.value) return states
  const val = props.modelValue as { chain?: SelectorChain[]; base?: BaseSelectorKey }
  const chain = val.chain ?? []

  const base = val.base ?? 'self'
  let current: CompileState[]
  try {
    current = selectorValidator.getBaseStates(base)
  } catch {
    return states
  }
  states.set(-1, current)

  for (let i = 0; i < chain.length; i++) {
    const result = selectorValidator.resolveStep(current, chain[i], `/chain/${i}`)
    if (!result.ok) {
      states.set(i, [])
      break
    }
    current = result.states
    states.set(i, current)
  }
  return states
})

const stepWarnings = computed((): Map<number, string> => {
  const warnings = new Map<number, string>()
  if (!isChain.value && !isSelectorValue.value) return warnings
  const val = props.modelValue as { chain?: SelectorChain[]; base?: BaseSelectorKey }
  const chain = val.chain ?? []
  if (chain.length === 0) return warnings

  let current: CompileState[]
  try {
    current = selectorValidator.getBaseStates(val.base ?? 'self')
  } catch {
    return warnings
  }

  for (let i = 0; i < chain.length; i++) {
    const result = selectorValidator.resolveStep(current, chain[i], `/chain/${i}`)
    if (!result.ok) {
      warnings.set(i, result.error)
      break
    }
    current = result.states
  }
  return warnings
})

const typeMismatchWarning = computed((): string | null => {
  if (!props.expectedValueType) return null
  const val = props.modelValue as { chain?: SelectorChain[]; base?: BaseSelectorKey }
  if (!isChain.value && !isSelectorValue.value) return null
  const chain = val.chain ?? []

  let current: CompileState[]
  try {
    current = selectorValidator.getBaseStates(val.base ?? 'self')
  } catch {
    return null
  }

  for (let i = 0; i < chain.length; i++) {
    const result = selectorValidator.resolveStep(current, chain[i], `/chain/${i}`)
    if (!result.ok) return null
    current = result.states
  }

  if (current.length === 0) return null
  const hasWrongType = current.some(s => {
    if (s.kind === 'scalar') return s.valueType !== props.expectedValueType
    return s.kind !== 'propertyRef'
  })
  if (!hasWrongType) return null

  const expected =
    props.expectedValueType === 'number' ? '数值' : props.expectedValueType === 'string' ? '字符串' : '布尔'
  const actual = current
    .map(s => {
      if (s.kind === 'scalar') return s.valueType
      if (s.kind === 'id') return s.target
      if (s.kind === 'owner') return s.owner
      return s.kind
    })
    .join(', ')
  return `期望输出类型为 ${expected}，但当前管道输出为 ${actual}`
})

const isBareString = computed(() => typeof props.modelValue === 'string')

const isChain = computed(
  () => typeof props.modelValue === 'object' && props.modelValue !== null && 'base' in props.modelValue,
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
  const base: BaseSelectorKey = isBareString.value ? (props.modelValue as BaseSelectorKey) : 'self'
  return { base, chain: [] }
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
  const base = isBareString.value ? (props.modelValue as BaseSelectorKey) : ('self' as BaseSelectorKey)
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
</script>

<template>
  <div class="selector-builder">
    <label v-if="label" class="selector-label">{{ label }}</label>

    <div v-if="isBareString" class="selector-compact">
      <el-select :model-value="modelValue as string" class="selector-base-input" @update:model-value="onBaseChange">
        <el-option v-for="opt in allSelectorOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
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
            <el-option v-for="opt in allSelectorOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
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

      <div v-for="(step, i) in (modelValue as { chain?: SelectorChain[] }).chain ?? []" :key="i" class="pipeline-step">
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
            <button type="button" class="card-move-btn" title="上移" :disabled="i === 0" @click="moveStepUp(i)">
              ▲
            </button>
            <button
              type="button"
              class="card-move-btn"
              title="下移"
              :disabled="i >= ((modelValue as { chain?: SelectorChain[] }).chain?.length ?? 0) - 1"
              @click="moveStepDown(i)"
            >
              ▼
            </button>
            <el-select
              :model-value="step.type"
              class="card-type-select"
              @update:model-value="(v: string) => onStepTypeChange(i, v)"
            >
              <el-option-group
                v-for="group in [
                  {
                    label: '提取',
                    types: ['select', 'selectPath', 'selectProp', 'selectObservable', 'selectAttribute$', 'configGet'],
                  },
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
                  :title="CHAIN_STEP_TYPES.find(s => s.value === t)?.description ?? t"
                />
              </el-option-group>
            </el-select>
            <el-tooltip
              v-if="getChainStepMeta(step.type)?.description"
              :content="getChainStepMeta(step.type)!.description"
              placement="top"
              effect="dark"
            >
              <span class="card-info-icon" title="步骤说明">ⓘ</span>
            </el-tooltip>
            <button type="button" class="card-delete-btn" title="删除步骤" @click="removeStep(i)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <PipelineCard
            :step="step"
            :index="i"
            :step-warnings="stepWarnings"
            :selector-states="selectorStates"
            :valid-extractor-keys="getValidKeysForStep(i)"
            :on-update-extractor-type="updateExtractorType"
            :on-update-extractor-base-arg="updateExtractorBaseArg"
            :on-update-extractor-key="updateExtractorKey"
            :on-update-extractor-path="updateExtractorPath"
            :on-update-extractor-dynamic-arg="updateExtractorDynamicArg"
            :on-update-step-arg-text="updateStepArgText"
            :on-update-step-evaluator="updateStepEvaluator"
            :on-update-step-arg="updateStepArg"
            :on-update-step-key="updateStepKey"
            :on-update-step-condition="updateStepCondition"
            :on-update-step-true-value="updateStepTrueValue"
            :on-update-step-false-value="updateStepFalseValue"
          >
            <template #evaluator="{ modelValue, update }">
              <slot name="evaluator" :model-value="modelValue" :update="update" />
            </template>
            <template #value="{ modelValue, update }">
              <slot name="value" :model-value="modelValue" :update="update" />
            </template>
            <template #condition="{ modelValue, update }">
              <slot name="condition" :model-value="modelValue" :update="update" />
            </template>
            <template #trueValue="{ modelValue, update }">
              <slot name="trueValue" :model-value="modelValue" :update="update" />
            </template>
            <template #falseValue="{ modelValue, update }">
              <slot name="falseValue" :model-value="modelValue" :update="update" />
            </template>
          </PipelineCard>
        </div>
      </div>

      <div v-if="typeMismatchWarning" class="card-step-warning">⚠ {{ typeMismatchWarning }}</div>

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
          :model-value="(modelValue as { condition: unknown }).condition as ConditionDSL"
          :update="
            (v: unknown) => emitValue({ ...(modelValue as Record<string, unknown>), condition: v } as SelectorDSL)
          "
        />
      </div>
      <div class="conditional-row">
        <span class="conditional-label">为真</span>
        <SelectorBuilder
          :model-value="(modelValue as { trueSelector: SelectorDSL }).trueSelector"
          @update:model-value="
            (v: SelectorDSL) =>
              emitValue({ ...(modelValue as Record<string, unknown>), trueSelector: v } as SelectorDSL)
          "
        />
      </div>
      <div class="conditional-row">
        <span class="conditional-label">为假</span>
        <SelectorBuilder
          :model-value="(modelValue as { falseSelector?: SelectorDSL }).falseSelector ?? 'self'"
          @update:model-value="
            (v: SelectorDSL) =>
              emitValue({ ...(modelValue as Record<string, unknown>), falseSelector: v } as SelectorDSL)
          "
        />
      </div>
    </div>

    <div v-else-if="isSelectorValue" class="selector-pipeline">
      <div class="pipeline-base">
        <div class="pipeline-base-row">
          <span class="selector-value-label">值</span>
          <slot
            name="value"
            :model-value="(modelValue as { value: unknown }).value as Value"
            :update="(v: unknown) => emitValue({ ...(modelValue as Record<string, unknown>), value: v } as SelectorDSL)"
          />
        </div>
      </div>

      <div v-for="(step, i) in (modelValue as { chain?: SelectorChain[] }).chain ?? []" :key="i" class="pipeline-step">
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
            <button type="button" class="card-move-btn" title="上移" :disabled="i === 0" @click="moveStepUp(i)">
              ▲
            </button>
            <button
              type="button"
              class="card-move-btn"
              title="下移"
              :disabled="i >= ((modelValue as { chain?: SelectorChain[] }).chain?.length ?? 0) - 1"
              @click="moveStepDown(i)"
            >
              ▼
            </button>
            <el-select
              :model-value="step.type"
              class="card-type-select"
              @update:model-value="(v: string) => onStepTypeChange(i, v)"
            >
              <el-option-group
                v-for="group in [
                  {
                    label: '提取',
                    types: ['select', 'selectPath', 'selectProp', 'selectObservable', 'selectAttribute$', 'configGet'],
                  },
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
                  :title="CHAIN_STEP_TYPES.find(s => s.value === t)?.description ?? t"
                />
              </el-option-group>
            </el-select>
            <el-tooltip
              v-if="getChainStepMeta(step.type)?.description"
              :content="getChainStepMeta(step.type)!.description"
              placement="top"
              effect="dark"
            >
              <span class="card-info-icon" title="步骤说明">ⓘ</span>
            </el-tooltip>
            <button type="button" class="card-delete-btn" title="删除步骤" @click="removeStep(i)">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <PipelineCard
            :step="step"
            :index="i"
            :step-warnings="stepWarnings"
            :selector-states="selectorStates"
            :valid-extractor-keys="getValidKeysForStep(i)"
            :on-update-extractor-type="updateExtractorType"
            :on-update-extractor-base-arg="updateExtractorBaseArg"
            :on-update-extractor-key="updateExtractorKey"
            :on-update-extractor-path="updateExtractorPath"
            :on-update-extractor-dynamic-arg="updateExtractorDynamicArg"
            :on-update-step-arg-text="updateStepArgText"
            :on-update-step-evaluator="updateStepEvaluator"
            :on-update-step-arg="updateStepArg"
            :on-update-step-key="updateStepKey"
            :on-update-step-condition="updateStepCondition"
            :on-update-step-true-value="updateStepTrueValue"
            :on-update-step-false-value="updateStepFalseValue"
          >
            <template #evaluator="{ modelValue, update }">
              <slot name="evaluator" :model-value="modelValue" :update="update" />
            </template>
            <template #value="{ modelValue, update }">
              <slot name="value" :model-value="modelValue" :update="update" />
            </template>
            <template #condition="{ modelValue, update }">
              <slot name="condition" :model-value="modelValue" :update="update" />
            </template>
            <template #trueValue="{ modelValue, update }">
              <slot name="trueValue" :model-value="modelValue" :update="update" />
            </template>
            <template #falseValue="{ modelValue, update }">
              <slot name="falseValue" :model-value="modelValue" :update="update" />
            </template>
          </PipelineCard>
        </div>
      </div>

      <div v-if="typeMismatchWarning" class="card-step-warning">⚠ {{ typeMismatchWarning }}</div>

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
  transition:
    color 0.12s ease,
    background 0.12s ease;
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
  transition:
    color 0.12s ease,
    background 0.12s ease;
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
  transition:
    color 0.12s ease,
    background 0.12s ease;
}

.card-move-btn:hover:not(:disabled) {
  color: var(--ae-text-primary);
  background: var(--ae-hover, rgba(255, 255, 255, 0.06));
}

.card-move-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

:deep() {
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
  transition:
    color 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
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

:deep() {
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

  /* Step info icon (ⓘ tooltip trigger) */
  .card-info-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    font-size: 12px;
    color: var(--ae-text-muted);
    cursor: help;
    flex-shrink: 0;
    opacity: 0.5;
    transition:
      opacity 0.12s ease,
      color 0.12s ease;
    user-select: none;
    margin-left: 1px;
  }

  .card-info-icon:hover {
    opacity: 1;
    color: var(--ae-accent, #409eff);
  }

  /* Step description hint shown in card body */
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

  /* Step compatibility warning banner */
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

  /* Pipeline state tag shown in card preview */
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

  /* Dimmed state tag when step has a compatibility warning */
  .state-dimmed {
    opacity: 0.45;
    text-decoration: line-through;
  }
}
</style>
