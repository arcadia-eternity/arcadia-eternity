<script setup lang="ts">
import { computed } from 'vue'
import { ElOption, ElOptionGroup, ElSelect, ElTooltip } from 'element-plus'
import type {
  BaseExtractorKey,
  BaseSelectorKey,
  ConditionDSL,
  EffectDslFieldTypingRule,
  EvaluatorDSL,
  ExtractorKind,
  SelectorChain,
  SelectorChainView,
  SelectorDSL,
  SelectorValue,
  Value,
} from '@arcadia-eternity/schema'
import {
  createSelectorValidator,
  seer2EffectCompileTypingEnvironment,
  stateMatchesConstraint,
  formatState as formatCompileStateVerbose,
  formatConstraint,
  type CompileState,
} from '@arcadia-eternity/battle'
import { useNodeTyping, compileStatesToFieldTyping } from '../../composables/useNodeTyping'
import {
  CHAIN_STEP_TYPES,
  NO_PARAM_TYPES,
  TEXT_INPUT_TYPES,
  VALUE_SLOT_TYPES,
  RECURSIVE_TYPES,
  getChainStepMeta,
} from '../../constants/selectorConstants'
import DslNode from '../../DslNode.vue'
import StepBodyContent from './StepBodyContent.vue'

defineOptions({ name: 'SelectorEditor' })

const { resolveSelectorOptions } = useNodeTyping()

const selectorValidator = createSelectorValidator(seer2EffectCompileTypingEnvironment)

const props = withDefaults(
  defineProps<{
    modelValue: SelectorDSL
    allowedBases?: string[]
    label?: string
    expectedValueType?: 'number' | 'string' | 'boolean'
    fieldRule?: EffectDslFieldTypingRule
  }>(),
  {
    modelValue: undefined,
    label: undefined,
    allowedBases: undefined,
    expectedValueType: undefined,
    fieldRule: undefined,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: SelectorDSL]
}>()

const GROUP_LABEL_MAP: Record<string, string> = {
  extract: '提取',
  filter: '过滤',
  transform: '变换',
  math: '运算',
  set: '集合',
  random: '随机',
  limit: '限制',
  flow: '流程',
}

const stepGroups = computed(() => {
  const map = new Map<string, { label: string; value: string; description: string }[]>()
  for (const meta of CHAIN_STEP_TYPES) {
    if (!map.has(meta.group)) map.set(meta.group, [])
    map.get(meta.group)!.push({ label: meta.label, value: meta.type, description: meta.description })
  }
  return Array.from(map.entries()).map(([group, types]) => ({
    label: GROUP_LABEL_MAP[group] ?? group,
    types,
  }))
})

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

/** Computed step-level compile states for pipeline validation. */
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

/** Per-step evaluator field rules derived from pipeline states before the evaluator step. */
const evaluatorFieldRules = computed((): Map<number, EffectDslFieldTypingRule | undefined> => {
  const rules = new Map<number, EffectDslFieldTypingRule | undefined>()
  if (!isChain.value && !isSelectorValue.value) return rules
  const val = props.modelValue as { chain?: SelectorChain[] }
  const chain = val.chain ?? []
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i]

    if (step.type === 'where') {
      const prevStates = selectorStates.value.get(i - 1)
      if (prevStates && prevStates.length > 0) {
        rules.set(i, compileStatesToFieldTyping(prevStates))
      }
      continue
    }

    if (step.type === 'whereAttr') {
      const prevStates = selectorStates.value.get(i - 1)
      if (!prevStates || prevStates.length === 0) continue
      const extractor = (step as { extractor: unknown }).extractor
      if (!extractor) {
        rules.set(i, compileStatesToFieldTyping(prevStates))
        continue
      }
      // Simulate a select step to resolve the extractor's output type
      try {
        const result = selectorValidator.resolveStep(prevStates, { type: 'select', arg: extractor }, `/eval-type/${i}`)
        if (result.ok && result.states.length > 0) {
          rules.set(i, compileStatesToFieldTyping(result.states))
        } else {
          rules.set(i, compileStatesToFieldTyping(prevStates))
        }
      } catch {
        rules.set(i, compileStatesToFieldTyping(prevStates))
      }
      continue
    }
  }
  return rules
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

