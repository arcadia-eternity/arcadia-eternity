<template>
  <div class="pack-workbench-root" :style="{ gridTemplateColumns: rootGridTemplateColumns }">
    <aside class="activity-bar">
      <button
        type="button"
        class="activity-button"
        :class="{ active: !sidebarCollapsed }"
        title="资源管理器"
        @click="sidebarCollapsed = !sidebarCollapsed"
      >
        <el-icon><Files /></el-icon>
      </button>

      <button
        type="button"
        class="activity-button"
        title="刷新工作区"
        :disabled="loading"
        @click="refreshWorkspace"
      >
        <el-icon><RefreshRight /></el-icon>
      </button>

      <button
        type="button"
        class="activity-button"
        title="新建数据包"
        :disabled="!isDesktop"
        @click="createDialogVisible = true"
      >
        <el-icon><Plus /></el-icon>
      </button>

      <button
        type="button"
        class="activity-button"
        :class="{ active: controllerVisible || controllerDrawerVisible }"
        title="战斗控制器"
        @click="toggleControllerPanel"
      >
        <el-icon><Monitor /></el-icon>
      </button>
    </aside>

    <div
      v-if="!sidebarCollapsed && compactMode"
      class="sidebar-backdrop"
      @click="sidebarCollapsed = true"
    />

    <aside
      v-if="!sidebarCollapsed"
      class="sidebar"
      :class="{ compact: compactMode }"
      :style="{ width: `${sidebarWidth}px` }"
    >
      <section class="sidebar-section">
        <header class="section-header">DATA PACKS</header>

        <div class="pack-list">
          <button
            v-for="pack in packs"
            :key="pack.folderName"
            type="button"
            class="pack-item"
            :class="{ active: selectedPackFolder === pack.folderName }"
            @click="selectPack(pack.folderName)"
          >
            <div class="pack-item-main">
              <div class="pack-item-title">{{ pack.folderName }}</div>
              <div class="pack-item-meta">{{ pack.id }}@{{ pack.version }}</div>
            </div>
            <el-switch
              v-model="pack.enabled"
              :disabled="!isDesktop || !pack.canDisable || isPackToggling(pack.folderName)"
              inline-prompt
              active-text="开"
              inactive-text="关"
              @click.stop
              @change="(value: string | number | boolean) => handleTogglePack(pack, Boolean(value))"
            />
          </button>

          <el-empty
            v-if="packs.length === 0"
            description="暂无数据包"
            :image-size="56"
          />
        </div>
      </section>

      <section class="sidebar-section grow">
        <header class="section-header">
          <span>EXPLORER</span>
          <div class="explorer-header-right">
            <span v-if="selectedPackFolder" class="selected-pack-label">{{ selectedPackFolder }}</span>
          </div>
        </header>

        <div class="file-tree-shell">
          <el-tree
            v-if="selectedPackFolder"
            :data="fileTreeNodes"
            node-key="key"
            :current-node-key="selectedTreeNodeKey"
            :expand-on-click-node="true"
            :highlight-current="true"
            :props="{
              label: 'label',
              children: 'children',
            }"
            @node-click="handleFileTreeNodeClick"
          >
            <template #default="{ data }">
              <div class="tree-node-row">
                <span class="tree-node-icon">
                  <el-icon>
                    <Folder v-if="data.isDirectory" />
                    <Document v-else />
                  </el-icon>
                </span>
                <span class="tree-node-label">{{ data.label }}</span>
                <el-tag
                  v-if="!data.isDirectory && data.entry?.dataKind"
                  class="tree-node-tag"
                  type="info"
                  size="small"
                  effect="plain"
                >
                  {{ data.entry.dataKind }}
                </el-tag>
              </div>
            </template>
          </el-tree>
          <el-empty v-else description="请选择数据包" :image-size="56" />
        </div>
      </section>
    </aside>

    <div
      v-if="!sidebarCollapsed && !compactMode"
      class="sidebar-resizer"
      @mousedown="startSidebarResize"
    />

    <div class="workbench-main">
      <main class="editor-main">
        <header class="tab-strip">
          <button
            v-for="tab in openTabs"
            :key="tab.id"
            type="button"
            class="tab-button"
            :class="{ active: activeTabId === tab.id }"
            @click="activateEditorTab(tab.id)"
          >
            <span class="tab-name">{{ tab.entry.label }}</span>
            <span class="tab-pack">{{ tab.packFolder }}</span>
            <span
              class="tab-close"
              title="关闭"
              role="button"
              tabindex="0"
              @click.stop="closeEditorTab(tab.id)"
              @keydown.enter.stop="closeEditorTab(tab.id)"
            >
              ×
            </span>
          </button>

          <div v-if="openTabs.length === 0" class="tab-placeholder">
            打开左侧文件开始编辑
          </div>
        </header>

        <section class="editor-surface">
          <component
            v-if="activeResolvedEditor && activeTab"
            :is="activeResolvedEditor.component"
            :key="`${activeTab.id}:${activeTab.entry.key}`"
            v-bind="activeResolvedEditor.props"
            @saved="handleActiveEditorSaved"
          />

          <div v-else class="editor-empty">
            <el-empty description="从左侧选择文件以打开编辑器" :image-size="92" />
          </div>
        </section>
      </main>

      <div
        v-if="controllerVisible && !compactMode"
        class="controller-resizer"
        @mousedown="startControllerResize"
      />

      <aside
        v-if="controllerVisible && !compactMode"
        class="controller-pane"
        :style="{ width: `${controllerWidth}px` }"
      >
        <BattleWorkbenchController
          :selected-pack-folder="selectedPackFolder"
          :selected-entry="selectedEntryForController"
          :open-tabs="openTabs"
        />
      </aside>
    </div>

    <el-drawer
      v-model="controllerDrawerVisible"
      :with-header="false"
      direction="rtl"
      size="88%"
      append-to-body
    >
      <BattleWorkbenchController
        :selected-pack-folder="selectedPackFolder"
        :selected-entry="selectedEntryForController"
        :open-tabs="openTabs"
      />
    </el-drawer>

    <el-dialog v-model="createDialogVisible" title="创建数据包" width="420px">
      <div class="space-y-3">
        <el-input
          v-model.trim="createForm.folderName"
          maxlength="64"
          clearable
          placeholder="目录名（必填）"
        />
        <el-input
          v-model.trim="createForm.packId"
          maxlength="128"
          clearable
          placeholder="包 ID（可选）"
        />
        <el-input
          v-model.trim="createForm.version"
          maxlength="32"
          clearable
          placeholder="版本（可选）"
        />
        <el-select v-model="createForm.template" class="w-full">
          <el-option
            v-for="template in templates"
            :key="template.id"
            :label="template.name"
            :value="template.id"
          />
        </el-select>
      </div>

      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="creating"
          :disabled="!isDesktop || !createForm.folderName"
          @click="handleCreatePack"
        >
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Document, Files, Folder, Monitor, Plus, RefreshRight } from '@element-plus/icons-vue'
import { isDesktop } from '@/utils/env'
import { useGameDataStore } from '@/stores/gameData'
import { useResourceStore } from '@/stores/resource'
import BattleWorkbenchController from '@/components/pack-editor/BattleWorkbenchController.vue'
import {
  createPackFromTemplate,
  listPackTemplates,
  listWorkspacePackFiles,
  listWorkspacePacks,
  readWorkspacePackManifest,
  setWorkspacePackEnabled,
  type PackTemplateSummary,
  type WorkspacePackFileEntry,
  type WorkspacePackSummary,
} from '@/services/packWorkspace'
import {
  resolvePackWorkbenchEditor,
  type PackWorkbenchFileEntry,
  type PackWorkbenchFileKind,
  type PackWorkbenchResolvedEditor,
} from '@/components/pack-editor/workbenchEditorRegistry'

