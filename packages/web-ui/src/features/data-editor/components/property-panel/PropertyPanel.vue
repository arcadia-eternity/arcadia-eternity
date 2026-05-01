<script setup lang="ts">
import { computed, ref, watch, inject, type Ref } from 'vue'
import { useEditorState } from '../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import { useEditorValidation } from '../../composables/useEditorValidation'
import { SpeciesSchema, SkillSchema, MarkSchema, type SpeciesSchemaType, type SkillSchemaType, type MarkSchemaType } from '@arcadia-eternity/schema'
import SpeciesProperties from './entity-properties/SpeciesProperties.vue'
import SkillProperties from './entity-properties/SkillProperties.vue'
import MarkProperties from './entity-properties/MarkProperties.vue'
import RelatedEntities from './RelatedEntities.vue'

const state = useEditorState()
const gameData = useGameDataStore()
const { fieldErrors, validateRecord, clearErrors } = useEditorValidation()

const currentRecord = computed(() => {
  if (!state.selectedEntityType || !state.selectedRecordId) return null
  switch (state.selectedEntityType) {
    case 'species': return gameData.getSpecies(state.selectedRecordId) ?? null
    case 'skills': return gameData.getSkill(state.selectedRecordId) ?? null
    case 'marks': return gameData.getMark(state.selectedRecordId) ?? null
    default: return null
  }
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
  switch (state.selectedEntityType) {
    case 'species': return SpeciesSchema
    case 'skills': return SkillSchema
    case 'marks': return MarkSchema
    default: return null
  }
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
      <span class="text-xs font-semibold uppercase">{{ state.selectedEntityType ?? '属性' }} 编辑器</span>
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

      <template v-else-if="state.selectedEntityType === 'species'">
        <SpeciesProperties
          :record="(currentRecord as SpeciesSchemaType | null)"
          :draft="draft"
          :schema="currentSchema"
          @update:draft="draft = $event"
        />
      </template>

      <template v-else-if="state.selectedEntityType === 'skills'">
        <SkillProperties
          :record="(currentRecord as SkillSchemaType | null)"
          :draft="draft"
          :schema="currentSchema"
          @update:draft="draft = $event"
        />
      </template>

      <template v-else-if="state.selectedEntityType === 'marks'">
        <MarkProperties
          :record="(currentRecord as MarkSchemaType | null)"
          :draft="draft"
          :schema="currentSchema"
          @update:draft="draft = $event"
        />
      </template>

      <template v-else-if="state.selectedEntityType === 'effects'">
        <div class="p-4">
          <div class="text-sm text-muted mb-3">效果记录视图（effect DSL 编辑器将在未来版本实现）</div>
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
