<script setup lang="ts">
import { computed, ref, watch, inject, type Ref, type Component } from 'vue'
import { useEditorState } from '../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import { useGameConfig, getEntityConfig } from '../../game-config'
import { translateEntityName } from '../../schemas/editorSchemas'
import SpeciesProperties from './entity-properties/SpeciesProperties.vue'
import SkillProperties from './entity-properties/SkillProperties.vue'
import MarkProperties from './entity-properties/MarkProperties.vue'
import EffectProperties from './entity-properties/EffectProperties.vue'
import RelatedEntities from './RelatedEntities.vue'

const state = useEditorState()
const gameData = useGameDataStore()
const config = useGameConfig()

const entityComponents: Record<string, Component> = {
  species: SpeciesProperties,
  skills: SkillProperties,
  marks: MarkProperties,
  effects: EffectProperties,
}

const currentRecord = computed(() => {
  if (!state.selectedEntityType || !state.selectedRecordId) return null
  const slice = (gameData as unknown as Record<string, { byId?: Record<string, unknown> }>)[state.selectedEntityType]
  return slice?.byId?.[state.selectedRecordId] ?? null
})

// Use injected draft from DataEditorPage so undo/redo tracks changes
const injectedDraft = inject<Ref<Record<string, unknown>>>('editor:draft', ref({}))
const draft = computed({
  get: () => injectedDraft.value,
  set: v => {
    injectedDraft.value = v
  },
})

// Populate draft when record is selected — mutate in-place to avoid undo entry
let applyingUndo = false

watch(
  () => state.selectedRecordId,
  () => {
    if (currentRecord.value) {
      applyingUndo = true
      const clone = JSON.parse(JSON.stringify(currentRecord.value)) as Record<string, unknown>
      for (const key of Object.keys(injectedDraft.value)) {
        delete injectedDraft.value[key]
      }
      Object.assign(injectedDraft.value, clone)
      applyingUndo = false
      state.isDirty = false
    }
  },
  { immediate: true },
)

// Compare draft with original record to detect real edits
watch(
  injectedDraft,
  val => {
    if (applyingUndo) return
    if (val && currentRecord.value) {
      state.isDirty = JSON.stringify(val) !== JSON.stringify(currentRecord.value)
    } else {
      state.isDirty = false
    }
  },
  { deep: true },
)

const currentSchema = computed(() => {
  if (!state.selectedEntityType) return null
  return config.entities[state.selectedEntityType]?.schema ?? null
})

const currentEntityConfig = computed(() => {
  if (!state.selectedEntityType) return null
  return getEntityConfig(config, state.selectedEntityType)
})

const recordDisplayName = computed(() => {
  if (!currentRecord.value || !currentEntityConfig.value) return null
  return translateEntityName(state.selectedRecordId!, currentEntityConfig.value)
})

const sourceFileLabel = computed(() => {
  if (!state.selectedRecordId) return null
  return state.recordSourceFiles?.[state.selectedRecordId] ?? null
})
</script>

<template>
  <div class="property-panel h-full flex flex-col">
    <div class="panel-header flex items-center justify-between px-3 py-2 border-b">
      <span class="text-xs font-semibold uppercase">
        {{ config.entities[state.selectedEntityType ?? '']?.label ?? state.selectedEntityType ?? '属性' }}
        <template v-if="recordDisplayName"> · {{ recordDisplayName }}</template>
        编辑器
        <span v-if="sourceFileLabel" class="text-[10px] text-[var(--ae-text-muted)] ml-2">
          来源: {{ sourceFileLabel }}
        </span>
      </span>
    </div>

    <div class="flex-1 min-h-0 overflow-auto">
      <div v-if="!state.selectedRecordId" class="p-4 text-center text-muted">选择一条记录查看属性</div>

      <template v-else-if="entityComponents[state.selectedEntityType ?? '']">
        <component
          :is="entityComponents[state.selectedEntityType ?? '']"
          :record="currentRecord"
          :draft="draft"
          :schema="currentSchema"
          @update:draft="draft = $event"
        />
      </template>

      <template v-else-if="state.selectedEntityType">
        <div class="p-4">
          <div class="text-sm text-muted mb-3">
            {{ config.entities[state.selectedEntityType]?.label ?? state.selectedEntityType }}
            记录视图（编辑器将在未来版本实现）
          </div>
          <div class="text-xs font-mono text-muted bg-[var(--ae-bg-overlay)] p-2 rounded">
            {{ JSON.stringify(currentRecord, null, 2) }}
          </div>
        </div>
      </template>
    </div>

    <div v-if="state.selectedEntityType && state.selectedRecordId" class="border-t">
      <RelatedEntities :entity-type="state.selectedEntityType" :record-id="state.selectedRecordId" />
    </div>
  </div>
</template>
