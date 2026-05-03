<script setup lang="ts">
/**
 * DataTable.vue
 *
 * Core data table component using TanStack Table v8.
 * Displays entity records with sortable columns, row selection via
 * checkboxes, and highlighted selected rows.
 *
 * Features:
 *   - Row click to select a single record
 *   - Multi-select with checkboxes (Shift/Ctrl)
 *   - Sortable column headers
 *   - Client-side filtering by searchQuery
 *   - Entity-type-specific column layouts
 */
import { computed, ref, watch, h } from 'vue'
import { translateEntityName, getValueByPath } from '../../schemas/editorSchemas'
import { useGameConfig } from '../../game-config'
import {
  useVueTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  FlexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from '@tanstack/vue-table'
import { useEditorState, type EntityType } from '../../composables/useEditorState'
import DataTableToolbar from './DataTableToolbar.vue'

// ── Props & Emits ──

const props = defineProps<{
  entityType: EntityType
  records: Record<string, unknown>[]
}>()

const emit = defineEmits<{
  select: [recordId: string]
  multiSelect: [recordIds: string[]]
}>()

// ── Editor state ──

const editorState = useEditorState()
const config = useGameConfig()

// ── Local table state ──

const sorting = ref<SortingState>([])
const rowSelection = ref<RowSelectionState>({})

// Reset selection when entity type changes
watch(() => props.entityType, () => {
  rowSelection.value = {}
  sorting.value = []
})

// ── Column helpers ──

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '∅'
  if (typeof value === 'string') return value.length > 0 ? value : '""'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length}项`
  if (typeof value === 'object') return '{…}'
  return String(value)
}

// ── Columns: data-driven from game config ──

const columns = computed<ColumnDef<Record<string, unknown>, unknown>[]>(() => {
  const entityCfg = config.entities[props.entityType]
  if (!entityCfg) return []

  const summaryCols = entityCfg.summaryColumns ?? []
  const defs: ColumnDef<Record<string, unknown>, unknown>[] = []

  for (const col of summaryCols) {
    if (col.id === 'id') {
      defs.push({
        id: 'id',
        accessorKey: 'id',
        header: col.label,
        size: col.width ?? 150,
        cell: (info) => info.getValue(),
        meta: { className: 'cell-id' },
      })
      // Name column for entities with translatable names
      if (entityCfg.i18n?.hasNames !== false) {
        defs.push({
          id: 'name',
          accessorFn: (row) => translateEntityName(row.id as string, entityCfg),
          header: '名称',
          size: 140,
          cell: (info) => info.getValue(),
        })
      }
      continue
    }

    if (col.id === 'trigger') {
      defs.push({
        id: 'triggerCount',
        accessorFn: (row) => {
          const triggers = getValueByPath(row as Record<string, unknown>, col.path) as unknown[]
          return triggers?.length ?? 0
        },
        header: '触发数',
        size: col.width ?? 120,
        cell: (info) => `${info.getValue()}项`,
      })
      continue
    }

    defs.push({
      id: col.id,
      accessorFn: (row) => getValueByPath(row as Record<string, unknown>, col.path),
      header: col.label,
      size: col.width ?? 150,
      cell: (info) => formatValue(info.getValue()),
    })
  }

  // Species-specific: learnable_skills
  if (props.entityType === 'species' && config.entities['skills']) {
    const skillsCfg = config.entities['skills']
    defs.push({
      id: 'learnable_skills',
      accessorFn: (row) => {
        const skills = row.learnable_skills as Array<{ skill_id: string; level: number; hidden?: boolean }> | undefined
        if (!skills?.length) return ''
        const preview = skills.slice(0, 3).map(s => {
          const name = translateEntityName(s.skill_id, skillsCfg)
          return `${name} Lv.${s.level ?? 1}${s.hidden ? ' 隐' : ''}`
        }).join(', ')
        return skills.length > 3 ? `${preview}  +${skills.length - 3}` : preview
      },
      header: '可学技能',
      size: 240,
      enableSorting: false,
      cell: (info) => {
        const text = info.getValue() as string
        if (!text) return '—'
        const skills = info.row.original.learnable_skills as Array<{ skill_id: string; level: number; hidden?: boolean }> | undefined
        const title = skills?.map(s => {
          const name = translateEntityName(s.skill_id, skillsCfg)
          return `${name} Lv.${s.level ?? 1}${s.hidden ? ' (隐藏)' : ''}`
        }).join('\n') ?? ''
        return h('span', { title, class: 'cell-learnable' }, text)
      },
    })
  }

  return defs
})

// ── Search filter ──

const globalFilter = computed(() => editorState.searchQuery)

// ── TanStack Table instance ──

const table = useVueTable({
  get data() {
    return props.records
  },
  get columns() { return columns.value },
  state: {
    get sorting() { return sorting.value },
    get rowSelection() { return rowSelection.value },
    get globalFilter() { return globalFilter.value },
  },
  enableRowSelection: true,
  onSortingChange: (updater) => {
    sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater
  },
  onRowSelectionChange: (updater) => {
    rowSelection.value = typeof updater === 'function' ? updater(rowSelection.value) : updater
    // Emit selected IDs
    const selectedIds = table.getFilteredSelectedRowModel().rows.map(r => r.original.id as string)
    emit('multiSelect', selectedIds)
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  globalFilterFn: (row, _columnId, filterValue) => {
    const search = String(filterValue).toLowerCase().trim()
    if (!search) return true
    const recordId = String(row.original.id ?? '').toLowerCase()
    const entityCfg = config.entities[props.entityType]
    const spec = entityCfg?.i18n != null ? entityCfg : undefined
    const i18nName = spec ? translateEntityName(row.original.id as string, spec).toLowerCase() : recordId
    return recordId.includes(search) || i18nName.includes(search)
  },
})

// ── Row click handler ──

function handleRowClick(recordId: string) {
  editorState.selectedRecordId = recordId
  emit('select', recordId)
}

// ── Selection summary ──

const selectedCount = computed(() => table.getFilteredSelectedRowModel().rows.length)
const totalCount = computed(() => table.getFilteredRowModel().rows.length)
</script>

<template>
  <div class="data-table-container">
    <!-- Toolbar -->
    <DataTableToolbar
      :entity-type="entityType"
      :record-count="totalCount"
      :selected-count="selectedCount"
    />

    <!-- Table scroll area -->
    <div class="data-table-scroll">
      <table class="data-table">
        <!-- Header groups -->
        <thead class="data-table__head">
          <tr
            v-for="headerGroup in table.getHeaderGroups()"
            :key="headerGroup.id"
            class="data-table__head-row"
          >
            <!-- Selection header cell -->
            <th class="data-table__th data-table__th--checkbox">
              <label class="data-table__checkbox-label">
                <input
                  type="checkbox"
                  class="data-table__checkbox"
                  :checked="table.getIsAllPageRowsSelected()"
                  :indeterminate="table.getIsSomePageRowsSelected()"
                  @change="table.getToggleAllPageRowsSelectedHandler()($event)"
                >
              </label>
            </th>

            <!-- Data header cells -->
            <th
              v-for="header in headerGroup.headers"
              :key="header.id"
              class="data-table__th"
              :class="[
                header.column.getCanSort() ? 'data-table__th--sortable' : '',
                header.column.getIsSorted() === 'asc' ? 'data-table__th--sorted-asc' : '',
                header.column.getIsSorted() === 'desc' ? 'data-table__th--sorted-desc' : '',
              ]"
              :style="header.column.getSize() !== 150 ? { width: `${header.column.getSize()}px` } : {}"
              @click="header.column.getToggleSortingHandler()?.($event)"
            >
              <div class="data-table__th-content">
                <FlexRender
                  :render="header.column.columnDef.header"
                  :props="header.getContext()"
                />
                <span v-if="header.column.getIsSorted() === 'asc'" class="sort-indicator">▲</span>
                <span v-else-if="header.column.getIsSorted() === 'desc'" class="sort-indicator">▼</span>
                <span v-else-if="header.column.getCanSort()" class="sort-indicator sort-indicator--inactive">⇅</span>
              </div>
            </th>
          </tr>
        </thead>

        <!-- Body -->
        <tbody class="data-table__body">
          <tr
            v-for="row in table.getRowModel().rows"
            :key="row.id"
            class="data-table__row"
            :class="{
              'data-table__row--selected': row.getIsSelected(),
              'data-table__row--active': row.original.id === editorState.selectedRecordId,
            }"
            @click="handleRowClick(row.original.id as string)"
          >
            <!-- Selection cell -->
            <td class="data-table__td data-table__td--checkbox">
              <label class="data-table__checkbox-label" @click.stop>
                <input
                  type="checkbox"
                  class="data-table__checkbox"
                  :checked="row.getIsSelected()"
                  @change="row.getToggleSelectedHandler()($event)"
                >
              </label>
            </td>

            <!-- Data cells -->
            <td
              v-for="cell in row.getVisibleCells()"
              :key="cell.id"
              class="data-table__td"
              :class="(cell.column.columnDef.meta as Record<string, unknown> | undefined)?.className as string | undefined"
            >
              <FlexRender
                :render="cell.column.columnDef.cell"
                :props="cell.getContext()"
              />
            </td>
          </tr>

          <!-- Empty state -->
          <tr v-if="table.getRowModel().rows.length === 0">
            <td :colspan="columns.length + 1" class="data-table__empty">
              <div class="data-table__empty-content">
                <span class="data-table__empty-icon">📭</span>
                <span class="data-table__empty-text">
                  {{ globalFilter ? '没有匹配的记录' : '没有数据' }}
                </span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* ── Container ── */
.data-table-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ── Scroll area ── */
.data-table-scroll {
  flex: 1;
  overflow: auto;
}

/* ── Table ── */
.data-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-family: var(--ae-font-base), -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: var(--ae-font-sm);
}

/* ── Header ── */
.data-table__head {
  position: sticky;
  top: 0;
  z-index: 2;
}

.data-table__head-row {
  background: var(--ae-bg-elevated);
}

.data-table__th {
  padding: var(--ae-space-2) var(--ae-space-3);
  font-size: var(--ae-font-xs);
  font-weight: 600;
  color: var(--ae-text-muted);
  text-align: left;
  border-bottom: 1px solid var(--ae-border-default);
  white-space: nowrap;
  user-select: none;
  position: relative;
}

.data-table__th--checkbox {
  width: 40px;
  text-align: center;
  padding: 0;
}

.data-table__th--sortable {
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease;
}

.data-table__th--sortable:hover {
  color: var(--ae-text-primary);
  background: var(--ae-hover);
}

.data-table__th--sorted-asc,
.data-table__th--sorted-desc {
  color: var(--ae-accent-primary);
}

.data-table__th-content {
  display: flex;
  align-items: center;
  gap: var(--ae-space-1);
}

.sort-indicator {
  font-size: 8px;
  line-height: 1;
  flex-shrink: 0;
}

.sort-indicator--inactive {
  opacity: 0.3;
}

/* ── Body ── */
.data-table__body {
  background: var(--ae-bg-surface);
}

.data-table__row {
  transition: background 0.1s ease;
  cursor: pointer;
}

.data-table__row:hover {
  background: var(--ae-hover);
}

.data-table__row--active {
  background: var(--ae-selected);
}

.data-table__row--active:hover {
  background: var(--ae-selected);
}

.data-table__row--selected {
  background: var(--ae-accent-primary-subtle);
}

.data-table__row--selected.data-table__row--active {
  background: var(--ae-accent-primary-subtle);
}

.data-table__td {
  padding: var(--ae-space-2) var(--ae-space-3);
  color: var(--ae-text-secondary);
  border-bottom: 1px solid var(--ae-border-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
  font-size: var(--ae-font-sm);
  line-height: 1.4;
}

.data-table__td--checkbox {
  width: 40px;
  text-align: center;
  padding: 0;
}

/* ── ID cell ── */
.data-table__td :deep(.cell-id),
.data-table__td.cell-id {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--ae-font-xs);
  color: var(--ae-text-primary);
}

/* ── Checkbox ── */
.data-table__checkbox-label {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.data-table__checkbox {
  width: 14px;
  height: 14px;
  accent-color: var(--ae-accent-primary);
  cursor: pointer;
}

/* ── Empty state ── */
.data-table__empty {
  text-align: center;
  padding: var(--ae-space-8) var(--ae-space-4);
}

.data-table__empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ae-space-2);
}

.data-table__empty-icon {
  font-size: 28px;
  opacity: 0.4;
}

.data-table__empty-text {
  font-size: var(--ae-font-sm);
  color: var(--ae-text-muted);
}
</style>