type WorkspacePackManifest = {
  id: string
  version?: string
  paths?: Record<string, unknown>
  data?: Record<string, unknown>
  locales?: Record<string, unknown>
  assetsRef?: unknown
  [key: string]: unknown
}

type PackFileTreeNode = {
  key: string
  label: string
  relativePath: string
  isDirectory: boolean
  entry?: PackWorkbenchFileEntry
  children?: PackFileTreeNode[]
}

type FileAnnotation = {
  kind: PackWorkbenchFileKind
  sourceFile?: string
  dataKind?: string
}

type CreateForm = {
  folderName: string
  packId: string
  version: string
  template: string
}

type EditorTab = {
  id: string
  packFolder: string
  entry: PackWorkbenchFileEntry
}

const STRUCTURED_DATA_KIND_SET = new Set(['species', 'skills', 'marks'])
const TEXT_EXTENSION_SET = new Set([
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'csv',
  'xml',
  'html',
  'htm',
  'js',
  'mjs',
  'cjs',
  'ts',
  'mts',
  'cts',
  'vue',
  'css',
  'scss',
  'less',
])
const IMAGE_EXTENSION_SET = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico'])

const SIDEBAR_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 560
const CONTROLLER_MIN_WIDTH = 320
const CONTROLLER_MAX_WIDTH = 620

