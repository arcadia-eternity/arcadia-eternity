<template>
  <div class="optional-editor">
    <div v-if="isMissing" class="optional-placeholder" @click="initValue">
      <el-icon><CirclePlus /></el-icon>
      <span>点击添加{{ label }}</span>
    </div>

    <div v-else-if="isNullValue" class="null-placeholder">
      <span class="null-pill">null</span>
      <div class="null-actions">
        <el-button text size="small" @click="initValue">设值</el-button>
        <el-button v-if="isOptional" text size="small" @click="clearValue">移除</el-button>
      </div>
    </div>

    <template v-else>
      <div class="editor-container">
        <div v-if="showFallbackActions" class="editor-actions">
          <el-button v-if="showClearAction" text size="small" @click="clearValue">清空</el-button>
          <el-button v-if="isNullable" text size="small" @click="setToNull">null</el-button>
        </div>

        <div v-if="isObjectType" class="nested-object">
          <div class="object-header">
            <span class="title">{{ label }}</span>
          </div>
          <div class="object-content">
            <div v-if="objectFields.length === 0" class="empty-tip">对象无可编辑字段</div>
            <div v-else class="object-fields">
              <div v-for="field in objectFields" :key="field.key" class="object-field-row">
                <div class="field-label">
                  <span>{{ field.key }}</span>
                  <span v-if="!field.required" class="optional-mark">optional</span>
                </div>
                <div class="field-editor">
                  <OptionalFieldEditor
                    :model-value="objectModel[field.key]"
                    :schema="field.schema"
                    :label="field.key"
                    :context-kind="contextKind"
                    :field-path="composeObjectFieldPath(field.key)"
                    @update:model-value="value => updateObjectField(field.key, value)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="isArrayType" class="array-editor">
          <div class="array-header">
            <span class="title">{{ label }}</span>
            <el-button size="small" @click="addArrayItem">添加项</el-button>
          </div>

          <div class="array-items">
            <div v-for="(item, index) in localArrayValue" :key="index" class="array-item-row">
              <div class="array-index">#{{ index + 1 }}</div>
              <div class="array-item-editor">
                <OptionalFieldEditor
                  :model-value="item"
                  :schema="arrayItemSchema"
                  :label="`${label || 'item'}[${index}]`"
                  :context-kind="contextKind"
                  :field-path="composeArrayItemPath(index)"
                  @update:model-value="value => updateArrayItem(index, value)"
                />
              </div>
              <el-button text type="danger" @click="removeArrayItem(index)">删除</el-button>
            </div>
            <el-empty v-if="localArrayValue.length === 0" description="数组为空" :image-size="56" />
          </div>
        </div>

        <div v-else-if="isEnumType" class="enum-editor">
          <el-select
            v-model="localEnumValue"
            :placeholder="placeholder"
            clearable
            @clear="clearValue"
            @change="handleEnumChange"
          >
            <el-option v-for="option in enumOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </div>

        <div v-else-if="isBooleanType" class="boolean-editor">
          <el-switch
            v-model="localBooleanValue"
            :active-text="booleanOptions.trueText"
            :inactive-text="booleanOptions.falseText"
          />
        </div>

        <div v-else-if="isTupleType" class="tuple-editor">
          <div class="tuple-header">
            <span class="title">{{ label }}</span>
            <el-tooltip v-if="tupleError" effect="dark" :content="tupleError" placement="top">
              <el-icon class="error-icon"><Warning /></el-icon>
            </el-tooltip>
          </div>

          <div class="tuple-items">
            <div v-for="(itemSchema, index) in tupleSchemas" :key="index" class="tuple-item">
              <el-input-number
                v-if="isNumberSchema(itemSchema)"
                :model-value="getTupleNumberValue(index)"
                :placeholder="getPlaceholder(itemSchema)"
                :step="getNumberStep(itemSchema)"
                :precision="getNumberPrecision(itemSchema)"
                :step-strictly="isStepStrict(itemSchema)"
                :min="getNumberMin(itemSchema)"
                :max="getNumberMax(itemSchema)"
                controls-position="right"
                @update:model-value="val => updateTupleNumber(index, val)"
                :class="{ 'error-field': tupleError }"
              />
              <el-input
                v-else-if="isStringSchema(itemSchema)"
                :model-value="getTupleStringValue(index)"
                :placeholder="getPlaceholder(itemSchema)"
                @update:model-value="val => updateTupleString(index, val)"
                :class="{ 'error-field': tupleError }"
              />
              <span v-else class="unsupported-type">不支持的类型：{{ (itemSchema as TSchema)[Kind] }}</span>
            </div>
          </div>

          <div v-if="tupleError" class="error-message">{{ tupleError }}</div>
        </div>

        <div v-else-if="isNumberType" class="number-editor">
          <el-input-number
            :model-value="localNumberValue"
            :min="numberOptions.min"
            :max="numberOptions.max"
            :step="numberOptions.step"
            :precision="numberOptions.precision"
            :step-strictly="numberOptions.stepStrictly"
            controls-position="right"
            @update:model-value="handleNumberChange"
          />
        </div>

        <div v-else class="text-editor">
          <el-select-v2
            v-if="hasStringSuggestions"
            v-model="localStringValue"
            :options="stringSuggestionOptions"
            :placeholder="placeholder"
            filterable
            clearable
            allow-create
            @clear="clearValue"
            @change="handleStringChange"
          >
            <template #default="{ item }">
              <div class="suggestion-option">
                <PetIcon
                  v-if="typeof item.petIconId === 'number'"
                  :id="item.petIconId"
                  class="suggestion-option-pet-icon"
                />
                <MarkIcon
                  v-else-if="typeof item.markId === 'string' && item.markId.length > 0"
                  :mark-id="item.markId"
                  :size="18"
                  class="suggestion-option-mark-icon"
                />
                <img v-else-if="item.imageUrl" :src="item.imageUrl" alt="" class="suggestion-option-image" />
                <span v-else-if="item.element" class="suggestion-option-element">
                  <ElementIcon :element="item.element" :size="18" />
                </span>
                <el-icon v-else-if="item.iconComponent" class="suggestion-option-icon">
                  <component :is="item.iconComponent" />
                </el-icon>
                <span class="suggestion-option-id">{{ item.value }}</span>
                <span v-if="item.relation" class="suggestion-option-relation">{{ item.relation }}</span>
              </div>
            </template>
          </el-select-v2>
          <el-input
            v-else
            v-model="localStringValue"
            :placeholder="placeholder"
            :type="inputType"
            clearable
            @clear="clearValue"
            @change="handleStringChange"
          />
          <div v-if="activeRelationHint" class="relation-hint">{{ activeRelationHint }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import i18next from 'i18next'
import type { Element } from '@arcadia-eternity/const'
import {
  type TArray,
  type TInteger,
  type TLiteral,
  type TNumber,
  type TObject,
  type TProperties,
  type TSchema,
  type TString,
  type TTuple,
  type TUnion,
} from '@sinclair/typebox'
import { Kind, OptionalKind } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import { Value } from '@sinclair/typebox/value'
import { CirclePlus, Warning, Document } from '@element-plus/icons-vue'
import { useGameDataStore } from '@/stores/gameData'
import type { EditableDataKind } from '@/components/pack-editor/typeboxDataSchema'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import PetIcon from '@/components/PetIcon.vue'
import MarkIcon from '@/components/MarkIcon.vue'

defineOptions({
  name: 'OptionalFieldEditor',
})

const isNumberSchema = (schema: TSchema): boolean => KindGuard.IsNumber(schema) || KindGuard.IsInteger(schema)
const isStringSchema = (schema: TSchema): boolean => KindGuard.IsString(schema)
const isObjectSchema = (schema: TSchema): boolean => KindGuard.IsObject(schema)
const isArraySchema = (schema: TSchema): boolean => KindGuard.IsArray(schema)
const isBooleanSchema = (schema: TSchema): boolean => KindGuard.IsBoolean(schema)
const isTupleSchema = (schema: TSchema): boolean => KindGuard.IsTuple(schema)

const isEnumSchema = (schema: TSchema): boolean => {
  if (KindGuard.IsUnion(schema)) {
    return (schema as TUnion).anyOf.every((s: TSchema) => KindGuard.IsLiteral(s))
  }
  return false
}

const hasNullInUnion = (schema: TSchema): boolean => {
  if (KindGuard.IsUnion(schema)) {
    return (schema as TUnion).anyOf.some((s: TSchema) => KindGuard.IsNull(s))
  }
  return false
}

const hasDefault = (schema: TSchema): boolean => {
  return 'default' in schema
}

const unwrapSchemaFn = (schema: TSchema): TSchema => {
  if (KindGuard.IsUnion(schema) && hasNullInUnion(schema)) {
    const nonNullTypes = (schema as TUnion).anyOf.filter((s: TSchema) => !KindGuard.IsNull(s))
    if (nonNullTypes.length === 1) {
      return unwrapSchemaFn(nonNullTypes[0])
    }
  }
  return schema
}

const props = defineProps<{
  modelValue: unknown
  schema: TSchema
  label?: string
  contextKind?: EditableDataKind
  fieldPath?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: unknown]
}>()

