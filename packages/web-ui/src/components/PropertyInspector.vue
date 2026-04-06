<template>
  <div class="flex flex-col h-full">
    <!-- Breadcrumb Navigation -->
    <el-breadcrumb separator="/" class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 shrink-0">
      <el-breadcrumb-item
        v-for="(seg, i) in navSegments"
        :key="i"
        :class="{ 'cursor-pointer hover:text-blue-500': i < navSegments.length - 1 }"
        @click="navigateTo(i)"
      >
        {{ seg.label }}
      </el-breadcrumb-item>
    </el-breadcrumb>

    <!-- Fields -->
    <div class="flex-1 overflow-auto p-3">
      <el-empty v-if="!draft" description="选择一条记录开始编辑" :image-size="64" />

      <!-- Array Level -->
      <template v-else-if="isArrayLevel">
        <div class="space-y-2">
          <div v-for="item in currentArrayItems" :key="item.index" class="field-block">
            <!-- Simple array item (string, number, etc.) -->
            <template v-if="item.isSimple">
              <div class="flex items-center gap-2">
                <span class="text-xs text-gray-400 w-6">#{{ item.index + 1 }}</span>
                <FieldEditor
                  :value="item.value"
                  :schema="currentSchema!"
                  :field-path="item.path"
                  :context-kind="contextKind"
                  @update="v => updateField(item.path, v)"
                  class="flex-1"
                />
                <el-button size="small" type="danger" text @click="removeArrayItem(item.index)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </template>

            <!-- Complex array item (object) -->
            <template v-else>
              <div
                class="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                @click="drillIntoArrayItem(item.index)"
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-xs text-gray-400 w-6">#{{ item.index + 1 }}</span>
                  <span class="text-sm truncate">{{ getItemSummary(item) }}</span>
                </div>
                <el-icon class="text-gray-400"><ArrowRight /></el-icon>
              </div>
            </template>
          </div>

          <el-button size="small" type="primary" @click="addArrayItem" class="w-full mt-2">
            <el-icon class="mr-1"><Plus /></el-icon>
            添加
          </el-button>
        </div>
      </template>

      <!-- Object Level -->
      <template v-else>
        <div class="space-y-3">
          <div v-for="field in currentFields" :key="field.key" class="field-block">
            <!-- Number-or-Range union (e.g., multihit: number | [number, number]) -->
            <template v-if="field.fieldType === 'numberOrRange'">
              <div class="flex items-center justify-between mb-1">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ getFieldLabel(field.key).primary }}
                  <span v-if="getFieldLabel(field.key).secondary" class="text-xs text-gray-400 ml-1">
                    {{ getFieldLabel(field.key).secondary }}
                  </span>
                  <span v-if="!field.required" class="text-xs text-gray-400 ml-1">optional</span>
                </label>
                <span v-if="field.isOptional && getFieldValue(field.path) === undefined" class="text-xs text-blue-400">
                  使用默认值
                </span>
                <el-button
                  v-else-if="field.isOptional && field.defaultValue !== undefined"
                  size="small"
                  type="info"
                  text
                  @click="updateField(field.path, undefined)"
                >
                  重置为默认
                </el-button>
              </div>
              <RangeEditor :value="getFieldValue(field.path)" @update="updateField(field.path, $event)" />
            </template>

            <!-- Simple field: inline editor -->
            <template v-else-if="field.isSimple">
              <div class="flex items-center justify-between mb-1">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {{ getFieldLabel(field.key).primary }}
                  <span v-if="getFieldLabel(field.key).secondary" class="text-xs text-gray-400 ml-1">
                    {{ getFieldLabel(field.key).secondary }}
                  </span>
                  <span v-if="!field.required" class="text-xs text-gray-400 ml-1">optional</span>
                </label>
                <span v-if="field.isOptional && getFieldValue(field.path) === undefined" class="text-xs text-blue-400">
                  使用默认值
                </span>
                <el-button
                  v-else-if="field.isOptional && field.defaultValue !== undefined"
                  size="small"
                  type="info"
                  text
                  @click="updateField(field.path, undefined)"
                >
                  重置为默认
                </el-button>
              </div>
              <FieldEditor
                :value="getFieldValue(field.path) ?? field.defaultValue"
                :schema="field.schema"
                :field-path="field.path"
                :context-kind="contextKind"
                :placeholder="
                  field.isOptional && getFieldValue(field.path) === undefined
                    ? String(field.defaultValue ?? '')
                    : undefined
                "
                @update="updateField(field.path, $event)"
              />
            </template>

            <!-- Object field with inline display -->
            <template v-else-if="field.fieldType === 'object' && field.objectDisplay === 'inline'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ getFieldLabel(field.key).primary }}
                <span v-if="getFieldLabel(field.key).secondary" class="text-xs text-gray-400 ml-1">
                  {{ getFieldLabel(field.key).secondary }}
                </span>
              </label>
              <InlineObjectEditor
                :field="field"
                :value="getFieldValue(field.path)"
                @update="updateField(field.path, $event)"
              />
            </template>

            <!-- Collapsible array field -->
            <template v-else-if="field.fieldType === 'array' && field.arrayDisplay === 'inline' && field.collapsible">
              <el-collapse>
                <el-collapse-item :title="getFieldLabel(field.key).primary">
                  <InlineArrayEditor
                    :field="field"
                    :value="getFieldValue(field.path)"
                    @update="updateField(field.path, $event)"
                  />
                </el-collapse-item>
              </el-collapse>
            </template>

            <!-- Non-collapsible inline array -->
            <template v-else-if="field.fieldType === 'array' && field.arrayDisplay === 'inline'">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {{ getFieldLabel(field.key).primary }}
                <span v-if="getFieldLabel(field.key).secondary" class="text-xs text-gray-400 ml-1">
                  {{ getFieldLabel(field.key).secondary }}
                </span>
              </label>
              <InlineArrayEditor
                :field="field"
                :value="getFieldValue(field.path)"
                @update="updateField(field.path, $event)"
              />
            </template>

            <!-- Complex field: drill-down trigger -->
            <template v-else>
              <div
                class="flex items-center justify-between p-2 rounded border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                @click="drillDown(field)"
              >
                <div class="flex flex-col min-w-0">
                  <span class="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {{ getFieldLabel(field.key).primary }}
                    <span v-if="getFieldLabel(field.key).secondary" class="text-xs text-gray-400 ml-1">
                      {{ getFieldLabel(field.key).secondary }}
                    </span>
                    <span v-if="!field.required" class="text-xs text-gray-400 ml-1">optional</span>
                  </span>
                  <span class="text-xs text-gray-500 truncate">
                    {{ getFieldSummary(field) }}
                  </span>
                </div>
                <el-icon class="text-gray-400"><ArrowRight /></el-icon>
              </div>
            </template>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import i18next from 'i18next'