const loading = ref(false)
const creating = ref(false)
const createDialogVisible = ref(false)
const templates = ref<PackTemplateSummary[]>([])
const packs = ref<WorkspacePackSummary[]>([])
const togglingFolders = ref<Record<string, boolean>>({})

const selectedPackFolder = ref('')
const selectedFileKey = ref('')
const selectedTreeNodeKey = ref('')
const fileEntries = ref<PackWorkbenchFileEntry[]>([])
const fileTreeNodes = ref<PackFileTreeNode[]>([])

const openTabs = ref<EditorTab[]>([])
const activeTabId = ref('')

const compactMode = ref(false)
const sidebarCollapsed = ref(false)
const sidebarWidth = ref(320)
const sidebarDragCleanup = ref<(() => void) | null>(null)
const controllerVisible = ref(false)
const controllerDrawerVisible = ref(false)
const controllerWidth = ref(380)
const controllerDragCleanup = ref<(() => void) | null>(null)

const gameDataStore = useGameDataStore()
const resourceStore = useResourceStore()

const createForm = reactive<CreateForm>({
  folderName: '',
  packId: '',
  version: '0.1.0',
  template: 'starter',
})

const activeTab = computed(() => {
  return openTabs.value.find(tab => tab.id === activeTabId.value) ?? null
})

const selectedEntryForController = computed<PackWorkbenchFileEntry | null>(() => {
  const byTree = fileEntries.value.find(entry => entry.key === selectedFileKey.value)
  if (byTree) return byTree
  return activeTab.value?.entry ?? null
})

const rootGridTemplateColumns = computed(() => {
  if (compactMode.value || sidebarCollapsed.value) {
    return '52px minmax(0, 1fr)'
  }
  return `52px ${sidebarWidth.value}px 6px minmax(0, 1fr)`
})

const activeResolvedEditor = computed<PackWorkbenchResolvedEditor | null>(() => {
  if (!activeTab.value) return null

  return resolvePackWorkbenchEditor({
    packFolder: activeTab.value.packFolder,
    entry: activeTab.value.entry,
  })
})

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clearSidebarDragListeners(): void {
  sidebarDragCleanup.value?.()
  sidebarDragCleanup.value = null
}

function clearControllerDragListeners(): void {
  controllerDragCleanup.value?.()
  controllerDragCleanup.value = null
}

function startSidebarResize(event: MouseEvent): void {
  if (compactMode.value) return

  event.preventDefault()
  clearSidebarDragListeners()

  const startX = event.clientX
  const startWidth = sidebarWidth.value

  const onMouseMove = (nextEvent: MouseEvent) => {
    const deltaX = nextEvent.clientX - startX
    sidebarWidth.value = clamp(startWidth + deltaX, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH)
  }

  const onMouseUp = () => {
    clearSidebarDragListeners()
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp, { once: true })

  sidebarDragCleanup.value = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
}

function startControllerResize(event: MouseEvent): void {
  if (compactMode.value || !controllerVisible.value) return

  event.preventDefault()
  clearControllerDragListeners()

  const startX = event.clientX
  const startWidth = controllerWidth.value

  const onMouseMove = (nextEvent: MouseEvent) => {
    const deltaX = nextEvent.clientX - startX
    controllerWidth.value = clamp(startWidth - deltaX, CONTROLLER_MIN_WIDTH, CONTROLLER_MAX_WIDTH)
  }

  const onMouseUp = () => {
    clearControllerDragListeners()
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp, { once: true })

  controllerDragCleanup.value = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }
}

function toggleControllerPanel(): void {
  if (compactMode.value) {
    controllerDrawerVisible.value = !controllerDrawerVisible.value
    return
  }
  controllerVisible.value = !controllerVisible.value
}

