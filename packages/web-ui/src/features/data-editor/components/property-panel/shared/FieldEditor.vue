<template>
  <!-- String with suggestions -->
  <div v-if="hasSuggestions" class="field-nullable-wrapper">
    <el-select-v2
      :model-value="stringValue"
      :options="suggestionOptions"
      :placeholder="placeholder"
      filterable
      clearable
      allow-create
      class="w-full"
      @update:model-value="handleStringChange"
    >
      <template #default="{ item }">
        <div class="flex items-center gap-1">
          <PetIcon v-if="typeof item.petIconId === 'number'" :id="item.petIconId" class="w-[18px] h-[18px]" />
          <MarkIcon
            v-else-if="typeof item.markId === 'string' && item.markId.length > 0"
            :mark-id="item.markId"
            :size="18"
            class="w-[18px] h-[18px]"
          />
          <span v-else-if="item.element" class="w-[18px] h-[18px]">
            <ElementIcon :element="item.element" :size="18" />
          </span>
          <span class="text-sm">{{ item.value }}</span>
          <span v-if="item.relation" class="text-xs text-gray-400 ml-auto">{{ item.relation }}</span>
        </div>
      </template>
    </el-select-v2>
    <button v-if="nullable" type="button" class="field-clear-btn" title="清空为默认值" @click="clearToNull">×</button>
  </div>

  <!-- String (plain) -->
  <div v-else-if="fieldType === 'string'" class="field-nullable-wrapper">
    <el-input
      :model-value="isShowingDefault ? String(defaultValue) : stringValue"
      :placeholder="placeholder"
      :class="{ 'field-using-default': isShowingDefault }"
      clearable
      @update:model-value="handleStringChange"
      @focus="onNullableFocus"
    />
    <button v-if="nullable" type="button" class="field-clear-btn" title="清空为默认值" @click="clearToNull">×</button>
  </div>

  <!-- Enum -->
  <div v-else-if="fieldType === 'enum'" class="field-nullable-wrapper">
    <el-select
      :model-value="value as string"
      :placeholder="isShowingDefault ? String(defaultValue) : placeholder"
      :class="{ 'field-using-default': isShowingDefault }"
      clearable
      class="w-full"
      @update:model-value="v => $emit('update', v ?? null)"
      @focus="onNullableFocus"
    >
      <el-option v-for="opt in enumOptions" :key="opt.value" :label="opt.label" :value="opt.value">
        <div class="flex items-center gap-2">
          <ElementIcon v-if="opt.element" :element="opt.element" :size="16" />
          <span>{{ opt.label }}</span>
        </div>
      </el-option>
    </el-select>
    <button v-if="nullable" type="button" class="field-clear-btn" title="清空为默认值" @click="clearToNull">×</button>
  </div>

  <!-- Number -->
  <div v-else-if="fieldType === 'number'" class="field-nullable-wrapper">
    <el-input-number
      :model-value="isShowingDefault ? defaultValue : normalizedNumber"
      :min="numberOptions.min"
      :max="numberOptions.max"
      :step="numberOptions.step"
      :precision="numberOptions.precision"
      :step-strictly="numberOptions.stepStrictly"
      controls-position="right"
      :class="{ 'field-using-default': isShowingDefault }"
      class="flex-1"
      @focus="onNullableFocus"
      @update:model-value="handleNumberChange"
    />
    <button v-if="nullable" type="button" class="field-clear-btn" title="清空为默认值" @click="clearToNull">×</button>
  </div>

  <!-- Boolean -->
  <el-switch
    v-else-if="fieldType === 'boolean'"
    :model-value="Boolean(value)"
    active-text="是"
    inactive-text="否"
    @update:model-value="$emit('update', $event)"
  />

  <!-- Number or Tuple (e.g., multihit) -->
  <div v-else-if="fieldType === 'numberOrTuple'" class="field-nullable-wrapper">
    <div class="number-or-tuple-editor">
      <div class="nt-toggle">
        <button type="button" class="nt-toggle-btn" :class="{ active: isSingleMode }" @click="switchToSingle">
          固定
        </button>
        <button type="button" class="nt-toggle-btn" :class="{ active: !isSingleMode }" @click="switchToRange">
          范围
        </button>
      </div>
      <div class="nt-inputs">
        <!-- Single: one number -->
        <el-input-number
          v-if="isSingleMode && numberOrTupleMembers.numberSchema"
          :model-value="singleValue"
          :min="getNumberOptions(numberOrTupleMembers.numberSchema).min"
          :max="getNumberOptions(numberOrTupleMembers.numberSchema).max"
          :step="getNumberOptions(numberOrTupleMembers.numberSchema).step"
          controls-position="right"
          class="flex-1"
          @update:model-value="onSingleChange"
        />
        <!-- Range: two numbers -->
        <template v-else-if="!isSingleMode && numberOrTupleMembers.tupleSchema">
          <el-input-number
            :model-value="rangeLow"
            controls-position="right"
            class="flex-1"
            @update:model-value="onRangeLowChange"
          />
          <span class="nt-separator">～</span>
          <el-input-number
            :model-value="rangeHigh"
            controls-position="right"
            class="flex-1"
            @update:model-value="onRangeHighChange"
          />
        </template>
      </div>
    </div>
    <button v-if="nullable" type="button" class="field-clear-btn" title="清空为默认值" @click="clearToNull">×</button>
  </div>

  <!-- Tuple -->
  <div v-else-if="fieldType === 'tuple'" class="flex gap-2">
    <template v-for="(itemSchema, i) in tupleSchemas" :key="i">
      <el-input-number
        v-if="isNumberSchema(itemSchema)"
        :model-value="getTupleValue(i) as number | null | undefined"
        :step="getStep(itemSchema)"
        :precision="getPrecision(itemSchema)"
        controls-position="right"
        class="flex-1"
        @update:model-value="updateTupleNumber(i, $event)"
      />
      <el-input
        v-else-if="isStringSchema(itemSchema)"
        :model-value="getTupleValue(i) as string | number | null | undefined"
        class="flex-1"
        @update:model-value="updateTupleString(i, $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Element } from '@arcadia-eternity/const'