const gameDataStore = useGameDataStore()
const contextKind = computed(() => props.contextKind)
const fieldPath = computed(() => String(props.fieldPath ?? ''))

const unwrappedSchema = computed(() => unwrapSchemaFn(props.schema))

const isOptional = computed(() => {
  const checkOptional = (schema: TSchema): boolean => {
    if (OptionalKind in schema) return true
    if (hasDefault(schema)) return true
    if (KindGuard.IsUnion(schema)) {
      return (schema as TUnion).anyOf.some((member: TSchema) => KindGuard.IsUndefined(member))
    }
    return false
  }

  return checkOptional(props.schema)
})

const isNullable = computed(() => hasNullInUnion(props.schema))
const isMissing = computed(() => props.modelValue === undefined)
const isNullValue = computed(() => props.modelValue === null)
const isObjectType = computed(() => isObjectSchema(unwrappedSchema.value))
const isArrayType = computed(() => isArraySchema(unwrappedSchema.value))
const isEnumType = computed(() => isEnumSchema(unwrappedSchema.value))
const isBooleanType = computed(() => isBooleanSchema(unwrappedSchema.value))
const isNumberType = computed(() => isNumberSchema(unwrappedSchema.value))
const isTupleType = computed(() => isTupleSchema(unwrappedSchema.value))
const isNullableTuple = computed(() => hasNullInUnion(props.schema) && isTupleSchema(unwrappedSchema.value))
const isCompositeType = computed(() => isObjectType.value || isArrayType.value || isTupleType.value)
const useBuiltinClear = computed(() => isEnumType.value || isStringSchema(unwrappedSchema.value))
const showClearAction = computed(() => isOptional.value && !useBuiltinClear.value)
const showFallbackActions = computed(() => !isCompositeType.value && (showClearAction.value || isNullable.value))

