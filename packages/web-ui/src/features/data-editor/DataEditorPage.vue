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
import { ElMessage } from 'element-plus'
import { isDesktop } from '@/utils/env'
import { provideEditorState } from './composables/useEditorState'
import { useEditorKeyboard } from './composables/useEditorKeyboard'
import { useEditorUndo } from './composables/useEditorUndo'
import { useGameDataStore } from '@/stores/gameData'
import { provideGameConfig } from './game-config'
import { baseEntities } from './game-config/base'
import { seer2Config } from './game-config/seer2'
import {
  listWorkspacePacks,
  readWorkspacePackFile,
  writeWorkspacePackFile,
  readWorkspacePackManifest,
  writeWorkspacePackManifest,
  type WorkspacePackSummary,
} from '@/services/packWorkspace'
import { resolveManifestDataPath } from './utils/packHelpers'
import {
  parseYamlAnchoredDataset,
  upsertYamlAnchoredRecord,
  stringifyYamlAnchoredDataset,
  type YamlAnchoredDataset,
} from './schemas/yamlAnchoredRecords'

import EditorAppBar from './components/layout/EditorAppBar.vue'
import EntitySidebar from './components/layout/EntitySidebar.vue'
import EditorWorkspace from './components/layout/EditorWorkspace.vue'
import BattleBottomDrawer from './components/layout/BattleBottomDrawer.vue'

// ── Centralized editor state (provided to all children) ──
const editorState = provideEditorState()

// ── Game config (entity types, categories, triggers) ──
provideGameConfig({
  entities: { ...baseEntities, ...seer2Config.entities },
  categories: seer2Config.categories,
  triggers: seer2Config.triggers,
})

// ── External data ──
const gameDataStore = useGameDataStore()

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

async function doSave() {
  const kind = editorState.selectedEntityType
  const id = editorState.selectedRecordId
  if (!kind || !id) return

  const draft = draftRef.value
  if (!draft || (Object.keys(draft).length === 0 && !(id in draft))) return

  const clone = JSON.parse(JSON.stringify(draft))

  // Persist to in-memory store
  const store = gameDataStore as unknown as Record<string, { byId: Record<string, unknown>; allIds: string[] }>
  if (store[kind]?.byId) {
    store[kind].byId[id] = clone
    if (!store[kind].allIds.includes(id)) store[kind].allIds.push(id)
  }

  // Persist to YAML file on disk
  const packFolder = editorState.packFilters.enabledPacks[0] || 'base'

  try {
    const isBase = packFolder === 'base' && window.arcadiaDesktop?.readBasePackFile

    const cfg = seer2Config.entities[kind] ?? baseEntities.effects
    if (!cfg || kind === 'effects') {
      editorState.isDirty = false
      return
    }

    let manifest: Record<string, unknown>
    if (isBase) {
      const { content: raw } = await window.arcadiaDesktop!.readBasePackFile({ folderName: 'base', relativePath: 'pack.json' })
      manifest = JSON.parse(raw)
    } else {
      const result = await readWorkspacePackManifest({ folderName: packFolder })
      manifest = result.manifest
    }

    const relativePath = resolveManifestDataPath(manifest, cfg.dataFile)
    const { content } = isBase
      ? await window.arcadiaDesktop!.readBasePackFile({ folderName: 'base', relativePath })
      : await readWorkspacePackFile({ folderName: packFolder, relativePath })

    const dataset = parseYamlAnchoredDataset(content)

    const existingIndex = dataset.rows.findIndex(row => row.id === id)
    upsertYamlAnchoredRecord({
      dataset,
      schema: cfg.schema,
      draft: clone,
      targetIndex: existingIndex >= 0 ? existingIndex : undefined,
    })

    const yamlText = stringifyYamlAnchoredDataset(dataset)
    if (isBase) {
      await window.arcadiaDesktop!.writeBasePackFile({ folderName: 'base', relativePath, content: yamlText })
    } else {
      await writeWorkspacePackFile({ folderName: packFolder, relativePath, content: yamlText })
    }

    editorState.isDirty = false
    ElMessage.success('已保存')
    await reloadDataFromDisk()
  } catch (err) {
    console.error('[DataEditor] File save failed:', err)
    ElMessage.error('保存失败: ' + (err instanceof Error ? err.message : String(err)))
  }
}

provide('editor:save', doSave)
provide('editor:startBattle', () => {
  console.log('[DataEditor] Battle triggered - opening battle controller')
  // BattleBottomDrawer handles visibility internally
})

const packs = ref<WorkspacePackSummary[]>([])
const isLoading = ref(true)
const loadError = ref<string | null>(null)

// ── Keyboard shortcuts ──
useEditorKeyboard({
  onSave() { doSave() },
  onUndo() {
    if (canUndo.value) undo()
  },
  onRedo() {
    if (canRedo.value) redo()
  },
})

// ── Reload data from disk via IPC (bypasses HTTP cache) ──
async function reloadDataFromDisk() {
  if (!isDesktop || !window.arcadiaDesktop?.readAllBasePackData) return

  try {
    const data = await window.arcadiaDesktop.readAllBasePackData()
    const store = gameDataStore as unknown as Record<string, { byId: Record<string, unknown>; allIds: string[] }>

    for (const kind of ['species', 'skills', 'marks', 'effects']) {
      const records = data[kind]
      if (!Array.isArray(records) || !store[kind]) continue

      const byId: Record<string, unknown> = {}
      const allIds: string[] = []
      for (const record of records) {
        const id = String((record as Record<string, unknown>).id ?? '')
        if (!id) continue
        byId[id] = record
        allIds.push(id)
      }
      store[kind].byId = byId
      store[kind].allIds = allIds
    }
  } catch (e) {
    console.error('[DataEditor] Failed to reload data from disk:', e)
  }
}

// ── Initialization ──
onMounted(async () => {
  try {
    isLoading.value = true

    // 1. Load workspace pack list (for pack selector in AppBar)
    packs.value = await listWorkspacePacks()

    // 2. Initialize the game data store (species, skills, marks, effects)
    await gameDataStore.initialize()

    // 2b. Reload from disk via IPC to bypass HTTP/Vite caches
    await reloadDataFromDisk()

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
