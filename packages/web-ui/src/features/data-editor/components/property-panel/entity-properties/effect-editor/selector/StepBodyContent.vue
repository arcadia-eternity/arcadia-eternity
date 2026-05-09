<script lang="ts">
import { defineComponent, h, computed, type PropType, type Component } from 'vue'
import { ElAutocomplete, ElOption, ElSelect } from 'element-plus'
import type { ExtractorDSL, SelectorChain, SelectorDSL } from '@arcadia-eternity/schema'
import SelectorEditor from './SelectorEditor.vue'
import {
  EXTRACTOR_TYPES,
  TEXT_INPUT_TYPES,
  VALUE_SLOT_TYPES,
  BASE_EXTRACTOR_OPTIONS,
  COMMON_EXTRACTOR_KEYS,
  COMMON_FIELD_PATHS,
} from '../constants/selectorConstants'

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

export default defineComponent({
  name: 'StepBodyContent',
  props: {
    step: { type: Object as PropType<SelectorChain>, required: true },
    index: { type: Number, required: true },
    validExtractorKeys: { type: Object as PropType<Set<string>>, required: true },
    onUpdateExtractorType: { type: Function as PropType<(index: number, value: string) => void>, required: true },
    onUpdateExtractorBaseArg: { type: Function as PropType<(index: number, value: string) => void>, required: true },
    onUpdateExtractorKey: { type: Function as PropType<(index: number, value: string) => void>, required: true },
    onUpdateExtractorPath: { type: Function as PropType<(index: number, value: string) => void>, required: true },
    onUpdateExtractorDynamicArg: { type: Function as PropType<(index: number, value: string) => void>, required: true },
    onUpdateStepArgText: { type: Function as PropType<(index: number, value: string) => void>, required: true },
    onUpdateStepEvaluator: { type: Function as PropType<(index: number, value: unknown) => void>, required: true },
    onUpdateStepArg: { type: Function as PropType<(index: number, value: unknown) => void>, required: true },
    onUpdateStepKey: { type: Function as PropType<(index: number, value: unknown) => void>, required: true },
    onUpdateStepCondition: { type: Function as PropType<(index: number, value: unknown) => void>, required: true },
    onUpdateStepTrueValue: { type: Function as PropType<(index: number, value: unknown) => void>, required: true },
    onUpdateStepFalseValue: { type: Function as PropType<(index: number, value: unknown) => void>, required: true },
    evaluatorFieldRule: { type: Object, required: false, default: undefined },
  },
  setup(props, { slots }) {
    const filteredBaseOptions = computed(() => {
      if (props.validExtractorKeys.size === 0) return BASE_EXTRACTOR_OPTIONS
      return BASE_EXTRACTOR_OPTIONS.filter(o => props.validExtractorKeys.has(o.value))
    })

    const dynamicExtractorOptions = computed(() => {
      const seen = new Set<string>()
      const results: { value: string; label: string }[] = []
      if (props.validExtractorKeys.size === 0) {
        const allSources = [...COMMON_FIELD_PATHS, ...COMMON_EXTRACTOR_KEYS, ...BASE_EXTRACTOR_OPTIONS]
        for (const opt of allSources) {
          if (!seen.has(opt.value)) {
            seen.add(opt.value)
            results.push({ value: opt.value, label: opt.label })
          }
        }
      } else {
        for (const key of props.validExtractorKeys) {
          if (!seen.has(key)) {
            seen.add(key)
            results.push({ value: key, label: key })
          }
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
      cb(dynamicExtractorOptions.value.filter(o => o.value.toLowerCase().includes(q)))
    }

    return () => {
      const step = props.step
      const idx = props.index

      if (step.type === 'select') {
        const extractorType = getExtractorType(step)
        const children: ReturnType<typeof h>[] = [
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
          children.push(
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
          children.push(
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
          children.push(
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
          children.push(
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
        return h('div', { class: 'card-field-row' }, children)
      }

      if (TEXT_INPUT_TYPES.has(step.type)) {
        return h(ElAutocomplete, {
          modelValue: (step as { arg: string }).arg,
          class: 'card-field-select',
          placeholder: '输入参数',
          fetchSuggestions: fetchDynamicSuggestions,
          triggerOnFocus: true,
          'onUpdate:modelValue': (v: string | number) => props.onUpdateStepArgText(idx, String(v)),
        })
      }

      if (step.type === 'where') {
        return slots.evaluator?.({
          modelValue: (step as { arg: unknown }).arg,
          update: (v: unknown) => props.onUpdateStepArg(idx, v),
          fieldRule: props.evaluatorFieldRule,
        })
      }

      if (step.type === 'whereAttr') {
        const s = step as { extractor: ExtractorDSL; evaluator: unknown }
        const extractorType = getExtractorType(step)
        const children: ReturnType<typeof h>[] = [
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
          children.push(
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
          children.push(
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
          children.push(
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
          children.push(
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
          h('div', { class: 'card-field-row' }, children),
          h('div', { class: 'card-field-row card-field-indent' }, [
            slots.evaluator?.({
              modelValue: s.evaluator,
              update: (v: unknown) => props.onUpdateStepEvaluator(idx, v),
              fieldRule: props.evaluatorFieldRule,
            }),
          ]),
        ]
      }

      if (step.type === 'and' || step.type === 'or') {
        return h(SelectorEditor as Component, {
          modelValue: (step as { arg: SelectorDSL }).arg,
          class: 'card-recursive-builder',
          'onUpdate:modelValue': (v: SelectorDSL) => props.onUpdateStepArg(idx, v),
        })
      }

      // NOTE: configGet must come before the VALUE_SLOT_TYPES.has() check below
      // because configGet binds to step.key, not step.arg like other value slot types.
      if (step.type === 'configGet') {
        return slots.value?.({
          modelValue: (step as { key: unknown }).key,
          update: (v: unknown) => props.onUpdateStepKey(idx, v),
        })
      }

      if (VALUE_SLOT_TYPES.has(step.type)) {
        return slots.value?.({
          modelValue: (step as { arg: unknown }).arg,
          update: (v: unknown) => props.onUpdateStepArg(idx, v),
        })
      }

      if (step.type === 'when') {
        const s = step as { condition: unknown; trueValue: unknown; falseValue: unknown }
        return h('div', { class: 'card-when-grid' }, [
          h('div', { class: 'card-when-label' }, '条件'),
          slots.condition?.({ modelValue: s.condition, update: (v: unknown) => props.onUpdateStepCondition(idx, v) }),
          h('div', { class: 'card-when-label' }, '为真时'),
          slots.trueValue?.({ modelValue: s.trueValue, update: (v: unknown) => props.onUpdateStepTrueValue(idx, v) }),
          h('div', { class: 'card-when-label' }, '为假时'),
          slots.falseValue?.({
            modelValue: s.falseValue,
            update: (v: unknown) => props.onUpdateStepFalseValue(idx, v),
          }),
        ])
      }

      return null
    }
  },
})
</script>
