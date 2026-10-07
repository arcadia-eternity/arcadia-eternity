import { ref, toValue, type Ref, type MaybeRef } from 'vue'
import * as yaml from 'yaml'
import type { EntityType } from './useEditorState'
import {
  readWorkspacePackManifest,
  writeWorkspacePackManifest,
  readWorkspacePackFile,
  writeWorkspacePackFile,
  renameWorkspacePackPath,
  deleteWorkspacePackPath,
} from '@/services/packWorkspace'
import { normalizePath, resolveManifestDataPath, toStringArray } from '@/features/data-editor/utils/packHelpers'

export function useDataFileManager(packFolder: MaybeRef<string>) {
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  function getFolder(): string {
    return normalizePath(toValue(packFolder))
  }

  function getDataKindArray(manifest: Record<string, unknown>, kind: EntityType): string[] {
    const data = manifest.data && typeof manifest.data === 'object' ? manifest.data : {}
    return toStringArray((data as Record<string, unknown>)[kind])
  }

  function setDataKindArray(manifest: Record<string, unknown>, kind: EntityType, paths: string[]): void {
    if (!manifest.data || typeof manifest.data !== 'object') {
      manifest.data = {}
    }
    ;(manifest.data as Record<string, unknown>)[kind] = paths
  }

  async function createDataFile(kind: EntityType, fileName: string, template?: string): Promise<void> {
    const folder = getFolder()
    isLoading.value = true
    error.value = null

    try {
      const normalized = normalizePath(fileName)
      const fileRef = normalized.endsWith('.yaml') || normalized.endsWith('.yml') ? normalized : `${normalized}.yaml`

      const { manifest } = await readWorkspacePackManifest({ folderName: folder })

      const existing = getDataKindArray(manifest, kind)
      if (existing.includes(fileRef)) {
        throw new Error(`文件 ${fileRef} 已存在于清单中`)
      }

      setDataKindArray(manifest, kind, [...existing, fileRef])
      await writeWorkspacePackManifest({ folderName: folder, manifest })

      const emptyContent = yaml.stringify([])
      await writeWorkspacePackFile({ folderName: folder, relativePath: fileRef, content: emptyContent })

      if (template === 'by-species' && kind === 'skills') {
        await copySpeciesSkills(folder, manifest, fileRef)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function copySpeciesSkills(
    folder: string,
    manifest: Record<string, unknown>,
    newFileRef: string,
  ): Promise<void> {
    const skillsFiles = getDataKindArray(manifest, 'skills')
    const speciesSkills: Array<Record<string, unknown>> = []

    for (const skillFile of skillsFiles) {
      if (skillFile === newFileRef) continue
      try {
        const { content } = await readWorkspacePackFile({ folderName: folder, relativePath: skillFile })
        const records = yaml.parse(content)
        if (!Array.isArray(records)) continue
        for (const record of records) {
          if (record && typeof record === 'object' && typeof record.species === 'string' && record.species.length > 0) {
            speciesSkills.push(record)
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (speciesSkills.length > 0) {
      const content = yaml.stringify(speciesSkills)
      await writeWorkspacePackFile({ folderName: folder, relativePath: newFileRef, content })
    }
  }

  async function renameDataFile(oldPath: string, newName: string): Promise<void> {
    const folder = getFolder()
    isLoading.value = true
    error.value = null

    try {
      const normalizedOld = normalizePath(oldPath)
      const normalizedNew = normalizePath(newName)

      const newRef =
        normalizedNew.endsWith('.yaml') || normalizedNew.endsWith('.yml') ? normalizedNew : `${normalizedNew}.yaml`

      if (normalizedOld === newRef) return

      const { manifest } = await readWorkspacePackManifest({ folderName: folder })

      const kind = findFileKind(manifest, normalizedOld)
      if (!kind) {
        throw new Error(`文件 ${normalizedOld} 不在清单中`)
      }

      const paths = getDataKindArray(manifest, kind)
      if (paths.some(p => normalizePath(p) === newRef)) {
        throw new Error(`文件名 ${newRef} 已存在于清单中`)
      }

      const updatedPaths = paths.map(p => (normalizePath(p) === normalizedOld ? newRef : p))
      setDataKindArray(manifest, kind, updatedPaths)
      await writeWorkspacePackManifest({ folderName: folder, manifest })

      await renameWorkspacePackPath({
        folderName: folder,
        oldRelativePath: normalizedOld,
        newRelativePath: newRef,
      })
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function deleteDataFile(relativePath: string, options?: { force?: boolean }): Promise<void> {
    const folder = getFolder()
    isLoading.value = true
    error.value = null

    try {
      const normalized = normalizePath(relativePath)

      const { manifest } = await readWorkspacePackManifest({ folderName: folder })

      const kind = findFileKind(manifest, normalized)
      if (!kind) {
        throw new Error(`文件 ${normalized} 不在清单中`)
      }

      const filePath = resolveManifestDataPath(manifest, normalized)
      const { content } = await readWorkspacePackFile({ folderName: folder, relativePath: filePath })
      const records = yaml.parse(content)
      const recordCount = Array.isArray(records) ? records.length : 0

      if (recordCount > 0 && !options?.force) {
        throw new Error(`文件 ${normalized} 包含 ${recordCount} 条记录，请先移动或删除这些记录后再删除文件`)
      }

      const paths = getDataKindArray(manifest, kind)
      if (paths.length <= 1) {
        throw new Error(`无法删除最后一个数据文件 ${normalized}，每种类型至少需要一个数据文件`)
      }

      const updatedPaths = paths.filter(p => normalizePath(p) !== normalized)
      setDataKindArray(manifest, kind, updatedPaths)
      await writeWorkspacePackManifest({ folderName: folder, manifest })

      await deleteWorkspacePackPath({ folderName: folder, relativePath: normalized })
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function moveRecords(sourceFile: string, targetFile: string, recordIds: string[]): Promise<void> {
    const folder = getFolder()
    isLoading.value = true
    error.value = null

    try {
      const normalizedSource = normalizePath(sourceFile)
      const normalizedTarget = normalizePath(targetFile)

      if (normalizedSource === normalizedTarget) return
      if (recordIds.length === 0) return

      const idSet = new Set(recordIds)

      const { content: sourceContent } = await readWorkspacePackFile({
        folderName: folder,
        relativePath: normalizedSource,
      })
      const sourceRecords = yaml.parse(sourceContent)
      if (!Array.isArray(sourceRecords)) {
        throw new Error(`源文件 ${normalizedSource} 格式无效：期望数组`)
      }

      const movedRecords: Array<Record<string, unknown>> = []
      const remainingRecords: Array<Record<string, unknown>> = []

      for (const record of sourceRecords) {
        if (record && typeof record === 'object' && typeof record.id === 'string' && idSet.has(record.id)) {
          movedRecords.push(record)
        } else {
          remainingRecords.push(record)
        }
      }

      if (movedRecords.length === 0) {
        throw new Error('未找到匹配的记录')
      }

      let targetRecords: Array<Record<string, unknown>> = []
      try {
        const { content: targetContent } = await readWorkspacePackFile({
          folderName: folder,
          relativePath: normalizedTarget,
        })
        const parsed = yaml.parse(targetContent)
        if (Array.isArray(parsed)) {
          targetRecords = parsed
        }
      } catch {
        // Target file may not exist yet
      }

      targetRecords.push(...movedRecords)

      // Write target before source to prevent data loss if source write fails
      const targetContent = yaml.stringify(targetRecords)
      await writeWorkspacePackFile({
        folderName: folder,
        relativePath: normalizedTarget,
        content: targetContent,
      })

      const sourceUpdated = yaml.stringify(remainingRecords)
      await writeWorkspacePackFile({
        folderName: folder,
        relativePath: normalizedSource,
        content: sourceUpdated,
      })

      await ensureFileInManifest(folder, normalizedTarget)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  function findFileKind(manifest: Record<string, unknown>, normalizedPath: string): EntityType | null {
    const data = manifest.data && typeof manifest.data === 'object' ? (manifest.data as Record<string, unknown>) : {}
    for (const kind of Object.keys(data)) {
      const paths = toStringArray(data[kind])
      if (paths.some(p => normalizePath(p) === normalizedPath)) {
        return kind
      }
    }
    return null
  }

  async function ensureFileInManifest(folder: string, normalizedPath: string): Promise<void> {
    const { manifest } = await readWorkspacePackManifest({ folderName: folder })
    const kind = findFileKind(manifest, normalizedPath)
    if (kind) return

    const inferredKind = inferKindFromPath(normalizedPath)
    if (!inferredKind) return

    const paths = getDataKindArray(manifest, inferredKind)
    setDataKindArray(manifest, inferredKind, [...paths, normalizedPath])
    await writeWorkspacePackManifest({ folderName: folder, manifest })
  }

  function inferKindFromPath(normalizedPath: string): EntityType | null {
    const filename = normalizedPath.split('/').pop()?.toLowerCase() ?? ''
    if (filename.startsWith('species')) return 'species'
    if (filename.startsWith('mark')) return 'marks'
    if (filename.startsWith('skill')) return 'skills'
    if (filename.startsWith('effect')) return 'effects'
    return null
  }

  return {
    createDataFile,
    renameDataFile,
    deleteDataFile,
    moveRecords,
    isLoading: isLoading as Ref<boolean>,
    error: error as Ref<string | null>,
  }
}