const enumOptions = computed(() => {
  if (!isEnumType.value) return []

  const schema = unwrappedSchema.value
  if (!KindGuard.IsUnion(schema)) return []

  return schema.anyOf
    .filter((s: TSchema) => KindGuard.IsLiteral(s))
    .map((s: TSchema) => (s as TLiteral).const)
    .filter((v): v is string => typeof v === 'string')
    .map(value => ({
      value,
      label: value.replace(/_/g, ' ').toUpperCase(),
    }))
})

function getDecimalPrecision(value: number): number {
  if (!Number.isFinite(value)) return 0
  const text = value.toString().toLowerCase()
  if (text.includes('e-')) {
    const [, exponent = '0'] = text.split('e-')
    return Number(exponent) || 0
  }
  const [, decimals = ''] = text.split('.')
  return decimals.length
}

function resolveNumberSchemaOptions(schema: TSchema): {
  min?: number
  max?: number
  step: number
  precision?: number
  stepStrictly: boolean
} {
  const numberSchema = schema as TNumber | TInteger
  const min = typeof numberSchema.minimum === 'number' ? numberSchema.minimum : undefined
  const max = typeof numberSchema.maximum === 'number' ? numberSchema.maximum : undefined
  const isInteger = KindGuard.IsInteger(schema)
  const baseStep = numberSchema.multipleOf
  const step = typeof baseStep === 'number' && baseStep > 0 ? baseStep : isInteger ? 1 : 0.1
  const precision = isInteger ? 0 : getDecimalPrecision(step)

  return {
    min,
    max,
    step,
    precision: Number.isFinite(precision) ? precision : undefined,
    stepStrictly: typeof baseStep === 'number' && baseStep > 0,
  }
}

