<script setup lang="ts">
import { computed, ref, watch, inject, type Ref, type Component } from 'vue'
import { useEditorState } from '../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import { useEditorValidation } from '../../composables/useEditorValidation'
import { useGameConfig, getEntityConfig } from '../../game-config'
import { translateEntityName } from '../../schemas/editorSchemas'
import SpeciesProperties from './entity-properties/SpeciesProperties.vue'
import SkillProperties from './entity-properties/SkillProperties.vue'
import MarkProperties from './entity-properties/MarkProperties.vue'
import RelatedEntities from './RelatedEntities.vue'

const state = useEditorState()
const gameData = useGameDataStore()
const config = useGameConfig()
const { fieldErrors, validateRecord, clearErrors } = useEditorValidation()

const entityComponents: Record<string, Component> = {
  species: SpeciesProperties,
  skills: SkillProperties,
  marks: MarkProperties,
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
  set: (v) => { injectedDraft.value = v },
})

// Track if we're applying an undo/redo (skip overwriting during undo)
let applyingUndo = false

watch(() => state.selectedRecordId, () => {
  if (currentRecord.value) {
    applyingUndo = true
    injectedDraft.value = JSON.parse(JSON.stringify(currentRecord.value))
    applyingUndo = false
  }
  clearErrors()
}, { immediate: true })

// Sync undo/redo changes back
watch(injectedDraft, (val) => {
  if (applyingUndo) return
  if (val && currentRecord.value) {
    state.isDirty = true
  }
}, { deep: true })

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

watch(draft, () => { state.isDirty = draft.value !== null }, { deep: true })

function handleSave() {
  if (!draft.value || !currentSchema.value) return
  const result = validateRecord(currentSchema.value, draft.value)
  if (!result.valid) return
  // TODO: actual save will be wired in Phase 4
  console.log('[PropertyPanel] Save:', draft.value)
  state.isDirty = false
}
</script>

<template>
  <div class="property-panel h-full flex flex-col">
    <div class="panel-header flex items-center justify-between px-3 py-2 border-b">
      <span class="text-xs font-semibold uppercase">
        {{ config.entities[state.selectedEntityType ?? '']?.label ?? state.selectedEntityType ?? '属性' }}
        <template v-if="recordDisplayName"> · {{ recordDisplayName }}</template>
        编辑器
      </span>
      <div class="flex gap-1">
        <el-button size="small" @click="handleSave" type="primary" :disabled="!state.isDirty">保存</el-button>
      </div>
    </div>

    <div v-if="Object.keys(fieldErrors).length > 0" class="px-3 py-1 bg-red-900/20 border-b">
      <div v-for="(msg, path) in fieldErrors" :key="path" class="text-xs text-red-400">
        {{ path }}: {{ msg }}
      </div>
    </div>

    <div class="flex-1 min-h-0 overflow-auto">
      <div v-if="!state.selectedRecordId" class="p-4 text-center text-muted">
        选择一条记录查看属性
      </div>

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
          <div class="text-sm text-muted mb-3">{{ config.entities[state.selectedEntityType]?.label ?? state.selectedEntityType }} 记录视图（编辑器将在未来版本实现）</div>
          <div class="text-xs font-mono text-muted bg-[var(--ae-bg-overlay)] p-2 rounded">
            {{ JSON.stringify(currentRecord, null, 2) }}
          </div>
        </div>
      </template>
    </div>

    <div v-if="state.selectedEntityType && state.selectedRecordId" class="border-t">
      <RelatedEntities
        :entity-type="state.selectedEntityType"
        :record-id="state.selectedRecordId"
      />
    </div>
  </div>
</template>
