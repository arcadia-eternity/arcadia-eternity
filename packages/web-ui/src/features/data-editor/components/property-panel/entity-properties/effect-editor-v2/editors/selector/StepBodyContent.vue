<script setup lang="ts">
import { computed } from 'vue'
import { ElAutocomplete, ElOption, ElSelect } from 'element-plus'
import type {
  BaseExtractorKey,
  ConditionDSL,
  EffectDslFieldTypingRule,
  EvaluatorDSL,
  ExtractorDSL,
  ExtractorKind,
  SelectorChain,
  SelectorChainView,
  SelectorDSL,
  Value,
} from '@arcadia-eternity/schema'

// Narrow type subsets derived from SelectorChain discriminated union
type TextInputStep = Extract<
  SelectorChain,
  { type: 'selectPath' | 'selectProp' | 'selectObservable' | 'selectAttribute$' }
>
type ValueSlotStep = Extract<
  SelectorChain,
  { type: 'randomPick' | 'randomSample' | 'add' | 'multiply' | 'divide' | 'limit' | 'clampMax' | 'clampMin' }
>
type RecursiveStep = Extract<SelectorChain, { type: 'and' | 'or' }>
import DslNode from '../../DslNode.vue'
import {
  EXTRACTOR_TYPES,
  TEXT_INPUT_TYPES,
  VALUE_SLOT_TYPES,
  RECURSIVE_TYPES,
  BASE_EXTRACTOR_OPTIONS,
  COMMON_EXTRACTOR_KEYS,
  COMMON_FIELD_PATHS,
} from '../../constants/selectorConstants'

defineOptions({ name: 'StepBodyContent' })

const props = defineProps<{
  step: SelectorChain
  index: number
  validExtractorKeys: Set<string>
  evaluatorFieldRule?: EffectDslFieldTypingRule
}>()

const emit = defineEmits<{
  'update:extractorType': [index: number, extractorType: ExtractorKind]
  'update:extractorBaseArg': [index: number, val: BaseExtractorKey | string]
  'update:extractorKey': [index: number, key: string]
  'update:extractorPath': [index: number, path: string]
  'update:extractorDynamicArg': [index: number, val: string]
  'update:stepArgText': [index: number, value: string]
  'update:stepEvaluator': [index: number, evaluator: EvaluatorDSL]
  'update:stepArg': [index: number, arg: SelectorChainView['arg']]
  'update:stepKey': [index: number, key: SelectorChainView['key']]
  'update:stepCondition': [index: number, condition: ConditionDSL]
  'update:stepTrueValue': [index: number, value: Value]
  'update:stepFalseValue': [index: number, value: Value | undefined]
}>()

// ── Extractor helpers (use discriminated union narrowing, not cast) ────────────

function getExtractorType(step: SelectorChain): string {
  const extractor = extractExtractor(step)
  if (!extractor) return 'base'
  if (typeof extractor === 'string') return 'base'
  return extractor.type
}

function getExtractorArg(step: SelectorChain): string | undefined {
  const extractor = extractExtractor(step)
  if (!extractor) return undefined
  if (typeof extractor === 'string') return extractor
  // Narrowed: extractor is object ExtractorDSL (type='base' with arg, or type='attribute'/'relation'/'field'/'dynamic')
  if (extractor.type === 'base' && 'arg' in extractor) return (extractor as { arg: string }).arg
  return undefined
}

function getExtractorKey(step: SelectorChain): string | undefined {
  const extractor = extractExtractor(step)
  if (!extractor || typeof extractor === 'string') return undefined
  const ex = extractor as { key?: string }
  return ex.key
}

function getExtractorPath(step: SelectorChain): string | undefined {
  const extractor = extractExtractor(step)
  if (!extractor || typeof extractor === 'string') return undefined
  const ex = extractor as { path?: string }
  return ex.path
}