function normalizeNumberValue(schema: TSchema, rawValue: unknown): number | undefined {
  if (rawValue === null || rawValue === undefined || rawValue === '') return undefined

  const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue)
  if (!Number.isFinite(numeric)) return undefined

  const options = resolveNumberSchemaOptions(schema)
  let nextValue = numeric

  if (typeof options.min === 'number') {
    nextValue = Math.max(options.min, nextValue)
  }
  if (typeof options.max === 'number') {
    nextValue = Math.min(options.max, nextValue)
  }

  if (KindGuard.IsInteger(schema)) {
    nextValue = Math.round(nextValue)
  }

  const numberSchema = schema as TNumber | TInteger
  if (typeof numberSchema.multipleOf === 'number' && numberSchema.multipleOf > 0) {
    nextValue = Math.round(nextValue / numberSchema.multipleOf) * numberSchema.multipleOf
  }

  if (typeof options.precision === 'number') {
    nextValue = Number(nextValue.toFixed(options.precision))
  }

  return Number.isFinite(nextValue) ? nextValue : undefined
}

const numberOptions = computed(() => {
  if (!isNumberType.value)
    return {
      step: 1,
      stepStrictly: false,
    }
  return resolveNumberSchemaOptions(unwrappedSchema.value)
})

const tupleSchemas = computed<TSchema[]>(() => {
  if (!isTupleSchema(unwrappedSchema.value)) return []
  return (unwrappedSchema.value as TTuple).items || []
})

const booleanOptions = computed(() => ({
  trueText: '是',
  falseText: '否',
}))

const inputType = computed(() => {
  if (isNumberSchema(unwrappedSchema.value)) return 'number'
  if (isStringSchema(unwrappedSchema.value)) return 'text'
  return 'text'
})

const localEnumValue = computed({
  get: () => (props.modelValue !== undefined ? props.modelValue : undefined),
  set: val => emit('update:modelValue', val),
})

const localBooleanValue = computed({
  get: () => Boolean(props.modelValue),
  set: val => emit('update:modelValue', val),
})

const localNumberValue = computed<number | undefined>(() => {
  return normalizeNumberValue(unwrappedSchema.value, props.modelValue)
})

const localStringValue = computed({
  get: () => (props.modelValue !== undefined && props.modelValue !== null ? String(props.modelValue) : ''),
  set: val => emit('update:modelValue', val.trim() || undefined),
})

type StringSuggestionOption = {
  value: string
  label: string
  petIconId?: number
  markId?: string
  imageUrl?: string
  element?: Element
  iconComponent?: Component
  relation?: string
}

const normalizedFieldPath = computed(() => fieldPath.value.replace(/\[\d+\]/g, '[]').replace(/^\./, ''))

function resolveSpeciesPetIconId(species: { num?: number } | undefined): number {
  return typeof species?.num === 'number' && species.num > 0 ? species.num : 999
}

function translateSpeciesName(id: string): string | null {
  const translated = i18next.t(`${id}.name`, { ns: 'species', defaultValue: id })
  return translated !== id ? translated : null
}

function translateSkillName(id: string): string | null {
  const translated = i18next.t(`${id}.name`, { ns: 'skill', defaultValue: id })
  return translated !== id ? translated : null
}

function translateMarkName(id: string): string | null {
  const translated = i18next.t(`${id}.name`, {
    ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
    defaultValue: id,
  })
  return translated !== id ? translated : null
}

function toSuggestionOption(
  value: string,
  iconComponent: Component | null,
  relation: string | null,
  options?: {
    petIconId?: number
    markId?: string
    imageUrl?: string
    element?: Element
  },
): StringSuggestionOption {
  return {
    value,
    label: relation ? `${value} ${relation}` : value,
    petIconId: options?.petIconId,
    markId: options?.markId,
    imageUrl: options?.imageUrl,
    element: options?.element,
    iconComponent: iconComponent ?? undefined,
    relation: relation ?? undefined,
  }
}