import { ELEMENT_MAP } from '@arcadia-eternity/const'
import { type TSchema, type TUnion, type TLiteral, type TNumber, type TInteger, type TTuple } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import { useGameDataStore } from '@/stores/gameData'
import type { EditableDataKind } from '@/features/data-editor/schemas/editorSchemas'
import { translateEntityName } from '../../../schemas/editorSchemas'
import { useGameConfig } from '../../../game-config'
import type { EntityKind } from '../../../game-config/types'
import PetIcon from '@/components/PetIcon.vue'
import MarkIcon from '@/components/MarkIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'

const props = defineProps<{
  value: unknown
  schema: TSchema
  fieldPath: string
  contextKind?: EditableDataKind
  nullable?: boolean
  defaultValue?: unknown
}>()

const emit = defineEmits<{
  update: [value: unknown]
}>()

const gameDataStore = useGameDataStore()
const config = useGameConfig()

// --- Schema Helpers ---

function unwrapSchema(schema: TSchema): TSchema {
  if (KindGuard.IsUnion(schema)) {
    const members = (schema as TUnion).anyOf
    const nonNull = members.filter((m: TSchema) => !KindGuard.IsNull(m))
    if (nonNull.length === 1) return unwrapSchema(nonNull[0])
  }
  return schema
}

const unwrapped = computed(() => unwrapSchema(props.schema))
const normalizedPath = computed(() => props.fieldPath.replace(/\[\d+\]/g, '[]').replace(/^\./, ''))

const isNull = computed(() => props.value === null || props.value === undefined)
const isShowingDefault = computed(() => isNull.value && props.defaultValue !== undefined)

const fieldType = computed(() => {
  const s = unwrapped.value
  if (isEnumSchema(s)) return 'enum'
  if (KindGuard.IsString(s)) return 'string'
  if (KindGuard.IsNumber(s) || KindGuard.IsInteger(s)) return 'number'
  if (KindGuard.IsBoolean(s)) return 'boolean'
  if (isNumberOrTuple(s)) return 'numberOrTuple'
  if (KindGuard.IsTuple(s)) return 'tuple'
  return 'unknown'
})

