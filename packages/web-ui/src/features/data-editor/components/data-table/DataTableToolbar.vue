<script setup lang="ts">
/**
 * DataTableToolbar.vue
 *
 * Toolbar above the data table providing:
 *   - Search input (syncs with editorState.searchQuery)
 *   - Record count + selection count
 *   - [新增] Create new record
 *   - [删除] Delete selected record
 *   - [批量操作] Batch delete/export dropdown
 *   - [文件管理] File import/export dropdown
 *
 * Uses the `useEditorState()` composable for search state.
 */
import { computed, inject } from 'vue'
import { Delete, Search, Plus } from '@element-plus/icons-vue'
import {
  ElInput,
  ElButton,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElIcon,
  ElMessage,
  ElMessageBox,
  ElSelect,
  ElOption,
} from 'element-plus'
import { useEditorState, type EntityType } from '../../composables/useEditorState'

// ── Props ──

const props = defineProps<{
  entityType: EntityType
  recordCount: number
  selectedCount: number
  selectedIds?: string[]
}>()

const selectedIds = computed(() => props.selectedIds ?? [])

// ── Editor state ──

const editorState = useEditorState()

// ── Editor operations (provided by DataEditorPage) ──

const createRecord = inject('editor:createRecord', (() => {
  console.warn('[DataTableToolbar] editor:createRecord not provided')
}) as unknown as () => Promise<void>) as () => Promise<void>

const deleteRecord = inject('editor:deleteRecord', (() => {
  console.warn('[DataTableToolbar] editor:deleteRecord not provided')
}) as unknown as () => Promise<void>) as () => Promise<void>

const batchDeleteRecords = inject('editor:batchDeleteRecords', (() => {
  console.warn('[DataTableToolbar] editor:batchDeleteRecords not provided')
}) as unknown as (ids: string[]) => Promise<void>) as (ids: string[]) => Promise<void>

// ── File operations (provided by DataEditorPage) ──
const createDataFile = inject<(kind: string, name: string) => Promise<void>>('file:createDataFile', async () => {})
const deleteDataFile = inject<(path: string, options?: { force?: boolean }) => Promise<void>>(
  'file:deleteDataFile',
  async () => {},
)

async function handleNewFile() {
  try {
    const { value } = await ElMessageBox.prompt('请输入新文件名（例如 my_effects.yaml）', '新建数据文件', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.yaml$/,
      inputErrorMessage: '格式：字母开头，.yaml 结尾',
    })
    if (value) {
      await createDataFile(props.entityType, value)
      ElMessage.success(`文件 ${value} 已创建`)
    }
  } catch {
    // cancelled
  }
}

