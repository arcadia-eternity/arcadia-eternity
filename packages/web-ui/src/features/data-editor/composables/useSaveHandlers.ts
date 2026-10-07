import type { Ref } from 'vue'
import type { EditorState } from './useEditorState'
import { ElMessage, ElMessageBox } from 'element-plus'
import { isDesktop } from '@/utils/env'
import { seer2Config } from '../game-config/seer2'
import { baseEntities } from '../game-config/base'
import { readWorkspacePackFile, writeWorkspacePackFile, readWorkspacePackManifest } from '@/services/packWorkspace'
import { resolveManifestDataPath } from '../utils/packHelpers'
import { resolveTargetFile, resolveTargetFileBatch } from '../utils/fileResolver'
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

export async function reloadDataFromDisk(gameDataStore: unknown) {
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

      const readFile = isBase
        ? (folder: string, path: string) =>
            window.arcadiaDesktop!.readBasePackFile({ folderName: 'base', relativePath: path })
        : (folder: string, path: string) => readWorkspacePackFile({ folderName: folder, relativePath: path })

      const sourceFile = editorState.recordSourceFiles?.[id]
      const resolved = await resolveTargetFile(
        { manifest, kind, packFolder, isBase: !!isBase, readFile },
        id,
        sourceFile,
      )

      let targetFile: string
      let targetDataset: YamlAnchoredDataset
      let existingIndex: number

      if (resolved) {
        targetFile = resolved.relativePath
        targetDataset = resolved.dataset
        existingIndex = resolved.index
      } else {
        // If editorState.createTargetFile is set (e.g. by doCreate with targetFile), use it
        const preferredFile = editorState.createTargetFile
        const dataFiles = (manifest.data as Record<string, string[]>)?.[kind] ?? []
        const firstFile = preferredFile ?? dataFiles[0] ?? cfg.dataFile
        if (!firstFile) {
          console.warn('[DataEditor] Save skipped: no data files found for', kind)
          editorState.isDirty = false
          return
        }
        targetFile = resolveManifestDataPath(manifest, firstFile)
        const { content } = await readFile(packFolder, targetFile)
        targetDataset = parseYamlAnchoredDataset(content)
        existingIndex = -1
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

  async function doCreate(options?: { targetFile?: string }) {
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

    // If targetFile specified, set it on editorState for doSave's fallback to use
    if (options?.targetFile) {
      editorState.createTargetFile = options.targetFile
    }

    // Auto-save to store + YAML
    await doSave()

    const savedFile = editorState.createTargetFile
    if (savedFile) {
      editorState.recordSourceFiles[newId] = savedFile
    }

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

      const readFile = isBase
        ? (folder: string, path: string) =>
            window.arcadiaDesktop!.readBasePackFile({ folderName: 'base', relativePath: path })
        : (folder: string, path: string) => readWorkspacePackFile({ folderName: folder, relativePath: path })

      const resolved = await resolveTargetFile({ manifest, kind, packFolder, isBase: !!isBase, readFile }, id)

      if (!resolved) {
        ElMessage.error('记录未找到')
        return
      }

      const { relativePath: targetFile, dataset: targetDataset, index: targetIndex } = resolved

      deleteYamlAnchoredRecord(targetDataset, targetIndex)
      const yamlText = stringifyYamlAnchoredDataset(targetDataset)
      if (isBase) {
        await window.arcadiaDesktop!.writeBasePackFile({
          folderName: 'base',
          relativePath: targetFile,
          content: yamlText,
        })
      } else {
        await writeWorkspacePackFile({ folderName: packFolder, relativePath: targetFile, content: yamlText })
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
      console.log('[DataEditor] Deleted', id, 'from', isBase ? 'base/' : packFolder + '/', targetFile)
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

      const idSet = new Set(ids)
      const readFile = isBase
        ? (folder: string, path: string) =>
            window.arcadiaDesktop!.readBasePackFile({ folderName: 'base', relativePath: path })
        : (folder: string, path: string) => readWorkspacePackFile({ folderName: folder, relativePath: path })

      const resolved = await resolveTargetFileBatch({ manifest, kind, packFolder, isBase: !!isBase, readFile }, idSet)

      if (!resolved) {
        ElMessage.error('未找到匹配的记录')
        return
      }

      const { relativePath: targetFile, dataset: targetDataset, indices } = resolved

      for (const idx of indices) {
        deleteYamlAnchoredRecord(targetDataset, idx)
      }

      const yamlText = stringifyYamlAnchoredDataset(targetDataset)
      if (isBase) {
        await window.arcadiaDesktop!.writeBasePackFile({
          folderName: 'base',
          relativePath: targetFile,
          content: yamlText,
        })
      } else {
        await writeWorkspacePackFile({ folderName: packFolder, relativePath: targetFile, content: yamlText })
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
        ids.length,
        'records from',
        isBase ? 'base/' : packFolder + '/',
        targetFile,
      )
      ElMessage.success(`已删除 ${ids.length} 条记录`)
      await reloadDataFromDisk(gameDataStore)
    } catch (err) {
      console.error('[DataEditor] Batch delete failed:', err)
      ElMessage.error('批量删除失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return { doSave, doCreate, doDelete, doBatchDelete, registerDraft }
}
