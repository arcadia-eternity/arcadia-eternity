<script setup lang="ts">
import { computed } from 'vue'
import { translateEntityName, getTypeBoxSchemaSpec } from '../../../schemas/editorSchemas'
import type { SpeciesSchemaType } from '@arcadia-eternity/schema'
import { useEditorState } from '../../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import PetIcon from '@/components/PetIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import RichSchemaRenderer from '../rich-editors/RichSchemaRenderer.vue'
import type { RichEditorMetadata, RichFieldHints } from '../rich-editors/types'

const props = defineProps<{
  record: SpeciesSchemaType | null
  draft: Record<string, unknown> | null
  schema: any
}>()
const emit = defineEmits<{ 'update:draft': [draft: Record<string, unknown>] }>()

const state = useEditorState()
const gameData = useGameDataStore()

const metadata = computed<RichEditorMetadata>(() => ({
  recordId: state.selectedRecordId ?? '',
  entityType: state.selectedEntityType ?? 'species',
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

const fieldHints: Record<string, RichFieldHints> = {
  baseStats: { display: 'statBars', statKeys: ['hp', 'atk', 'spa', 'def', 'spd', 'spe'] },
  learnable_skills: { display: 'entityTable', entityKind: 'skills', idKey: 'skill_id' },
  ability: { display: 'entityTags', entityKind: 'marks' },
  emblem: { display: 'entityTags', entityKind: 'marks' },
}
</script>

<template>
  <div v-if="record" class="entity-properties">
    <div class="identity-header">
      <PetIcon :id="record.num ?? 0" class="identity-icon" />
      <div class="identity-info">
        <span class="identity-name">{{ translateEntityName(record.id, getTypeBoxSchemaSpec('species')) }}</span>
        <ElementIcon v-if="record.element" :element="record.element" :size="14" />
        <span class="identity-dex">#{{ record.num ?? '?' }}</span>
      </div>
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
  <div v-else class="empty-state">选择一个物种查看属性</div>
</template>

<style scoped>
.entity-properties { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.entity-body { flex: 1; min-height: 0; overflow-y: auto; }
.identity-header {
  display: flex; align-items: center; gap: var(--ae-space-3);
  padding: var(--ae-space-2) var(--ae-space-3); height: 48px;
  border-bottom: 1px solid var(--ae-border-subtle);
  background-color: var(--ae-bg-elevated); flex-shrink: 0;
}
.identity-icon { width: 32px; height: 32px; border-radius: var(--ae-radius-sm); flex-shrink: 0; }
.identity-info { display: flex; align-items: center; gap: var(--ae-space-2); min-width: 0; }
.identity-name {
  font-size: var(--ae-font-sm); font-weight: 600; color: var(--ae-text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.identity-dex {
  font-size: var(--ae-font-xs); color: var(--ae-text-muted);
  font-variant-numeric: tabular-nums; margin-left: auto;
}
.empty-state {
  display: flex; align-items: center; justify-content: center;
  height: 100%; min-height: 200px;
  font-size: var(--ae-font-sm); color: var(--ae-text-muted);
}
</style>