const stringSuggestionCatalog = computed<StringSuggestionOption[]>(() => {
  const path = normalizedFieldPath.value

  if (path === 'learnable_skills[].skill_id' || path === 'skill_id') {
    return gameDataStore.skills.allIds.map(id => {
      const skill = gameDataStore.skills.byId[id]
      return toSuggestionOption(id, null, translateSkillName(id), {
        element: skill?.element as Element | undefined,
      })
    })
  }

  if (path === 'ability[]' || path === 'emblem[]') {
    return gameDataStore.marks.allIds.map(id => {
      return toSuggestionOption(id, null, translateMarkName(id), {
        markId: id,
      })
    })
  }

  if (path === 'effect[]') {
    return gameDataStore.effects.allIds.map(id => toSuggestionOption(id, Document, null))
  }

  if (path === 'species' || path === 'species_id') {
    return gameDataStore.species.allIds.map(id => {
      const species = gameDataStore.species.byId[id]
      return toSuggestionOption(id, null, translateSpeciesName(id), {
        petIconId: resolveSpeciesPetIconId(species),
      })
    })
  }

  if (path === 'id') {
    if (contextKind.value === 'species') {
      return gameDataStore.species.allIds.map(id => {
        const species = gameDataStore.species.byId[id]
        return toSuggestionOption(id, null, translateSpeciesName(id), {
          petIconId: resolveSpeciesPetIconId(species),
        })
      })
    }
    if (contextKind.value === 'skills') {
      return gameDataStore.skills.allIds.map(id => {
        const skill = gameDataStore.skills.byId[id]
        return toSuggestionOption(id, null, translateSkillName(id), {
          element: skill?.element as Element | undefined,
        })
      })
    }
    if (contextKind.value === 'marks') {
      return gameDataStore.marks.allIds.map(id => {
        return toSuggestionOption(id, null, translateMarkName(id), {
          markId: id,
        })
      })
    }
  }

  return []
})

const hasStringSuggestions = computed(
  () => isStringSchema(unwrappedSchema.value) && stringSuggestionCatalog.value.length > 0,
)

const stringSuggestionOptions = computed(() => {
  return stringSuggestionCatalog.value.map(item => ({
    value: item.value,
    label: item.label,
    petIconId: item.petIconId,
    markId: item.markId,
    imageUrl: item.imageUrl,
    element: item.element,
    iconComponent: item.iconComponent,
    relation: item.relation,
  }))
})

const activeRelationHint = computed(() => {
  if (typeof props.modelValue !== 'string') return ''
  const hit = stringSuggestionCatalog.value.find(item => item.value === props.modelValue)
  return hit?.relation ? `关联：${hit.relation}` : ''
})

const localTupleValue = ref<unknown[]>([])
const tupleError = ref<string | null>(null)

const placeholder = computed(() => `${props.label || ''}${isOptional.value ? '（可选）' : ''}`)

const objectSchema = computed<TObject<TProperties> | null>(() => {
  if (KindGuard.IsObject(unwrappedSchema.value)) {
    return unwrappedSchema.value as TObject<TProperties>
  }
  return null
})

const objectRequiredSet = computed(() => {
  const required = objectSchema.value?.required
  return new Set(Array.isArray(required) ? required : [])
})

const objectFields = computed(() => {
  const schema = objectSchema.value
  if (!schema) return []

  return Object.entries(schema.properties).map(([key, fieldSchema]) => ({
    key,
    schema: fieldSchema as TSchema,
    required: objectRequiredSet.value.has(key),
  }))
})

const objectModel = computed<Record<string, unknown>>(() => {
  if (typeof props.modelValue !== 'object' || props.modelValue === null || Array.isArray(props.modelValue)) {
    return {}
  }
  return props.modelValue as Record<string, unknown>
})

const arraySchema = computed<TArray | null>(() => {
  if (!KindGuard.IsArray(unwrappedSchema.value)) return null
  return unwrappedSchema.value as TArray
})