const pipelineTypeWarning = computed((): string | null => {
  const hasFieldRule = props.fieldRule?.allow && props.fieldRule.allow.length > 0
  const hasExpectedValue = !!props.expectedValueType
  if (!hasFieldRule && !hasExpectedValue) return null

  // conditional: two divergent branches, skip
  if (isConditional.value) return null

  const val = props.modelValue as { chain?: SelectorChain[]; base?: BaseSelectorKey }

  // Get final pipeline states
  let states: CompileState[]
  if (isBareString.value) {
    try {
      states = selectorValidator.getBaseStates(val.base ?? (props.modelValue as BaseSelectorKey))
    } catch {
      return null
    }
  } else if (isChain.value) {
    const chain = val.chain ?? []
    try {
      states = selectorValidator.getBaseStates(val.base ?? 'self')
    } catch {
      return null
    }
    for (let i = 0; i < chain.length; i++) {
      const result = selectorValidator.resolveStep(states, chain[i], `/chain/${i}`)
      if (!result.ok) return null
      states = result.states
    }
  } else if (isSelectorValue.value) {
    const sv = props.modelValue as { type: 'selectorValue'; value: unknown; chain?: SelectorChain[] }
    try {
      states = selectorValidator.inferValueStates(sv)
    } catch {
      return null
    }
    const chain = sv.chain ?? []
    for (let i = 0; i < chain.length; i++) {
      const result = selectorValidator.resolveStep(states, chain[i], `/chain/${i}`)
      if (!result.ok) return null
      states = result.states
    }
  } else {
    return null
  }

  if (states.length === 0) return null

  // Validate against fieldRule (full constraint matching)
  if (hasFieldRule) {
    const hasMatch = states.some(s => props.fieldRule!.allow.some(c => stateMatchesConstraint(s, c)))
    if (!hasMatch) {
      const expected = props.fieldRule!.allow.map(formatConstraint).join(' | ')
      const actual = states.map(formatCompileStateVerbose).join(', ')
      return `选择器类型不匹配：期望 ${expected}，当前管道输出 ${actual}`
    }
    return null
  }

  // Fallback: validate against expectedValueType (scalar-only)
  const actual = states
    .map(s => {
      if (s.kind === 'scalar') return s.valueType
      if (s.kind === 'id') return s.target
      if (s.kind === 'owner') return s.owner
      return s.kind
    })
    .join(', ')
  const expected =
    props.expectedValueType === 'number' ? '数值' : props.expectedValueType === 'string' ? '字符串' : '布尔'

  const hasWrongType = states.some(s => {
    if (s.kind === 'scalar') return s.valueType !== props.expectedValueType
    return s.kind !== 'propertyRef'
  })
  if (!hasWrongType) return null

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
    (props.modelValue as { type: unknown }).type === 'selectorValue',
)

function ensureChainSelector(): { base: BaseSelectorKey; chain: SelectorChain[] } {
  if (isChain.value) {
    const cs = props.modelValue as { base: BaseSelectorKey; chain?: SelectorChain[] }
    return { base: cs.base, chain: cs.chain ?? [] }
  }
  const base: BaseSelectorKey = isBareString.value ? (props.modelValue as BaseSelectorKey) : 'self'
  return { base, chain: [] }
}

function makeStep(type: SelectorChain['type']): SelectorChain {
  if (type === 'select') {
    return { type: 'select', arg: 'currentHp' }
  }
  if (type === 'selectPath' || type === 'selectProp' || type === 'selectObservable' || type === 'selectAttribute$') {
    return { type, arg: '' }
  }
  if (type === 'configGet') {
    return { type: 'configGet', key: { type: 'raw:string', value: '' } }
  }
  if (type === 'where') {
    return { type: 'where', arg: { type: 'exist' } }
  }
  if (type === 'whereAttr') {
    return {
      type: 'whereAttr',
      extractor: 'currentHp',
      evaluator: { type: 'exist' },
    }
  }
  if (RECURSIVE_TYPES.has(type)) {
    return { type: type as 'and' | 'or', arg: 'self' }
  }
  if (VALUE_SLOT_TYPES.has(type)) {
    return {
      type: type as 'randomPick' | 'randomSample' | 'limit' | 'clampMax' | 'clampMin' | 'add' | 'multiply' | 'divide',
      arg: { type: 'raw:number', value: 0 },
    }
  }
  if (type === 'when') {
    return {
      type: 'when',
      condition: { type: 'petIsActive' },
      trueValue: { type: 'raw:number', value: 0 },
      falseValue: { type: 'raw:number', value: 0 },
    }
  }
  // NO_PARAM_TYPES
  return { type: type as 'flat' | 'sum' | 'avg' | 'shuffled' | 'asStatLevelMark' | 'sampleBetween' }
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

// ── Typed accessors for conditional / selectorValue modes ─────────────────────

function conditionalFields(): { condition: ConditionDSL; trueSelector: SelectorDSL; falseSelector?: SelectorDSL } {
  const m = props.modelValue as { condition: ConditionDSL; trueSelector: SelectorDSL; falseSelector?: SelectorDSL }
  return m
}

function emitConditionalUpdate(field: 'condition' | 'trueSelector' | 'falseSelector', value: unknown) {
  const cf = conditionalFields()
  emitValue({
    condition: cf.condition,
    trueSelector: cf.trueSelector,
    falseSelector: cf.falseSelector,
    [field]: value,
  } as SelectorDSL)
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

function onStepTypeChange(index: number, newType: SelectorChain['type']) {
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

function updateStepArg(index: number, arg: SelectorChainView['arg']) {
  const cs = ensureChainSelector()
  const step = cs.chain[index] as SelectorChainView
  updateStep(index, { ...step, arg } as SelectorChain)
}

function updateStepKey(index: number, key: SelectorChainView['key']) {
  const cs = ensureChainSelector()
  const step = cs.chain[index] as SelectorChainView
  updateStep(index, { ...step, key } as SelectorChain)
}

function updateStepEvaluator(index: number, evaluator: EvaluatorDSL) {
  const cs = ensureChainSelector()
  const step = cs.chain[index] as SelectorChainView
  updateStep(index, { ...step, evaluator } as SelectorChain)
}

function updateStepCondition(index: number, condition: ConditionDSL) {
  const cs = ensureChainSelector()
  const step = cs.chain[index] as SelectorChainView
  updateStep(index, { ...step, condition } as SelectorChain)
}

function updateStepTrueValue(index: number, value: Value) {
  const cs = ensureChainSelector()
  const step = cs.chain[index] as SelectorChainView
  updateStep(index, { ...step, trueValue: value } as SelectorChain)
}

function updateStepFalseValue(index: number, value?: Value) {
  const cs = ensureChainSelector()
  const step = cs.chain[index] as SelectorChainView
  updateStep(index, { ...step, falseValue: value } as SelectorChain)
}

function updateStepArgText(index: number, value: string) {
  const cs = ensureChainSelector()
  const step = cs.chain[index] as SelectorChainView
  updateStep(index, { ...step, arg: value } as SelectorChain)
}

function updateExtractorType(index: number, extractorType: ExtractorKind) {
  const cs = ensureChainSelector()
  const prev = cs.chain[index]
  const stepType = prev.type

  if (stepType === 'select') {
    if (extractorType === 'base') {
      updateStep(index, { type: 'select', arg: 'currentHp' })
    } else if (extractorType === 'attribute') {
      updateStep(index, { type: 'select', arg: { type: 'attribute', key: '' } })
    } else if (extractorType === 'relation') {
      updateStep(index, { type: 'select', arg: { type: 'relation', key: '' } })
    } else if (extractorType === 'field') {
      updateStep(index, { type: 'select', arg: { type: 'field', path: '' } })
    } else {
      updateStep(index, { type: 'select', arg: { type: 'dynamic', arg: '' } })
    }
  } else if (stepType === 'whereAttr') {
    const evaluator = prev.type === 'whereAttr' ? prev.evaluator : { type: 'exist' as const }
    if (extractorType === 'base') {
      updateStep(index, { type: 'whereAttr', extractor: 'currentHp', evaluator })
    } else if (extractorType === 'attribute') {
      updateStep(index, { type: 'whereAttr', extractor: { type: 'attribute', key: '' }, evaluator })
    } else if (extractorType === 'relation') {
      updateStep(index, { type: 'whereAttr', extractor: { type: 'relation', key: '' }, evaluator })
    } else if (extractorType === 'field') {
      updateStep(index, { type: 'whereAttr', extractor: { type: 'field', path: '' }, evaluator })
    } else {
      updateStep(index, { type: 'whereAttr', extractor: { type: 'dynamic', arg: '' }, evaluator })
    }
  }
}

function updateExtractorBaseArg(index: number, val: string) {
  const cs = ensureChainSelector()
  const prev = cs.chain[index]
  if (prev.type === 'select') {
    updateStep(index, { type: 'select', arg: val as BaseExtractorKey })
  } else if (prev.type === 'whereAttr') {
    updateStep(index, { type: 'whereAttr', extractor: val as BaseExtractorKey, evaluator: prev.evaluator })
  }
}

function updateExtractorKey(index: number, key: string) {
  const cs = ensureChainSelector()
  const prev = cs.chain[index]
  if (prev.type !== 'select') return
  const arg = prev.arg
  if (typeof arg !== 'object' || Array.isArray(arg)) return
  if (arg.type === 'attribute' || arg.type === 'relation') {
    updateStep(index, { type: 'select', arg: { type: arg.type, key } })
  }
}

function updateExtractorPath(index: number, path: string) {
  const cs = ensureChainSelector()
  const prev = cs.chain[index]
  if (prev.type !== 'select') return
  const arg = prev.arg
  if (typeof arg !== 'object' || Array.isArray(arg)) return
  if (arg.type === 'field') {
    updateStep(index, { type: 'select', arg: { type: 'field', path } })
  }
}

function updateExtractorDynamicArg(index: number, val: string) {
  const cs = ensureChainSelector()
  const prev = cs.chain[index]
  if (prev.type !== 'select') return
  const arg = prev.arg
  if (typeof arg !== 'object' || Array.isArray(arg)) return
  if (arg.type === 'dynamic') {
    updateStep(index, { type: 'select', arg: { type: 'dynamic', arg: val } })
  }
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

function previewStep(step: SelectorChain): string {
  const typeLabel = CHAIN_STEP_TYPES.find(t => t.type === step.type)?.label ?? step.type
  if (NO_PARAM_TYPES.has(step.type)) return typeLabel
  const view = step as SelectorChainView
  if (TEXT_INPUT_TYPES.has(step.type)) {
    return `${typeLabel}: ${typeof view.arg === 'string' ? view.arg : '…'}`
  }
  if (step.type === 'select') {
    const arg = (step as Extract<SelectorChain, { type: 'select' }>).arg
    if (typeof arg === 'string') return `${typeLabel}: ${arg}`
    if (typeof arg === 'object' && arg.type === 'base' && 'arg' in arg) {
      return `${typeLabel}: ${(arg as { arg: string }).arg}`
    }
    if (typeof arg === 'object' && (arg.type === 'attribute' || arg.type === 'relation')) {
      return `${typeLabel}: ${String((arg as { key?: string }).key || arg.type)}`
    }
    if (typeof arg === 'object' && arg.type === 'field') {
      return `${typeLabel}: ${String((arg as { path?: string }).path || arg.type)}`
    }
    if (typeof arg === 'object' && arg.type === 'dynamic') {
      return `${typeLabel}: ${String((arg as { arg?: string }).arg || arg.type)}`
    }
    return `${typeLabel}: ${(arg as { type: string }).type}`
  }
  if (step.type === 'where') return `${typeLabel}: …`
  if (step.type === 'whereAttr') return `${typeLabel}: …`
  if (RECURSIVE_TYPES.has(step.type)) return typeLabel
  if (VALUE_SLOT_TYPES.has(step.type)) return `${typeLabel}: …`
  if (step.type === 'when') return `${typeLabel}: …`
  return typeLabel
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
      <div v-if="pipelineTypeWarning" class="card-step-warning">⚠ {{ pipelineTypeWarning }}</div>
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
              @update:model-value="(v: string | number | boolean) => onStepTypeChange(i, v as SelectorChain['type'])"
            >
              <el-option-group v-for="group in stepGroups" :key="group.label" :label="group.label">
                <el-option
                  v-for="t in group.types"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                  :title="t.description"
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

          <div class="card-body">
            <div v-if="stepWarnings.has(i)" class="card-step-warning">⚠ {{ stepWarnings.get(i) }}</div>
            <div v-if="getChainStepMeta(step.type)?.description" class="card-step-hint">
              {{ getChainStepMeta(step.type)!.description }}
            </div>
            <StepBodyContent
              :step="step"
              :index="i"
              :valid-extractor-keys="getValidKeysForStep(i)"
              :evaluator-field-rule="evaluatorFieldRules.get(i)"
              @update:extractor-type="updateExtractorType"
              @update:extractor-base-arg="updateExtractorBaseArg"
              @update:extractor-key="updateExtractorKey"
              @update:extractor-path="updateExtractorPath"
              @update:extractor-dynamic-arg="updateExtractorDynamicArg"
              @update:step-arg-text="updateStepArgText"
              @update:step-evaluator="updateStepEvaluator"
              @update:step-arg="updateStepArg"
              @update:step-key="updateStepKey"
              @update:step-condition="updateStepCondition"
              @update:step-true-value="updateStepTrueValue"
              @update:step-false-value="updateStepFalseValue"
            />
          </div>

          <div class="card-preview">
            {{ previewStep(step) }}
            <span
              v-if="selectorStates.has(i) && selectorStates.get(i)!.length > 0"
              class="card-state-tag"
              :class="[`state-${selectorStates.get(i)![0].kind}`, { 'state-dimmed': stepWarnings.has(i) }]"
            >
              → {{ selectorStates.get(i)!.map(formatCompileState).join(', ') }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="pipelineTypeWarning" class="card-step-warning">⚠ {{ pipelineTypeWarning }}</div>

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
        <DslNode
          kind="condition"
          :model-value="conditionalFields().condition"
          @update:model-value="(v: unknown) => emitConditionalUpdate('condition', v)"
        />
      </div>
      <div class="conditional-row">
        <span class="conditional-label">为真</span>
        <SelectorEditor
          :model-value="(modelValue as { trueSelector: SelectorDSL }).trueSelector"
          :field-rule="props.fieldRule"
          @update:model-value="(v: SelectorDSL) => emitConditionalUpdate('trueSelector', v)"
        />
      </div>
      <div class="conditional-row">
        <span class="conditional-label">为假</span>
        <SelectorEditor
          :model-value="(modelValue as { falseSelector?: SelectorDSL }).falseSelector ?? 'self'"
          :field-rule="props.fieldRule"
          @update:model-value="(v: SelectorDSL) => emitConditionalUpdate('falseSelector', v)"
        />
      </div>
    </div>

    <div v-else-if="isSelectorValue" class="selector-pipeline">
      <div class="pipeline-base">
        <div class="pipeline-base-row">
          <span class="selector-value-label">值</span>
          <DslNode
            kind="value"
            :model-value="(modelValue as SelectorValue).value"
            @update:model-value="
              (v: unknown) => emitValue({ ...(modelValue as SelectorValue), value: v as Value } as SelectorDSL)
            "
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
              @update:model-value="(v: string | number | boolean) => onStepTypeChange(i, v as SelectorChain['type'])"
            >
              <el-option-group v-for="group in stepGroups" :key="group.label" :label="group.label">
                <el-option
                  v-for="t in group.types"
                  :key="t.value"
                  :label="t.label"
                  :value="t.value"
                  :title="t.description"
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

          <div class="card-body">
            <div v-if="stepWarnings.has(i)" class="card-step-warning">⚠ {{ stepWarnings.get(i) }}</div>
            <div v-if="getChainStepMeta(step.type)?.description" class="card-step-hint">
              {{ getChainStepMeta(step.type)!.description }}
            </div>
            <StepBodyContent
              :step="step"
              :index="i"
              :valid-extractor-keys="getValidKeysForStep(i)"
              :evaluator-field-rule="evaluatorFieldRules.get(i)"
              @update:extractor-type="updateExtractorType"
              @update:extractor-base-arg="updateExtractorBaseArg"
              @update:extractor-key="updateExtractorKey"
              @update:extractor-path="updateExtractorPath"
              @update:extractor-dynamic-arg="updateExtractorDynamicArg"
              @update:step-arg-text="updateStepArgText"
              @update:step-evaluator="updateStepEvaluator"
              @update:step-arg="updateStepArg"
              @update:step-key="updateStepKey"
              @update:step-condition="updateStepCondition"
              @update:step-true-value="updateStepTrueValue"
              @update:step-false-value="updateStepFalseValue"
            />
          </div>

          <div class="card-preview">
            {{ previewStep(step) }}
            <span
              v-if="selectorStates.has(i) && selectorStates.get(i)!.length > 0"
              class="card-state-tag"
              :class="[`state-${selectorStates.get(i)![0].kind}`, { 'state-dimmed': stepWarnings.has(i) }]"
            >
              → {{ selectorStates.get(i)!.map(formatCompileState).join(', ') }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="pipelineTypeWarning" class="card-step-warning">⚠ {{ pipelineTypeWarning }}</div>

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
