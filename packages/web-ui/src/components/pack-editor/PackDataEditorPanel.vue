<template>
  <el-card shadow="never" class="schema-panel-root">
    <section class="table-pane table-pane-full">
      <div class="table-filter-row">
        <el-input
          v-model.trim="editorFilter"
          clearable
          placeholder="搜索 ID / 列值"
          :disabled="!editorDataFile"
        />
        <el-tag size="small" effect="plain">{{ filteredRows.length }} 条</el-tag>
        <el-button
          :loading="editorLoading"
          :disabled="!isDesktop || !packFolder || !editorDataFile"
          @click="() => loadEditorRecords()"
        >
          刷新
        </el-button>
      </div>

      <div class="tanstack-table-shell">
        <table class="tanstack-table" v-if="table.getRowModel().rows.length > 0">
          <thead>
            <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
              <th
                v-for="header in headerGroup.headers"
                :key="header.id"
                :style="{ width: header.column.columnDef.size ? `${header.column.columnDef.size}px` : undefined }"
                :class="{ sortable: header.column.getCanSort() }"
                @click="toggleColumnSort(header.column)"
              >
                <template v-if="!header.isPlaceholder">
                  <div class="th-inner">
                    <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
                    <span class="sort-indicator">{{ getSortIndicator(header.column.getIsSorted()) }}</span>
                  </div>
                </template>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :class="{ selected: selectedRowIndex === row.original.index }"
              @click="selectEditorRow(row.original)"
            >
              <td v-for="cell in row.getVisibleCells()" :key="cell.id">
                <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
              </td>
            </tr>
          </tbody>
        </table>

        <el-empty v-else description="当前数据文件暂无条目" :image-size="72" />
      </div>

      <div class="table-pagination-row" v-if="filteredRows.length > 0">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :total="filteredRows.length"
          :page-sizes="[20, 50, 100, 200]"
          layout="total, sizes, prev, pager, next"
          small
        />
      </div>
    </section>
  </el-card>

  <el-drawer
    v-model="editorPanelVisible"
    class="pack-editor-drawer"
    direction="rtl"
    :with-header="false"
    :append-to-body="true"
    size="min(760px, 92vw)"
    modal-class="pack-editor-blur-overlay"
  >
    <el-empty
      v-if="!editorDraft"
      description="选择一条记录开始编辑"
      :image-size="88"
    />

    <div v-else class="detail-content">
      <div class="drawer-actions">
        <el-button @click="editorPanelVisible = false">关闭</el-button>
        <el-button
          v-if="selectedRowIsAlias"
          :disabled="!isDesktop || !packFolder || !editorDataFile || !editorDraft"
          @click="detachAlias"
        >
          解除别名
        </el-button>
        <el-button
          type="danger"
          :disabled="!isDesktop || !packFolder || !editorDataFile || selectedRowIndex === null"
          @click="deleteEditorRecord"
        >
          删除条目
        </el-button>
        <el-button
          type="primary"
          :loading="editorSaving"
          :disabled="!isDesktop || !packFolder || !editorDataFile || !editorDraft"
          @click="saveEditorRecord"
        >
          保存条目
        </el-button>
      </div>

      <el-alert
        show-icon
        :closable="false"
        :type="selectedRowIsAlias ? 'warning' : selectedRowHasMerge ? 'success' : 'info'"
        :title="detailAlertTitle"
      />

      <div v-if="mergeRevertableKeys.length > 0" class="merge-revert-shell">
        <div class="merge-revert-title">回退到继承值</div>
        <div class="merge-revert-actions">
          <el-button
            v-for="key in mergeRevertableKeys"
            :key="key"
            size="small"
            @click="revertMergeKey(key)"
          >
            回退 {{ key }}
          </el-button>
        </div>
        <div class="merge-revert-tip">回退后会从当前条目移除该字段，保存后由锚点/merge 提供值。</div>
      </div>

      <div class="schema-editor-shell" :class="{ readonly: selectedRowIsAlias }">
        <OptionalFieldEditor
          v-model="editorDraft"
          :schema="schemaSpec.rowSchema"
          :context-kind="kind"
          field-path=""
          label="条目"
        />
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { computed, h, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import i18next from 'i18next'
import { Check, Close } from '@element-plus/icons-vue'
import type { Element } from '@arcadia-eternity/const'
import {
  FlexRender,
  createColumnHelper,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useVueTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from '@tanstack/vue-table'
import { Value } from '@sinclair/typebox/value'
import type { TSchema } from '@sinclair/typebox'
import { isDesktop } from '@/utils/env'
import { useGameDataStore } from '@/stores/gameData'
import { useResourceStore } from '@/stores/resource'
import OptionalFieldEditor from '@/components/OptionalFieldEditor.vue'
import ElementIcon from '@/components/battle/ElementIcon.vue'
import PetIcon from '@/components/PetIcon.vue'
import MarkIcon from '@/components/MarkIcon.vue'
import type { MarkSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'
import {
  listWorkspacePacks,
  readWorkspacePackFile,
  readWorkspacePackManifest,
  writeWorkspacePackFile,
  writeWorkspacePackManifest,
} from '@/services/packWorkspace'
import {
  formatSummaryValue,
  getTypeBoxSchemaSpec,
  getValueByPath,
  resolveSchemaByPath,
  type EditableDataKind,
} from '@/components/pack-editor/typeboxDataSchema'
import {
  deleteYamlAnchoredRecord,
  detachYamlAliasRecord,
  parseYamlAnchoredDataset,
  stringifyYamlAnchoredDataset,
  upsertYamlAnchoredRecord,
  type YamlAnchoredDataset,
  type YamlAnchoredRow,
} from '@/components/pack-editor/yamlAnchoredRecords'

type WorkspacePackManifest = {
  id: string
  version?: string
  paths?: Record<string, unknown>
  data?: Record<string, unknown>
  [key: string]: unknown
}

type EditorRow = YamlAnchoredRow & {
  sourceFile: string
}

const props = defineProps<{
  kind: EditableDataKind
  packFolder: string
  initialDataFile?: string
  lockDataFile?: boolean
}>()

const emit = defineEmits<{
  saved: []
}>()

const kind = computed(() => props.kind)
const packFolder = computed(() => String(props.packFolder ?? '').trim())
const initialDataFile = computed(() => String(props.initialDataFile ?? '').trim())

const DATA_FILE_BY_KIND: Record<EditableDataKind, string> = {
  species: 'species.yaml',
  skills: 'skill.yaml',
  marks: 'mark.yaml',
}

const schemaSpec = computed(() => getTypeBoxSchemaSpec(kind.value))

const editorLoading = ref(false)
const editorSaving = ref(false)
const editorDataFiles = ref<string[]>([])
const editorDataFile = ref('')
const editorFilter = ref('')
const editorRows = ref<EditorRow[]>([])
const selectedRowIndex = ref<number | null>(null)
const editorDraft = ref<Record<string, unknown> | null>(null)
const editorPanelVisible = ref(false)
const editorManifest = ref<WorkspacePackManifest | null>(null)
const datasetRef = ref<YamlAnchoredDataset | null>(null)

const gameDataStore = useGameDataStore()
const resourceStore = useResourceStore()

type SummaryCellState = 'missing' | 'null' | 'value'

const selectedRow = computed(() => {
  if (selectedRowIndex.value === null) return null
  return editorRows.value.find(row => row.index === selectedRowIndex.value) ?? null
})

const selectedRowIsAlias = computed(() => selectedRow.value?.kind === 'alias')
const selectedRowHasMerge = computed(() => Boolean(selectedRow.value?.hasMerge))
const mergeRevertableKeys = computed(() => {
  const row = selectedRow.value
  if (!row?.hasMerge) return []
  return row.directKeys.filter(key => Object.prototype.hasOwnProperty.call(row.mergeBase, key))
})

const detailAlertTitle = computed(() => {
  if (selectedRowIsAlias.value) {
    return '当前记录是 YAML 别名，先点击“解除别名”再编辑。'
  }
  if (selectedRowHasMerge.value) {
    return '该记录包含 merge 继承，保存时会尽量保留锚点复用。'
  }
  return '当前记录将按 TypeBox schema 校验并写回 YAML。'
})

function getTopLevelKey(path: string): string {
  return path.split('.').filter(Boolean)[0] ?? path
}

function isCellInherited(row: EditorRow, path: string): boolean {
  if (!row.hasMerge) return false
  const topKey = getTopLevelKey(path)
  return !row.directKeys.includes(topKey) && Object.prototype.hasOwnProperty.call(row.mergeBase, topKey)
}

function isCellOverridden(row: EditorRow, path: string): boolean {
  const topKey = getTopLevelKey(path)
  return row.directKeys.includes(topKey)
}

function revertMergeKey(key: string): void {
  if (!editorDraft.value) return
  const nextDraft = cloneJson(editorDraft.value)
  delete nextDraft[key]
  editorDraft.value = nextDraft
  ElMessage.success(`已回退 ${key}，保存后生效`)
}

function cloneJson<T>(value: T): T {
  return Value.Clone(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0)
}

function normalizeManifest(raw: Record<string, unknown>): WorkspacePackManifest {
  const manifest: WorkspacePackManifest = {
    ...raw,
    id: typeof raw.id === 'string' ? raw.id : '',
    version: typeof raw.version === 'string' ? raw.version : '0.1.0',
    paths: raw.paths && typeof raw.paths === 'object' ? { ...(raw.paths as Record<string, unknown>) } : {},
    data: raw.data && typeof raw.data === 'object' ? { ...(raw.data as Record<string, unknown>) } : {},
  }

  const data = manifest.data ?? {}
  data.effects = toStringArray(data.effects)
  data.marks = toStringArray(data.marks)
  data.skills = toStringArray(data.skills)
  data.species = toStringArray(data.species)
  manifest.data = data

  return manifest
}

function getDataDir(manifest: WorkspacePackManifest): string {
  const raw = manifest.paths?.dataDir
  if (typeof raw !== 'string') return '.'
  const cleaned = raw.trim()
  return cleaned.length > 0 ? cleaned : '.'
}

function isRemotePath(pathValue: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(pathValue)
}

function resolvePackDataPath(manifest: WorkspacePackManifest, fileRef: string): string {
  if (isRemotePath(fileRef)) {
    throw new Error(`暂不支持编辑远程数据文件: ${fileRef}`)
  }

  const cleanedFile = String(fileRef ?? '').replace(/^\/+/, '').trim()
  if (!cleanedFile || cleanedFile.split('/').includes('..')) {
    throw new Error(`非法数据文件路径: ${fileRef}`)
  }

  const dataDir = getDataDir(manifest)
  if (dataDir === '.' || dataDir.length === 0) {
    return cleanedFile
  }

  const cleanedDir = dataDir.replace(/\/+$/, '').replace(/^\/+/, '')
  return `${cleanedDir}/${cleanedFile}`
}

function getKindFiles(manifest: WorkspacePackManifest, currentKind: EditableDataKind): string[] {
  const data = manifest.data ?? {}
  return toStringArray(data[currentKind])
}

function setKindFiles(manifest: WorkspacePackManifest, currentKind: EditableDataKind, files: string[]): void {
  if (!manifest.data || typeof manifest.data !== 'object') {
    manifest.data = {}
  }
  ;(manifest.data as Record<string, unknown>)[currentKind] = [...new Set(files)]
}

function isMissingFileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('文件不存在') || message.includes('not found')
}

async function readYamlSourceFile(
  currentPackFolder: string,
  manifest: WorkspacePackManifest,
  fileRef: string,
): Promise<string> {
  const relativePath = resolvePackDataPath(manifest, fileRef)

  try {
    const result = await readWorkspacePackFile({
      folderName: currentPackFolder,
      relativePath,
    })
    return result.content
  } catch (error) {
    if (isMissingFileError(error)) {
      return ''
    }
    throw error
  }
}

async function writeYamlSourceFile(
  currentPackFolder: string,
  manifest: WorkspacePackManifest,
  fileRef: string,
  content: string,
): Promise<void> {
  const relativePath = resolvePackDataPath(manifest, fileRef)
  await writeWorkspacePackFile({
    folderName: currentPackFolder,
    relativePath,
    content,
  })
}

async function ensureManifestForEditor(): Promise<WorkspacePackManifest> {
  if (!packFolder.value) {
    throw new Error('缺少数据包目录参数')
  }

  if (editorManifest.value) {
    return cloneJson(editorManifest.value)
  }

  const manifestResult = await readWorkspacePackManifest({ folderName: packFolder.value })
  const manifest = normalizeManifest(manifestResult.manifest)
  editorManifest.value = manifest
  return cloneJson(manifest)
}

async function ensureSourceFileInManifest(manifest: WorkspacePackManifest, sourceFile: string): Promise<WorkspacePackManifest> {
  const files = getKindFiles(manifest, kind.value)
  if (files.includes(sourceFile)) {
    return manifest
  }

  const nextFiles = [...files, sourceFile]
  setKindFiles(manifest, kind.value, nextFiles)
  await writeWorkspacePackManifest({
    folderName: packFolder.value,
    manifest,
  })

  editorManifest.value = cloneJson(manifest)
  editorDataFiles.value = [...new Set(nextFiles)]
  return manifest
}

function resetEditorSelection(): void {
  editorPanelVisible.value = false
  selectedRowIndex.value = null
  editorDraft.value = null
}

function selectEditorRow(row: EditorRow, options?: { openPanel?: boolean }): void {
  selectedRowIndex.value = row.index
  editorDraft.value = cloneJson(row.value)
  syncPageForRow(row.index)
  if (options?.openPanel !== false) {
    editorPanelVisible.value = true
  }
}

async function triggerRuntimeReload(folderName: string): Promise<void> {
  const allPacks = await listWorkspacePacks()
  const target = allPacks.find(
    pack => String(pack.folderName).trim().toLowerCase() === folderName.trim().toLowerCase(),
  )
  if (!target?.enabled) return

  const results = await Promise.allSettled([
    gameDataStore.applyWorkspacePackToggle({
      folderName,
      enabled: true,
    }),
    resourceStore.applyWorkspacePackToggle({
      folderName,
      enabled: true,
    }),
  ])

  const failed = results.find(item => item.status === 'rejected')
  if (failed && failed.status === 'rejected') {
    throw failed.reason
  }
}

async function loadEditorRecords(options?: { preferredId?: string; preferredIndex?: number | null }): Promise<void> {
  if (!isDesktop || !packFolder.value) {
    editorRows.value = []
    editorDataFiles.value = []
    editorDataFile.value = ''
    editorManifest.value = null
    datasetRef.value = null
    resetEditorSelection()
    return
  }

  editorLoading.value = true
  try {
    const autoOpenPanel = editorPanelVisible.value

    const manifestResult = await readWorkspacePackManifest({ folderName: packFolder.value })
    const manifest = normalizeManifest(manifestResult.manifest)
    editorManifest.value = manifest

    const files = getKindFiles(manifest, kind.value)
    let sourceFile = initialDataFile.value || editorDataFile.value.trim()
    if (!sourceFile) {
      sourceFile = files[0] || schemaSpec.value.defaultDataFile || DATA_FILE_BY_KIND[kind.value]
    }

    const nextFiles = [...new Set([...files, sourceFile])]
    editorDataFiles.value = nextFiles
    editorDataFile.value = sourceFile

    const yamlText = await readYamlSourceFile(packFolder.value, manifest, sourceFile)
    const dataset = parseYamlAnchoredDataset(yamlText)
    datasetRef.value = dataset

    editorRows.value = dataset.rows.map(row => ({
      ...row,
      sourceFile,
    }))

    const preferredIndex = options?.preferredIndex
    if (typeof preferredIndex === 'number') {
      const matchedByIndex = editorRows.value.find(row => row.index === preferredIndex)
      if (matchedByIndex) {
        selectEditorRow(matchedByIndex, { openPanel: autoOpenPanel })
        return
      }
    }

    const preferredId = options?.preferredId ?? selectedRow.value?.id
    if (preferredId) {
      const matchedById = editorRows.value.find(row => row.id === preferredId)
      if (matchedById) {
        selectEditorRow(matchedById, { openPanel: autoOpenPanel })
        return
      }
    }

    if (editorRows.value.length > 0) {
      selectEditorRow(editorRows.value[0], { openPanel: autoOpenPanel })
    } else {
      resetEditorSelection()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`加载编辑数据失败: ${message}`)
    editorRows.value = []
    datasetRef.value = null
    resetEditorSelection()
  } finally {
    editorLoading.value = false
  }
}

async function persistDataset(options?: { preferredId?: string; preferredIndex?: number | null }): Promise<void> {
  const dataset = datasetRef.value
  if (!dataset) {
    throw new Error('数据文档未加载')
  }

  const sourceFile = editorDataFile.value.trim() || DATA_FILE_BY_KIND[kind.value]
  if (!sourceFile) {
    throw new Error('请先选择数据文件')
  }

  let manifest = await ensureManifestForEditor()
  manifest = await ensureSourceFileInManifest(manifest, sourceFile)

  const yamlText = stringifyYamlAnchoredDataset(dataset)
  await writeYamlSourceFile(packFolder.value, manifest, sourceFile, yamlText)

  await loadEditorRecords(options)

  try {
    await triggerRuntimeReload(packFolder.value)
  } catch (reloadError) {
    const message = reloadError instanceof Error ? reloadError.message : String(reloadError)
    ElMessage.warning(`文件已保存，但热加载失败: ${message}`)
  }

  emit('saved')
}

async function saveEditorRecord(): Promise<void> {
  if (!isDesktop || !packFolder.value || !editorDraft.value) return

  const dataset = datasetRef.value
  if (!dataset) {
    ElMessage.error('数据文档未加载')
    return
  }

  const nextId = String(editorDraft.value.id ?? '').trim()
  if (!nextId) {
    ElMessage.warning('ID 不能为空')
    return
  }

  const duplicate = editorRows.value.find(
    row => row.id === nextId && row.index !== selectedRowIndex.value,
  )
  if (duplicate) {
    ElMessage.error(`ID 冲突: ${nextId}`)
    return
  }

  editorSaving.value = true
  try {
    const result = upsertYamlAnchoredRecord({
      dataset,
      schema: schemaSpec.value.rowSchema as TSchema,
      draft: cloneJson(editorDraft.value),
      targetIndex: selectedRowIndex.value ?? undefined,
    })

    await persistDataset({ preferredId: String(result.normalized.id ?? ''), preferredIndex: result.index })
    ElMessage.success('条目已保存')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`保存失败: ${message}`)
  } finally {
    editorSaving.value = false
  }
}

async function deleteEditorRecord(): Promise<void> {
  if (!isDesktop || !packFolder.value || selectedRowIndex.value === null) return

  const row = selectedRow.value
  if (!row) return

  try {
    await ElMessageBox.confirm(`确定删除条目 ${row.id} 吗？`, '删除确认', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }

  const dataset = datasetRef.value
  if (!dataset) return

  editorSaving.value = true
  try {
    deleteYamlAnchoredRecord(dataset, row.index)
    await persistDataset({ preferredIndex: row.index })
    ElMessage.success('条目已删除')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`删除失败: ${message}`)
  } finally {
    editorSaving.value = false
  }
}

async function detachAlias(): Promise<void> {
  const row = selectedRow.value
  const dataset = datasetRef.value
  if (!row || !dataset || !editorDraft.value) return

  if (!detachYamlAliasRecord(dataset, row.index, editorDraft.value)) {
    ElMessage.warning('当前条目不是别名，无法解除')
    return
  }

  editorSaving.value = true
  try {
    await persistDataset({ preferredIndex: row.index })
    ElMessage.success('已解除别名，可继续编辑')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`解除别名失败: ${message}`)
  } finally {
    editorSaving.value = false
  }
}