function updateViewportMode(): void {
  const nextCompact = window.innerWidth < 1024
  if (nextCompact !== compactMode.value) {
    compactMode.value = nextCompact
    controllerDrawerVisible.value = false
    if (nextCompact) {
      sidebarCollapsed.value = true
      sidebarWidth.value = Math.min(sidebarWidth.value, 320)
    } else {
      sidebarCollapsed.value = false
    }
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0)
}

function normalizePath(pathValue: string): string {
  return pathValue
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
}

function hasTreeKey(nodes: PackFileTreeNode[], key: string): boolean {
  if (!key) return false

  const queue = [...nodes]
  while (queue.length > 0) {
    const node = queue.shift()!
    if (node.key === key) return true
    if (node.children && node.children.length > 0) {
      queue.push(...node.children)
    }
  }

  return false
}

function isRemotePath(pathValue: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(pathValue)
}

function getPathExtension(relativePath: string): string {
  const cleaned = normalizePath(relativePath)
  const name = cleaned.split('/').pop() ?? cleaned
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex < 0) return ''
  return name.slice(dotIndex + 1).toLowerCase()
}

function resolveDataPath(manifest: WorkspacePackManifest, fileRef: string): string {
  const dataDirRaw = manifest.paths?.dataDir
  const dataDir = typeof dataDirRaw === 'string' && dataDirRaw.trim().length > 0 ? dataDirRaw.trim() : '.'

  const source = normalizePath(fileRef)
  if (dataDir === '.' || dataDir.length === 0) return source
  return `${normalizePath(dataDir).replace(/\/+$/, '')}/${source}`
}

function resolveLocalePath(manifest: WorkspacePackManifest, locale: string, fileRef: string): string {
  const localesDirRaw = manifest.paths?.localesDir
  const localesDir = typeof localesDirRaw === 'string' && localesDirRaw.trim().length > 0 ? localesDirRaw.trim() : 'locales'

  const normalizedRef = fileRef.endsWith('.yaml') || fileRef.endsWith('.yml') ? fileRef : `${fileRef}.yaml`
  return `${normalizePath(localesDir).replace(/\/+$/, '')}/${normalizePath(locale)}/${normalizePath(normalizedRef)}`
}

function detectFileKind(relativePath: string): PackWorkbenchFileKind {
  const normalizedPath = normalizePath(relativePath)
  if (normalizedPath === 'pack.json') {
    return 'manifest'
  }

  const ext = getPathExtension(normalizedPath)
  if (IMAGE_EXTENSION_SET.has(ext)) return 'image'
  if (TEXT_EXTENSION_SET.has(ext)) return 'text'
  return 'binary'
}

function buildFileAnnotations(manifest: WorkspacePackManifest): Map<string, FileAnnotation> {
  const annotationMap = new Map<string, FileAnnotation>()
  annotationMap.set('pack.json', { kind: 'manifest' })

  const data = manifest.data && typeof manifest.data === 'object' ? manifest.data : {}
  for (const [dataKey, refs] of Object.entries(data)) {
    for (const sourceFile of toStringArray(refs)) {
      if (isRemotePath(sourceFile)) continue
      const relativePath = normalizePath(resolveDataPath(manifest, sourceFile))
      const isStructured = STRUCTURED_DATA_KIND_SET.has(dataKey)
      annotationMap.set(relativePath, {
        kind: isStructured ? 'structured' : detectFileKind(relativePath),
        sourceFile,
        dataKind: dataKey,
      })
    }
  }

  const locales = manifest.locales && typeof manifest.locales === 'object'
    ? (manifest.locales as Record<string, unknown>)
    : {}

  for (const [locale, files] of Object.entries(locales)) {
    for (const sourceFile of toStringArray(files)) {
      const relativePath = normalizePath(resolveLocalePath(manifest, locale, sourceFile))
      annotationMap.set(relativePath, {
        kind: 'text',
        sourceFile,
        dataKind: `locale:${locale}`,
      })
    }
  }

  const assetRefs = Array.isArray(manifest.assetsRef)
    ? toStringArray(manifest.assetsRef)
    : typeof manifest.assetsRef === 'string'
      ? [manifest.assetsRef]
      : []

  for (const sourceFile of assetRefs) {
    if (isRemotePath(sourceFile)) continue
    const relativePath = normalizePath(sourceFile)
    if (!relativePath) continue
    // assetsRef can point to a directory; only JSON manifests should appear as file entries.
    if (!relativePath.toLowerCase().endsWith('.json')) continue
    if (!annotationMap.has(relativePath)) {
      annotationMap.set(relativePath, {
        kind: detectFileKind(relativePath),
        sourceFile,
        dataKind: 'asset',
      })
    }
  }

  return annotationMap
}