const arrayItemSchema = computed<TSchema>(() => {
  const schema = arraySchema.value
  if (!schema) return unwrappedSchema.value
  return schema.items as TSchema
})

const localArrayValue = computed<unknown[]>(() => {
  return Array.isArray(props.modelValue) ? props.modelValue : []
})

const composeObjectFieldPath = (key: string): string => {
  if (!fieldPath.value) return key
  return `${fieldPath.value}.${key}`
}

const composeArrayItemPath = (index: number): string => {
  return `${fieldPath.value}[${index}]`
}

function createDefaultBySchema(schema: TSchema): unknown {
  if (hasDefault(schema)) {
    return Value.Clone((schema as TSchema & { default: unknown }).default)
  }

  try {
    const created = Value.Create(schema)
    if (created !== undefined) {
      return Value.Clone(created)
    }
  } catch {
    // fallback to manual defaults
  }

  if (KindGuard.IsUnion(schema)) {
    const candidate = (schema as TUnion).anyOf.find(item => !KindGuard.IsNull(item))
    if (candidate) return createDefaultBySchema(candidate)
  }

  if (KindGuard.IsObject(schema)) {
    const objectSchema = schema as TObject<TProperties>
    const required = new Set(Array.isArray(objectSchema.required) ? objectSchema.required : [])
    const result: Record<string, unknown> = {}

    for (const [key, fieldSchema] of Object.entries(objectSchema.properties)) {
      const childDefault = createDefaultBySchema(fieldSchema as TSchema)
      if (childDefault === undefined && !required.has(key)) continue
      result[key] = childDefault
    }

    return result
  }
  if (KindGuard.IsArray(schema)) return []
  if (KindGuard.IsTuple(schema)) {
    const tupleSchema = schema as TTuple
    return (tupleSchema.items ?? []).map(item => createDefaultBySchema(item))
  }
  if (KindGuard.IsBoolean(schema)) return false
  if (KindGuard.IsInteger(schema) || KindGuard.IsNumber(schema)) {
    const options = resolveNumberSchemaOptions(schema)
    const base = typeof options.min === 'number' ? options.min : 0
    return normalizeNumberValue(schema, base) ?? 0
  }
  if (KindGuard.IsString(schema)) return ''

  return undefined
}

const validateTuple = (value: unknown[]) => {
  try {
    if (Value.Check(props.schema, value)) {
      tupleError.value = null
      return true
    }

    const errors = [...Value.Errors(props.schema, value)]
    tupleError.value = errors.map(error => `${error.path} ${error.message}`).join('; ')
    return false
  } catch {
    tupleError.value = '无效的元组格式'
    return false
  }
}

const initValue = () => {
  let defaultValue = createDefaultBySchema(unwrappedSchema.value)

  if (defaultValue === undefined) {
    if (isNullableTuple.value) defaultValue = tupleSchemas.value.map(item => createDefaultBySchema(item))
    else if (isObjectType.value) defaultValue = {}
    else if (isArrayType.value) defaultValue = []
    else if (isBooleanType.value) defaultValue = false
    else if (isNumberType.value) defaultValue = 0
    else if (isTupleType.value) defaultValue = tupleSchemas.value.map(item => createDefaultBySchema(item))
    else defaultValue = ''
  }

  emit('update:modelValue', defaultValue)
}

const clearValue = () => {
  emit('update:modelValue', undefined)
}

const setToNull = () => {
  if (isNullable.value) {
    emit('update:modelValue', null)
  }
}

const handleEnumChange = (val: string | null) => {
  emit('update:modelValue', val !== null ? val : undefined)
}

const handleStringChange = (val: string) => {
  emit('update:modelValue', val !== '' ? val : undefined)
}

const handleNumberChange = (value: number | null | undefined) => {
  emit('update:modelValue', normalizeNumberValue(unwrappedSchema.value, value))
}

const handleTupleChange = (index: number, value: unknown) => {
  const nextValue = [...localTupleValue.value]
  nextValue[index] = value

  if (validateTuple(nextValue)) {
    emit('update:modelValue', nextValue)
  }
}

const getTupleNumberValue = (index: number): number | undefined => {
  const schema = tupleSchemas.value[index]
  if (!schema) return undefined
  const raw = localTupleValue.value[index]
  return normalizeNumberValue(schema, raw)
}

