<script setup lang="ts">
/**
 * RichSchemaRenderer - Core orchestrator that traverses a TypeBox schema,
 * matches fields to rich editors via the hints map, and renders a seamless
 * editing form. Identity fields are excluded (handled by parent panel).
 */
import { computed, onMounted, shallowRef, type Component } from 'vue'
import i18next from 'i18next'
import { type TSchema, type TObject } from '@sinclair/typebox'
import { KindGuard } from '@sinclair/typebox/type'
import type { RichFieldHints, RichFieldContext, RichEditorMetadata } from './types'
import { ensureDefaultRichEditors, resolveRichEditor } from './registry'
import FieldEditor from '../shared/FieldEditor.vue'

const props = defineProps<{
  schema: any
  draft: Record<string, unknown>
  hints: Record<string, RichFieldHints>
  metadata: RichEditorMetadata
}>()

const emit = defineEmits<{ 'update:draft': [value: Record<string, unknown>] }>()

// Register default rich editors on mount
const ready = shallowRef(false)
onMounted(async () => {
  await ensureDefaultRichEditors()
  ready.value = true
})

// --- Field label translation (mirrors PropertyInspector) ---

function getFieldLabel(key: string): string {
  const t1 = i18next.t(key, { ns: 'webui', defaultValue: '' })
  if (t1 && t1 !== key) return t1
  const t2 = i18next.t(`stats.${key}`, { ns: 'webui', defaultValue: '' })
  if (t2 && t2 !== `stats.${key}`) return t2
  return key
}

// --- Field resolution ---

interface ResolvedField {
  key: string
  label: string
  path: string
  schemaNode: TSchema
  value: unknown
  hints: RichFieldHints
  editor: { component: Component } | null
  context: RichFieldContext
}

const fields = computed<ResolvedField[]>(() => {
  if (!ready.value) return []
  const schema = props.schema as TSchema
  if (!schema || !KindGuard.IsObject(schema)) return []

  const obj = schema as TObject
  const propsMap = obj.properties as Record<string, TSchema>

  return Object.entries(propsMap).map(([key, fieldSchema]) => {
    const path = key
    const value = props.draft?.[key]
    const hints = props.hints[path] ?? { display: 'default' }

    const context: RichFieldContext = {
      path,
      schema: fieldSchema,
      value,
      onUpdate: (v: unknown) => updateField(path, v),
      hints,
      metadata: props.metadata,
    }

    const reg = resolveRichEditor(context)
    const editor = reg && reg.hint !== 'identity' ? { component: reg.component } : null

    return {
      key,
      label: getFieldLabel(key),
      path,
      schemaNode: fieldSchema,
      value,
      hints,
      editor,
      context,
    }
  })
})

// --- Field update ---

function updateField(path: string, value: unknown) {
  const next = { ...props.draft, [path]: value }
  emit('update:draft', next)
}
</script>

<template>
  <div class="rich-schema-renderer">
    <div v-for="field in fields" :key="field.path" class="renderer-field">
      <component
        v-if="field.editor"
        :is="field.editor.component"
        :context="field.context"
        @update="(v: unknown) => updateField(field.path, v)"
      />
      <div v-else class="renderer-default-field">
        <label class="field-label">{{ field.label }}</label>
        <FieldEditor
          :value="field.value"
          :schema="field.schemaNode"
          :field-path="field.path"
          @update="(v: unknown) => updateField(field.path, v)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.rich-schema-renderer {
  display: flex;
  flex-direction: column;
}

.renderer-field {
  min-width: 0;
}

.renderer-default-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ae-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