function isEnumSchema(schema: TSchema): boolean {
  if (KindGuard.IsUnion(schema)) {
    return (schema as TUnion).anyOf.every((s: TSchema) => KindGuard.IsLiteral(s))
  }
  return false
}

function isNumberOrTuple(schema: TSchema): boolean {
  if (!KindGuard.IsUnion(schema)) return false
  const members = (schema as TUnion).anyOf
  if (members.length < 2) return false
  const nonNull = members.filter(m => !KindGuard.IsNull(m))
  const hasNumber = nonNull.some(m => KindGuard.IsNumber(m) || KindGuard.IsInteger(m))
  const hasTuple = nonNull.some(m => KindGuard.IsTuple(m))
  return hasNumber && hasTuple
}

const isNumberSchema = (s: TSchema) => KindGuard.IsNumber(s) || KindGuard.IsInteger(s)
const isStringSchema = (s: TSchema) => KindGuard.IsString(s)

// --- String ---

const stringValue = computed(() => (props.value !== undefined && props.value !== null ? String(props.value) : ''))

const placeholder = computed(() => '请输入')

function handleStringChange(val: string | null) {
  emit('update', val && val.trim() ? val.trim() : undefined)
}

// --- Suggestions ---

type SuggestionOption = {
  value: string
  label: string
  petIconId?: number
  markId?: string
  element?: Element
  relation?: string
}

function buildEntitySuggestions(entityKind: EntityKind): SuggestionOption[] {
  const entities = gameDataStore[entityKind as keyof typeof gameDataStore]
  if (!entities || typeof entities !== 'object') return []
  const allIds = (entities as { allIds?: string[] }).allIds
  const byId = (entities as { byId?: Record<string, Record<string, unknown>> }).byId
  if (!allIds || !byId) return []

  const entityConfig = config.entities[entityKind]
  return allIds.map(id => {
    const record = byId[id]
    const name = entityConfig ? translateEntityName(id, entityConfig) : null
    const option: SuggestionOption = {
      value: id,
      label: name && name !== id ? name : id,
      relation: name && name !== id ? id : undefined,
    }
    // Attach icon metadata based on entity type
    if (entityKind === 'species') {
      option.petIconId = typeof record?.num === 'number' && record.num > 0 ? record.num : 999
    } else if (entityKind === 'marks') {
      option.markId = id
    } else if (entityKind === 'skills') {
      option.element = record?.element as Element | undefined
    }
    return option
  })
}

/**
 * Derives the referenced entity kind from a field name by checking config.entities.
 * E.g. 'skill_id' → 'skills', 'species' → 'species', 'emblem' → 'marks' (if registered).
 */
function inferEntityKindFromField(path: string): EntityKind | null {
  const cleanPath = path.replace(/\[\]/g, '').replace(/^\./, '')
  for (const kind of Object.keys(config.entities)) {
    // Direct match on field name (e.g. 'id', 'species')
    if (cleanPath === kind) return kind
    // Match patterns like 'skill_id', 'species_id', 'mark_id'
    if (cleanPath.endsWith(`_${kind}`) || cleanPath.startsWith(`${kind}_`)) return kind
    // Match plural forms (e.g. 'skills' → 'skills')
    if (cleanPath.includes(kind)) return kind
  }
  // Heuristic: strip common suffixes and re-check
  const stripped = cleanPath.replace(/_id$/, '')
  for (const kind of Object.keys(config.entities)) {
    if (stripped === kind) return kind
  }
  return null
}

const suggestionCatalog = computed<SuggestionOption[]>(() => {
  const path = normalizedPath.value
  const kind = props.contextKind

  // For the primary 'id' field of the entity being edited
  if (path === 'id' && kind) {
    return buildEntitySuggestions(kind)
  }

  // For reference fields, infer the referenced entity kind from config
  const inferredKind = inferEntityKindFromField(path)
  if (inferredKind) {
    return buildEntitySuggestions(inferredKind)
  }

  return []
})

