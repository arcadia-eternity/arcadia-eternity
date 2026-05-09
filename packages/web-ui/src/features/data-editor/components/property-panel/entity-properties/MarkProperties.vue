<script setup lang="ts">
import { computed } from 'vue'
import type { TSchema } from '@sinclair/typebox'

import type { MarkSchemaType } from '@arcadia-eternity/schema'
import { useGameConfig } from '../../../game-config'
import { useEditorState } from '../../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import MarkIcon from '@/components/MarkIcon.vue'
import type { RichEditorMetadata } from '../rich-editors/types'
import EntityPropertiesBase from './EntityPropertiesBase.vue'

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
  <EntityPropertiesBase
    :record="record"
    :draft="draft!"
    :schema="schema"
    :metadata="metadata"
    :field-hints="fieldHints"
    entity-type="marks"
    empty-text="选择一个标记查看属性"
    @update:draft="v => emit('update:draft', v)"
  >
    <template #identity-icon>
      <MarkIcon :mark-id="record!.id" :size="32" />
    </template>
  </EntityPropertiesBase>
</template>
