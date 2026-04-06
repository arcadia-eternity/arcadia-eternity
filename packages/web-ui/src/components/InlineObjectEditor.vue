<script setup lang="ts">
import { computed } from 'vue'
import i18next from 'i18next'
import { type TSchema, type TObject, type TProperties } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import FieldEditor from '@/components/FieldEditor.vue'

const props = defineProps<{
  field: {
    key: string
    label: string
    path: string
    schema: TSchema
    required: boolean
  }
  value: unknown
}>()

const emit = defineEmits<{
  update: [value: unknown]
}>()

function unwrapSchema(schema: TSchema): TSchema {
  if (KindGuard.IsUnion(schema)) {
    const members = (schema as any).anyOf
    const nonNull = members.filter((m: TSchema) => !KindGuard.IsNull(m))
    if (nonNull.length === 1) return unwrapSchema(nonNull[0])
  }
  return schema
}

function getObjectSchema(): TObject<TProperties> | null {
  const u = unwrapSchema(props.field.schema)
  if (KindGuard.IsObject(u)) {
    return u as TObject<TProperties>
  }
  return null
}

const fields = computed(() => {
  const obj = getObjectSchema()
  if (!obj) return []
  return Object.entries(obj.properties).map(([key, fieldSchema]) => ({
    key,
    label: key,
    schema: fieldSchema as TSchema,
    path: `${props.field.path}.${key}`,
    required: Array.isArray(obj.required) ? obj.required.includes(key) : false,
  }))
})

function getFieldValue(fieldName: string): unknown {
  if (typeof props.value !== 'object' || props.value === null) return undefined
  return (props.value as Record<string, unknown>)[fieldName]
}

function updateField(fieldName: string, fieldVal: unknown) {
  const obj =
    typeof props.value === 'object' && props.value !== null ? { ...(props.value as Record<string, unknown>) } : {}
  obj[fieldName] = fieldVal
  emit('update', obj)
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
</script>

<template>
  <div class="pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-2">
    <div v-for="f in fields" :key="f.key">
      <label class="block text-xs text-gray-500 mb-0.5">
        {{ getFieldLabel(f.key).primary }}
        <span v-if="getFieldLabel(f.key).secondary" class="text-gray-400 ml-1">
          {{ getFieldLabel(f.key).secondary }}
        </span>
        <span v-if="!f.required" class="text-gray-400">optional</span>
      </label>
      <FieldEditor
        :value="getFieldValue(f.key)"
        :schema="f.schema"
        :field-path="f.path"
        @update="v => updateField(f.key, v)"
      />
    </div>
  </div>
</template>