const hasSuggestions = computed(() => fieldType.value === 'string' && suggestionCatalog.value.length > 0)

const suggestionOptions = computed(() =>
  suggestionCatalog.value.map(item => ({
    value: item.value,
    label: item.label,
    petIconId: item.petIconId,
    markId: item.markId,
    element: item.element,
    relation: item.relation,
  })),
)

// --- Enum ---

const enumOptions = computed(() => {
  if (!isEnumSchema(unwrapped.value)) return []
  const values = (unwrapped.value as TUnion).anyOf
    .filter((s: TSchema) => KindGuard.IsLiteral(s))
    .map((s: TSchema) => (s as TLiteral).const)
    .filter((v: unknown): v is string => typeof v === 'string')

  const isElement = values.some(v => v in ELEMENT_MAP)
  const categoryEntries = config.categories ?? []

  return values.map((v: string) => {
    let label = v.replace(/_/g, ' ').toUpperCase()
    let element: Element | undefined
    if (isElement && v in ELEMENT_MAP) {
      const info = ELEMENT_MAP[v]
      label = info.name
      element = v as Element
    } else {
      const cat = categoryEntries.find(c => String(c.value) === v)
      if (cat) label = cat.label
    }
    return { value: v, label, element }
  })
})

// --- Number ---

function getNumberOptions(schema: TSchema) {
  const s = schema as TNumber | TInteger
  const isInt = KindGuard.IsInteger(schema)
  const step = typeof s.multipleOf === 'number' ? s.multipleOf : isInt ? 1 : 0.1
  return {
    min: s.minimum,
    max: s.maximum,
    step,
    precision: isInt ? 0 : getDecimalPrecision(step),
    stepStrictly: typeof s.multipleOf === 'number',
  }
}

function getDecimalPrecision(v: number): number {
  if (!Number.isFinite(v)) return 0
  const text = v.toString().toLowerCase()
  if (text.includes('e-')) return Number(text.split('e-')[1]) || 0
  return (text.split('.')[1] || '').length
}

const numberOptions = computed(() => {
  if (fieldType.value !== 'number') {
    return { min: undefined, max: undefined, step: 1, precision: undefined, stepStrictly: false }
  }
  return getNumberOptions(unwrapped.value)
})

function normalizeNumber(schema: TSchema, raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  const num = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(num)) return undefined
  const opts = getNumberOptions(schema)
  let v = num
  if (typeof opts.min === 'number') v = Math.max(opts.min, v)
  if (typeof opts.max === 'number') v = Math.min(opts.max, v)
  if (KindGuard.IsInteger(schema)) v = Math.round(v)
  if (typeof (schema as TNumber).multipleOf === 'number') {
    v = Math.round(v / (schema as TNumber).multipleOf!) * (schema as TNumber).multipleOf!
  }
  if (typeof opts.precision === 'number') v = Number(v.toFixed(opts.precision))
  return Number.isFinite(v) ? v : undefined
}

const normalizedNumber = computed(() =>
  fieldType.value === 'number' ? normalizeNumber(unwrapped.value, props.value) : undefined,
)

function handleNumberChange(v: number | null | undefined) {
  emit('update', normalizeNumber(unwrapped.value, v))
}

// --- Number or Tuple (Union) ---

const numberOrTupleMembers = computed(() => {
  if (fieldType.value !== 'numberOrTuple') return { numberSchema: null, tupleSchema: null }
  const members = (unwrapped.value as TUnion).anyOf.filter((m: TSchema) => !KindGuard.IsNull(m))
  return {
    numberSchema: members.find(m => KindGuard.IsNumber(m) || KindGuard.IsInteger(m)) ?? null,
    tupleSchema: members.find(m => KindGuard.IsTuple(m)) ?? null,
  }
})

const isSingleMode = computed(() => {
  const v = props.value
  if (isShowingDefault.value) return true // default mode = single
  return typeof v === 'number' || !Array.isArray(v)
})

const singleValue = computed(() => {
  const v = props.value
  if (typeof v === 'number') return v
  if (isShowingDefault.value && typeof props.defaultValue === 'number') return props.defaultValue
  // If current value is a tuple, derive a reasonable single value (midpoint)
  if (Array.isArray(v) && v.length >= 2) return Math.round(((v[0] as number) + (v[1] as number)) / 2)
  return 0
})

