<script setup lang="ts">
/**
 * EditorWorkspace - Main content area with resizable two-panel layout.
 *
 * Left panel: DataTable (browse and select records).
 * Right panel: PropertyPanel (edit selected record fields).
 * Divider: ResizeHandle for adjusting the split ratio.
 */
import { ref, computed } from 'vue'
import { useEditorState } from '../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import ResizeHandle from './ResizeHandle.vue'
import DataTable from '@/features/data-editor/components/data-table/DataTable.vue'
import PropertyPanel from '@/features/data-editor/components/property-panel/PropertyPanel.vue'

const editorState = useEditorState()
const gameData = useGameDataStore()

const records = computed(() => {
  const type = editorState.selectedEntityType
  if (!type) return []
  const slice = (gameData as unknown as Record<string, { allIds?: string[]; byId?: Record<string, unknown> }>)[type]
  return slice?.allIds?.map((id: string) => slice.byId?.[id]) ?? []
})

// Panel width percentages (left + right must = 100)
const leftPercent = ref(60)

const leftWidth = computed(() => leftPercent.value)
const rightWidth = computed(() => 100 - leftPercent.value)

const MIN_LEFT = 30
const MAX_LEFT = 80

function handleResize(deltaX: number) {
  const workspace = document.querySelector('.editor-workspace-content')
  if (!workspace) return
  const totalWidth = workspace.clientWidth
  if (totalWidth <= 0) return

  const deltaPercent = (deltaX / totalWidth) * 100
  leftPercent.value = Math.min(MAX_LEFT, Math.max(MIN_LEFT, leftPercent.value + deltaPercent))
}
</script>

<template>
  <div class="editor-workspace flex-1 flex flex-col min-w-0 overflow-hidden">
    <!-- Tab bar -->
    <div
      v-if="editorState.openTabs.length > 0"
      class="workspace-tabs flex items-center gap-[2px] px-[var(--ae-space-2)] h-9 shrink-0"
      style="background: var(--ae-bg-surface); border-bottom: 1px solid var(--ae-border-subtle)"
    >
      <div
        v-for="tab in editorState.openTabs"
        :key="tab.id"
        class="workspace-tab"
        :class="{ active: tab.id === editorState.activeTabId }"
      >
        <span class="tab-label">{{ tab.label }}</span>
      </div>
    </div>

    <!-- Two-panel resizable content area -->
    <div class="editor-workspace-content flex-1 flex min-h-0">
      <!-- Left: DataTable -->
      <div class="panel-left overflow-auto" :style="{ width: `${leftWidth}%` }">
        <DataTable
          :entity-type="editorState.selectedEntityType ?? 'species'"
          :records="records as Record<string, unknown>[]"
        />
      </div>

      <!-- Divider -->
      <ResizeHandle @resize="handleResize" />

      <!-- Right: PropertyPanel -->
      <div class="panel-right overflow-auto min-w-0" :style="{ width: `${rightWidth}%` }">
        <PropertyPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-workspace {
  background: var(--ae-bg-base);
}

.panel-left {
  background: var(--ae-bg-base);
}

.panel-right {
  background: var(--ae-bg-surface);
  border-left: 1px solid var(--ae-border-subtle);
}

/* Tab bar styles */
.workspace-tab {
  padding: var(--ae-space-1) var(--ae-space-3);
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
  border-radius: var(--ae-radius-sm) var(--ae-radius-sm) 0 0;
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.workspace-tab:hover {
  color: var(--ae-text-secondary);
  background: var(--ae-hover);
}

.workspace-tab.active {
  color: var(--ae-text-primary);
  background: var(--ae-bg-base);
}

.tab-label {
  font-size: var(--ae-font-xs);
}
</style>
