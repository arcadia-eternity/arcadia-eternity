<script setup lang="ts">
/**
 * DataTableToolbar.vue
 *
 * Toolbar above the data table providing:
 *   - Search input (syncs with editorState.searchQuery)
 *   - Record count + selection count
 *   - [新增] button (placeholder — Phase 4)
 *   - [批量操作] dropdown (placeholder — Phase 4)
 *   - [文件管理] dropdown (placeholder — Phase 4)
 *
 * Uses the `useEditorState()` composable for search state.
 */
import { computed } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import {
  ElInput,
  ElButton,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElIcon,
  ElTooltip,
} from 'element-plus'
import { useEditorState, type EntityType } from '../../composables/useEditorState'

// ── Props ──

const props = defineProps<{
  entityType: EntityType
  recordCount: number
  selectedCount: number
}>()

// ── Editor state ──

const editorState = useEditorState()

// ── Search binding ──

const searchQuery = computed({
  get: () => editorState.searchQuery,
  set: (val: string) => {
    editorState.searchQuery = val
  },
})

// ── Entity type labels ──

const entityLabels: Record<EntityType, string> = {
  species: '物种',
  skills: '技能',
  marks: '标记',
  effects: '效果',
}

const currentLabel = computed(() => entityLabels[props.entityType])
</script>

<template>
  <div class="data-table-toolbar">
    <!-- Left: entity label + counts -->
    <div class="toolbar-section toolbar-section--info">
      <span class="toolbar-entity-label">{{ currentLabel }}</span>
      <span class="toolbar-count">
        {{ recordCount }}条记录
      </span>
      <span v-if="selectedCount > 0" class="toolbar-count toolbar-count--selected">
        已选{{ selectedCount }}条
      </span>
    </div>

    <!-- Center: Search input -->
    <div class="toolbar-section toolbar-section--search">
      <ElInput
        v-model="searchQuery"
        placeholder="搜索ID..."
        :prefix-icon="Search"
        clearable
        size="small"
        class="toolbar-search"
      />
    </div>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Right: Action buttons -->
    <div class="toolbar-section toolbar-section--actions">
      <!-- 新增 button (placeholder) -->
      <ElTooltip content="新增记录 (Phase 4)" placement="bottom" :show-after="400">
        <ElButton
          size="small"
          type="primary"
          class="toolbar-action-btn"
          disabled
        >
          <template #icon>
            <ElIcon :size="14"><Plus /></ElIcon>
          </template>
          新增
        </ElButton>
      </ElTooltip>

      <!-- 批量操作 dropdown (placeholder) -->
      <ElDropdown trigger="click" placement="bottom-end" disabled>
        <ElButton size="small" class="toolbar-action-btn" disabled>
          批量操作
          <span class="toolbar-chevron">&#9662;</span>
        </ElButton>

        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem disabled>
              <span class="text-[var(--ae-text-muted)] text-xs">批量删除 (即将推出)</span>
            </ElDropdownItem>
            <ElDropdownItem disabled>
              <span class="text-[var(--ae-text-muted)] text-xs">批量导出 (即将推出)</span>
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>

      <!-- 文件管理 dropdown (placeholder) -->
      <ElDropdown trigger="click" placement="bottom-end" disabled>
        <ElButton size="small" class="toolbar-action-btn" disabled>
          文件管理
          <span class="toolbar-chevron">&#9662;</span>
        </ElButton>

        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem disabled>
              <span class="text-[var(--ae-text-muted)] text-xs">导入文件 (即将推出)</span>
            </ElDropdownItem>
            <ElDropdownItem disabled>
              <span class="text-[var(--ae-text-muted)] text-xs">导出文件 (即将推出)</span>
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
    </div>
  </div>
</template>

<style scoped>
/* ── Toolbar container ── */
.data-table-toolbar {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
  padding: var(--ae-space-2) var(--ae-space-3);
  min-height: 40px;
  flex-shrink: 0;
  background: var(--ae-bg-surface);
  border-bottom: 1px solid var(--ae-border-subtle);
  font-family: var(--ae-font-base), -apple-system, BlinkMacSystemFont, sans-serif;
}

/* ── Sections ── */
.toolbar-section {
  display: flex;
  align-items: center;
  gap: var(--ae-space-2);
}

.toolbar-section--info {
  flex-shrink: 0;
}

.toolbar-section--search {
  flex: 0 1 200px;
  min-width: 120px;
  max-width: 280px;
}

.toolbar-section--actions {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
  flex-shrink: 0;
}

/* ── Entity label ── */
.toolbar-entity-label {
  font-size: var(--ae-font-sm);
  font-weight: 600;
  color: var(--ae-text-primary);
  white-space: nowrap;
}

/* ── Count badges ── */
.toolbar-count {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  padding: 0 var(--ae-space-1);
  background: var(--ae-bg-overlay);
  border-radius: 999px;
  line-height: 1.4;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.toolbar-count--selected {
  color: var(--ae-accent-primary);
  background: var(--ae-accent-primary-subtle);
}

/* ── Search input override ── */
.toolbar-search :deep(.el-input__wrapper) {
  background: var(--ae-bg-elevated) !important;
  box-shadow: 0 0 0 1px var(--ae-border-subtle) inset !important;
  border-radius: var(--ae-radius-sm) !important;
  height: 28px !important;
  font-size: var(--ae-font-sm);
  transition: box-shadow 0.15s ease;
}

.toolbar-search :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--ae-border-default) inset !important;
}

.toolbar-search :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--ae-accent-primary) inset !important;
}

.toolbar-search :deep(.el-input__prefix) {
  color: var(--ae-text-muted);
}

.toolbar-search :deep(.el-input__inner) {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-primary);
}

.toolbar-search :deep(.el-input__inner::placeholder) {
  color: var(--ae-text-muted);
  font-size: var(--ae-font-sm);
}

/* ── Action buttons ── */
.toolbar-action-btn {
  height: 28px !important;
  padding: 0 var(--ae-space-2) !important;
  font-size: var(--ae-font-sm) !important;
  border-radius: var(--ae-radius-sm) !important;
  font-weight: 500;
}

.toolbar-chevron {
  font-size: 10px;
  margin-left: 2px;
}
</style>
