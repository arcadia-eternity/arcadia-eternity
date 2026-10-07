import type { YamlAnchoredDataset } from '../schemas/yamlAnchoredRecords'
import { parseYamlAnchoredDataset } from '../schemas/yamlAnchoredRecords'
import { resolveManifestDataPath } from './packHelpers'

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
    const relativePath = resolveManifestDataPath(ctx.manifest, sourceFile)
    try {
      const { content } = await ctx.readFile(ctx.packFolder, relativePath)
      const dataset = parseYamlAnchoredDataset(content)
      const index = dataset.rows.findIndex(r => r.id === recordId)
      if (index >= 0) {
        return { relativePath, dataset, index }
      }
    } catch {}
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
 * Find the first data file containing any matching record IDs.
 * Returns indices sorted descending for safe in-place deletion.
 */
export async function resolveTargetFileBatch(
  ctx: FileResolverContext,
  recordIds: Set<string>,
): Promise<FileResolverBatchResult | null> {
  const dataFiles = resolveDataFiles(ctx.manifest, ctx.kind, ctx.fileList)

  for (const fileRef of dataFiles) {
    const relativePath = resolveManifestDataPath(ctx.manifest, fileRef)
    try {
      const { content } = await ctx.readFile(ctx.packFolder, relativePath)
      const dataset = parseYamlAnchoredDataset(content)
      const indices = dataset.rows
        .map((r, i) => (recordIds.has(r.id) ? i : -1))
        .filter(i => i >= 0)
        .sort((a, b) => b - a) // Descending order for safe deletion

      if (indices.length > 0) {
        return { relativePath, dataset, indices }
      }
    } catch {
      continue
    }
  }

  return null
}
