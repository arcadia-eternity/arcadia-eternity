import type { YamlAnchoredDataset } from '../schemas/yamlAnchoredRecords'
import { parseYamlAnchoredDataset } from '../schemas/yamlAnchoredRecords'
import { normalizePath, resolveManifestDataPath } from './packHelpers'

export interface FileResolverContext {
  manifest: Record<string, unknown>
  kind: string
  fileList?: string[]
  packFolder: string
  isBase: boolean
  readFile: (folderName: string, relativePath: string) => Promise<{ content: string }>
}

export interface FileResolverResult {
  relativePath: string
  dataset: YamlAnchoredDataset
  index: number
}

export interface FileResolverBatchResult {
  relativePath: string
  dataset: YamlAnchoredDataset
  indices: number[]
}

function resolveDataFiles(manifest: Record<string, unknown>, kind: string, fileList?: string[]): string[] {
  return fileList ?? (manifest.data as Record<string, string[]>)?.[kind] ?? []
}

/** Source maps may include the data directory; file selectors use manifest-relative paths. */
export function matchesDataFile(sourceFile: string, fileRef: string, fileRefs: readonly string[] = [fileRef]): boolean {
  const source = normalizePath(sourceFile)
  const target = normalizePath(fileRef)
  const matchingRef = fileRefs
    .map(normalizePath)
    .filter(ref => ref.length > 0 && (source === ref || source.endsWith(`/${ref}`)))
    .sort((a, b) => b.length - a.length)[0]
  return target.length > 0 && matchingRef === target
}

/**
 * Search for a record by ID across all data files.
 * If sourceFile is provided and contains the record, directly targets that file.
 * Otherwise, iterates all data files to find the record.
 */
export async function resolveTargetFile(
  ctx: FileResolverContext,
  recordId: string,
  sourceFile?: string | null,
): Promise<FileResolverResult | null> {
  const dataFiles = resolveDataFiles(ctx.manifest, ctx.kind, ctx.fileList)

  if (sourceFile) {
    const source = normalizePath(sourceFile)
    const hintedFile = dataFiles.find(
      file => normalizePath(file) === source || normalizePath(resolveManifestDataPath(ctx.manifest, file)) === source,
    )
    if (hintedFile) {
      const relativePath = resolveManifestDataPath(ctx.manifest, hintedFile)
      try {
        const { content } = await ctx.readFile(ctx.packFolder, relativePath)
        const dataset = parseYamlAnchoredDataset(content)
        const index = dataset.rows.findIndex(r => r.id === recordId)
        if (index >= 0) {
          return { relativePath, dataset, index }
        }
      } catch {}
    }
  }

  for (const fileRef of dataFiles) {
    const relativePath = resolveManifestDataPath(ctx.manifest, fileRef)
    try {
      const { content } = await ctx.readFile(ctx.packFolder, relativePath)
      const dataset = parseYamlAnchoredDataset(content)
      const index = dataset.rows.findIndex(r => r.id === recordId)
      if (index >= 0) {
        return { relativePath, dataset, index }
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Find every data file containing matching record IDs.
 * Returns indices sorted descending for safe in-place deletion.
 */
export async function resolveTargetFileBatch(
  ctx: FileResolverContext,
  recordIds: Set<string>,
): Promise<FileResolverBatchResult[]> {
  const dataFiles = resolveDataFiles(ctx.manifest, ctx.kind, ctx.fileList)
  const matches: FileResolverBatchResult[] = []

  for (const fileRef of new Set(dataFiles)) {
    const relativePath = resolveManifestDataPath(ctx.manifest, fileRef)
    try {
      const { content } = await ctx.readFile(ctx.packFolder, relativePath)
      const dataset = parseYamlAnchoredDataset(content)
      const indices = dataset.rows
        .map((r, i) => (recordIds.has(r.id) ? i : -1))
        .filter(i => i >= 0)
        .sort((a, b) => b - a) // Descending order for safe deletion

      if (indices.length > 0) {
        matches.push({ relativePath, dataset, indices })
      }
    } catch {
      continue
    }
  }

  return matches
}
