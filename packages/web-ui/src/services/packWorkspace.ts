import type {
  CreateWorkspacePackFolderInput,
  CreateWorkspacePackFolderResult,
  CreatePackFromTemplateInput,
  CreatePackFromTemplateResult,
  DeleteWorkspacePackPathInput,
  DeleteWorkspacePackPathResult,
  ListWorkspacePackFilesInput,
  ListWorkspacePackFilesResult,
  PackTemplateSummary,
  ReadWorkspacePackFileInput,
  ReadWorkspacePackFileResult,
  ReadWorkspacePackManifestInput,
  ReadWorkspacePackManifestResult,
  RenameWorkspacePackPathInput,
  RenameWorkspacePackPathResult,
  SetWorkspacePackEnabledInput,
  SetWorkspacePackEnabledResult,
  WorkspacePackFileEntry,
  WriteWorkspacePackFileInput,
  WriteWorkspacePackFileResult,
  WriteWorkspacePackManifestInput,
  WorkspacePackSummary,
} from '@/types/desktop'
import { getDesktopApi, isDesktop } from '@/utils/env'

export type {
  PackTemplateSummary,
  WorkspacePackSummary,
  CreatePackFromTemplateInput,
  CreatePackFromTemplateResult,
  CreateWorkspacePackFolderInput,
  CreateWorkspacePackFolderResult,
  RenameWorkspacePackPathInput,
  RenameWorkspacePackPathResult,
  DeleteWorkspacePackPathInput,
  DeleteWorkspacePackPathResult,
  SetWorkspacePackEnabledInput,
  SetWorkspacePackEnabledResult,
  ListWorkspacePackFilesInput,
  ListWorkspacePackFilesResult,
  WorkspacePackFileEntry,
  ReadWorkspacePackManifestInput,
  ReadWorkspacePackManifestResult,
  WriteWorkspacePackManifestInput,
  ReadWorkspacePackFileInput,
  ReadWorkspacePackFileResult,
  WriteWorkspacePackFileInput,
  WriteWorkspacePackFileResult,
}

function desktopApi() {
  return getDesktopApi()
}

const BASE_PACK_ID = 'arcadia-eternity.base'

type WorkspacePackManifest = {
  id?: string
  version?: string
  paths?: Record<string, unknown>
  data?: Record<string, unknown>
  locales?: Record<string, unknown>
  assetsRef?: unknown
  [key: string]: unknown
}

function normalizeRelativePath(value: string): string {
  return String(value).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? '').trim())
    .filter(item => item.length > 0)
}

function isRemotePath(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
}

function resolveManifestDataPath(manifest: WorkspacePackManifest, fileRef: string): string {
  const dataDirRaw = manifest.paths?.dataDir
  const dataDir = typeof dataDirRaw === 'string' && dataDirRaw.trim().length > 0 ? dataDirRaw.trim() : '.'
  const source = normalizeRelativePath(fileRef)
  if (dataDir === '.' || dataDir.length === 0) return source
  return `${normalizeRelativePath(dataDir).replace(/\/+$/, '')}/${source}`
}

function resolveManifestLocalePath(manifest: WorkspacePackManifest, locale: string, fileRef: string): string {
  const localesDirRaw = manifest.paths?.localesDir
  const localesDir = typeof localesDirRaw === 'string' && localesDirRaw.trim().length > 0 ? localesDirRaw.trim() : 'locales'
  const normalizedRef = fileRef.endsWith('.yaml') || fileRef.endsWith('.yml') ? fileRef : `${fileRef}.yaml`
  return `${normalizeRelativePath(localesDir).replace(/\/+$/, '')}/${normalizeRelativePath(locale)}/${normalizeRelativePath(normalizedRef)}`
}