import { ArrowRight, Delete, Plus } from '@element-plus/icons-vue'
import { type TSchema, type TObject, type TProperties, type TArray, type TUnion, type TTuple } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import { Kind, OptionalKind } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { getArrayUIHint, getObjectUIHint, type ArrayDisplayMode } from '@arcadia-eternity/schema'
import FieldEditor from '@/components/FieldEditor.vue'
import InlineArrayEditor from '@/components/InlineArrayEditor.vue'
import InlineObjectEditor from '@/components/InlineObjectEditor.vue'
import RangeEditor from '@/components/RangeEditor.vue'
import type { EditableDataKind } from '@/components/pack-editor/typeboxDataSchema'

// --- Types ---

type NavSegment = {
  type: 'root' | 'object' | 'array'
  key?: string
  index?: number
  label: string
  schema: TSchema
}

type FieldInfo = {
  key: string
  label: string
  path: string
  schema: TSchema
  required: boolean
  isSimple: boolean
  fieldType: 'string' | 'number' | 'boolean' | 'enum' | 'tuple' | 'object' | 'array' | 'numberOrRange'
  arrayDisplay?: ArrayDisplayMode
  objectDisplay?: 'inline' | 'drilldown'
  itemLabel?: string
  collapsible?: boolean
  collapsed?: boolean
  defaultValue?: unknown
  isOptional: boolean
}

// --- Props ---

