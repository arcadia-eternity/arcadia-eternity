<script setup lang="ts">
/**
 * EditorAppBar - Top toolbar for the data editor.
 *
 * Horizontally-styled app bar containing:
 * - Left: PackSelector (dropdown to select active packs)
 * - Center: GlobalSearch input (searches across all entity types)
 * - Right: Action buttons (Save, Undo, Redo, Battle dropdown)
 *
 * All mutable state flows through the inject-based `useEditorState()` composable.
 * Undo/redo and save handlers are injected via provide/inject from the parent.
 */
import { inject } from 'vue'
import { Document, RefreshRight, VideoPlay } from '@element-plus/icons-vue'
import { ElButton, ElDropdown, ElDropdownMenu, ElDropdownItem, ElIcon, ElTooltip } from 'element-plus'
import { useEditorState } from '../../composables/useEditorState'
import GlobalSearch from './GlobalSearch.vue'

// --- Injected state ---
const state = useEditorState()

// --- Injected handlers (provided by parent DataEditorPage) ---
const onSave = inject<() => void>('editor:save', () => {})
const onUndo = inject<() => void>('editor:undo', () => {})
const onRedo = inject<() => void>('editor:redo', () => {})
const onStartBattle = inject<() => void>('editor:startBattle', () => {})

const canUndo = inject<() => boolean>('editor:canUndo', () => false)
const canRedo = inject<() => boolean>('editor:canRedo', () => false)
</script>

<template>
  <header class="editor-app-bar">
    <!-- Global search -->
    <div class="app-bar-section app-bar-section--search">
      <GlobalSearch :model-value="state.searchQuery" @update:model-value="state.searchQuery = $event" />
    </div>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Dirty indicator -->
    <span v-if="state.isDirty" class="app-bar-dirty-dot" title="未保存的更改" />

    <!-- Right: Action buttons -->
    <div class="app-bar-section app-bar-section--actions">
      <!-- Save -->
      <ElTooltip content="保存 (Ctrl+S)" placement="bottom" :show-after="400">
        <ElButton
          size="small"
          :type="state.isDirty ? 'primary' : 'default'"
          :icon="Document"
          class="app-bar-action-btn"
          @click="onSave"
        >
          保存
        </ElButton>
      </ElTooltip>

      <!-- Undo -->
      <ElTooltip content="撤销 (Ctrl+Z)" placement="bottom" :show-after="400">
        <ElButton size="small" :icon="RefreshRight" :disabled="!canUndo()" class="app-bar-action-btn" @click="onUndo">
          撤销
        </ElButton>
      </ElTooltip>

      <!-- Redo -->
      <ElTooltip content="重做 (Ctrl+Shift+Z)" placement="bottom" :show-after="400">
        <ElButton size="small" :disabled="!canRedo()" class="app-bar-action-btn" @click="onRedo">
          <template #icon>
            <span class="redo-icon">&#x21bb;</span>
          </template>
          重做
        </ElButton>
      </ElTooltip>

      <!-- Divider -->
      <div class="app-bar-divider app-bar-divider--vertical" />

      <!-- Battle dropdown -->
      <ElDropdown trigger="click" placement="bottom-end">
        <ElButton size="small" type="primary" class="app-bar-action-btn app-bar-battle-btn">
          <template #icon>
            <ElIcon :size="14">
              <VideoPlay />
            </ElIcon>
          </template>
          Battle
          <span class="battle-chevron">&#9662;</span>
        </ElButton>

        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem @click="onStartBattle">
              <span class="flex items-center gap-2">
                <ElIcon :size="14"><VideoPlay /></ElIcon>
                快速对战
              </span>
            </ElDropdownItem>
            <ElDropdownItem divided disabled>
              <span class="text-[var(--ae-text-muted)] text-xs">自定义对战 (即将推出)</span>
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </div>
  </header>
</template>

<style scoped>
.editor-app-bar {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: 0 var(--ae-space-3);
  height: 48px;
  min-height: 48px;
  flex-shrink: 0;
  user-select: none;
  background: var(--ae-bg-surface);
  border-bottom: 1px solid var(--ae-border-subtle);
  font-family:
    var(--ae-font-base),
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  z-index: 10;
}

/* --- Sections --- */
.app-bar-section {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
}

.app-bar-section--packs {
  flex-shrink: 0;
}

.app-bar-section--search {
  flex: 0 1 280px;
  min-width: 140px;
  max-width: 360px;
}

.app-bar-section--actions {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  flex-shrink: 0;
}

/* --- Search input override --- */
.app-bar-search :deep(.el-input__wrapper) {
  background: var(--ae-bg-elevated) !important;
  box-shadow: 0 0 0 1px var(--ae-border-subtle) inset !important;
  border-radius: var(--ae-radius-sm) !important;
  height: 28px !important;
  font-size: var(--ae-font-sm);
  transition: box-shadow 0.15s ease;
}

.app-bar-search :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--ae-border-default) inset !important;
}

.app-bar-search :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--ae-accent-primary) inset !important;
}

.app-bar-search :deep(.el-input__prefix) {
  color: var(--ae-text-muted);
}

.app-bar-search :deep(.el-input__inner) {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-primary);
}

.app-bar-search :deep(.el-input__inner::placeholder) {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-sm);
}

/* --- Action buttons --- */
.app-bar-action-btn {
  height: 28px !important;
  padding: 0 var(--ae-space-2) !important;
  font-size: var(--ae-font-sm) !important;
  border-radius: var(--ae-radius-sm) !important;
  font-weight: 500;
}

.app-bar-battle-btn {
  padding: 0 var(--ae-space-3) !important;
}

.battle-chevron {
  font-size: 10px;
  margin-left: 2px;
}

.redo-icon {
  display: inline-block;
  transform: scaleX(-1);
  font-size: 14px;
}

/* --- Dividers --- */
.app-bar-divider {
  width: 1px;
  height: 20px;
  background: var(--ae-border-subtle);
  flex-shrink: 0;
  margin: 0 var(--ae-space-1);
}

.app-bar-divider--vertical {
  height: 20px;
  margin: 0 var(--ae-space-1);
}

/* --- Dirty indicator --- */
.app-bar-dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ae-warning);
  flex-shrink: 0;
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