function collectManifestFilePaths(manifest: WorkspacePackManifest): string[] {
  const output = new Set<string>(['pack.json'])

  const data = manifest.data && typeof manifest.data === 'object' ? manifest.data : {}
  for (const refs of Object.values(data)) {
    for (const sourceFile of toStringArray(refs)) {
      if (isRemotePath(sourceFile)) continue
      output.add(normalizeRelativePath(resolveManifestDataPath(manifest, sourceFile)))
    }
  }

  const locales = manifest.locales && typeof manifest.locales === 'object'
    ? (manifest.locales as Record<string, unknown>)
    : {}
  for (const [locale, refs] of Object.entries(locales)) {
    for (const sourceFile of toStringArray(refs)) {
      output.add(normalizeRelativePath(resolveManifestLocalePath(manifest, locale, sourceFile)))
    }
  }

  const assetRefs = Array.isArray(manifest.assetsRef)
    ? toStringArray(manifest.assetsRef)
    : typeof manifest.assetsRef === 'string'
      ? [manifest.assetsRef]
      : []
  for (const sourceFile of assetRefs) {
    if (isRemotePath(sourceFile)) continue
    output.add(normalizeRelativePath(sourceFile))
  }

  return [...output].filter(path => path.length > 0).sort((a, b) => a.localeCompare(b))
}

function pathExt(relativePath: string): string {
  const cleaned = normalizeRelativePath(relativePath)
  const filename = cleaned.split('/').pop() ?? cleaned
  const index = filename.lastIndexOf('.')
  if (index < 0) return ''
  return filename.slice(index + 1).toLowerCase()
}

function webPackBasePath(folderName: string): string {
  return `/packs/${encodeURIComponent(folderName)}`
}

function normalizeWorkspacePackSummary(item: unknown): WorkspacePackSummary {
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

export async function listPackTemplates(): Promise<PackTemplateSummary[]> {
  const api = desktopApi()
  if (!api) {
    return [
      {
        id: 'starter',
        name: 'Starter Pack',
        description: '基础可运行模板，包含最小 data/locales/assets 结构',
      },
    ]
  }

  return api.listPackTemplates()
}

export async function listWorkspacePacks(): Promise<WorkspacePackSummary[]> {
  const api = desktopApi()
  if (api) {
    const result = await api.listWorkspacePacks()
    return Array.isArray(result) ? result.map(normalizeWorkspacePackSummary) : []
  }

  try {
    const response = await fetch('/packs/workspace/index.json')
    if (!response.ok) return []
    const json = await response.json()
    if (!Array.isArray(json)) return []
    return json.map(item => normalizeWorkspacePackSummary(item))
  } catch {
    return []
  }
}

export async function createPackFromTemplate(
  input: CreatePackFromTemplateInput,
): Promise<CreatePackFromTemplateResult> {
  const api = desktopApi()
  if (!api) {
    throw new Error('当前环境不支持本地数据包创建（仅桌面端可用）')
  }

  return api.createPackFromTemplate({
    folderName: input.folderName,
    packId: input.packId,
    version: input.version,
    template: input.template ?? 'starter',
  })
}

export async function setWorkspacePackEnabled(
  input: SetWorkspacePackEnabledInput,
): Promise<SetWorkspacePackEnabledResult> {
  const api = desktopApi()
  if (!api) {
    throw new Error('当前环境不支持修改数据包启用状态（仅桌面端可用）')
  }
  if (typeof api.setWorkspacePackEnabled !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }
  return api.setWorkspacePackEnabled(input)
}

export async function readWorkspacePackManifest(
  input: ReadWorkspacePackManifestInput,
): Promise<ReadWorkspacePackManifestResult> {
  const api = desktopApi()
  if (!api) {
    const folderName = String(input.folderName ?? '').trim()
    if (!folderName) {
      throw new Error('folderName 不能为空')
    }

    const response = await fetch(`${webPackBasePath(folderName)}/pack.json`)
    if (!response.ok) {
      throw new Error(`无法读取数据包清单: HTTP ${response.status}`)
    }

    const manifest = await response.json()
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('数据包清单格式无效')
    }

    return {
      folderName,
      manifest: manifest as Record<string, unknown>,
    }
  }
  if (typeof api.readWorkspacePackManifest !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }
  return api.readWorkspacePackManifest(input)
}

export async function writeWorkspacePackManifest(
  input: WriteWorkspacePackManifestInput,
): Promise<void> {
  const api = desktopApi()
  if (!api) {
    throw new Error('当前环境不支持写入本地数据包清单（仅桌面端可用）')
  }
  if (typeof api.writeWorkspacePackManifest !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }
  await api.writeWorkspacePackManifest(input)
}

