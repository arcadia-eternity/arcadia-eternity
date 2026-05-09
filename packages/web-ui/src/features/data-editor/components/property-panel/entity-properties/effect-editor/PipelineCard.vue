<script setup lang="ts">
import { computed, defineComponent, h } from 'vue'
import type { PropType } from 'vue'
import { ElAutocomplete, ElOption, ElSelect } from 'element-plus'
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
import {
  CHAIN_STEP_TYPES,
  EXTRACTOR_TYPES,
  NO_PARAM_TYPES,
  TEXT_INPUT_TYPES,
  VALUE_SLOT_TYPES,
  RECURSIVE_TYPES,
  BASE_EXTRACTOR_OPTIONS,
  COMMON_EXTRACTOR_KEYS,
  COMMON_FIELD_PATHS,
  getChainStepMeta,
} from './constants/selectorConstants'

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

// ── Computed ──

const filteredBaseOptions = computed(() => {
  if (props.validExtractorKeys.size === 0) return BASE_EXTRACTOR_OPTIONS
  return BASE_EXTRACTOR_OPTIONS.filter(o => props.validExtractorKeys.has(o.value))
})

const dynamicExtractorOptions = computed(() => {
  const seen = new Set<string>()
  const results: { value: string; label: string }[] = []

  // No state info available: show all options as fallback
  if (props.validExtractorKeys.size === 0) {
    const allSources = [...COMMON_FIELD_PATHS, ...COMMON_EXTRACTOR_KEYS, ...BASE_EXTRACTOR_OPTIONS]
    for (const opt of allSources) {
      if (!seen.has(opt.value)) {
        seen.add(opt.value)
        results.push({ value: opt.value, label: opt.label })
      }
    }
  } else {
    // Build suggestions from valid keys, enriched with multi-level paths from COMMON_FIELD_PATHS
    for (const key of props.validExtractorKeys) {
      // Include the single-level key itself
      if (!seen.has(key)) {
        seen.add(key)
        results.push({ value: key, label: key })
      }
      // Include multi-level paths where this key is a prefix
      for (const path of COMMON_FIELD_PATHS) {
        if (path.value === key || path.value.startsWith(key + '.')) {
          if (!seen.has(path.value)) {
            seen.add(path.value)
            results.push({ value: path.value, label: path.label })
          }
        }
      }
    }
  }

  return results.sort((a, b) => a.label.localeCompare(b.label))
})

function fetchDynamicSuggestions(queryString: string, cb: (results: { value: string }[]) => void) {
  const q = queryString.toLowerCase()
  const results = dynamicExtractorOptions.value.filter(o => o.value.toLowerCase().includes(q))
  cb(results)
}

// ── Utility functions ──

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

// ── Step body renderer (defineComponent for reliable rendering) ──