function getExtractorDynamicArg(step: SelectorChain): string | undefined {
  const extractor = extractExtractor(step)
  if (!extractor || typeof extractor === 'string') return undefined
  const ex = extractor as { arg?: string }
  return ex.arg
}

/** Extract the ExtractorDSL from a step using discriminated union narrowing. */
function extractExtractor(step: SelectorChain): ExtractorDSL | undefined {
  if (step.type === 'select') return step.arg
  if (step.type === 'whereAttr') return step.extractor
  return undefined
}

// ── Extractor option filtering ───────────────────────────────────────────────

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

// ── Helpers for template access ────────────────────────────────────────────────

const step = computed(() => props.step)
const idx = computed(() => props.index)
const extractorType = computed(() => getExtractorType(props.step))
</script>

<template>
  <div>
    <!-- ── select ── -->
    <template v-if="step.type === 'select'">
      <div class="card-field-row">
        <el-select
          :model-value="extractorType"
          class="card-field-select"
          filterable
          @update:model-value="(v: string) => emit('update:extractorType', idx, v as ExtractorKind)"
        >
          <el-option v-for="et in EXTRACTOR_TYPES" :key="et.value" :label="et.label" :value="et.value" />
        </el-select>
        <el-select
          v-if="extractorType === 'base'"
          :model-value="getExtractorArg(step) ?? ''"
          class="card-field-select"
          filterable
          @update:model-value="(v: string) => emit('update:extractorBaseArg', idx, v)"
        >
          <el-option v-for="bk in filteredBaseOptions" :key="bk.value" :label="bk.label" :value="bk.value" />
        </el-select>
        <el-select
          v-else-if="extractorType === 'attribute' || extractorType === 'relation'"
          :model-value="getExtractorKey(step) ?? ''"
          class="card-field-select"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入键名"
          @update:model-value="(v: string) => emit('update:extractorKey', idx, v)"
        >
          <el-option v-for="opt in COMMON_EXTRACTOR_KEYS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-select
          v-else-if="extractorType === 'field'"
          :model-value="getExtractorPath(step) ?? ''"
          class="card-field-select"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入字段路径"
          @update:model-value="(v: string) => emit('update:extractorPath', idx, v)"
        >
          <el-option v-for="opt in COMMON_FIELD_PATHS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-autocomplete
          v-else-if="extractorType === 'dynamic'"
          :model-value="getExtractorDynamicArg(step) ?? ''"
          class="card-field-select"
          placeholder="输入动态参数"
          :fetch-suggestions="fetchDynamicSuggestions"
          trigger-on-focus
          @update:model-value="(v: string | number) => emit('update:extractorDynamicArg', idx, String(v))"
        />
      </div>
    </template>

    <!-- ── TEXT_INPUT_TYPES ── -->
    <template v-else-if="TEXT_INPUT_TYPES.has(step.type)">
      <el-autocomplete
        :model-value="(step as TextInputStep).arg"
        class="card-field-select"
        placeholder="输入参数"
        :fetch-suggestions="fetchDynamicSuggestions"
        trigger-on-focus
        @update:model-value="(v: string | number) => emit('update:stepArgText', idx, String(v))"
      />
    </template>

    <!-- ── where ── -->
    <template v-else-if="step.type === 'where'">
      <DslNode
        kind="evaluator"
        :model-value="step.arg"
        :field-rule="evaluatorFieldRule"
        @update:model-value="(v: unknown) => emit('update:stepArg', idx, v as EvaluatorDSL)"
      />
    </template>

    <!-- ── whereAttr ── -->
    <template v-else-if="step.type === 'whereAttr'">
      <div class="card-field-row">
        <el-select
          :model-value="extractorType"
          class="card-field-select"
          filterable
          @update:model-value="(v: string) => emit('update:extractorType', idx, v as ExtractorKind)"
        >
          <el-option v-for="et in EXTRACTOR_TYPES" :key="et.value" :label="et.label" :value="et.value" />
        </el-select>
        <el-select
          v-if="extractorType === 'base'"
          :model-value="getExtractorArg(step) ?? ''"
          class="card-field-select"
          filterable
          @update:model-value="(v: string) => emit('update:extractorBaseArg', idx, v)"
        >
          <el-option v-for="bk in filteredBaseOptions" :key="bk.value" :label="bk.label" :value="bk.value" />
        </el-select>
        <el-select
          v-else-if="extractorType === 'attribute' || extractorType === 'relation'"
          :model-value="getExtractorKey(step) ?? ''"
          class="card-field-select"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入键名"
          @update:model-value="(v: string) => emit('update:extractorKey', idx, v)"
        >
          <el-option v-for="opt in COMMON_EXTRACTOR_KEYS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-select
          v-else-if="extractorType === 'field'"
          :model-value="getExtractorPath(step) ?? ''"
          class="card-field-select"
          filterable
          allow-create
          default-first-option
          placeholder="选择或输入字段路径"
          @update:model-value="(v: string) => emit('update:extractorPath', idx, v)"
        >
          <el-option v-for="opt in COMMON_FIELD_PATHS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>
        <el-autocomplete
          v-else-if="extractorType === 'dynamic'"
          :model-value="getExtractorDynamicArg(step) ?? ''"
          class="card-field-select"
          placeholder="输入动态参数"
          :fetch-suggestions="fetchDynamicSuggestions"
          trigger-on-focus
          @update:model-value="(v: string | number) => emit('update:extractorDynamicArg', idx, String(v))"
        />
      </div>
      <div class="card-field-row card-field-indent">
        <DslNode
          kind="evaluator"
          :model-value="step.evaluator"
          :field-rule="evaluatorFieldRule"
          @update:model-value="(v: unknown) => emit('update:stepEvaluator', idx, v as EvaluatorDSL)"
        />
      </div>
    </template>

    <!-- ── configGet ── -->
    <template v-else-if="step.type === 'configGet'">
      <DslNode
        kind="value"
        :model-value="step.key"
        @update:model-value="(v: unknown) => emit('update:stepKey', idx, v as Value)"
      />
    </template>

    <!-- ── VALUE_SLOT_TYPES (non-configGet) ── -->
    <template v-else-if="VALUE_SLOT_TYPES.has(step.type)">
      <DslNode
        kind="value"
        :model-value="(step as ValueSlotStep).arg"
        @update:model-value="(v: unknown) => emit('update:stepArg', idx, v as Value)"
      />
    </template>

    <!-- ── RECURSIVE_TYPES (and / or) ── -->
    <template v-else-if="RECURSIVE_TYPES.has(step.type)">
      <div class="card-recursive-builder">
        <DslNode
          kind="selector"
          :model-value="(step as RecursiveStep).arg"
          @update:model-value="(v: unknown) => emit('update:stepArg', idx, v as SelectorDSL)"
        />
      </div>
    </template>

    <!-- ── when ── -->
    <template v-else-if="step.type === 'when'">
      <div class="card-when-grid">
        <div class="card-when-label">条件</div>
        <DslNode
          kind="condition"
          :model-value="step.condition"
          @update:model-value="(v: unknown) => emit('update:stepCondition', idx, v as ConditionDSL)"
        />
        <div class="card-when-label">为真时</div>
        <DslNode
          kind="value"
          :model-value="step.trueValue"
          @update:model-value="(v: unknown) => emit('update:stepTrueValue', idx, v as Value)"
        />
        <div class="card-when-label">为假时</div>
        <DslNode
          kind="value"
          :model-value="step.falseValue"
          :nullable="true"
          :clearable="true"
          @update:model-value="(v: unknown) => emit('update:stepFalseValue', idx, v as Value | undefined)"
        />
      </div>
    </template>

    <!-- ── NO_PARAM_TYPES: no body content ── -->
  </div>
</template>