const props = defineProps<{
  modelValue: Record<string, unknown> | null
  schema: TSchema
  contextKind?: EditableDataKind
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

// --- Navigation State ---

const navSegments = ref<NavSegment[]>([])
const draft = computed(() => props.modelValue)

// Initialize navigation when schema changes
watch(
  () => props.schema,
  schema => {
    navSegments.value = [{ type: 'root', label: '根节点', schema }]
  },
  { immediate: true },
)

// --- Schema Helpers ---

function unwrapSchema(schema: TSchema): TSchema {
  if (KindGuard.IsUnion(schema)) {
    const members = (schema as TUnion).anyOf
    const nonNull = members.filter((m: TSchema) => !KindGuard.IsNull(m))
    if (nonNull.length === 1) return unwrapSchema(nonNull[0])
  }
  return schema
}

function isOptional(schema: TSchema): boolean {
  if (OptionalKind in schema) return true
  if ('default' in schema) return true
  if (KindGuard.IsUnion(schema)) {
    return (schema as TUnion).anyOf.some((m: TSchema) => KindGuard.IsUndefined(m))
  }
  return false
}

function isSimpleType(schema: TSchema): boolean {
  if (isNumberOrRangeType(schema)) return false
  const u = unwrapSchema(schema)
  return (
    KindGuard.IsString(u) ||
    KindGuard.IsNumber(u) ||
    KindGuard.IsInteger(u) ||
    KindGuard.IsBoolean(u) ||
    isEnumType(u) ||
    KindGuard.IsTuple(u)
  )
}

function isEnumType(schema: TSchema): boolean {
  if (KindGuard.IsUnion(schema)) {
    return (schema as TUnion).anyOf.every((s: TSchema) => KindGuard.IsLiteral(s))
  }
  return false
}

function isNumberOrRangeType(schema: TSchema): boolean {
  if (!KindGuard.IsUnion(schema)) return false
  const members = (schema as TUnion).anyOf
  if (members.length !== 2) return false
  const hasNumber = members.some(m => KindGuard.IsNumber(m) || KindGuard.IsInteger(m))
  const hasTuple = members.some(m => {
    if (!KindGuard.IsTuple(m)) return false
    const tuple = m as TTuple
    return tuple.items?.length === 2 && tuple.items.every(item => KindGuard.IsNumber(item) || KindGuard.IsInteger(item))
  })
  return hasNumber && hasTuple
}

function getFieldKind(schema: TSchema): FieldInfo['fieldType'] {
  if (isNumberOrRangeType(schema)) return 'numberOrRange'
  const u = unwrapSchema(schema)
  if (isEnumType(u)) return 'enum'
  if (KindGuard.IsString(u)) return 'string'
  if (KindGuard.IsNumber(u) || KindGuard.IsInteger(u)) return 'number'
  if (KindGuard.IsBoolean(u)) return 'boolean'
  if (KindGuard.IsTuple(u)) return 'tuple'
  if (KindGuard.IsArray(u)) return 'array'
  if (KindGuard.IsObject(u)) return 'object'
  return 'string'
}

function getFieldLabel(fieldKey: string): { primary: string; secondary?: string } {
  let translated = i18next.t(fieldKey, { ns: 'webui', defaultValue: '' })
  if (translated && translated !== fieldKey) {
    return { primary: translated, secondary: fieldKey }
  }

  translated = i18next.t(`stats.${fieldKey}`, { ns: 'webui', defaultValue: '' })
  if (translated && translated !== `stats.${fieldKey}`) {
    return { primary: translated, secondary: fieldKey }
  }

  translated = i18next.t(`speciesDetail.${fieldKey}`, { ns: 'webui', defaultValue: '' })
  if (translated && translated !== `speciesDetail.${fieldKey}`) {
    return { primary: translated, secondary: fieldKey }
  }

  translated = i18next.t(`skillDetail.${fieldKey}`, { ns: 'webui', defaultValue: '' })
  if (translated && translated !== `skillDetail.${fieldKey}`) {
    return { primary: translated, secondary: fieldKey }
  }

  return { primary: fieldKey }
}

// --- Current Fields ---

const currentSchema = computed(() => {
  const seg = navSegments.value[navSegments.value.length - 1]
  return seg ? unwrapSchema(seg.schema) : null
})

const currentSegment = computed(() => navSegments.value[navSegments.value.length - 1])

const isArrayLevel = computed(() => currentSegment.value?.type === 'array')

const currentArrayPath = computed(() => {
  const seg = currentSegment.value
  return seg?.type === 'array' ? seg.key : null
})

const currentArrayItems = computed(() => {
  const path = currentArrayPath.value
  if (!path || !draft.value) return []
  const arr = getFieldValue(path)
  if (!Array.isArray(arr)) return []
  return arr.map((item, index) => ({
    index,
    value: item,
    path: `${path}[${index}]`,
    isSimple: typeof item !== 'object' || item === null,
  }))
})

const currentFields = computed<FieldInfo[]>(() => {
  const schema = currentSchema.value
  if (!schema || !KindGuard.IsObject(schema)) return []

  const obj = schema as TObject<TProperties>
  const requiredSet = new Set(Array.isArray(obj.required) ? obj.required : [])

  return Object.entries(obj.properties).map(([key, fieldSchema]) => {
    const s = fieldSchema as TSchema
    const u = unwrapSchema(s)
    const arrayHint = KindGuard.IsArray(u) ? getArrayUIHint(u) : undefined
    const objectHint = KindGuard.IsObject(u) ? getObjectUIHint(u) : undefined
    const isOptional = !requiredSet.has(key) || 'default' in s || OptionalKind in s
    const defaultValue = 'default' in s ? (s as any).default : undefined

    return {
      key,
      label: key,
      path: buildPath(key),
      schema: s,
      required: requiredSet.has(key),
      isSimple: isSimpleType(s),
      fieldType: getFieldKind(s),
      arrayDisplay: arrayHint?.display,
      objectDisplay: objectHint?.display,
      itemLabel: arrayHint?.itemLabel,
      collapsible: arrayHint?.collapsible ?? objectHint?.collapsible,
      collapsed: arrayHint?.collapsed ?? objectHint?.collapsed,
      defaultValue,
      isOptional,
    }
  })
})

// --- Path Building ---

function buildPath(key: string): string {
  const seg = navSegments.value[navSegments.value.length - 1]
  if (!seg || seg.type === 'root') return key
  if (seg.type === 'object') return `${seg.key}.${key}`
  if (seg.type === 'array') return `${seg.key}[${seg.index}].${key}`
  return key
}

// --- Value Access ---

function getFieldValue(path: string): unknown {
  if (!draft.value) return undefined
  const segments = path.split(/\.|\[(\d+)\]/).filter(Boolean)
  let current: unknown = draft.value
  for (const seg of segments) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[seg]
  }
  return current
}

