<script setup lang="ts">
/**
 * DataEditorPage.vue
 *
 * Main entry page for the refactored data editor.
 * Directus/Strapi-style database browser layout with:
 *   AppBar → EntitySidebar + EditorWorkspace → BattleBottomDrawer
 *
 * State management: provideEditorState() provides centralized reactive
 * state via Vue's Provide/Inject — no Pinia for editor state.
 */
import { onMounted, provide, ref } from 'vue'
import { provideEditorState } from './composables/useEditorState'
import { useEditorKeyboard } from './composables/useEditorKeyboard'
import { useEditorUndo } from './composables/useEditorUndo'
import { useGameDataStore } from '@/stores/gameData'
import { listWorkspacePacks, type WorkspacePackSummary } from '@/services/packWorkspace'

import EditorAppBar from './components/layout/EditorAppBar.vue'
import EntitySidebar from './components/layout/EntitySidebar.vue'
import EditorWorkspace from './components/layout/EditorWorkspace.vue'
import BattleBottomDrawer from './components/layout/BattleBottomDrawer.vue'

// ── Centralized editor state (provided to all children) ──
provideEditorState()

// ── Undo/redo for the currently selected record draft ──
const draftRef = ref<Record<string, unknown>>({})
const { undo, redo, canUndo, canRedo } = useEditorUndo(draftRef)

provide('editor:draft', draftRef)
provide('editor:registerDraft', (data: Record<string, unknown>) => {
  Object.assign(draftRef.value, data)
})
provide('editor:undo', () => undo())
provide('editor:redo', () => redo())
provide('editor:canUndo', () => canUndo.value)
provide('editor:canRedo', () => canRedo.value)
provide('editor:save', async () => {
  console.log('[DataEditor] Save triggered - saving current draft')
})
provide('editor:startBattle', () => {
  console.log('[DataEditor] Battle triggered - opening battle controller')
  // BattleBottomDrawer handles visibility internally
})

// ── External data ──
const gameDataStore = useGameDataStore()
const packs = ref<WorkspacePackSummary[]>([])
const isLoading = ref(true)
const loadError = ref<string | null>(null)

// ── Keyboard shortcuts ──
useEditorKeyboard({
  onSave() {
    console.log('[DataEditor] Save triggered (Ctrl+S)')
    // TODO: delegate to PropertyPanel's save when integrated
  },
  onUndo() {
    if (canUndo.value) undo()
  },
  onRedo() {
    if (canRedo.value) redo()
  },
})

// ── Initialization ──
onMounted(async () => {
  try {
    isLoading.value = true

    // 1. Load workspace pack list (for pack selector in AppBar)
    packs.value = await listWorkspacePacks()

    // 2. Initialize the game data store (species, skills, marks, effects)
    await gameDataStore.initialize()

    loadError.value = null
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Failed to load editor data'
    console.error('[DataEditor] Initialization failed:', error)
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="data-editor-root h-screen flex flex-col bg-[#1a1d23] text-[#d6dde8]">
    <!-- Loading overlay -->
    <Transition name="fade">
      <div v-if="isLoading" class="editor-loading-overlay">
        <div class="editor-loading-spinner" />
        <span class="editor-loading-text">加载数据中…</span>
      </div>
    </Transition>

    <!-- Error banner -->
    <div v-if="loadError" class="editor-error-banner">
      <span class="editor-error-message">{{ loadError }}</span>
      <button
        type="button"
        class="editor-error-dismiss"
        @click="loadError = null"
      >
        ✕
      </button>
    </div>

    <!-- Top toolbar -->
    <EditorAppBar />

    <!-- Main content: sidebar + workspace -->
    <div class="flex-1 flex min-h-0">
      <EntitySidebar />
      <EditorWorkspace />
    </div>

    <!-- Bottom drawer -->
    <BattleBottomDrawer />
  </div>
</template>

<style scoped>
/* ── Loading overlay ── */
.editor-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--ae-space-3);
  background: rgba(26, 29, 35, 0.88);
  backdrop-filter: blur(6px);
}

.editor-loading-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--ae-border-default);
  border-top-color: var(--ae-accent-primary);
  border-radius: 50%;
  animation: ae-spin 0.7s linear infinite;
}

@keyframes ae-spin {
  to {
    transform: rotate(360deg);
  }
}

.editor-loading-text {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-secondary);
  letter-spacing: 0.02em;
}

/* ── Error banner ── */
.editor-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ae-space-2) var(--ae-space-4);
  background: var(--ae-error-subtle);
  border-bottom: 1px solid rgba(248, 113, 113, 0.25);
  color: var(--ae-error);
  font-size: var(--ae-font-sm);
  flex-shrink: 0;
}

.editor-error-message {
  flex: 1;
}

.editor-error-dismiss {
  margin-left: var(--ae-space-3);
  background: none;
  border: none;
  color: var(--ae-error);
  font-size: var(--ae-font-sm);
  cursor: pointer;
  padding: var(--ae-space-1);
  line-height: 1;
  opacity: 0.7;
  transition: opacity 0.12s ease;
}

.editor-error-dismiss:hover {
  opacity: 1;
}

/* ── Fade transition ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