export async function readWorkspacePackFile(
  input: ReadWorkspacePackFileInput,
): Promise<ReadWorkspacePackFileResult> {
  const api = desktopApi()
  if (!api) {
    const folderName = String(input.folderName ?? '').trim()
    const relativePath = normalizeRelativePath(String(input.relativePath ?? ''))

    if (!folderName) {
      throw new Error('folderName 不能为空')
    }
    if (!relativePath) {
      throw new Error('relativePath 不能为空')
    }

    const response = await fetch(`${webPackBasePath(folderName)}/${relativePath}`)
    if (!response.ok) {
      throw new Error(`无法读取文件: HTTP ${response.status}`)
    }

    return {
      folderName,
      relativePath,
      content: await response.text(),
    }
  }
  if (typeof api.readWorkspacePackFile !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }
  return api.readWorkspacePackFile(input)
}

export async function listWorkspacePackFiles(
  input: ListWorkspacePackFilesInput,
): Promise<ListWorkspacePackFilesResult> {
  const api = desktopApi()
  if (!api) {
    const manifest = await readWorkspacePackManifest({
      folderName: input.folderName,
    })

    const filePaths = collectManifestFilePaths(manifest.manifest as WorkspacePackManifest)
    const files: WorkspacePackFileEntry[] = filePaths.map(relativePath => ({
      relativePath,
      size: 0,
      ext: pathExt(relativePath),
    }))

    return {
      folderName: manifest.folderName,
      files,
    }
  }
  if (typeof api.listWorkspacePackFiles !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }

  const result = await api.listWorkspacePackFiles(input)
  const normalizedFolder = String(result?.folderName ?? input.folderName)
  const files: WorkspacePackFileEntry[] = Array.isArray(result?.files)
    ? result.files.map(file => ({
        relativePath: String(file?.relativePath ?? '').replace(/\\/g, '/').replace(/^\/+/, ''),
        size: Number.isFinite(Number(file?.size)) ? Number(file?.size) : 0,
        ext: String(file?.ext ?? '').toLowerCase(),
        isDirectory: file?.isDirectory === true,
      }))
    : []

  return {
    folderName: normalizedFolder,
    files: files.filter(item => item.relativePath.length > 0),
  }
}

export async function writeWorkspacePackFile(
  input: WriteWorkspacePackFileInput,
): Promise<WriteWorkspacePackFileResult> {
  const api = desktopApi()
  if (!api) {
    throw new Error('当前环境不支持写入本地数据包文件（仅桌面端可用）')
  }
  if (typeof api.writeWorkspacePackFile !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }
  return api.writeWorkspacePackFile(input)
}

export async function createWorkspacePackFolder(
  input: CreateWorkspacePackFolderInput,
): Promise<CreateWorkspacePackFolderResult> {
  const api = desktopApi()
  if (!api) {
    throw new Error('当前环境不支持创建本地目录（仅桌面端可用）')
  }
  if (typeof api.createWorkspacePackFolder !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }
  return api.createWorkspacePackFolder(input)
}

export async function renameWorkspacePackPath(
  input: RenameWorkspacePackPathInput,
): Promise<RenameWorkspacePackPathResult> {
  const api = desktopApi()
  if (!api) {
    throw new Error('当前环境不支持重命名本地文件（仅桌面端可用）')
  }
  if (typeof api.renameWorkspacePackPath !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }
  return api.renameWorkspacePackPath(input)
}

export async function deleteWorkspacePackPath(
  input: DeleteWorkspacePackPathInput,
): Promise<DeleteWorkspacePackPathResult> {
  const api = desktopApi()
  if (!api) {
    throw new Error('当前环境不支持删除本地文件（仅桌面端可用）')
  }
  if (typeof api.deleteWorkspacePackPath !== 'function') {
    throw new Error('当前桌面进程不支持该能力，请重启桌面客户端后重试')
  }
  return api.deleteWorkspacePackPath(input)
}

export async function resolveWorkspaceFileUrl(relativePath: string): Promise<string> {
  const cleaned = relativePath.replace(/^\/+/, '')

  if (isDesktop) {
    const api = desktopApi()
    if (api) {
      try {
        const port = await api.getLocalServerPort()
        if (port && Number.isFinite(port) && port > 0) {
          return `http://127.0.0.1:${port}/${cleaned}`
        }
      } catch {
        // fallback for unavailable local server
      }
    }
  }

  return `/${cleaned}`
}