async function handleDeleteFile() {
  try {
    const { value: fileName } = await ElMessageBox.prompt('请输入要删除的文件名', '删除数据文件', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    if (!fileName) return
    await ElMessageBox.confirm(`确认删除 "${fileName}"？此操作不可逆。`, '确认删除', {
      type: 'warning',
      confirmButtonText: '确认删除',
    })
    await deleteDataFile(fileName as string)
    ElMessage.success(`文件 ${fileName} 已删除`)
  } catch {
    // cancelled or error handled by deleteDataFile
  }
}

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
      <span class="toolbar-count"> {{ recordCount }}条记录 </span>
      <span v-if="selectedCount > 0" class="toolbar-count toolbar-count--selected"> 已选{{ selectedCount }}条 </span>
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

    <!-- File selector -->
    <div class="toolbar-section toolbar-section--file">
      <ElSelect
        v-model="editorState.selectedDataFile"
        placeholder="文件"
        size="small"
        clearable
        class="toolbar-file-select"
      >
        <ElOption label="(全部文件)" :value="null" />
        <ElOption v-for="f in editorState.availableDataFiles" :key="f" :label="f" :value="f" />
      </ElSelect>
    </div>

    <!-- Spacer -->
    <div class="flex-1" />

    <!-- Right: Action buttons -->
    <div class="toolbar-section toolbar-section--actions">
      <!-- Target file selector (next to 新增 button) -->
      <div class="toolbar-target-group">
        <span class="toolbar-target-label">存至</span>
        <ElSelect v-model="editorState.createTargetFile" size="small" class="toolbar-target-select" placeholder="默认">
          <ElOption label="(默认)" :value="null" />
          <ElOption v-for="f in editorState.availableDataFiles" :key="f" :label="f" :value="f" />
        </ElSelect>
      </div>

      <!-- 新增 button -->
      <ElButton
        size="small"
        type="primary"
        class="toolbar-action-btn"
        :disabled="!editorState.selectedEntityType"
        @click="createRecord"
      >
        <template #icon>
          <ElIcon :size="14"><Plus /></ElIcon>
        </template>
        新增
      </ElButton>

      <!-- 删除 button -->
      <ElButton
        size="small"
        type="danger"
        class="toolbar-action-btn"
        :disabled="!editorState.selectedRecordId"
        @click="deleteRecord"
      >
        <template #icon>
          <ElIcon :size="14"><Delete /></ElIcon>
        </template>
        删除
      </ElButton>

      <!-- 批量操作 dropdown -->
      <ElDropdown trigger="click" placement="bottom-end" :disabled="selectedCount === 0">
        <ElButton size="small" class="toolbar-action-btn" :disabled="selectedCount === 0">
          批量操作
          <span class="toolbar-chevron">&#9662;</span>
        </ElButton>

        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem @click="batchDeleteRecords(selectedIds)"> 批量删除 </ElDropdownItem>
            <ElDropdownItem disabled>
              <span class="text-[var(--ae-text-muted)] text-xs">批量导出 (即将推出)</span>
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>

      <!-- 文件管理 dropdown -->
      <ElDropdown trigger="click" placement="bottom-end">
        <ElButton size="small" class="toolbar-action-btn">
          文件管理
          <span class="toolbar-chevron">&#9662;</span>
        </ElButton>

        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem @click="handleNewFile"> 新建文件 </ElDropdownItem>
            <ElDropdownItem @click="handleDeleteFile"> 删除文件 </ElDropdownItem>
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
  font-family:
    var(--ae-font-base),
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
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

.toolbar-section--file {
  flex: 0 0 auto;
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

/* ── File select override ── */
.toolbar-file-select :deep(.el-input__wrapper) {
  background: var(--ae-bg-elevated) !important;
  box-shadow: 0 0 0 1px var(--ae-border-subtle) inset !important;
  border-radius: var(--ae-radius-sm) !important;
  height: 28px !important;
  font-size: var(--ae-font-sm);
  transition: box-shadow 0.15s ease;
}

.toolbar-file-select :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--ae-border-default) inset !important;
}

.toolbar-file-select :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--ae-accent-primary) inset !important;
}

.toolbar-file-select :deep(.el-input__inner) {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-primary);
}

/* ── Action buttons ── */
.toolbar-target-group {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: var(--ae-space-1);
}

.toolbar-target-label {
  font-size: var(--ae-font-xs);
  color: var(--ae-text-muted);
  white-space: nowrap;
}

.toolbar-target-select {
  width: 140px;
}

.toolbar-target-select :deep(.el-input__wrapper) {
  background: var(--ae-bg-elevated) !important;
  box-shadow: 0 0 0 1px var(--ae-border-subtle) inset !important;
  border-radius: var(--ae-radius-sm) !important;
  height: 28px !important;
  font-size: var(--ae-font-sm);
  transition: box-shadow 0.15s ease;
}

.toolbar-target-select :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--ae-border-default) inset !important;
}

.toolbar-target-select :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px var(--ae-accent-primary) inset !important;
}

.toolbar-target-select :deep(.el-input__inner) {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-primary);
}

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
