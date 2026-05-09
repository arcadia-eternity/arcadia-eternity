<script setup lang="ts">
import { computed } from 'vue'
import type { TSchema } from '@sinclair/typebox'
import { useGameConfig } from '../../../game-config'

import type { SpeciesSchemaType } from '@arcadia-eternity/schema'
import { useEditorState } from '../../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import PetIcon from '@/components/PetIcon.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import type { RichEditorMetadata } from '../rich-editors/types'
import EntityPropertiesBase from './EntityPropertiesBase.vue'

defineProps<{
  record: SpeciesSchemaType | null
  draft: Record<string, unknown> | null
  schema: TSchema
}>()
const emit = defineEmits<{ 'update:draft': [draft: Record<string, unknown>] }>()

const state = useEditorState()
const gameData = useGameDataStore()
const config = useGameConfig()

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

const fieldHints = config.entities.species.fieldHints
</script>

<template>
  <EntityPropertiesBase
    :record="record"
    :draft="draft!"
    :schema="schema"
    :metadata="metadata"
    :field-hints="fieldHints"
    entity-type="species"
    empty-text="选择一个物种查看属性"
    @update:draft="v => emit('update:draft', v)"
  >
    <template #identity-icon>
      <PetIcon :id="record?.num ?? 0" />
    </template>
    <template #identity-badges>
      <ElementIcon v-if="record?.element" :element="record.element" :size="14" />
      <span class="identity-dex">#{{ record?.num ?? '?' }}</span>
    </template>
  </EntityPropertiesBase>
</template>