function buildPackFileEntries(
  files: WorkspacePackFileEntry[],
  annotationMap: Map<string, FileAnnotation>,
): PackWorkbenchFileEntry[] {
  const entryMap = new Map<string, PackWorkbenchFileEntry>()

  for (const file of files) {
    const relativePath = normalizePath(file.relativePath)
    if (!relativePath) continue

    const annotation = annotationMap.get(relativePath)
    const fallbackKind = detectFileKind(relativePath)
    const label = relativePath.split('/').pop() ?? relativePath

    entryMap.set(relativePath, {
      key: relativePath,
      label,
      relativePath,
      kind: annotation?.kind ?? fallbackKind,
      dataKind: annotation?.dataKind,
      sourceFile: annotation?.sourceFile,
      size: file.size,
    })
  }

  for (const [relativePath, annotation] of annotationMap.entries()) {
    if (entryMap.has(relativePath)) continue
    const label = relativePath.split('/').pop() ?? relativePath

    entryMap.set(relativePath, {
      key: relativePath,
      label,
      relativePath,
      kind: annotation.kind,
      dataKind: annotation.dataKind,
      sourceFile: annotation.sourceFile,
      size: 0,
    })
  }

  return [...entryMap.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function buildFileTree(entries: PackWorkbenchFileEntry[], directoryPaths: string[] = []): PackFileTreeNode[] {
  const root: PackFileTreeNode = {
    key: 'dir:/',
    label: '/',
    relativePath: '',
    isDirectory: true,
    children: [],
  }
  const directoryMap = new Map<string, PackFileTreeNode>([['', root]])

  function ensureDirectoryNode(directoryPath: string): PackFileTreeNode {
    const normalizedDirectory = normalizePath(directoryPath)
    if (directoryMap.has(normalizedDirectory)) {
      return directoryMap.get(normalizedDirectory)!
    }

    const segments = normalizedDirectory.split('/').filter(Boolean)
    let currentPath = ''
    let parentNode = root

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      let currentNode = directoryMap.get(currentPath)
      if (!currentNode) {
        currentNode = {
          key: `dir:${currentPath}`,
          label: segment,
          relativePath: currentPath,
          isDirectory: true,
          children: [],
        }
        directoryMap.set(currentPath, currentNode)
        parentNode.children?.push(currentNode)
      }
      parentNode = currentNode
    }

    return parentNode
  }

  for (const directoryPath of directoryPaths) {
    ensureDirectoryNode(directoryPath)
  }

  for (const entry of entries) {
    const segments = entry.relativePath.split('/').filter(Boolean)
    const fileName = segments.pop()
    if (!fileName) continue

    const directoryPath = segments.join('/')
    const parentNode = ensureDirectoryNode(directoryPath)
    parentNode.children = parentNode.children ?? []
    parentNode.children.push({
      key: entry.key,
      label: fileName,
      relativePath: entry.relativePath,
      isDirectory: false,
      entry,
    })
  }

  function sortNodes(nodes: PackFileTreeNode[]): void {
    nodes.sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1
      }
      return left.label.localeCompare(right.label)
    })

    for (const node of nodes) {
      if (node.isDirectory && node.children && node.children.length > 0) {
        sortNodes(node.children)
      }
    }
  }

  const output = root.children ?? []
  sortNodes(output)
  return output
}

function buildTabId(packFolder: string, relativePath: string): string {
  return `pack:${packFolder}:${relativePath}`
}

