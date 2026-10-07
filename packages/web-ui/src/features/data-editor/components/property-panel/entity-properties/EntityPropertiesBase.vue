<script setup lang="ts" generic="T extends { id: string }">
import { computed } from 'vue'
import type { TSchema } from '@sinclair/typebox'
import type { RichFieldHints, RichEditorMetadata } from '../rich-editors/types'
import { translateEntityName } from '../../../schemas/editorSchemas'
import { useGameConfig } from '../../../game-config'
import RichSchemaRenderer from '../rich-editors/RichSchemaRenderer.vue'

const props = defineProps<{
  record: T | null
  draft: Record<string, unknown> | null
  schema: TSchema
  metadata: RichEditorMetadata
  fieldHints: Record<string, RichFieldHints>
  entityType: string
  emptyText: string
}>()

const emit = defineEmits<{ 'update:draft': [draft: Record<string, unknown>] }>()

const config = useGameConfig()

const displayName = computed(() => {
  if (!props.record) return ''
  const entityConfig = config.entities[props.entityType]
  if (!entityConfig) return props.record.id
  return translateEntityName(props.record.id, entityConfig)
})
</script>

<template>
  <div v-if="record" class="entity-properties">
    <div class="identity-header">
      <slot name="identity-icon" />
      <slot name="identity-badges" />
      <slot name="identity-name">
        <span class="identity-name">{{ displayName }}</span>
      </slot>
    </div>
    <div class="entity-body">
      <RichSchemaRenderer
        :schema="schema"
        :draft="draft!"
        :hints="fieldHints"
        :metadata="metadata"
        @update:draft="(v: Record<string, unknown>) => emit('update:draft', v)"
      />
    </div>
  </div>
  <div v-else class="empty-state">{{ emptyText }}</div>
</template>

<style scoped>
.entity-properties {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.entity-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.identity-header {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: var(--ae-space-2) var(--ae-space-3);
  height: 48px;
  border-bottom: 1px solid var(--ae-border-subtle);
  background-color: var(--ae-bg-elevated);
  flex-shrink: 0;
}

.identity-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--ae-radius-sm);
  flex-shrink: 0;
}

.identity-info {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  min-width: 0;
}

.identity-name {
  font-size: var(--ae-font-sm);
  font-weight: 600;
  color: var(--ae-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-dex {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.identity-element-icon {
  flex-shrink: 0;
}

.identity-category-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  font-size: var(--ae-font-xs);
  font-weight: 600;
  border-radius: 999px;
  line-height: 1.6;
  flex-shrink: 0;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
}
</style>