function getColumnDefaultText(columnPath: string): string {
  const schemaByPath = resolveSchemaByPath(schemaSpec.value.rowSchema, columnPath)
  if (!schemaByPath || !Object.prototype.hasOwnProperty.call(schemaByPath, 'default')) {
    return ''
  }
  return formatSummaryValue((schemaByPath as TSchema & { default: unknown }).default)
}

function getSummaryCellState(value: unknown): SummaryCellState {
  if (value === undefined) return 'missing'
  if (value === null) return 'null'
  return 'value'
}

function translateCurrentKindName(id: string): string {
  if (kind.value === 'species') {
    return i18next.t(`${id}.name`, { ns: 'species', defaultValue: id })
  }
  if (kind.value === 'skills') {
    return i18next.t(`${id}.name`, { ns: 'skill', defaultValue: id })
  }
  return i18next.t(`${id}.name`, {
    ns: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
    defaultValue: id,
  })
}

function getCellMainText(columnPath: string, value: unknown): string {
  if (columnPath === 'id' && typeof value === 'string') {
    return value
  }

  if (columnPath === 'element' && typeof value === 'string') {
    return i18next.t(`element.${value}`, { ns: 'battle', defaultValue: value })
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return formatSummaryValue(value)
}

function getCellSubText(columnPath: string, value: unknown): string {
  if (columnPath === 'id' && typeof value === 'string') {
    const translated = translateCurrentKindName(value)
    return translated !== value ? translated : ''
  }
  return ''
}

function getRowEntityPreview(row: EditorRow): {
  petIconId?: number
  markId?: string
  element?: Element
} {
  if (kind.value === 'species') {
    const species = row.value as Partial<SpeciesSchemaType>
    const num = typeof species?.num === 'number' && species.num > 0 ? species.num : 999
    return {
      petIconId: num,
    }
  }

  if (kind.value === 'marks') {
    const mark = row.value as Partial<MarkSchemaType>
    return {
      markId: String(mark.id ?? row.id ?? '').trim(),
    }
  }

  if (kind.value === 'skills') {
    const fromRow = row.value?.element
    if (typeof fromRow === 'string') {
      return { element: fromRow as Element }
    }
    const fromStore = gameDataStore.skills.byId[row.id]?.element
    if (typeof fromStore === 'string') {
      return { element: fromStore as Element }
    }
  }

  return {}
}

const filteredRows = computed(() => {
  const query = editorFilter.value.trim().toLowerCase()
  if (!query) return editorRows.value

  const columns = schemaSpec.value.summaryColumns
  return editorRows.value.filter(row => {
    if (row.id.toLowerCase().includes(query)) return true
    return columns.some(column => {
      const value = getValueByPath(row.value, column.path)
      const state = getSummaryCellState(value)
      const defaultText = state === 'missing' ? getColumnDefaultText(column.path) : ''
      const searchable = `${formatSummaryValue(value)} ${defaultText}`.trim().toLowerCase()
      return searchable.includes(query)
    })
  })
})

const columnHelper = createColumnHelper<EditorRow>()

function renderSummaryCell(row: EditorRow, columnPath: string): ReturnType<typeof h> {
  const displayValue = getValueByPath(row.value, columnPath)
  const state = getSummaryCellState(displayValue)
  const defaultText = state === 'missing' ? getColumnDefaultText(columnPath) : ''
  const mainText = getCellMainText(columnPath, displayValue)
  const subText = getCellSubText(columnPath, displayValue)
  const rowEntityPreview = getRowEntityPreview(row)

  const nodes: ReturnType<typeof h>[] = []

  if (state === 'value' && columnPath === 'id') {
    if (typeof rowEntityPreview.petIconId === 'number') {
      nodes.push(
        h(PetIcon, {
          id: rowEntityPreview.petIconId,
          class: 'cell-pet-icon',
        }),
      )
    } else if (typeof rowEntityPreview.markId === 'string' && rowEntityPreview.markId.length > 0) {
      nodes.push(h(MarkIcon, { markId: rowEntityPreview.markId, size: 18, class: 'cell-mark-icon' }))
    } else if (rowEntityPreview.element) {
      nodes.push(
        h('span', { class: 'cell-icon cell-element-icon' }, [
          h(ElementIcon, { element: rowEntityPreview.element, size: 18 }),
        ]),
      )
    }
  }

  if (state === 'value' && columnPath === 'element' && typeof displayValue === 'string') {
    nodes.push(
      h('span', { class: 'cell-icon cell-element-icon' }, [
        h(ElementIcon, { element: displayValue as Element, size: 18 }),
      ]),
    )
  }

  if (state === 'value' && typeof displayValue === 'boolean') {
    nodes.push(
      h('span', { class: ['cell-icon', displayValue ? 'cell-boolean-true' : 'cell-boolean-false'] }, [
        h(displayValue ? Check : Close),
      ]),
    )
  }

  nodes.push(h('span', { class: ['cell-value', `cell-value-${state}`] }, mainText))

  if (subText) {
    nodes.push(h('span', { class: 'cell-sub-value' }, subText))
  }

  if (state === 'missing' && defaultText) {
    nodes.push(h('span', { class: 'cell-badge default' }, `=${defaultText}`))
  }

  if (isCellInherited(row, columnPath)) {
    nodes.push(h('span', { class: 'cell-badge inherited' }, '继承'))
  } else if (isCellOverridden(row, columnPath) && row.hasMerge) {
    nodes.push(h('span', { class: 'cell-badge overridden' }, '覆盖'))
  }

  return h('div', { class: 'cell-inline' }, nodes)
}

const tableColumns = computed<ColumnDef<EditorRow>[]>(() => {
  const metaColumn: ColumnDef<EditorRow> = columnHelper.display({
    id: 'meta',
    size: 130,
    header: '状态',
    cell: info => {
      const row = info.row.original
      const states: string[] = []
      if (row.kind === 'alias') states.push('ALIAS')
      if (row.hasMerge) states.push('MERGE')
      if (row.anchor) states.push(`&${row.anchor}`)
      return states.join(' | ') || '-'
    },
  })

  const summaryColumns = schemaSpec.value.summaryColumns.map(column => {
    return columnHelper.accessor(
      row => getValueByPath(row.value, column.path),
      {
        id: column.id,
        size: column.width,
        header: column.label,
        cell: info => renderSummaryCell(info.row.original, column.path),
      },
    )
  })

  return [metaColumn, ...summaryColumns]
})

const sorting = ref<SortingState>([])
const pagination = ref<PaginationState>({
  pageIndex: 0,
  pageSize: 50,
})
const table = useVueTable({
  get data() {
    return filteredRows.value
  },
  get columns() {
    return tableColumns.value
  },
  getRowId: row => String(row.index),
  state: {
    get sorting() {
      return sorting.value
    },
    get pagination() {
      return pagination.value
    },
  },
  onSortingChange: updater => {
    sorting.value = typeof updater === 'function'
      ? updater(sorting.value)
      : updater
  },
  onPaginationChange: updater => {
    pagination.value = typeof updater === 'function'
      ? updater(pagination.value)
      : updater
  },
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
})

const currentPage = computed({
  get: () => pagination.value.pageIndex + 1,
  set: page => {
    const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1
    table.setPageIndex(safePage - 1)
  },
})

const pageSize = computed({
  get: () => pagination.value.pageSize,
  set: size => {
    const numericSize = Number(size)
    const safeSize = Number.isFinite(numericSize) ? Math.max(1, Math.floor(numericSize)) : 50
    table.setPageSize(safeSize)
  },
})

function syncPageForRow(rowIndex: number | null): void {
  if (typeof rowIndex !== 'number') return
  const position = filteredRows.value.findIndex(row => row.index === rowIndex)
  if (position < 0) return
  const nextPageIndex = Math.floor(position / Math.max(1, pageSize.value))
  if (nextPageIndex !== pagination.value.pageIndex) {
    table.setPageIndex(nextPageIndex)
  }
}

function toggleColumnSort(column: { getCanSort: () => boolean; toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' }): void {
  if (!column.getCanSort()) return
  column.toggleSorting(column.getIsSorted() === 'asc')
}

function getSortIndicator(value: false | 'asc' | 'desc'): string {
  if (value === 'asc') return '▲'
  if (value === 'desc') return '▼'
  return ''
}

watch(
  () => editorFilter.value,
  () => {
    table.setPageIndex(0)
  },
)

watch(
  () => [filteredRows.value.length, pageSize.value],
  () => {
    const pageCount = Math.max(1, table.getPageCount())
    if (pagination.value.pageIndex >= pageCount) {
      table.setPageIndex(pageCount - 1)
    }
    syncPageForRow(selectedRowIndex.value)
  },
)

watch(
  () => [kind.value, packFolder.value],
  async () => {
    editorRows.value = []
    editorDataFiles.value = []
    editorDataFile.value = ''
    editorManifest.value = null
    datasetRef.value = null
    table.setPageIndex(0)
    resetEditorSelection()
    await loadEditorRecords()
  },
)

watch(
  () => initialDataFile.value,
  async file => {
    if (!file) return
    if (editorDataFile.value === file) return
    editorDataFile.value = file
    await loadEditorRecords()
  },
)

onMounted(async () => {
  await loadEditorRecords()
})
</script>

<style scoped>
.schema-panel-root {
  --panel-bg: #f7f9fc;
  --line: #dde4ef;
  --line-strong: #c5d1e4;
  --text-main: #1f2a3d;
  --text-sub: #5f6f86;
  --row-hover: #f2f6ff;
  --row-active: #e8f0ff;
}

.schema-panel-root :deep(.el-card__body) {
  padding: 0;
}

.table-pane {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 620px;
}

.table-pane-full {
  height: 100%;
}

.table-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 10px;
  border-bottom: 1px solid var(--line);
}

.tanstack-table-shell {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.table-pagination-row {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 8px 10px;
  border-top: 1px solid var(--line);
  background: #ffffff;
}

.tanstack-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 860px;
}

.tanstack-table th,
.tanstack-table td {
  border-bottom: 1px solid var(--line);
  padding: 8px 10px;
  text-align: left;
  font-size: 12px;
  color: var(--text-main);
  vertical-align: middle;
}

.tanstack-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--panel-bg);
  border-bottom-color: var(--line-strong);
  font-weight: 700;
  color: #32445f;
  user-select: none;
}