const updateTupleNumber = (index: number, value: number | null | undefined) => {
  const schema = tupleSchemas.value[index]
  const normalized = schema ? normalizeNumberValue(schema, value) : undefined
  handleTupleChange(index, normalized)
}

const getTupleStringValue = (index: number): string => {
  const raw = localTupleValue.value[index]
  if (raw == null) return ''
  return String(raw)
}

const updateTupleString = (index: number, value: string | number) => {
  const next = typeof value === 'string' ? value : String(value)
  handleTupleChange(index, next)
}

const updateObjectField = (key: string, value: unknown) => {
  const next = {
    ...objectModel.value,
  }

  if (value === undefined) {
    delete next[key]
  } else {
    next[key] = value
  }

  emit('update:modelValue', next)
}

const addArrayItem = () => {
  const next = [...localArrayValue.value]
  const defaultItem = createDefaultBySchema(arrayItemSchema.value)
  next.push(defaultItem === undefined ? null : defaultItem)
  emit('update:modelValue', next)
}

const removeArrayItem = (index: number) => {
  const next = [...localArrayValue.value]
  next.splice(index, 1)
  emit('update:modelValue', next)
}

const updateArrayItem = (index: number, value: unknown) => {
  const next = [...localArrayValue.value]
  next[index] = value
  emit('update:modelValue', next)
}

const getNumberStep = (schema: TSchema) => {
  return resolveNumberSchemaOptions(schema).step
}

const getNumberPrecision = (schema: TSchema) => {
  return resolveNumberSchemaOptions(schema).precision
}

const isStepStrict = (schema: TSchema) => {
  return resolveNumberSchemaOptions(schema).stepStrictly
}

const getNumberMin = (schema: TSchema) => {
  return resolveNumberSchemaOptions(schema).min
}

const getNumberMax = (schema: TSchema) => {
  return resolveNumberSchemaOptions(schema).max
}

const getPlaceholder = (schema: TSchema) => {
  if (isNumberSchema(schema)) {
    const min = (schema as TNumber | TInteger).minimum
    const max = (schema as TNumber | TInteger).maximum
    return `请输入${min ?? '-∞'}~${max ?? '+∞'}之间的数值`
  }

  if (isStringSchema(schema)) {
    const min = (schema as TString).minLength
    return `至少${min ?? 0}个字符`
  }

  return '请输入'
}

watch(
  () => props.modelValue,
  newValue => {
    if (isNullableTuple.value && newValue === null) {
      localTupleValue.value = []
      return
    }

    if (Array.isArray(newValue)) {
      localTupleValue.value = newValue.map((value, index) => {
        const schema = tupleSchemas.value[index]
        if (schema && isNumberSchema(schema)) return Number(value) || 0
        if (schema && isStringSchema(schema)) return String(value)
        return value
      })
      validateTuple(newValue)
      return
    }

    localTupleValue.value = []
  },
  { immediate: true, deep: true },
)
</script>

<style scoped>
.optional-editor {
  position: relative;
  margin: var(--ae-space-2) 0;
}

.optional-placeholder {
  cursor: pointer;
  padding: var(--ae-space-2) var(--ae-space-3);
  border: 1px dashed var(--ae-border-default);
  border-radius: var(--ae-radius-sm);
  display: inline-flex;
  align-items: center;
  gap: var(--ae-space-2);
  color: var(--ae-text-muted);
  transition: all 0.2s;
  background-color: var(--ae-bg-elevated);
}

.optional-placeholder:hover {
  border-color: var(--ae-accent-primary);
  background-color: var(--ae-accent-primary-subtle);
  color: var(--ae-text-secondary);
}

.editor-container {
  position: relative;
  display: grid;
  gap: var(--ae-space-1);
}

.editor-actions {
  display: inline-flex;
  gap: var(--ae-space-1);
  justify-content: flex-end;
}

.null-placeholder {
  border: 1px dashed var(--ae-border-default);
  border-radius: var(--ae-radius-md);
  background: var(--ae-bg-elevated);
  min-height: 34px;
  padding: var(--ae-space-1) var(--ae-space-2);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ae-space-2);
}

