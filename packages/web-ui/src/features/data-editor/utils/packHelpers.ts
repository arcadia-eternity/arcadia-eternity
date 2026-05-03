import type { WorkspacePackSummary } from '@/types/desktop'

export type { WorkspacePackSummary }

export type WorkspacePackManifest = {
  id?: string
  version?: string
  paths?: Record<string, unknown>
  data?: Record<string, unknown>
  locales?: Record<string, unknown>
  assetsRef?: unknown
  [key: string]: unknown
}

export const BASE_PACK_ID = 'arcadia-eternity.base'

export const TEXT_EXTENSION_SET = new Set([
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

export const IMAGE_EXTENSION_SET = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico'])

export function normalizePath(value: string): string {
  return String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0)
}

export function isRemotePath(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
}

export function getPathExtension(relativePath: string): string {
  const cleaned = normalizePath(relativePath)
  const filename = cleaned.split('/').pop() ?? cleaned
  const index = filename.lastIndexOf('.')
  if (index < 0) return ''
  return filename.slice(index + 1).toLowerCase()
}

export function resolveManifestDataPath(manifest: WorkspacePackManifest, fileRef: string): string {
  const dataDirRaw = manifest.paths?.dataDir
  const dataDir = typeof dataDirRaw === 'string' && dataDirRaw.trim().length > 0 ? dataDirRaw.trim() : '.'
  const source = normalizePath(fileRef)
  if (dataDir === '.' || dataDir.length === 0) return source
  return `${normalizePath(dataDir).replace(/\/+$/, '')}/${source}`
}

export function resolveManifestLocalePath(manifest: WorkspacePackManifest, locale: string, fileRef: string): string {
  const localesDirRaw = manifest.paths?.localesDir
  const localesDir =
    typeof localesDirRaw === 'string' && localesDirRaw.trim().length > 0 ? localesDirRaw.trim() : 'locales'
  const normalizedRef = fileRef.endsWith('.yaml') || fileRef.endsWith('.yml') ? fileRef : `${fileRef}.yaml`
  return `${normalizePath(localesDir).replace(/\/+$/, '')}/${normalizePath(locale)}/${normalizePath(normalizedRef)}`
}

export function collectManifestFilePaths(manifest: WorkspacePackManifest): string[] {
  const output = new Set<string>(['pack.json'])

  const data = manifest.data && typeof manifest.data === 'object' ? manifest.data : {}
  for (const refs of Object.values(data)) {
    for (const sourceFile of toStringArray(refs)) {
      if (isRemotePath(sourceFile)) continue
      output.add(normalizePath(resolveManifestDataPath(manifest, sourceFile)))
    }
  }

  const locales =
    manifest.locales && typeof manifest.locales === 'object'
      ? (manifest.locales as Record<string, unknown>)
      : {}
  for (const [locale, refs] of Object.entries(locales)) {
    for (const sourceFile of toStringArray(refs)) {
      output.add(normalizePath(resolveManifestLocalePath(manifest, locale, sourceFile)))
    }
  }

  const assetRefs = Array.isArray(manifest.assetsRef)
    ? toStringArray(manifest.assetsRef)
    : typeof manifest.assetsRef === 'string'
      ? [manifest.assetsRef]
      : []
  for (const sourceFile of assetRefs) {
    if (isRemotePath(sourceFile)) continue
    output.add(normalizePath(sourceFile))
  }

  return [...output].filter(path => path.length > 0).sort((a, b) => a.localeCompare(b))
}

export function webPackBasePath(folderName: string): string {
  return `/packs/${encodeURIComponent(folderName)}`
}

export function normalizeWorkspacePackSummary(item: unknown): WorkspacePackSummary {
  const source = (item ?? {}) as Record<string, unknown>
  const id = String(source.id ?? '')
  return {
    folderName: String(source.folderName ?? ''),
    id,
    version: String(source.version ?? ''),
    manifestPath: String(source.manifestPath ?? ''),
    enabled: source.enabled !== false,
    canDisable: typeof source.canDisable === 'boolean' ? source.canDisable : id !== BASE_PACK_ID,
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