function syncOpenTabsForPack(packFolder: string): void {
  if (!packFolder) return

  const entriesByKey = new Map(fileEntries.value.map(entry => [entry.key, entry]))
  let activeTabRemoved = false

  openTabs.value = openTabs.value
    .map(tab => {
      if (tab.packFolder !== packFolder) return tab
      const nextEntry = entriesByKey.get(tab.entry.key)
      if (!nextEntry) {
        if (tab.id === activeTabId.value) activeTabRemoved = true
        return null
      }
      return {
        ...tab,
        entry: nextEntry,
      }
    })
    .filter((tab): tab is EditorTab => tab !== null)

  if (activeTabRemoved) {
    activeTabId.value = openTabs.value[openTabs.value.length - 1]?.id ?? ''
  }
}

function openEditorTab(packFolder: string, entry: PackWorkbenchFileEntry): void {
  const id = buildTabId(packFolder, entry.relativePath)
  const existing = openTabs.value.find(tab => tab.id === id)

  if (existing) {
    existing.entry = entry
    activeTabId.value = id
    return
  }

  openTabs.value.push({
    id,
    packFolder,
    entry,
  })
  activeTabId.value = id
}

function closeEditorTab(tabId: string): void {
  const index = openTabs.value.findIndex(tab => tab.id === tabId)
  if (index < 0) return

  const wasActive = activeTabId.value === tabId
  openTabs.value.splice(index, 1)

  if (!wasActive) return
  const fallback = openTabs.value[index] ?? openTabs.value[index - 1] ?? null
  activeTabId.value = fallback?.id ?? ''
  selectedFileKey.value = fallback?.entry.key ?? ''
  selectedTreeNodeKey.value = fallback?.entry.key ?? ''

  if (fallback && selectedPackFolder.value !== fallback.packFolder) {
    selectedPackFolder.value = fallback.packFolder
    void loadPackWorkspace(fallback.packFolder)
  }
}

function activateEditorTab(tabId: string): void {
  const tab = openTabs.value.find(item => item.id === tabId)
  if (!tab) return

  activeTabId.value = tabId
  selectedFileKey.value = tab.entry.key
  selectedTreeNodeKey.value = tab.entry.key

  if (selectedPackFolder.value !== tab.packFolder) {
    selectedPackFolder.value = tab.packFolder
    void loadPackWorkspace(tab.packFolder)
  }
}

async function loadPackWorkspace(folderName: string): Promise<void> {
  if (!folderName) {
    fileEntries.value = []
    fileTreeNodes.value = []
    selectedFileKey.value = ''
    selectedTreeNodeKey.value = ''
    return
  }

  const [manifestResult, filesResult] = await Promise.all([
    readWorkspacePackManifest({ folderName }),
    listWorkspacePackFiles({ folderName }),
  ])

  const manifest = manifestResult.manifest as WorkspacePackManifest
  const annotationMap = buildFileAnnotations(manifest)
  const directoryPaths = new Set<string>()
  const fileList = filesResult.files.filter(file => {
    if (file.isDirectory) {
      const normalized = normalizePath(file.relativePath)
      if (normalized) {
        directoryPaths.add(normalized)
      }
      return false
    }
    return true
  })

  fileEntries.value = buildPackFileEntries(fileList, annotationMap)
  fileTreeNodes.value = buildFileTree(fileEntries.value, [...directoryPaths])

  if (!fileEntries.value.some(item => item.key === selectedFileKey.value)) {
    selectedFileKey.value = fileEntries.value[0]?.key ?? ''
  }

  if (selectedFileKey.value) {
    selectedTreeNodeKey.value = selectedFileKey.value
  } else if (!hasTreeKey(fileTreeNodes.value, selectedTreeNodeKey.value)) {
    selectedTreeNodeKey.value = fileTreeNodes.value[0]?.key ?? ''
  }

  syncOpenTabsForPack(folderName)
}

async function refreshWorkspace(): Promise<void> {
  loading.value = true
  try {
    const [templateList, packList] = await Promise.all([listPackTemplates(), listWorkspacePacks()])
    templates.value = templateList
    packs.value = packList

    if (!templates.value.some(item => item.id === createForm.template) && templates.value.length > 0) {
      createForm.template = templates.value[0].id
    }

    if (!packs.value.some(pack => pack.folderName === selectedPackFolder.value)) {
      selectedPackFolder.value = packs.value[0]?.folderName ?? ''
      selectedFileKey.value = ''
      selectedTreeNodeKey.value = ''
    }

    if (selectedPackFolder.value) {
      await loadPackWorkspace(selectedPackFolder.value)
    } else {
      fileEntries.value = []
      fileTreeNodes.value = []
      selectedFileKey.value = ''
      selectedTreeNodeKey.value = ''
      openTabs.value = []
      activeTabId.value = ''
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`加载工作区失败: ${message}`)
  } finally {
    loading.value = false
  }
}