function setFieldValue(root: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const segments = path.split(/\.|\[(\d+)\]/).filter(Boolean)
  if (segments.length === 0) return root

  const next = { ...root }
  let current: Record<string, unknown> = next

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]
    const existing = current[seg]
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
      current[seg] = {}
    }
    current = { ...(current[seg] as Record<string, unknown>) }
    // Re-assign parent
    rebuildParent(next, segments.slice(0, i + 1), current)
  }

  const lastSeg = segments[segments.length - 1]
  if (value === undefined) {
    delete current[lastSeg]
  } else {
    current[lastSeg] = value
  }

  // Rebuild the chain
  rebuildParent(next, segments.slice(0, -1), current)

  return next
}

function rebuildParent(root: Record<string, unknown>, pathSegments: string[], leafValue: unknown): void {
  if (pathSegments.length === 0) return
  if (pathSegments.length === 1) {
    root[pathSegments[0]] = leafValue
    return
  }

  const parentSegs = pathSegments.slice(0, -1)
  let current = root
  for (const seg of parentSegs) {
    current = current[seg] as Record<string, unknown>
  }
  current[pathSegments[pathSegments.length - 1]] = leafValue
}

function updateField(path: string, value: unknown): void {
  if (!draft.value) return
  const next = setFieldValue(Value.Clone(draft.value), path, value)
  emit('update:modelValue', next)
}

// --- Navigation ---

function navigateTo(index: number): void {
  if (index >= navSegments.value.length - 1) return
  navSegments.value = navSegments.value.slice(0, index + 1)
}

function drillDown(field: FieldInfo): void {
  const schema = unwrapSchema(field.schema)
  const fieldType = field.fieldType

  if (fieldType === 'array') {
    // For arrays, we drill into the array items list
    const arraySchema = schema as TArray
    navSegments.value.push({
      type: 'array',
      key: field.path,
      label: field.label,
      schema: arraySchema.items as TSchema,
    })
  } else if (fieldType === 'object') {
    navSegments.value.push({
      type: 'object',
      key: field.path,
      label: field.label,
      schema,
    })
  }
}

// --- Field Summary ---

function getFieldSummary(field: FieldInfo): string {
  const value = getFieldValue(field.path)
  if (value === undefined) return '未设置'
  if (value === null) return 'null'
  if (Array.isArray(value)) return `${value.length} 项`
  if (typeof value === 'object') return `对象 (${Object.keys(value as object).length} 字段)`
  return String(value)
}

function getItemSummary(item: { value: unknown }): string {
  if (item.value === null || item.value === undefined) return '(空)'
  if (typeof item.value === 'object') {
    const obj = item.value as Record<string, unknown>
    const id = obj.id || obj.name || obj.type
    return id ? String(id) : `对象 (${Object.keys(obj).length} 字段)`
  }
  return String(item.value)
}

// --- Array Operations ---

function drillIntoArrayItem(index: number): void {
  const path = currentArrayPath.value
  if (!path || !draft.value) return

  const itemValue = getFieldValue(`${path}[${index}]`)
  if (typeof itemValue !== 'object' || itemValue === null) return

  const itemSchema = unwrapSchema(currentSegment.value!.schema)
  navSegments.value.push({
    type: 'object',
    key: `${path}[${index}]`,
    label: `#${index + 1}`,
    schema: itemSchema,
  })
}

function addArrayItem(): void {
  const path = currentArrayPath.value
  if (!path || !draft.value) return

  const arr = getFieldValue(path)
  const itemSchema = unwrapSchema(currentSegment.value!.schema)
  const newItem = Value.Create(itemSchema)
  const newArr = Array.isArray(arr) ? [...arr, newItem] : [newItem]
  updateField(path, newArr)
}

function removeArrayItem(index: number): void {
  const path = currentArrayPath.value
  if (!path || !draft.value) return

  const arr = getFieldValue(path)
  if (!Array.isArray(arr)) return
  const newArr = arr.filter((_, i) => i !== index)
  updateField(path, newArr)
}
</script>
