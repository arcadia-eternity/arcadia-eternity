import { cloneJson, fail, parseDraft, type WorkDraft, type WorkRelease, type WorkDependency, type Json } from './model'
import { verifyRelease, verifyAssets, resolveReleases } from './compiler'
import { parseArchive, decodeBytes, type WorkArchive } from './archive'

export interface WorkWorkspace {
  format: 'arcadia.work-workspace'
  version: 1
  drafts: Record<string, WorkDraft>
  releases: Record<string, WorkRelease>
  selected: WorkDependency[]
  blobs: Record<string, string>
  preferences: Record<string, Json>
}
export interface WorkSnapshot {
  revision: number
  workspace: WorkWorkspace
}
/** CAS is atomic in each adapter, including across tabs/processes. */
export interface WorkStorage {
  read(): Promise<WorkSnapshot>
  compareAndSwap(expected: number, next: WorkWorkspace): Promise<boolean>
}
export function emptyWorkspace(): WorkWorkspace {
  return {
    format: 'arcadia.work-workspace',
    version: 1,
    drafts: {},
    releases: {},
    selected: [],
    blobs: {},
    preferences: {},
  }
}
export const releaseKey = (release: WorkRelease) => `${release.project.id}@${release.releaseVersion}`
export function parseWorkspace(input: unknown): WorkWorkspace {
  const value = cloneJson(input) as WorkWorkspace
  if (!value || value.format !== 'arcadia.work-workspace' || value.version !== 1)
    fail('UNSUPPORTED_FORMAT', '', '不支持的本地作品库格式')
  for (const key of ['drafts', 'releases', 'blobs', 'preferences'] as const)
    if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key]))
      fail('INVALID_WORKSPACE', key, '本地作品库结构无效')
  if (!Array.isArray(value.selected)) fail('INVALID_WORKSPACE', 'selected', '启用列表无效')
  return value
}
export class WorkRepository {
  constructor(private readonly storage: WorkStorage) {}
  async read(): Promise<WorkWorkspace> {
    return parseWorkspace((await this.storage.read()).workspace)
  }
  private async update<T>(change: (workspace: WorkWorkspace) => T | Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.storage.read()
      const workspace = parseWorkspace(snapshot.workspace)
      const result = await change(workspace)
      if (await this.storage.compareAndSwap(snapshot.revision, workspace)) return result
    }
    fail('CONCURRENT_EDIT', '', '作品库被其他窗口持续修改，请重新读取后重试')
  }
  async saveDraft(input: WorkDraft): Promise<WorkDraft> {
    const draft = parseDraft(input)
    return this.update(workspace => {
      const current = workspace.drafts[draft.project.id]
      if ((current && current.revision !== draft.revision) || (!current && draft.revision !== 0))
        fail('DRAFT_CONFLICT', 'revision', '此草稿已在其他窗口修改，请保留当前编辑并重新载入', draft.project.id)
      const saved = { ...draft, revision: draft.revision + 1 }
      workspace.drafts[draft.project.id] = saved
      return cloneJson(saved)
    })
  }
  async deleteDraft(projectId: string, revision: number): Promise<void> {
    await this.update(workspace => {
      if (workspace.drafts[projectId]?.revision !== revision) fail('DRAFT_CONFLICT', 'revision', '草稿已经改变，未删除')
      delete workspace.drafts[projectId]
    })
  }
  async installRelease(input: WorkRelease, blobs: Readonly<Record<string, string>> = {}): Promise<void> {
    const release = await verifyRelease(input)
    await this.update(async workspace => {
      const previous = workspace.releases[releaseKey(release)]
      if (previous && previous.digest !== release.digest)
        fail('RELEASE_CONFLICT', 'releaseVersion', '该版本已经存在，请发布新的版本号')
      const combined = { ...workspace.blobs, ...blobs }
      await verifyAssets(
        release.assets,
        Object.fromEntries(Object.entries(combined).map(([hash, bytes]) => [hash, decodeBytes(bytes)])),
      )
      await resolveReleases([release], [...Object.values(workspace.releases), release])
      workspace.releases[releaseKey(release)] = release
      for (const asset of release.assets) workspace.blobs[asset.sha256] = combined[asset.sha256]
    })
  }
  async select(releases: readonly WorkDependency[]): Promise<void> {
    const input = cloneJson(releases)
    await this.update(async workspace => {
      const roots = input.map(dep => {
        const release = workspace.releases[`${dep.projectId}@${dep.version}`]
        if (!release || release.digest !== dep.digest)
          fail('MISSING_DEPENDENCY', 'selected', '选定版本尚未安装或摘要不同')
        return release
      })
      const resolved = await resolveReleases(roots, Object.values(workspace.releases))
      const namespaces = new Set<string>()
      for (const release of resolved) {
        if (namespaces.has(release.project.namespace))
          fail('NAMESPACE_CONFLICT', 'selected', '选定作品存在相同命名空间')
        namespaces.add(release.project.namespace)
      }
      workspace.selected = [...input]
    })
  }
  async importArchive(input: string | WorkArchive): Promise<void> {
    const archive = await parseArchive(input)
    await this.update(workspace => {
      for (const draft of archive.drafts)
        if (workspace.drafts[draft.project.id])
          fail('DRAFT_CONFLICT', 'drafts', '本地已存在同一草稿；请先另存副本，导入不会覆盖它')
      for (const release of archive.releases) {
        const current = workspace.releases[releaseKey(release)]
        if (current && current.digest !== release.digest)
          fail('RELEASE_CONFLICT', 'releases', '本地同版本的摘要不同，导入已取消')
      }
      for (const draft of archive.drafts) workspace.drafts[draft.project.id] = { ...draft, revision: 1 }
      for (const release of archive.releases) workspace.releases[releaseKey(release)] = release
      Object.assign(workspace.blobs, archive.blobs)
      // Import installs data only. Enabling content is an explicit separate user action.
    })
  }
  async putAsset(hash: string, bytes: string): Promise<void> {
    const { digestBytes } = await import('./model')
    if (!/^[a-f0-9]{64}$/.test(hash) || (await digestBytes(decodeBytes(bytes))) !== hash)
      fail('ASSET_INTEGRITY', 'blobs', '素材摘要不匹配')
    await this.update(workspace => {
      workspace.blobs[hash] = bytes
    })
  }
}