const StepBody = defineComponent({
  props: {
    step: { type: Object as PropType<SelectorChain>, required: true },
    index: { type: Number, required: true },
  },
  setup(compProps, { slots }) {
    return () => {
      const step = compProps.step
      const idx = compProps.index

      // --- select ---
      if (step.type === 'select') {
        const extractorType = getExtractorType(step)
        const fieldRowChildren: ReturnType<typeof h>[] = [
          h(
            ElSelect,
            {
              modelValue: extractorType,
              class: 'card-field-select',
              filterable: true,
              'onUpdate:modelValue': (v: string) => props.onUpdateExtractorType(idx, v),
            },
            EXTRACTOR_TYPES.map(et => h(ElOption, { key: et.value, label: et.label, value: et.value })),
          ),
        ]

        if (extractorType === 'base') {
          fieldRowChildren.push(
            h(
              ElSelect,
              {
                modelValue: getExtractorArg(step) ?? '',
                class: 'card-field-select',
                filterable: true,
                'onUpdate:modelValue': (v: string) => props.onUpdateExtractorBaseArg(idx, v),
              },
              filteredBaseOptions.value.map(bk => h(ElOption, { key: bk.value, label: bk.label, value: bk.value })),
            ),
          )
        } else if (extractorType === 'attribute' || extractorType === 'relation') {
          fieldRowChildren.push(
            h(
              ElSelect,
              {
                modelValue: getExtractorKey(step) ?? '',
                class: 'card-field-select',
                filterable: true,
                allowCreate: true,
                defaultFirstOption: true,
                placeholder: '选择或输入键名',
                'onUpdate:modelValue': (v: string) => props.onUpdateExtractorKey(idx, v),
              },
              COMMON_EXTRACTOR_KEYS.map(opt => h(ElOption, { key: opt.value, label: opt.label, value: opt.value })),
            ),
          )
        } else if (extractorType === 'field') {
          fieldRowChildren.push(
            h(
              ElSelect,
              {
                modelValue: getExtractorPath(step) ?? '',
                class: 'card-field-select',
                filterable: true,
                allowCreate: true,
                defaultFirstOption: true,
                placeholder: '选择或输入字段路径',
                'onUpdate:modelValue': (v: string) => props.onUpdateExtractorPath(idx, v),
              },
              COMMON_FIELD_PATHS.map(opt => h(ElOption, { key: opt.value, label: opt.label, value: opt.value })),
            ),
          )
        } else if (extractorType === 'dynamic') {
          fieldRowChildren.push(
            h(ElAutocomplete, {
              modelValue: getExtractorDynamicArg(step) ?? '',
              class: 'card-field-select',
              placeholder: '输入动态参数',
              fetchSuggestions: fetchDynamicSuggestions,
              triggerOnFocus: true,
              'onUpdate:modelValue': (v: string | number) => props.onUpdateExtractorDynamicArg(idx, String(v)),
            }),
          )
        }

        return h('div', { class: 'card-field-row' }, fieldRowChildren)
      }

      // --- TEXT_INPUT_TYPES ---
      if (
        step.type === 'selectPath' ||
        step.type === 'selectProp' ||
        step.type === 'selectObservable' ||
        step.type === 'selectAttribute$'
      ) {
        return h(ElAutocomplete, {
          modelValue: step.arg,
          class: 'card-field-select',
          placeholder: '输入参数',
          fetchSuggestions: fetchDynamicSuggestions,
          triggerOnFocus: true,
          'onUpdate:modelValue': (v: string | number) => props.onUpdateStepArgText(idx, String(v)),
        })
      }

      // --- where ---
      if (step.type === 'where') {
        return slots.evaluator?.({ modelValue: step.arg, update: (v: unknown) => props.onUpdateStepArg(idx, v) })
      }

      // --- whereAttr ---
      if (step.type === 'whereAttr') {
        const extractorType = getExtractorType(step)
        const fieldRowChildren: ReturnType<typeof h>[] = [
          h(
            ElSelect,
            {
              modelValue: extractorType,
              class: 'card-field-select',
              filterable: true,
              'onUpdate:modelValue': (v: string) => props.onUpdateExtractorType(idx, v),
            },
            EXTRACTOR_TYPES.map(et => h(ElOption, { key: et.value, label: et.label, value: et.value })),
          ),
        ]

        if (extractorType === 'base') {
          fieldRowChildren.push(
            h(
              ElSelect,
              {
                modelValue: getExtractorArg(step) ?? '',
                class: 'card-field-select',
                filterable: true,
                'onUpdate:modelValue': (v: string) => props.onUpdateExtractorBaseArg(idx, v),
              },
              filteredBaseOptions.value.map(bk => h(ElOption, { key: bk.value, label: bk.label, value: bk.value })),
            ),
          )
        } else if (extractorType === 'attribute' || extractorType === 'relation') {
          fieldRowChildren.push(
            h(
              ElSelect,
              {
                modelValue: getExtractorKey(step) ?? '',
                class: 'card-field-select',
                filterable: true,
                allowCreate: true,
                defaultFirstOption: true,
                placeholder: '选择或输入键名',
                'onUpdate:modelValue': (v: string) => props.onUpdateExtractorKey(idx, v),
              },
              COMMON_EXTRACTOR_KEYS.map(opt => h(ElOption, { key: opt.value, label: opt.label, value: opt.value })),
            ),
          )
        } else if (extractorType === 'field') {
          fieldRowChildren.push(
            h(
              ElSelect,
              {
                modelValue: getExtractorPath(step) ?? '',
                class: 'card-field-select',
                filterable: true,
                allowCreate: true,
                defaultFirstOption: true,
                placeholder: '选择或输入字段路径',
                'onUpdate:modelValue': (v: string) => props.onUpdateExtractorPath(idx, v),
              },
              COMMON_FIELD_PATHS.map(opt => h(ElOption, { key: opt.value, label: opt.label, value: opt.value })),
            ),
          )
        } else if (extractorType === 'dynamic') {
          fieldRowChildren.push(
            h(ElAutocomplete, {
              modelValue: getExtractorDynamicArg(step) ?? '',
              class: 'card-field-select',
              placeholder: '输入动态参数',
              fetchSuggestions: fetchDynamicSuggestions,
              triggerOnFocus: true,
              'onUpdate:modelValue': (v: string | number) => props.onUpdateExtractorDynamicArg(idx, String(v)),
            }),
          )
        }

        return [
          h('div', { class: 'card-field-row' }, fieldRowChildren),
          h('div', { class: 'card-field-row card-field-indent' }, [
            slots.evaluator?.({
              modelValue: step.evaluator,
              update: (v: unknown) => props.onUpdateStepEvaluator(idx, v),
            }),
          ]),
        ]
      }

      // --- RECURSIVE_TYPES (and / or) ---
      if (step.type === 'and' || step.type === 'or') {
        return h(SelectorBuilder, {
          modelValue: step.arg,
          class: 'card-recursive-builder',
          'onUpdate:modelValue': (v: SelectorDSL) => props.onUpdateStepArg(idx, v),
        })
      }

      // --- configGet ---
      if (step.type === 'configGet') {
        return slots.value?.({ modelValue: step.key, update: (v: unknown) => props.onUpdateStepKey(idx, v) })
      }

      // --- VALUE_SLOT_TYPES (except configGet which is handled above) ---
      if (
        step.type === 'randomPick' ||
        step.type === 'randomSample' ||
        step.type === 'limit' ||
        step.type === 'clampMax' ||
        step.type === 'clampMin' ||
        step.type === 'add' ||
        step.type === 'multiply' ||
        step.type === 'divide'
      ) {
        return slots.value?.({ modelValue: step.arg, update: (v: unknown) => props.onUpdateStepArg(idx, v) })
      }

      // --- when ---
      if (step.type === 'when') {
        return h('div', { class: 'card-when-grid' }, [
          h('div', { class: 'card-when-label' }, '条件'),
          slots.condition?.({
            modelValue: step.condition,
            update: (v: unknown) => props.onUpdateStepCondition(idx, v),
          }),
          h('div', { class: 'card-when-label' }, '为真时'),
          slots.trueValue?.({
            modelValue: step.trueValue,
            update: (v: unknown) => props.onUpdateStepTrueValue(idx, v),
          }),
          h('div', { class: 'card-when-label' }, '为假时'),
          slots.falseValue?.({
            modelValue: step.falseValue,
            update: (v: unknown) => props.onUpdateStepFalseValue(idx, v),
          }),
        ])
      }

      return null
    }
  },
})
</script>

<template>
  <div class="card-body">
    <div v-if="stepWarnings.has(index)" class="card-step-warning">⚠ {{ stepWarnings.get(index) }}</div>
    <div v-if="getChainStepMeta(step.type)?.description" class="card-step-hint">
      {{ getChainStepMeta(step.type)!.description }}
    </div>
    <StepBody :step="step" :index="index" />
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

<style scoped></style>