async function handleCreatePack(): Promise<void> {
  if (!createForm.folderName) {
    ElMessage.warning('请先填写目录名')
    return
  }

  creating.value = true
  try {
    const result = await createPackFromTemplate({
      folderName: createForm.folderName,
      packId: createForm.packId || undefined,
      version: createForm.version || undefined,
      template: createForm.template || undefined,
    })

    ElMessage.success(`已创建数据包: ${result.folderName}`)

    createDialogVisible.value = false
    createForm.folderName = ''
    createForm.packId = ''

    await refreshWorkspace()
    selectedPackFolder.value = result.folderName
    await loadPackWorkspace(result.folderName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`创建失败: ${message}`)
  } finally {
    creating.value = false
  }
}

const isPackToggling = (folderName: string): boolean => {
  return togglingFolders.value[folderName] === true
}

async function triggerRuntimeReload(folderName: string): Promise<void> {
  const target = packs.value.find(
    item => item.folderName.trim().toLowerCase() === folderName.trim().toLowerCase(),
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

async function handleTogglePack(pack: WorkspacePackSummary, enabled: boolean): Promise<void> {
  if (!isDesktop) {
    pack.enabled = !enabled
    return
  }

  togglingFolders.value = {
    ...togglingFolders.value,
    [pack.folderName]: true,
  }

  try {
    const result = await setWorkspacePackEnabled({
      folderName: pack.folderName,
      enabled,
    })
    pack.enabled = result.enabled

    await refreshWorkspace()

    try {
      await Promise.all([
        gameDataStore.applyWorkspacePackToggle({
          folderName: result.folderName,
          enabled: result.enabled,
        }),
        resourceStore.applyWorkspacePackToggle({
          folderName: result.folderName,
          enabled: result.enabled,
        }),
      ])
      ElMessage.success(`已${result.enabled ? '启用' : '禁用'}数据包并按包热加载`)
    } catch (reloadError) {
      const message = reloadError instanceof Error ? reloadError.message : String(reloadError)
      ElMessage.warning(`启用状态已更新，但热加载失败: ${message}`)
    }
  } catch (error) {
    pack.enabled = !enabled
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`更新启用状态失败: ${message}`)
  } finally {
    const next = { ...togglingFolders.value }
    delete next[pack.folderName]
    togglingFolders.value = next
  }
}

async function selectPack(folderName: string): Promise<void> {
  if (selectedPackFolder.value === folderName) return

  selectedPackFolder.value = folderName
  selectedFileKey.value = ''
  selectedTreeNodeKey.value = ''

  try {
    await loadPackWorkspace(folderName)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.error(`加载数据包失败: ${message}`)
  }
}

function handleFileTreeNodeClick(node: PackFileTreeNode): void {
  if (!selectedPackFolder.value) return
  if (node.isDirectory || !node.entry) return

  selectedTreeNodeKey.value = node.key
  selectedFileKey.value = node.entry.key
  openEditorTab(selectedPackFolder.value, node.entry)
  if (compactMode.value) {
    sidebarCollapsed.value = true
  }
}

async function handleActiveEditorSaved(): Promise<void> {
  if (!activeTab.value) return

  try {
    if (selectedPackFolder.value === activeTab.value.packFolder) {
      await loadPackWorkspace(activeTab.value.packFolder)
    }
    await triggerRuntimeReload(activeTab.value.packFolder)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ElMessage.warning(`文件已保存，但热加载失败: ${message}`)
  }
}

onMounted(async () => {
  updateViewportMode()
  window.addEventListener('resize', updateViewportMode)

  await refreshWorkspace()
})

onBeforeUnmount(() => {
  clearSidebarDragListeners()
  clearControllerDragListeners()
  window.removeEventListener('resize', updateViewportMode)
})
</script>

<style scoped>
.pack-workbench-root {
  position: relative;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  height: calc(100vh - 88px);
  min-height: 640px;
  background: #1f242b;
  color: #d6dde8;
}

.activity-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 10px 0;
  background: #181c22;
  border-right: 1px solid #2b323d;
  z-index: 30;
}

