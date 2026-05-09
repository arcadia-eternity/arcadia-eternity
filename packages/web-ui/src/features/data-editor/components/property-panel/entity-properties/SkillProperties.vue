<script setup lang="ts">
import { computed } from 'vue'
import type { TSchema } from '@sinclair/typebox'

import type { SkillSchemaType } from '@arcadia-eternity/schema'
import { useGameConfig } from '../../../game-config'
import { useEditorState } from '../../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import type { RichEditorMetadata } from '../rich-editors/types'
import EntityPropertiesBase from './EntityPropertiesBase.vue'

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
  <EntityPropertiesBase
    :record="record"
    :draft="draft!"
    :schema="schema"
    :metadata="metadata"
    :field-hints="fieldHints"
    entity-type="skills"
    empty-text="选择一个技能查看属性"
    @update:draft="v => emit('update:draft', v)"
  >
    <template #identity-icon>
      <ElementIcon v-if="record?.element" :element="record.element" :size="32" />
    </template>
    <template #identity-badges>
      <span
        v-if="categoryMeta"
        class="identity-category-badge"
        :style="{ color: categoryMeta.color, backgroundColor: categoryMeta.bg }"
      >
        {{ categoryMeta.label }}
      </span>
    </template>
  </EntityPropertiesBase>
</template>
