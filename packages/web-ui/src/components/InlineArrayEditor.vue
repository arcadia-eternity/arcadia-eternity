<script setup lang="ts">
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { type TSchema, type TArray, type TObject, type TProperties } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import { Value } from '@sinclair/typebox/value'
import FieldEditor from '@/components/FieldEditor.vue'

const props = defineProps<{
  field: {
    key: string
    label: string
    path: string
    schema: TSchema
    required: boolean
    itemLabel?: string
  }
  value: unknown
}>()

const emit = defineEmits<{
  update: [value: unknown]
}>()

const items = computed(() => {
  if (!Array.isArray(props.value)) return []
  return props.value.map((item, index) => ({
    index,
    value: item,
    path: `${props.field.path}[${index}]`,
    isSimple: typeof item !== 'object' || item === null,
  }))
})

function unwrapSchema(schema: TSchema): TSchema {
  if (KindGuard.IsUnion(schema)) {
    const members = (schema as any).anyOf
    const nonNull = members.filter((m: TSchema) => !KindGuard.IsNull(m))
    if (nonNull.length === 1) return unwrapSchema(nonNull[0])
  }
  return schema
}

function getItemSchema(): TSchema {
  const u = unwrapSchema(props.field.schema)
  if (KindGuard.IsArray(u)) {
    return (u as TArray).items as TSchema
  }
  return props.field.schema
}

function getFieldSchema(fieldName: string): TSchema {
  const itemSchema = unwrapSchema(getItemSchema())
  if (KindGuard.IsObject(itemSchema)) {
    const obj = itemSchema as TObject<TProperties>
    if (obj.properties[fieldName]) {
      return obj.properties[fieldName] as TSchema
    }
  }
  return itemSchema
}

function getObjectFields(): string[] {
  const itemSchema = unwrapSchema(getItemSchema())
  if (KindGuard.IsObject(itemSchema)) {
    const obj = itemSchema as TObject<TProperties>
    return Object.keys(obj.properties)
  }
  return []
}

function getItemLabel(item: unknown): string {
  if (item === null || item === undefined) return '(空)'
  if (typeof item !== 'object') return String(item)
  const obj = item as Record<string, unknown>
  const labelKey = props.field.itemLabel
  if (labelKey && obj[labelKey] !== undefined) return String(obj[labelKey])
  if (obj.id !== undefined) return String(obj.id)
  if (obj.name !== undefined) return String(obj.name)
  if (obj.skill_id !== undefined) return String(obj.skill_id)
  return `#${(obj as any).__index ?? '?'}`
}

function addItem() {
  const itemSchema = getItemSchema()
  const newItem = Value.Create(itemSchema)
  const arr = Array.isArray(props.value) ? [...props.value, newItem] : [newItem]
  emit('update', arr)
}

function removeItem(index: number) {
  if (!Array.isArray(props.value)) return
  const arr = props.value.filter((_, i) => i !== index)
  emit('update', arr)
}

function updateItem(index: number, val: unknown) {
  if (!Array.isArray(props.value)) return
  const arr = [...props.value]
  arr[index] = val
  emit('update', arr)
}

function updateItemField(index: number, fieldName: string, fieldVal: unknown) {
  if (!Array.isArray(props.value)) return
  const arr = [...props.value]
  arr[index] = { ...(arr[index] as any), [fieldName]: fieldVal }
  emit('update', arr)
}
</script>

<template>
  <div class="space-y-2">
    <div v-for="item in items" :key="item.index" class="border border-gray-200 dark:border-gray-700 rounded">
      <!-- Item header -->
      <div
        class="flex items-center justify-between px-2 py-1 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
      >
        <span class="text-xs text-gray-500 font-medium">{{ getItemLabel(item.value) }}</span>
        <el-button size="small" type="danger" text @click="removeItem(item.index)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>

      <!-- Simple item content -->
      <div v-if="item.isSimple" class="p-2">
        <FieldEditor
          :value="item.value"
          :schema="getItemSchema()"
          :field-path="item.path"
          @update="v => updateItem(item.index, v)"
        />
      </div>

      <!-- Object item content -->
      <div v-else class="p-2 space-y-2">
        <div v-for="key in getObjectFields()" :key="key">
          <label class="block text-xs text-gray-500 mb-0.5">{{ key }}</label>
          <FieldEditor
            :value="(item.value as any)[key]"
            :schema="getFieldSchema(key)"
            :field-path="`${item.path}.${key}`"
            @update="v => updateItemField(item.index, key, v)"
          />
        </div>
      </div>
    </div>

    <el-button size="small" type="primary" @click="addItem" class="w-full">
      <el-icon class="mr-1"><Plus /></el-icon>
      添加
    </el-button>
  </div>
</template>