.activity-button {
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #c4ccda;
  background: transparent;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease;
}

.activity-button:hover {
  color: #ffffff;
  background: #2b3341;
}

.activity-button.active {
  color: #ffffff;
  background: #324c8f;
}

.activity-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sidebar-backdrop {
  position: absolute;
  inset: 0;
  z-index: 15;
  background: rgba(5, 10, 18, 0.4);
}

.sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid #2b323d;
  background: #232a33;
  overflow: hidden;
  z-index: 20;
}

.sidebar.compact {
  position: absolute;
  left: 52px;
  top: 0;
  bottom: 0;
  box-shadow: 0 12px 42px rgba(0, 0, 0, 0.4);
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid #2e3642;
}

.sidebar-section.grow {
  flex: 1;
  border-bottom: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #8f9bad;
  border-bottom: 1px solid #2e3642;
}

.selected-pack-label {
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.explorer-header-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pack-list {
  padding: 6px;
  overflow: auto;
  max-height: 42vh;
}

.pack-item {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #d6dde8;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  margin-bottom: 4px;
  cursor: pointer;
}

.pack-item:hover {
  background: #2d3645;
}

.pack-item.active {
  border-color: #4b5b7a;
  background: #33405a;
}

.pack-item-main {
  min-width: 0;
  flex: 1;
}

.pack-item-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pack-item-meta {
  font-size: 11px;
  color: #8f9bad;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-tree-shell {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.tree-node-row {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding-right: 8px;
}

.tree-node-icon {
  display: inline-flex;
  align-items: center;
  color: #8fa5c8;
}

.tree-node-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-node-tag {
  flex-shrink: 0;
}

.sidebar-resizer {
  width: 6px;
  cursor: col-resize;
  background: linear-gradient(to right, #1d232b, #2a323f, #1d232b);
}

.workbench-main {
  min-width: 0;
  display: flex;
  overflow: hidden;
}

.editor-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: #1f242b;
}

.controller-resizer {
  width: 6px;
  cursor: col-resize;
  background: linear-gradient(to right, #1d232b, #2a323f, #1d232b);
}

.controller-pane {
  min-width: 0;
  border-left: 1px solid #2b323d;
  background: #202834;
}

.controller-pane :deep(.battle-workbench-controller) {
  height: 100%;
}

.tab-strip {
  min-height: 40px;
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid #2b323d;
  background: #1b2027;
}

.tab-button {
  border: 0;
  border-right: 1px solid #2b323d;
  background: transparent;
  color: #b4bfd1;
  min-width: 170px;
  max-width: 280px;
  padding: 6px 10px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: 1fr 1fr;
  grid-template-areas:
    'name close'
    'pack close';
  align-items: center;
  cursor: pointer;
}

.tab-button:hover {
  background: #2a3240;
}

.tab-button.active {
  background: #263c68;
  color: #f6f8fc;
}

.tab-name {
  grid-area: name;
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-pack {
  grid-area: pack;
  font-size: 11px;
  color: #9aa9bf;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-close {
  grid-area: close;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
}

.tab-close:hover {
  background: rgba(255, 255, 255, 0.18);
}

.tab-placeholder {
  font-size: 12px;
  color: #7f8ba1;
  display: inline-flex;
  align-items: center;
  padding: 0 12px;
}

.editor-surface {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #1f242b;
  display: flex;
  flex-direction: column;
}

.editor-surface > * {
  flex: 1;
  min-height: 0;
}

.editor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.pack-workbench-root :deep(.el-tree) {
  background: transparent;
  color: #d6dde8;
}

.pack-workbench-root :deep(.el-tree-node__content) {
  min-height: 28px;
  border-radius: 6px;
}

.pack-workbench-root :deep(.el-tree-node__content:hover) {
  background: #313b4b;
}

.pack-workbench-root :deep(.el-tree-node.is-current > .el-tree-node__content) {
  background: #334b7f;
}

.pack-workbench-root :deep(.el-empty__description p) {
  color: #9aa9bf;
}

@media (max-width: 1023px) {
  .sidebar-resizer {
    display: none;
  }

  .controller-resizer {
    display: none;
  }
}
</style>
