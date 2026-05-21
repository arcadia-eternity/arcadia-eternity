import type { Ref } from 'vue'
import type { EditorState } from './useEditorState'
import { ElMessage, ElMessageBox } from 'element-plus'
import { isDesktop } from '@/utils/env'
import { seer2Config } from '../game-config/seer2'
import { baseEntities } from '../game-config/base'
import { readWorkspacePackFile, writeWorkspacePackFile, readWorkspacePackManifest } from '@/services/packWorkspace'
import { resolveManifestDataPath } from '../utils/packHelpers'
import {
  parseYamlAnchoredDataset,
  upsertYamlAnchoredRecord,
  deleteYamlAnchoredRecord,
  stringifyYamlAnchoredDataset,
  type YamlAnchoredDataset,
} from '../schemas/yamlAnchoredRecords'

type StoreLike = Record<string, { byId: Record<string, unknown>; allIds: string[] }>

export interface UseSaveHandlersOptions {
  draftRef: Ref<Record<string, unknown>>
  editorState: EditorState
  gameDataStore: unknown
}

async function reloadDataFromDisk(gameDataStore: unknown) {
  if (!isDesktop || !window.arcadiaDesktop?.readAllBasePackData) return

  try {
    const data = await window.arcadiaDesktop.readAllBasePackData()
    const store = gameDataStore as StoreLike

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

export function useSaveHandlers(options: UseSaveHandlersOptions) {
  const { draftRef, editorState, gameDataStore } = options

  function registerDraft(data: Record<string, unknown>) {
    Object.assign(draftRef.value, data)
  }

  async function doSave() {
    const kind = editorState.selectedEntityType
    const id = editorState.selectedRecordId
    if (!kind || !id) {
      console.warn('[DataEditor] Save skipped: no entity type or record selected')
      return
    }

    const draft = draftRef.value
    if (!draft || (Object.keys(draft).length === 0 && !(id in draft))) {
      console.warn('[DataEditor] Save skipped: empty draft')
      return
    }

    const clone = JSON.parse(JSON.stringify(draft))

    // Persist to in-memory store
    const store = gameDataStore as StoreLike
    if (store[kind]?.byId) {
      store[kind].byId[id] = clone
      if (!store[kind].allIds.includes(id)) store[kind].allIds.push(id)
    }

    // Persist to YAML file on disk
    const packFolder = editorState.packFilters.enabledPacks[0] || 'base'

    try {
      const isBase = packFolder === 'base' && window.arcadiaDesktop?.readBasePackFile

      const cfg = seer2Config.entities[kind] ?? baseEntities.effects
      if (!cfg) {
        editorState.isDirty = false
        console.warn('[DataEditor] Save skipped: no entity config for', kind)
        return
      }

      let manifest: Record<string, unknown>
      if (isBase) {
        const { content: raw } = await window.arcadiaDesktop!.readBasePackFile({
          folderName: 'base',
          relativePath: 'pack.json',
        })
        manifest = JSON.parse(raw)
      } else {
        const result = await readWorkspacePackManifest({ folderName: packFolder })
        manifest = result.manifest
      }

      const manifestData = (manifest.data as Record<string, string[]>) ?? {}
      const dataFiles = manifestData[kind] ?? (cfg.dataFile ? [cfg.dataFile] : [])

      if (dataFiles.length === 0) {
        console.warn('[DataEditor] Save skipped: no data files found for', kind)
        editorState.isDirty = false
        return
      }

      let targetFile: string | null = null
      let targetDataset: YamlAnchoredDataset | null = null
      let existingIndex = -1

      for (const fileRef of dataFiles) {
        const relativePath = resolveManifestDataPath(manifest, fileRef)
        const { content } = isBase
          ? await window.arcadiaDesktop!.readBasePackFile({ folderName: 'base', relativePath })
          : await readWorkspacePackFile({ folderName: packFolder, relativePath })

        const dataset = parseYamlAnchoredDataset(content)
        const idx = dataset.rows.findIndex(row => row.id === id)

        if (idx >= 0) {
          targetFile = relativePath
          targetDataset = dataset
          existingIndex = idx
          break
        }

        if (!targetDataset) {
          targetFile = relativePath
          targetDataset = dataset
        }
      }

      upsertYamlAnchoredRecord({
        dataset: targetDataset!,
        schema: cfg.schema,
        draft: clone,
        targetIndex: existingIndex >= 0 ? existingIndex : undefined,
      })

      const yamlText = stringifyYamlAnchoredDataset(targetDataset!)
      if (isBase) {
        await window.arcadiaDesktop!.writeBasePackFile({
          folderName: 'base',
          relativePath: targetFile!,
          content: yamlText,
        })
      } else {
        await writeWorkspacePackFile({ folderName: packFolder, relativePath: targetFile!, content: yamlText })
      }

      editorState.isDirty = false
      console.log('[DataEditor] Saved', id, 'to', isBase ? 'base/' : packFolder + '/', targetFile)
      ElMessage.success('已保存')
      await reloadDataFromDisk(gameDataStore)
    } catch (err) {
      console.error('[DataEditor] File save failed:', err)
      ElMessage.error('保存失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  async function doCreate() {
    const kind = editorState.selectedEntityType
    if (!kind) {
      ElMessage.warning('请先选择实体类型')
      return
    }

    const cfg = seer2Config.entities[kind] ?? baseEntities.effects
    const draft = cfg.createDraft()
    const newId = `new_${kind}_${Date.now()}`
    draft.id = newId

    // Register draft so doSave can pick it up
    registerDraft(draft)

    // Set selection BEFORE save so doSave picks up the record ID
    editorState.selectedRecordId = newId
    editorState.isDirty = true

    // Auto-save to store + YAML
    await doSave()

    // Re-affirm selection after save (reloadDataFromDisk may have cleared it on desktop)
    editorState.selectedRecordId = newId
    ElMessage.success('已创建新记录')
  }

  async function doDelete() {
    const kind = editorState.selectedEntityType
    const id = editorState.selectedRecordId
    if (!kind || !id) {
      ElMessage.warning('没有选中的记录')
      return
    }

    try {
      await ElMessageBox.confirm(`确认删除 "${id}"？此操作不可撤销。`, '删除确认', {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }

    const packFolder = editorState.packFilters.enabledPacks[0] || 'base'
    const isBase = packFolder === 'base' && window.arcadiaDesktop?.readBasePackFile
    const cfg = seer2Config.entities[kind] ?? baseEntities.effects

    try {
      // Read YAML file
      let manifest: Record<string, unknown>
      if (isBase) {
        const { content: raw } = await window.arcadiaDesktop!.readBasePackFile({
          folderName: 'base',
          relativePath: 'pack.json',
        })
        manifest = JSON.parse(raw)
      } else {
        manifest = (await readWorkspacePackManifest({ folderName: packFolder })).manifest
      }

      const relativePath = resolveManifestDataPath(manifest, cfg.dataFile)
      const { content } = isBase
        ? await window.arcadiaDesktop!.readBasePackFile({ folderName: 'base', relativePath })
        : await readWorkspacePackFile({ folderName: packFolder, relativePath })
      const dataset = parseYamlAnchoredDataset(content)
      const index = dataset.rows.findIndex(r => r.id === id)
      if (index < 0) {
        ElMessage.error('记录未找到')
        return
      }

      deleteYamlAnchoredRecord(dataset, index)
      const yamlText = stringifyYamlAnchoredDataset(dataset)
      if (isBase) {
        await window.arcadiaDesktop!.writeBasePackFile({ folderName: 'base', relativePath, content: yamlText })
      } else {
        await writeWorkspacePackFile({ folderName: packFolder, relativePath, content: yamlText })
      }

      // Remove from in-memory store
      const store = gameDataStore as StoreLike
      if (store[kind]) {
        delete store[kind].byId[id]
        store[kind].allIds = store[kind].allIds.filter(i => i !== id)
      }

      // Clear selection
      editorState.selectedRecordId = null
      draftRef.value = {}
      editorState.isDirty = false
      console.log('[DataEditor] Deleted', id, 'from', isBase ? 'base/' : packFolder + '/', relativePath)
      ElMessage.success('已删除')
      await reloadDataFromDisk(gameDataStore)
    } catch (err) {
      console.error('[DataEditor] Delete failed:', err)
      ElMessage.error('删除失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  async function doBatchDelete(ids: string[]) {
    const kind = editorState.selectedEntityType
    if (!kind || ids.length === 0) {
      ElMessage.warning('没有选中的记录')
      return
    }

    try {
      await ElMessageBox.confirm(`确认删除 ${ids.length} 条记录？此操作不可撤销。`, '批量删除确认', {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }

    const packFolder = editorState.packFilters.enabledPacks[0] || 'base'
    const isBase = packFolder === 'base' && window.arcadiaDesktop?.readBasePackFile
    const cfg = seer2Config.entities[kind] ?? baseEntities.effects

    try {
      // Read YAML file
      let manifest: Record<string, unknown>
      if (isBase) {
        const { content: raw } = await window.arcadiaDesktop!.readBasePackFile({
          folderName: 'base',
          relativePath: 'pack.json',
        })
        manifest = JSON.parse(raw)
      } else {
        manifest = (await readWorkspacePackManifest({ folderName: packFolder })).manifest
      }

      const relativePath = resolveManifestDataPath(manifest, cfg.dataFile)
      const { content } = isBase
        ? await window.arcadiaDesktop!.readBasePackFile({ folderName: 'base', relativePath })
        : await readWorkspacePackFile({ folderName: packFolder, relativePath })
      const dataset = parseYamlAnchoredDataset(content)

      // Collect indices, sort descending to avoid shift
      const idSet = new Set(ids)
      const indices = dataset.rows
        .map((r, i) => (idSet.has(r.id) ? i : -1))
        .filter(i => i >= 0)
        .sort((a, b) => b - a) // descending

      if (indices.length === 0) {
        ElMessage.error('未找到匹配的记录')
        return
      }

      for (const idx of indices) {
        deleteYamlAnchoredRecord(dataset, idx)
      }
      const yamlText = stringifyYamlAnchoredDataset(dataset)
      if (isBase) {
        await window.arcadiaDesktop!.writeBasePackFile({ folderName: 'base', relativePath, content: yamlText })
      } else {
        await writeWorkspacePackFile({ folderName: packFolder, relativePath, content: yamlText })
      }

      // Remove from in-memory store
      const store = gameDataStore as StoreLike
      if (store[kind]) {
        for (const id of ids) {
          delete store[kind].byId[id]
        }
        store[kind].allIds = store[kind].allIds.filter(i => !idSet.has(i))
      }

      // Clear selection if selected record was deleted
      if (editorState.selectedRecordId && idSet.has(editorState.selectedRecordId)) {
        editorState.selectedRecordId = null
        draftRef.value = {}
        editorState.isDirty = false
      }

      console.log(
        '[DataEditor] Batch deleted',
        indices.length,
        'records from',
        isBase ? 'base/' : packFolder + '/',
        relativePath,
      )
      ElMessage.success(`已删除 ${indices.length} 条记录`)
      await reloadDataFromDisk(gameDataStore)
    } catch (err) {
      console.error('[DataEditor] Batch delete failed:', err)
      ElMessage.error('批量删除失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return { doSave, doCreate, doDelete, doBatchDelete, registerDraft }
}
