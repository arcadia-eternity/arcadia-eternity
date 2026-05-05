<script setup lang="ts">
import { computed } from 'vue'
import type { TSchema } from '@sinclair/typebox'
import { translateEntityName } from '../../../schemas/editorSchemas'
import type { MarkSchemaType } from '@arcadia-eternity/schema'
import { useGameConfig } from '../../../game-config'
import { useEditorState } from '../../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import MarkIcon from '@/components/MarkIcon.vue'
import RichSchemaRenderer from '../rich-editors/RichSchemaRenderer.vue'
import type { RichEditorMetadata } from '../rich-editors/types'

defineProps<{
  record: MarkSchemaType | null
  draft: Record<string, unknown> | null
  schema: TSchema
}>()
const emit = defineEmits<{ 'update:draft': [draft: Record<string, unknown>] }>()

const state = useEditorState()
const gameData = useGameDataStore()
const config = useGameConfig()

const metadata = computed<RichEditorMetadata>(() => ({
  recordId: state.selectedRecordId ?? '',
  entityType: state.selectedEntityType ?? 'marks',
  gameData: {
    species: gameData.species.byId as Record<string, unknown>,
    skills: gameData.skills.byId as Record<string, unknown>,
    marks: gameData.marks.byId as Record<string, unknown>,
    effects: gameData.effects.byId as Record<string, unknown>,
  },
  recordCounts: {
    species: gameData.species.allIds.length,
    skills: gameData.skills.allIds.length,
    marks: gameData.marks.allIds.length,
    effects: gameData.effects.allIds.length,
  },
}))

const fieldHints = config.entities.marks.fieldHints
</script>

<template>
  <div v-if="record" class="entity-properties">
    <div class="identity-header">
      <MarkIcon :mark-id="record.id" :size="32" class="identity-icon" />
      <span class="identity-name">{{ translateEntityName(record.id, config.entities.marks) }}</span>
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
  <div v-else class="empty-state">选择一个标记查看属性</div>
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
  flex-shrink: 0;
}

.identity-name {
  font-size: var(--ae-font-sm);
  font-weight: 600;
  color: var(--ae-text-primary);
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