.null-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid var(--ae-border-default);
  background: var(--ae-bg-overlay);
  color: var(--ae-warning);
  font-size: var(--ae-font-sm);
  line-height: 1;
  padding: var(--ae-space-1) var(--ae-space-2);
}

.null-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--ae-space-1);
}

.nested-object {
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md);
  padding: var(--ae-space-2);
  background: var(--ae-bg-elevated);
}

.nested-object .nested-object {
  padding: var(--ae-space-1);
  border: none;
  background: transparent;
}

.nested-object .nested-object .nested-object {
  padding: 0;
}

.object-header {
  margin-bottom: var(--ae-space-2);
  padding-bottom: var(--ae-space-1);
  border-bottom: 1px solid var(--ae-border-subtle);
}

.title {
  font-size: var(--ae-font-sm);
  font-weight: 600;
  color: var(--ae-text-primary);
}

.object-content {
  min-height: 24px;
}

.empty-tip {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-xs);
}

.object-fields {
  display: grid;
  gap: var(--ae-space-3);
}

.object-field-row {
  display: flex;
  flex-direction: column;
  gap: var(--ae-space-1);
}

.field-label {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  color: var(--ae-text-secondary);
  font-size: var(--ae-font-sm);
  padding-top: var(--ae-space-1);
}

.optional-mark {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-xs);
}

.array-editor {
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md);
  padding: var(--ae-space-3);
  background: var(--ae-bg-elevated);
}

.array-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--ae-space-2);
}

.array-items {
  display: grid;
  gap: var(--ae-space-2);
}

.array-item-row {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: var(--ae-space-2);
  align-items: start;
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-md);
  padding: var(--ae-space-2);
}

.array-index {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-sm);
  padding-top: var(--ae-space-1);
}

.boolean-editor {
  display: flex;
  align-items: center;
  min-height: 32px;
}

.number-editor {
  width: 100%;
}

.number-editor :deep(.el-input-number) {
  width: 100%;
}

.enum-editor :deep(.el-select) {
  min-width: 160px;
}

.text-editor {
  display: grid;
  gap: var(--ae-space-1);
}

.text-editor :deep(.el-select-v2) {
  width: 100%;
}

.suggestion-option {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  min-width: 0;
}

.suggestion-option-icon {
  font-size: 16px;
  color: var(--ae-accent-primary);
  flex: 0 0 auto;
}

.suggestion-option-pet-icon,
.suggestion-option-mark-icon,
.suggestion-option-image {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.suggestion-option-image {
  border-radius: var(--ae-radius-sm);
  object-fit: contain;
  border: 1px solid var(--ae-border-default);
  background: var(--ae-bg-overlay);
}

.suggestion-option-element {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.suggestion-option-element :deep(.element-icon) {
  min-height: 18px;
  width: 18px;
  height: 18px;
}

.suggestion-option-id {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-primary);
  white-space: nowrap;
}

.suggestion-option-relation {
  margin-left: auto;
  min-width: 0;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.relation-hint {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  line-height: 1.3;
}

.tuple-editor {
  border: 1px solid var(--ae-border-subtle);
  border-radius: var(--ae-radius-sm);
  padding: var(--ae-space-3);
  position: relative;
}

.tuple-header {
  display: flex;
  align-items: center;
  margin-bottom: var(--ae-space-2);
}

.error-icon {
  color: var(--ae-error);
  margin-left: var(--ae-space-2);
  cursor: help;
}

.tuple-items {
  display: grid;
  gap: var(--ae-space-2);
}

.tuple-item :deep(.el-input-number) {
  width: 100%;
}

.error-field :deep(.el-input__inner) {
  border-color: var(--ae-error);
  background: var(--ae-error-subtle);
}

.error-message {
  color: var(--ae-error);
  font-size: var(--ae-font-sm);
  margin-top: var(--ae-space-1);
}

.unsupported-type {
  color: var(--ae-text-muted);
  font-style: italic;
}

@media (max-width: 880px) {
  .object-field-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .field-label {
    padding-top: 0;
  }

  .array-item-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .array-index {
    padding-top: 0;
  }
}
</style>