const rangeLow = computed(() => {
  if (Array.isArray(props.value) && props.value.length >= 2) return props.value[0] as number
  return 2
})

const rangeHigh = computed(() => {
  if (Array.isArray(props.value) && props.value.length >= 2) return props.value[1] as number
  return 5
})

function switchToSingle() {
  const mid = Math.round((rangeLow.value + rangeHigh.value) / 2)
  emit('update', mid)
}

function switchToRange() {
  const v = singleValue.value
  emit('update', [Math.max(1, v - 1), v + 1])
}

function onSingleChange(v: number | null | undefined) {
  const num = normalizeNumber(numberOrTupleMembers.value.numberSchema!, v)
  emit('update', num)
}

function onRangeLowChange(v: number | null | undefined) {
  const low = normalizeNumber(numberOrTupleMembers.value.tupleSchema!, v)
  const high = rangeHigh.value
  emit('update', [low ?? 2, high])
}

function onRangeHighChange(v: number | null | undefined) {
  const low = rangeLow.value
  const high = normalizeNumber(numberOrTupleMembers.value.tupleSchema!, v)
  emit('update', [low, high ?? 5])
}

// --- Tuple ---

const tupleSchemas = computed<TSchema[]>(() => {
  if (!KindGuard.IsTuple(unwrapped.value)) return []
  return (unwrapped.value as TTuple).items || []
})

function getTupleValue(index: number): unknown {
  return Array.isArray(props.value) ? (props.value as unknown[])[index] : undefined
}

function getStep(schema: TSchema) {
  return getNumberOptions(schema).step
}

function getPrecision(schema: TSchema) {
  return getNumberOptions(schema).precision
}

function updateTupleItem(index: number, val: unknown) {
  const arr = Array.isArray(props.value) ? [...(props.value as unknown[])] : []
  arr[index] = val
  emit('update', arr)
}

function updateTupleNumber(index: number, val: number | null | undefined) {
  updateTupleItem(index, val)
}

function updateTupleString(index: number, val: string | number | null | undefined) {
  updateTupleItem(index, val)
}

// --- Nullable ---

function clearToNull() {
  emit('update', null)
}

function onNullableFocus() {
  if (isShowingDefault.value && props.defaultValue !== undefined) {
    emit('update', props.defaultValue)
  }
}
</script>

<style scoped>
.field-nullable-wrapper {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
}

.field-nullable-wrapper :deep(.el-input-number) {
  flex: 1;
}

.field-nullable-wrapper :deep(.el-input-number.field-using-default .el-input__inner),
.field-nullable-wrapper :deep(.el-select.field-using-default .el-input__inner),
.field-nullable-wrapper :deep(.el-input.field-using-default .el-input__inner) {
  color: var(--ae-text-muted) !important;
  font-style: italic;
}

.field-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--ae-text-muted);
  cursor: pointer;
  border-radius: var(--ae-radius-sm);
  font-size: 14px;
  line-height: 1;
  padding: 0;
  flex-shrink: 0;
  transition:
    color 0.12s ease,
    background 0.12s ease;
}

.field-clear-btn:hover {
  color: var(--ae-error);
  background: var(--ae-hover);
}

.number-or-tuple-editor {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-1);
  flex: 1;
}

.nt-toggle {
  display: flex;
  gap: 1px;
  background: var(--ae-bg-overlay);
  border-radius: var(--ae-radius-sm);
  padding: 2px;
}

.nt-toggle-btn {
  flex: 1;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--ae-text-muted);
  font-size: var(--ae-font-xs);
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--ae-radius-xs);
  transition: all 0.12s ease;
  padding: 0;
}

.nt-toggle-btn:hover {
  color: var(--ae-text-secondary);
}

.nt-toggle-btn.active {
  background: var(--ae-bg-base);
  color: var(--ae-text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

.nt-inputs {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
}

.nt-separator {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-sm);
  flex-shrink: 0;
}
</style>
