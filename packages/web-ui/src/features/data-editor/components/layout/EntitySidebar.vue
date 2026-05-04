<script setup lang="ts">
/**
 * EntitySidebar - Left sidebar showing entity type navigation.
 *
 * Lists entity types (Species/Skills/Marks/Effects) with record counts.
 * Bottom section provides a pack manager toggle.
 */
import { computed, ref } from 'vue'
import { useEditorState, type EntityType } from '../../composables/useEditorState'
import { useGameDataStore } from '@/stores/gameData'
import { useGameConfig } from '../../game-config'
import PackManagerTab from './PackManagerTab.vue'

const showPackManager = ref(false)

const editorState = useEditorState()
const gameDataStore = useGameDataStore()
const config = useGameConfig()

const entityTypes = Object.values(config.entities)

const countMap = computed(() => {
  const map: Record<string, number> = {}
  for (const key of Object.keys(config.entities)) {
    map[key] = (gameDataStore as unknown as Record<string, { allIds?: unknown[] }>)[key]?.allIds?.length ?? 0
  }
  return map
})

function selectEntity(type: EntityType) {
  editorState.selectedEntityType = type
  editorState.selectedRecordId = null
}
</script>

<template>
  <aside class="entity-sidebar">
    <!-- Header -->
    <header class="sidebar-header">数据导航</header>

    <!-- Entity type list -->
    <nav class="entity-nav">
      <button
        v-for="entity in entityTypes"
        :key="entity.key"
        type="button"
        class="entity-item"
        :class="{ 'entity-item--active': editorState.selectedEntityType === entity.key }"
        @click="selectEntity(entity.key)"
      >
        <span class="entity-icon">{{ entity.icon }}</span>
        <span class="entity-label">{{ entity.label }}</span>
        <span class="entity-count">{{ countMap[entity.key] }}</span>
        <span v-if="editorState.selectedEntityType === entity.key" class="entity-chevron">&#9654;</span>
      </button>
    </nav>

    <!-- Spacer pushes bottom section down -->
    <div class="flex-1" />

    <!-- Pack manager toggle -->
    <div class="pack-manager-area">
      <button
        type="button"
        class="pack-manager-btn"
        :class="{ active: showPackManager }"
        @click="showPackManager = !showPackManager"
      >
        <span class="pack-manager-icon">📦</span>
        <span class="pack-manager-label">数据包管理</span>
        <span class="pack-manager-chevron">{{ showPackManager ? '▾' : '▸' }}</span>
      </button>
    </div>

    <!-- Pack manager panel -->
    <div v-if="showPackManager" class="pack-manager-panel">
      <PackManagerTab />
    </div>
  </aside>
</template>

<style scoped>
.entity-sidebar {
  display: flex;
  flex-direction: column;
  width: 224px;
  min-height: 0;
  flex-shrink: 0;
  user-select: none;
  overflow-y: auto;
  background: var(--ae-bg-surface);
  border-right: 1px solid var(--ae-border-subtle);
  font-family:
    var(--ae-font-base),
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
}

/* ── Header ── */
.sidebar-header {
  padding: var(--ae-space-3) var(--ae-space-3);
  font-size: var(--ae-font-xs);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ae-text-muted);
  border-bottom: 1px solid var(--ae-border-subtle);
}

/* ── Entity nav ── */
.entity-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--ae-space-2);
}

/* ── Entity item row ── */
.entity-item {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  height: 40px;
  padding: 0 var(--ae-space-2);
  font-size: var(--ae-font-sm);
  color: var(--ae-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition:
    color 0.12s ease,
    background-color 0.12s ease;
  text-align: left;
  width: 100%;
}

.entity-item:hover {
  color: var(--ae-text-primary);
  background: var(--ae-hover);
}

.entity-item--active {
  color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
}

.entity-item--active:hover {
  color: var(--ae-accent-primary-hover);
  background: var(--ae-accent-primary-subtle);
}

/* ── Item parts ── */
.entity-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.entity-label {
  flex: 1;
}

.entity-count {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  min-width: 24px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.entity-chevron {
  font-size: 8px;
  color: var(--ae-accent-primary);
  margin-left: var(--ae-space-1);
  flex-shrink: 0;
}

/* ── Pack manager area ── */
.pack-manager-area {
  padding: var(--ae-space-2);
  border-top: 1px solid var(--ae-border-subtle);
}

.pack-manager-btn {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  width: 100%;
  height: 36px;
  padding: 0 var(--ae-space-2);
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
  background: transparent;
  border: 1px solid var(--ae-border-default);
  border-radius: var(--ae-radius-sm);
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.pack-manager-btn:hover {
  background: var(--ae-hover);
  border-color: var(--ae-accent-primary-subtle);
}

.pack-manager-btn.active {
  background: var(--ae-accent-primary-subtle);
  border-color: var(--ae-accent-primary);
  color: var(--ae-text-primary);
}

.pack-manager-icon {
  font-size: 14px;
}

.pack-manager-chevron {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.6;
}

.pack-manager-panel {
  max-height: 240px;
  overflow: auto;
  border-top: 1px solid var(--ae-border-subtle);
}

.pack-manager-label {
  flex: 1;
  text-align: left;
}
</style>