.tanstack-table th.sortable {
  cursor: pointer;
}

.th-inner {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sort-indicator {
  display: inline-block;
  min-width: 12px;
  color: #5f6f86;
}

.tanstack-table tbody tr:hover {
  background: var(--row-hover);
}

.tanstack-table tbody tr.selected {
  background: var(--row-active);
}

.detail-content {
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.schema-editor-shell {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  background: #fbfcff;
}

.schema-editor-shell.readonly {
  opacity: 0.9;
}

.merge-revert-shell {
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  background: #f7faff;
  padding: 8px;
  display: grid;
  gap: 8px;
}

.merge-revert-title {
  font-size: 12px;
  font-weight: 600;
  color: #39557a;
}

.merge-revert-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.merge-revert-tip {
  font-size: 11px;
  color: #6c7e98;
}

.cell-inline {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex-wrap: wrap;
}

.cell-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: #55739f;
}

.cell-icon :deep(svg) {
  width: 16px;
  height: 16px;
}

.cell-pet-icon,
.cell-mark-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
}

.cell-element-icon :deep(.element-icon) {
  min-height: 18px;
  width: 18px;
  height: 18px;
}

.cell-boolean-true {
  color: #2f7f43;
}

.cell-boolean-false {
  color: #9a3a3a;
}

.cell-value {
  min-width: 0;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell-value-missing {
  color: #7b8aa3;
  font-style: italic;
}

.cell-value-null {
  color: #8a5c2d;
  font-style: italic;
}

.cell-sub-value {
  flex-basis: 100%;
  font-size: 10px;
  color: #6d7f99;
  line-height: 1.2;
}

.cell-badge {
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 10px;
  line-height: 1.5;
  border: 1px solid transparent;
}

.cell-badge.inherited {
  background: #eef4ff;
  color: #35527a;
  border-color: #c9daf8;
}

.cell-badge.overridden {
  background: #fef5e9;
  color: #7f4a15;
  border-color: #f8d7ad;
}

.cell-badge.default {
  background: #f0f7ed;
  color: #3b6c2f;
  border-color: #cde5c3;
}

:global(.pack-editor-blur-overlay) {
  background: rgba(17, 24, 39, 0.28) !important;
  backdrop-filter: blur(8px);
}

:global(.pack-editor-drawer .el-drawer__body) {
  padding: 0;
}
</style>
