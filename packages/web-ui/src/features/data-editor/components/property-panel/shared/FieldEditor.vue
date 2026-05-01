<template>
  <!-- String with suggestions -->
  <el-select-v2
    v-if="hasSuggestions"
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

  <!-- String (plain) -->
  <el-input
    v-else-if="fieldType === 'string'"
    :model-value="stringValue"
    :placeholder="placeholder"
    clearable
    @update:model-value="handleStringChange"
  />

  <!-- Enum -->
  <el-select
    v-else-if="fieldType === 'enum'"
    :model-value="value as string"
    :placeholder="placeholder"
    clearable
    class="w-full"
    @update:model-value="v => $emit('update', v ?? undefined)"
  >
    <el-option v-for="opt in enumOptions" :key="opt.value" :label="opt.label" :value="opt.value">
      <div class="flex items-center gap-2">
        <ElementIcon v-if="opt.element" :element="opt.element" :size="16" />
        <span>{{ opt.label }}</span>
      </div>
    </el-option>
  </el-select>

  <!-- Number -->
  <el-input-number
    v-else-if="fieldType === 'number'"
    :model-value="normalizedNumber"
    :min="numberOptions.min"
    :max="numberOptions.max"
    :step="numberOptions.step"
    :precision="numberOptions.precision"
    :step-strictly="numberOptions.stepStrictly"
    controls-position="right"
    class="w-full"
    @update:model-value="handleNumberChange"
  />

  <!-- Boolean -->
  <el-switch
    v-else-if="fieldType === 'boolean'"
    :model-value="Boolean(value)"
    active-text="是"
    inactive-text="否"
    @update:model-value="$emit('update', $event)"
  />

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
import i18next from 'i18next'
import type { Element } from '@arcadia-eternity/const'
import { ELEMENT_MAP } from '@arcadia-eternity/const'
import { type TSchema, type TUnion, type TLiteral, type TNumber, type TInteger, type TTuple } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import { useGameDataStore } from '@/stores/gameData'
import type { EditableDataKind } from '@/components/pack-editor/typeboxDataSchema'
import PetIcon from '@/components/PetIcon.vue'
import MarkIcon from '@/components/MarkIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'

const CATEGORY_MAP: Record<string, string> = {
  Physical: '物理',
  Special: '特殊',
  Status: '变化',
  Climax: '必杀',
}

const props = defineProps<{
  value: unknown
  schema: TSchema
  fieldPath: string
  contextKind?: EditableDataKind
}>()

const emit = defineEmits<{
  update: [value: unknown]
}>()

const gameDataStore = useGameDataStore()

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

const fieldType = computed(() => {
  const s = unwrapped.value
  if (isEnumSchema(s)) return 'enum'
  if (KindGuard.IsString(s)) return 'string'
  if (KindGuard.IsNumber(s) || KindGuard.IsInteger(s)) return 'number'
  if (KindGuard.IsBoolean(s)) return 'boolean'
  if (KindGuard.IsTuple(s)) return 'tuple'
  return 'unknown'
})

function isEnumSchema(schema: TSchema): boolean {
  if (KindGuard.IsUnion(schema)) {
    return (schema as TUnion).anyOf.every((s: TSchema) => KindGuard.IsLiteral(s))
  }
  return false
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

function translateName(id: string, ns: string | string[]): string | null {
  const translated = i18next.t(`${id}.name`, { ns, defaultValue: id })
  return translated !== id ? translated : null
}

const suggestionCatalog = computed<SuggestionOption[]>(() => {
  const path = normalizedPath.value
  const kind = props.contextKind

  if (path === 'learnable_skills[].skill_id' || path === 'skill_id') {
    return gameDataStore.skills.allIds.map(id => {
      const skill = gameDataStore.skills.byId[id]
      const name = translateName(id, 'skill')
      return {
        value: id,
        label: name ?? id,
        element: skill?.element as Element | undefined,
        relation: name ? id : undefined,
      }
    })
  }

  if (path === 'ability[]' || path === 'emblem[]') {
    return gameDataStore.marks.allIds.map(id => {
      const name = translateName(id, ['mark', 'mark_ability', 'mark_emblem', 'mark_global'])
      return {
        value: id,
        label: name ?? id,
        markId: id,
        relation: name ? id : undefined,
      }
    })
  }

  if (path === 'species' || path === 'species_id') {
    return gameDataStore.species.allIds.map(id => {
      const species = gameDataStore.species.byId[id]
      const name = translateName(id, 'species')
      return {
        value: id,
        label: name ?? id,
        petIconId: typeof species?.num === 'number' && species.num > 0 ? species.num : 999,
        relation: name ? id : undefined,
      }
    })
  }

  if (path === 'id') {
    if (kind === 'species') {
      return gameDataStore.species.allIds.map(id => {
        const species = gameDataStore.species.byId[id]
        const name = translateName(id, 'species')
        return {
          value: id,
          label: name ?? id,
          petIconId: typeof species?.num === 'number' && species.num > 0 ? species.num : 999,
          relation: name ? id : undefined,
        }
      })
    }
    if (kind === 'skills') {
      return gameDataStore.skills.allIds.map(id => {
        const skill = gameDataStore.skills.byId[id]
        const name = translateName(id, 'skill')
        return {
          value: id,
          label: name ?? id,
          element: skill?.element as Element | undefined,
          relation: name ? id : undefined,
        }
      })
    }
    if (kind === 'marks') {
      return gameDataStore.marks.allIds.map(id => {
        const name = translateName(id, ['mark', 'mark_ability', 'mark_emblem', 'mark_global'])
        return {
          value: id,
          label: name ?? id,
          markId: id,
          relation: name ? id : undefined,
        }
      })
    }
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
  const isCategory = values.some(v => v in CATEGORY_MAP)

  return values.map((v: string) => {
    let label = v.replace(/_/g, ' ').toUpperCase()
    let element: Element | undefined
    if (isElement && v in ELEMENT_MAP) {
      const info = ELEMENT_MAP[v]
      label = info.name
      element = v as Element
    } else if (isCategory && v in CATEGORY_MAP) {
      label = CATEGORY_MAP[v]
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
</script>
