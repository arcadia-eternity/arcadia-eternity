import { cloneJson, limits, parseDraft, fail, type WorkDraft, type WorkRelease, type WorkDependency } from './model'
import { resolveReleases, verifyAssets, verifyRelease } from './compiler'

export interface WorkArchive {
  format: 'arcadia.work-archive'
  version: 1
  drafts: WorkDraft[]
  releases: WorkRelease[]
  selected: WorkDependency[]
  blobs: Record<string, string>
}
export function encodeBytes(value: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < value.length; offset += 8192)
    binary += String.fromCharCode(...value.subarray(offset, offset + 8192))
  return btoa(binary)
}
export function decodeBytes(value: string): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length > limits.bytes ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    fail('INVALID_ASSET', 'blobs', '素材编码无效')
  return Uint8Array.from(atob(value), c => c.charCodeAt(0))
}
export async function parseArchive(input: string | unknown): Promise<WorkArchive> {
  if (typeof input === 'string' && new TextEncoder().encode(input).length > limits.bytes)
    fail('LIMIT_EXCEEDED', '', '导入文件超过 32 MiB')
  let value: WorkArchive
  try {
    value = cloneJson(typeof input === 'string' ? JSON.parse(input) : input) as WorkArchive
  } catch (error) {
    if (error instanceof SyntaxError) fail('INVALID_ARCHIVE', '', '文件不是有效的作品数据')
    throw error
  }
  if (
    !value ||
    value.format !== 'arcadia.work-archive' ||
    value.version !== 1 ||
    !Array.isArray(value.drafts) ||
    !Array.isArray(value.releases) ||
    !Array.isArray(value.selected) ||
    !value.blobs ||
    typeof value.blobs !== 'object' ||
    Array.isArray(value.blobs)
  )
    fail('UNSUPPORTED_FORMAT', 'format', '不支持的作品文件格式')
  if (value.drafts.length > 64 || value.releases.length > 128 || Object.keys(value.blobs).length > limits.assets)
    fail('LIMIT_EXCEEDED', '', '作品文件条目过多')
  const drafts = value.drafts.map(parseDraft),
    releases = await Promise.all(value.releases.map(verifyRelease))
  const seen = new Set<string>()
  for (const draft of drafts) {
    if (seen.has(draft.project.id)) fail('DUPLICATE_ID', 'drafts', '文件中存在重复草稿')
    seen.add(draft.project.id)
  }
  const versions = new Map<string, string>()
  for (const release of releases) {
    const key = `${release.project.id}@${release.releaseVersion}`
    if (versions.has(key)) fail('DUPLICATE_RELEASE', 'releases', '文件中存在重复作品版本')
    versions.set(key, release.digest)
    // Every included release must have its dependency closure, even when it is not selected for play.
    await resolveReleases([release], releases)
  }
  const roots = value.selected.map(dep => {
    const release = releases.find(
      item => item.project.id === dep?.projectId && item.releaseVersion === dep.version && item.digest === dep.digest,
    )
    if (!release) fail('MISSING_DEPENDENCY', 'selected', '文件缺少选定的固定版本')
    return release
  })
  await resolveReleases(roots, releases)
  const blobs = Object.fromEntries(Object.entries(value.blobs).map(([hash, text]) => [hash, decodeBytes(text)]))
  const assets = [...drafts, ...releases].flatMap(work => work.assets)
  // Verify per work: separate works may use the same local asset name.
  for (const work of [...drafts, ...releases]) await verifyAssets(work.assets, blobs)
  const hashes = new Set(assets.map(asset => asset.sha256))
  if (Object.keys(blobs).some(hash => !hashes.has(hash))) fail('UNDECLARED_ASSET', 'blobs', '文件包含未声明的素材')
  return { format: value.format, version: 1, drafts, releases, selected: value.selected, blobs: value.blobs }
}

export async function exportArchive(input: {
  drafts?: readonly WorkDraft[]
  selected?: readonly WorkRelease[]
  installed?: readonly WorkRelease[]
  blobs?: Readonly<Record<string, string>>
}): Promise<string> {
  const drafts = (input.drafts ?? []).map(parseDraft)
  const installed = input.installed ?? []
  const draftDependencies = drafts.flatMap(draft =>
    draft.dependencies.map(dep => {
      const release = installed.find(
        item => item.project.id === dep.projectId && item.releaseVersion === dep.version && item.digest === dep.digest,
      )
      if (!release) fail('MISSING_DEPENDENCY', 'dependencies', '导出前需要安装草稿声明的固定依赖')
      return release
    }),
  )
  const releases = await resolveReleases([...(input.selected ?? []), ...draftDependencies], installed)
  const hashes = new Set([...drafts, ...releases].flatMap(work => work.assets.map(asset => asset.sha256)))
  const blobs: Record<string, string> = {}
  for (const hash of hashes) {
    const bytes = input.blobs?.[hash]
    if (bytes === undefined) fail('ASSET_INTEGRITY', 'blobs', `缺少素材：${hash}`)
    blobs[hash] = bytes
  }
  const archive = await parseArchive({
    format: 'arcadia.work-archive',
    version: 1,
    drafts,
    releases,
    selected: (input.selected ?? []).map(release => ({
      projectId: release.project.id,
      version: release.releaseVersion,
      digest: release.digest,
    })),
    blobs,
  })
  return JSON.stringify(archive, null, 2)
}
