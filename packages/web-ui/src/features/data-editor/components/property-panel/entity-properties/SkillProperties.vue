<script setup lang="ts">
import { computed } from 'vue'
import type { TSchema } from '@sinclair/typebox'
import { translateEntityName } from '../../../schemas/editorSchemas'
import type { SkillSchemaType } from '@arcadia-eternity/schema'
import { useGameConfig } from '../../../game-config'
import { useEditorState } from '../../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import RichSchemaRenderer from '../rich-editors/RichSchemaRenderer.vue'
import type { RichEditorMetadata } from '../rich-editors/types'

const props = defineProps<{
  record: SkillSchemaType | null
  draft: Record<string, unknown> | null
  schema: TSchema
}>()
const emit = defineEmits<{ 'update:draft': [draft: Record<string, unknown>] }>()

const state = useEditorState()
const gameData = useGameDataStore()
const config = useGameConfig()

const categoryMeta = computed(() => {
  const cat = props.record?.category
  if (cat == null) return null
  return config.categories?.find(c => c.value === cat) ?? null
})

const metadata = computed<RichEditorMetadata>(() => ({
  recordId: state.selectedRecordId ?? '',
  entityType: state.selectedEntityType ?? 'skills',
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

const fieldHints = config.entities.skills.fieldHints
</script>

<template>
  <div v-if="record" class="entity-properties">
    <div class="identity-header">
      <ElementIcon v-if="record.element" :element="record.element" :size="32" class="identity-element-icon" />
      <span
        v-if="categoryMeta"
        class="identity-category-badge"
        :style="{ color: categoryMeta.color, backgroundColor: categoryMeta.bg }"
      >
        {{ categoryMeta.label }}
      </span>
      <span class="identity-name">{{ translateEntityName(record.id, config.entities.skills) }}</span>
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
  <div v-else class="empty-state">选择一个技能查看属性</div>
</template>

<style scoped>
.entity-properties { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.entity-body { flex: 1; min-height: 0; overflow-y: auto; }
.identity-header {
  display: flex; align-items: center; gap: var(--ae-space-2);
  padding: var(--ae-space-2) var(--ae-space-3); height: 48px;
  border-bottom: 1px solid var(--ae-border-subtle);
  background-color: var(--ae-bg-elevated); flex-shrink: 0;
}
.identity-element-icon { flex-shrink: 0; }
.identity-category-badge {
  display: inline-flex; align-items: center; padding: 1px 8px;
  font-size: var(--ae-font-xs); font-weight: 600; border-radius: 999px;
  line-height: 1.6; flex-shrink: 0;
}
.identity-name {
  font-size: var(--ae-font-sm); font-weight: 600; color: var(--ae-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.empty-state {
  display: flex; align-items: center; justify-content: center;
  height: 100%; min-height: 200px;
  font-size: var(--ae-font-sm); color: var(--ae-text-muted);
}
</style>
