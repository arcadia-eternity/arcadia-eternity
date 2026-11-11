import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import semver from 'semver'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import { normalizeEnvironmentDocument } from './debug-environments.ts'
import { withSourceLock } from './source-lock.ts'
import { contentError, materialFiles, writeMaterials } from './workspace-materials.ts'

export interface EnvironmentRules {
  schemaVersion: 1
  tier?: string
  allow?: { species?: string[]; skills?: string[]; marks?: string[] }
  deny?: { species?: string[]; skills?: string[]; marks?: string[] }
  team?: { minSize?: number; maxSize?: number; uniqueSpecies?: boolean }
}
export interface EnvironmentDocument {
  schemaVersion: 2
  id: string
  name: string
  packages: Record<string, string>
  sources: string[]
  disabled?: { packages: Record<string, string>; sources: string[] }
  rules: EnvironmentRules
  requires: { engine?: string; sdk?: string; capabilities?: string[] }
}
export interface EnvironmentDraft {
  document: EnvironmentDocument
  revision: string
}
export interface EnvironmentVersion {
  format: 'arcadia.environment-version/1'
  versionId: string
  workspaceId: string
  environmentId: string
  document: EnvironmentDocument
  draftRevision: string
  contentRevision: string
  members?: {
    name: string
    version: string
    projectId: string
    namespace: string
    direct: boolean
    dependencies: string[]
    requiredBy: string[]
  }[]
  packages: unknown[]
  createdAt: number
  adopted: boolean
  materialDirectory: string
  directory: string
  status: 'ready'
}
export interface UnavailableVersion {
  versionId: string
  workspaceId: string
  environmentId?: string
  status: 'unavailable'
  reason: string
}
export interface PrepareVersionInput {
  onProgress?: (progress: { stage: string; completed?: number; total?: number }) => void | Promise<void>
  environmentId: string
  expectedRevision: string
  projectDirectory?: string
  directory?: string
  signal?: AbortSignal
  beforeCommit?: () => Promise<void>
}
export type StaticPreparer = (input: {
  directory: string
  draft: EnvironmentDocument
  signal?: AbortSignal
}) => Promise<{
  contentRevision: string
  packages?: unknown[]
}>
export interface ContentWorkspaceOptions {
  maxBytes?: number
  maxFiles?: number
  stagingRetentionMs?: number
  resolveProject?: (environmentId: string) => string | undefined | Promise<string | undefined>
  acquireMaterials?: (directory: string, versionId: string) => Promise<() => void | Promise<void>>
  retentions?: {
    list(versionId: string): Promise<Record<string, unknown>[]>
    put?(versionId: string, retentionId: string): Promise<void>
    remove?(retentionId: string): Promise<void>
  }
}
export interface EnvironmentExport {
  format: 'arcadia.environment-export/1'
  document: EnvironmentDocument
  contentRevision: string
  files: { path: string; data: string }[]
}
export interface WorkspaceSnapshot {
  format: 'arcadia.workspace-snapshot/1'
  workspaceId: string
  drafts: EnvironmentDraft[]
  versions: {
    version: Pick<
      EnvironmentVersion,
      'versionId' | 'environmentId' | 'document' | 'draftRevision' | 'contentRevision' | 'packages' | 'createdAt'
    >
    files: { path: string; data: string }[]
  }[]
}
export interface WorkspaceSnapshotStamp {
  workspaceId: string
  bootId: string
  generation: number
}
export interface WorkspaceSnapshotCapture {
  snapshot: WorkspaceSnapshot
  stamp: WorkspaceSnapshotStamp
}
export interface ContentWorkspace {
  readonly root: string
  readonly workspaceId: string
  readonly bootId: string
  listDrafts(): Promise<EnvironmentDraft[]>
  getDraft(environmentId: string): Promise<EnvironmentDraft>
  saveDraft(input: { document: unknown; expectedRevision: string | null }): Promise<EnvironmentDraft>
  deleteDraft(input: { environmentId: string; expectedRevision: string }): Promise<void>
  prepareVersion(input: PrepareVersionInput, preparer: StaticPreparer): Promise<EnvironmentVersion>
  adoptVersion(input: PrepareVersionInput, preparer: StaticPreparer): Promise<EnvironmentVersion>
  getVersion(versionId: string): Promise<EnvironmentVersion>
  listVersions(environmentId?: string): Promise<(EnvironmentVersion | UnavailableVersion)[]>
  acquire(versionId: string, owner?: string): Promise<EnvironmentVersion & { release(): Promise<void> }>
  retain(versionId: string, retentionId: string): Promise<void>
  releaseRetention(retentionId: string): Promise<void>
  references(versionId: string): Promise<Record<string, unknown>[]>
  deleteVersion(versionId: string): Promise<void>
  exportVersion(versionId: string): Promise<EnvironmentExport>
  exportSnapshot(): Promise<WorkspaceSnapshot>
  captureSnapshot(): Promise<WorkspaceSnapshotCapture>
  isSnapshotCurrent(stamp: WorkspaceSnapshotStamp): Promise<boolean>
  restoreSnapshot(
    snapshot: WorkspaceSnapshot,
    input: { mode: 'restore' | 'clone' },
    preparer: StaticPreparer,
  ): Promise<{ workspaceId: string; versionIds: Record<string, string> }>
  importVersion(
    bundle: EnvironmentExport,
    input: {
      environmentId?: string
      expectedRevision?: string | null
      signal?: AbortSignal
      beforeCommit?: () => Promise<void>
      importId?: string
    },
    preparer: StaticPreparer,
  ): Promise<EnvironmentVersion>
  recoverImport(importId: string): Promise<EnvironmentVersion>
  forgetImport(importId: string, input?: { discard?: boolean }): Promise<void>
  reconcile(): Promise<{
    workspaceId: string
    versions: (EnvironmentVersion | UnavailableVersion)[]
    abandoned: string[]
  }>
  close(input?: { force?: boolean }): Promise<void>
  cleanupStaging(): Promise<string[]>
}
export interface ContentWorkspaceConstructor {
  new (root: string, options?: ContentWorkspaceOptions): ContentWorkspace
  open(directory: string, options?: ContentWorkspaceOptions): Promise<ContentWorkspace>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// npm ls redacts UUID-shaped path components, so opaque logical identities must
// not also be physical directory names.
const versionDirectory = id => 'version-' + id.replaceAll('-', '')
const directoryVersion = name =>
  /^version-[a-f0-9]{32}$/.test(name)
    ? name.slice(8).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
    : undefined
const envId = /^[a-z0-9][a-z0-9_-]{0,79}$/
const revision = text => createHash('sha256').update(text).digest('hex')
const json = value => JSON.stringify(value, null, 2) + '\n'
const checkId = (id, pattern = uuid) => {
  if (typeof id !== 'string' || !pattern.test(id)) throw contentError('RESOURCE_ID_INVALID')
  return id
}
async function readJson(file, limit = 4 * 1024 * 1024) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw contentError('WORKSPACE_FILE_INVALID')
  return JSON.parse(await readFile(file, 'utf8'))
}
async function regularDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw contentError('WORKSPACE_PATH_INVALID')
}
async function checkedPreparation(result: any, document: EnvironmentDocument, directory: string) {
  if (
    !result ||
    typeof result.contentRevision !== 'string' ||
    !result.contentRevision ||
    !Array.isArray(result.packages ?? [])
  )
    throw contentError('STATIC_PREPARATION_INVALID')
  const packages = result.packages ?? []
  for (const [name, range] of Object.entries(document.packages)) {
    const matches = packages.filter(pkg => pkg?.name === name)
    if (
      !semver.validRange(range) ||
      !matches.some(pkg => semver.valid(pkg.version) && semver.satisfies(pkg.version, range))
    )
      throw contentError('ENVIRONMENT_PACKAGE_MISMATCH', `Prepared packages do not satisfy ${name}@${range}`)
  }
  for (const name of document.sources)
    if (!packages.some(pkg => pkg?.name === name)) throw contentError('ENVIRONMENT_SOURCE_MISSING', name)
  const inspection = await inspectNpmProject(directory)
  return { ...result, members: inspection.members }
}
function activeProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    if (error.code === 'EPERM') return true
    throw error
  }
}

/** One local owner coordinates files, immutable materials and runtime leases.
 * Bindings/grants/retention roots remain owned by the injected durable database.
 */
class ContentWorkspaceImplementation implements ContentWorkspace {
  readonly root: string
  readonly bootId: string
  workspaceId!: string
  #queue = Promise.resolve()
  #snapshotGeneration = 0
  #snapshotObservations
  #closed = false
  #closing = false
  #closePromise
  #pending = new Set()
  #activeStaging = new Set()
  #leases = new Map()
  #external = new Map()
  #controller = new AbortController()
  #options
  constructor(root: string, options: ContentWorkspaceOptions = {}) {
    this.root = root
    this.bootId = randomUUID()
    this.#options = options
  }
  static async open(directory: string, options: ContentWorkspaceOptions = {}): Promise<ContentWorkspace> {
    await regularDirectory(resolve(directory))
    const root = await realpath(directory)
    const workspace = new ContentWorkspaceImplementation(root, options)
    await withSourceLock(root, 'workspace-owner', async () => {
      const ownerFile = join(root, 'workspace-owner.json')
      try {
        const owner = await readJson(ownerFile)
        if (activeProcess(owner.pid)) throw contentError('WORKSPACE_BUSY')
        await rm(ownerFile)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await writeFile(ownerFile, json({ pid: process.pid, bootId: workspace.bootId }), { flag: 'wx', mode: 0o600 })
    })
    try {
      for (const name of ['environments', 'versions', 'staging', 'imports']) await regularDirectory(join(root, name))
      try {
        const metadata = await readJson(join(root, 'workspace.json'))
        if (metadata.format !== 'arcadia.content-workspace/1') throw contentError('WORKSPACE_FORMAT_INVALID')
        workspace.workspaceId = checkId(metadata.workspaceId)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        workspace.workspaceId = randomUUID()
        await writeFileAtomic(
          join(root, 'workspace.json'),
          json({ format: 'arcadia.content-workspace/1', workspaceId: workspace.workspaceId }),
          { mode: 0o600 },
        )
      }
      await workspace.reconcile()
      return workspace
    } catch (error) {
      await workspace.close()
      throw error
    }
  }
  async #assertOwner() {
    if (this.#closed || this.#closing) throw contentError('WORKSPACE_CLOSED')
    const owner = await readJson(join(this.root, 'workspace-owner.json'))
    if (owner.bootId !== this.bootId || owner.pid !== process.pid) throw contentError('WORKSPACE_OWNERSHIP_LOST')
  }
  #exclusive(action, mutatesSnapshot = false) {
    const result = this.#queue.then(async () => {
      await this.#assertOwner()
      if (mutatesSnapshot) {
        // Invalidate before the first awaited write: an operation may commit
        // partially and then fail, including an external DB import boundary.
        this.#snapshotGeneration++
        this.#snapshotObservations = undefined
      }
      return action()
    })
    this.#queue = result.catch(() => {})
    return result
  }
  async #draft(id) {
    checkId(id, envId)
    const file = join(this.root, 'environments', `${id}.json`)
    await readJson(file)
    const text = await readFile(file, 'utf8')
    const document = normalizeEnvironmentDocument(JSON.parse(text))
    if (document.id !== id) throw contentError('ENVIRONMENT_ID_MISMATCH')
    return { document, revision: revision(text) }
  }
  async listDrafts(): Promise<EnvironmentDraft[]> {
    await this.#assertOwner()
    const result = []
    for (const file of (await readdir(join(this.root, 'environments'))).sort()) {
      if (!file.endsWith('.json')) continue
      result.push(await this.#draft(file.slice(0, -5)))
    }
    return result
  }
  getDraft(id: string): Promise<EnvironmentDraft> {
    return this.#exclusive(() => this.#draft(id))
  }
  saveDraft({
    document,
    expectedRevision,
  }: {
    document: unknown
    expectedRevision: string | null
  }): Promise<EnvironmentDraft> {
    const next = normalizeEnvironmentDocument(document)
    return this.#exclusive(async () => {
      let previous = null
      try {
        previous = await this.#draft(next.id)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (expectedRevision !== (previous?.revision ?? null)) throw contentError('REVISION_CONFLICT')
      await writeFileAtomic(join(this.root, 'environments', `${next.id}.json`), json(next), { mode: 0o600 })
      return this.#draft(next.id)
    }, true)
  }
  deleteDraft({ environmentId, expectedRevision }: { environmentId: string; expectedRevision: string }): Promise<void> {
    return this.#exclusive(async () => {
      const draft = await this.#draft(environmentId)
      if (draft.revision !== expectedRevision) throw contentError('REVISION_CONFLICT')
      const versions = await this.listVersions()
      if (versions.some(version => version.environmentId === environmentId || version.environmentId === undefined))
        throw contentError('ENVIRONMENT_HAS_VERSIONS')
      await rm(join(this.root, 'environments', `${environmentId}.json`))
    }, true)
  }
  async #materialDirectory(metadata) {
    const path = metadata.materialDirectory
    if (
      typeof path !== 'string' ||
      isAbsolute(path) ||
      path.includes('\\') ||
      path.split('/').some(p => !p || p === '.' || p === '..')
    )
      throw contentError('MATERIAL_PATH_INVALID')
    const directory = join(this.root, path)
    if ((await realpath(directory)) !== directory) throw contentError('MATERIAL_PATH_ESCAPE')
    return directory
  }
  async #version(versionId) {
    checkId(versionId)
    const metadata = await readJson(join(this.root, 'versions', versionDirectory(versionId), 'version.json'))
    if (
      metadata.format !== 'arcadia.environment-version/1' ||
      metadata.versionId !== versionId ||
      metadata.workspaceId !== this.workspaceId
    )
      throw contentError('ENVIRONMENT_VERSION_INVALID')
    checkId(metadata.environmentId, envId)
    const document = normalizeEnvironmentDocument(metadata.document)
    if (
      document.id !== metadata.environmentId ||
      typeof metadata.contentRevision !== 'string' ||
      !metadata.contentRevision ||
      typeof metadata.draftRevision !== 'string'
    )
      throw contentError('ENVIRONMENT_VERSION_INVALID')
    if (metadata.adopted && !this.#options.acquireMaterials) throw contentError('MATERIAL_OWNER_REQUIRED')
    const directory = await this.#materialDirectory(metadata)
    await readJson(join(directory, 'package.json'))
    await readJson(join(directory, 'package-lock.json'), 16 * 1024 * 1024)
    return { ...metadata, document, directory, status: 'ready' }
  }
  getVersion(versionId: string): Promise<EnvironmentVersion> {
    return this.#exclusive(() => this.#version(versionId))
  }
  async listVersions(environmentId?: string): Promise<(EnvironmentVersion | UnavailableVersion)[]> {
    await this.#assertOwner()
    if (environmentId !== undefined) checkId(environmentId, envId)
    const result = []
    for (const directory of (await readdir(join(this.root, 'versions'))).sort()) {
      const versionId = directoryVersion(directory)
      if (!versionId) continue
      try {
        const version = await this.#version(versionId)
        if (environmentId === undefined || version.environmentId === environmentId) result.push(version)
      } catch (error) {
        const metadata = await readJson(join(this.root, 'versions', directory, 'version.json')).catch(() => null)
        if (environmentId === undefined || metadata?.environmentId === environmentId)
          result.push({
            versionId,
            environmentId: metadata?.environmentId,
            workspaceId: this.workspaceId,
            status: 'unavailable',
            reason: error.code ?? 'ENVIRONMENT_VERSION_INVALID',
          })
      }
    }
    return result
  }
  prepareVersion(input: PrepareVersionInput, preparer: StaticPreparer): Promise<EnvironmentVersion> {
    return this.#prepare(input, preparer, false)
  }
  adoptVersion(input: PrepareVersionInput, preparer: StaticPreparer): Promise<EnvironmentVersion> {
    return this.#prepare(input, preparer, true)
  }
  #prepare(input, preparer, adopted) {
    if (typeof preparer !== 'function') throw contentError('STATIC_PREPARER_REQUIRED')
    const task = this.#performPrepare(input, preparer, adopted)
    this.#pending.add(task)
    task.finally(() => this.#pending.delete(task)).catch(() => {})
    return task
  }
  async #performPrepare(
    { environmentId, expectedRevision, projectDirectory, directory, signal, beforeCommit, onProgress },
    preparer,
    adopted,
  ) {
    const draft = await this.getDraft(environmentId)
    if (draft.revision !== expectedRevision) throw contentError('REVISION_CONFLICT')
    const combined = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal
    combined.throwIfAborted()
    const sourceDirectory = projectDirectory ?? directory ?? (await this.#options.resolveProject?.(environmentId))
    if (typeof sourceDirectory !== 'string') throw contentError('ENVIRONMENT_SOURCE_MISSING')
    const versionId = randomUUID()
    const staging = join(this.root, 'staging', 'prepare-' + versionId.replaceAll('-', ''))
    await mkdir(staging, { mode: 0o700 })
    this.#activeStaging.add(staging)
    let releaseExternal,
      committed = false
    try {
      await onProgress?.({ stage: 'capturing' })
      let materials = join(staging, 'materials')
      if (adopted) {
        materials = await realpath(sourceDirectory)
        const path = relative(this.root, materials)
        if (!path || isAbsolute(path) || path === '..' || path.startsWith('../'))
          throw contentError('MATERIAL_PATH_ESCAPE')
        if (typeof this.#options.acquireMaterials !== 'function') throw contentError('MATERIAL_OWNER_REQUIRED')
        releaseExternal = await this.#options.acquireMaterials(materials, versionId)
        if (typeof releaseExternal !== 'function') throw contentError('MATERIAL_OWNER_REQUIRED')
      } else {
        await mkdir(materials)
        const files = await materialFiles(sourceDirectory, { ...this.#options, signal: combined })
        await writeMaterials(materials, files, { ...this.#options, signal: combined })
      }
      combined.throwIfAborted()
      await onProgress?.({ stage: 'preparing' })
      const result = await checkedPreparation(
        await preparer({ directory: materials, draft: structuredClone(draft.document), signal: combined }),
        draft.document,
        materials,
      )
      combined.throwIfAborted()
      const metadata = {
        format: 'arcadia.environment-version/1',
        versionId,
        workspaceId: this.workspaceId,
        environmentId,
        document: draft.document,
        draftRevision: draft.revision,
        contentRevision: result.contentRevision,
        packages: result.packages ?? [],
        members: result.members ?? [],
        createdAt: Date.now(),
        adopted,
        materialDirectory: adopted
          ? relative(this.root, materials).split('\\').join('/')
          : `versions/${versionDirectory(versionId)}/materials`,
      }
      await writeFile(join(staging, 'version.json'), json(metadata), { flag: 'wx', mode: 0o600 })
      return await this.#exclusive(async () => {
        combined.throwIfAborted()
        await beforeCommit?.()
        combined.throwIfAborted()
        await rename(staging, join(this.root, 'versions', versionDirectory(versionId)))
        committed = true
        if (releaseExternal) this.#external.set(versionId, releaseExternal)
        // The revision is captured, never a mutable "active" pointer. A stale
        // candidate can be retained but only the binding owner can publish it.
        return this.#version(versionId)
      }, true)
    } finally {
      this.#activeStaging.delete(staging)
      if (!committed) {
        await rm(staging, { recursive: true, force: true })
        await releaseExternal?.()
      }
    }
  }
  acquire(versionId: string, owner = 'runtime'): Promise<EnvironmentVersion & { release(): Promise<void> }> {
    return this.#exclusive(async () => {
      const version = await this.#version(versionId)
      if (this.#closing || this.#closed) throw contentError('WORKSPACE_CLOSED')
      const token = randomUUID()
      this.#leases.set(token, { versionId, owner, bootId: this.bootId })
      let released = false
      return {
        ...version,
        release: async () => {
          if (released) return
          released = true
          this.#leases.delete(token)
        },
      }
    })
  }
  retain(versionId: string, retentionId: string): Promise<void> {
    return this.#exclusive(async () => {
      await this.#version(versionId)
      if (!this.#options.retentions?.put) throw contentError('RETENTION_UNAVAILABLE')
      await this.#options.retentions.put(versionId, retentionId)
    })
  }
  releaseRetention(retentionId: string): Promise<void> {
    return this.#exclusive(async () => {
      if (!this.#options.retentions?.remove) throw contentError('RETENTION_UNAVAILABLE')
      await this.#options.retentions.remove(retentionId)
    })
  }
  async #references(versionId) {
    if (!this.#options.retentions?.list) throw contentError('RETENTION_UNAVAILABLE')
    return [
      ...(await this.#importIntents())
        .filter(x => x.versionId === versionId)
        .map(x => ({ kind: 'import', importId: x.importId })),
      ...[...this.#leases.values()].filter(x => x.versionId === versionId).map(x => ({ kind: 'runtime', ...x })),
      ...(await this.#options.retentions.list(versionId)).map(x => ({ kind: 'retention', ...x })),
    ]
  }
  references(versionId: string): Promise<Record<string, unknown>[]> {
    return this.#exclusive(() => this.#references(checkId(versionId)))
  }
  deleteVersion(versionId: string): Promise<void> {
    return this.#exclusive(async () => {
      checkId(versionId)
      const references = await this.#references(versionId)
      if (references.length) throw Object.assign(contentError('ENVIRONMENT_IN_USE'), { references })
      // Rename removes it from admission before any bytes are deleted. A crash
      // leaves a recognizable staging tombstone, never a half-ready version.
      const tombstone = join(
        this.root,
        'staging',
        `deleted-${versionId.replaceAll('-', '')}-${randomUUID().replaceAll('-', '')}`,
      )
      await rename(join(this.root, 'versions', versionDirectory(versionId)), tombstone)
      await rm(tombstone, { recursive: true, force: true })
      await this.#external.get(versionId)?.()
      this.#external.delete(versionId)
    }, true)
  }
  async exportVersion(versionId: string): Promise<EnvironmentExport> {
    const lease = await this.acquire(versionId, 'export')
    try {
      const files = await materialFiles(lease.directory, this.#options)
      return {
        format: 'arcadia.environment-export/1',
        document: lease.document,
        contentRevision: lease.contentRevision,
        files: files.map(({ path, bytes }) => ({ path, data: bytes.toString('base64') })),
      }
    } finally {
      await lease.release()
    }
  }
  #observation(path, info) {
    return {
      path,
      dev: info.dev,
      ino: info.ino,
      mode: info.mode,
      size: info.size,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
    }
  }
  async #observationsCurrent(observations) {
    for (const previous of observations) {
      const info = await lstat(previous.path).catch(error => {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null
        throw error
      })
      if (!info) return false
      const current = this.#observation(previous.path, info)
      if (Object.keys(current).some(key => current[key] !== previous[key])) return false
    }
    return true
  }
  async #snapshotData(observations = undefined) {
    if ((await this.#importIntents()).some(intent => !intent.completed))
      throw contentError('WORKSPACE_SNAPSHOT_UNSETTLED')
    const observe = (path, info) => {
      if (!observations) return
      if (observations.length >= 200000) throw contentError('WORKSPACE_SNAPSHOT_LIMIT')
      observations.push(this.#observation(path, info))
    }
    // Observe control files before reading them; materialFiles supplies the
    // matching post-read observations without copying another set of bytes.
    if (observations) {
      for (const name of ['workspace.json', 'environments', 'versions', 'imports']) {
        const path = join(this.root, name)
        observe(path, await lstat(path))
      }
      for (const name of await readdir(join(this.root, 'environments'))) {
        const path = join(this.root, 'environments', name)
        observe(path, await lstat(path))
      }
      for (const name of await readdir(join(this.root, 'versions'))) {
        if (!directoryVersion(name)) continue
        const path = join(this.root, 'versions', name, 'version.json')
        observe(path, await lstat(path))
      }
    }
    const versions = []
    let materialBytes = 0
    for (const entry of await this.listVersions()) {
      if (entry.status !== 'ready') throw contentError('ENVIRONMENT_UNAVAILABLE')
      const { versionId, environmentId, document, draftRevision, contentRevision, packages, createdAt } = entry
      const files = await materialFiles(entry.directory, {
        ...this.#options,
        signal: this.#controller.signal,
        onRead: observe,
      })
      materialBytes += files.reduce((total, file) => total + file.bytes.length, 0)
      if (materialBytes > 1024 * 1024 * 1024) throw contentError('WORKSPACE_SNAPSHOT_LIMIT')
      versions.push({
        version: { versionId, environmentId, document, draftRevision, contentRevision, packages, createdAt },
        files: files.map(({ path, bytes }) => ({ path, data: bytes.toString('base64') })),
      })
    }
    const snapshot = {
      format: 'arcadia.workspace-snapshot/1',
      workspaceId: this.workspaceId,
      drafts: await this.listDrafts(),
      versions,
    }
    if (observations && !(await this.#observationsCurrent(observations)))
      throw contentError('WORKSPACE_SNAPSHOT_UNSETTLED')
    return snapshot
  }
  exportSnapshot(): Promise<WorkspaceSnapshot> {
    return this.#exclusive(() => this.#snapshotData())
  }
  /** One-use stamp for an optimistic file/DB consistent snapshot. */
  captureSnapshot(): Promise<WorkspaceSnapshotCapture> {
    return this.#exclusive(async () => {
      this.#snapshotGeneration++
      this.#snapshotObservations = undefined
      const observations = []
      const snapshot = await this.#snapshotData(observations)
      const stamp = { workspaceId: this.workspaceId, bootId: this.bootId, generation: this.#snapshotGeneration }
      this.#snapshotObservations = observations
      return { snapshot, stamp }
    })
  }
  isSnapshotCurrent(stamp: WorkspaceSnapshotStamp): Promise<boolean> {
    return this.#exclusive(async () => {
      if (
        !stamp ||
        stamp.workspaceId !== this.workspaceId ||
        stamp.bootId !== this.bootId ||
        !Number.isSafeInteger(stamp.generation) ||
        stamp.generation !== this.#snapshotGeneration ||
        !this.#snapshotObservations
      )
        return false
      const observations = this.#snapshotObservations
      this.#snapshotObservations = undefined
      return this.#observationsCurrent(observations)
    })
  }
  async restoreSnapshot(
    snapshot: WorkspaceSnapshot,
    { mode }: { mode: 'restore' | 'clone' },
    preparer: StaticPreparer,
  ): Promise<{ workspaceId: string; versionIds: Record<string, string> }> {
    if (
      snapshot?.format !== 'arcadia.workspace-snapshot/1' ||
      !['restore', 'clone'].includes(mode) ||
      !Array.isArray(snapshot.drafts) ||
      !Array.isArray(snapshot.versions) ||
      typeof preparer !== 'function'
    )
      throw contentError('WORKSPACE_SNAPSHOT_INVALID')
    checkId(snapshot.workspaceId)
    return this.#exclusive(async () => {
      if (
        (await this.listDrafts()).length ||
        (await this.listVersions()).length ||
        this.#pending.size ||
        this.#leases.size
      )
        throw contentError('WORKSPACE_NOT_EMPTY')
      const workspaceId = mode === 'restore' ? snapshot.workspaceId : this.workspaceId
      const versions = new Map()
      const drafts = new Map()
      for (const draft of snapshot.drafts) {
        const document = normalizeEnvironmentDocument(draft.document)
        if (drafts.has(document.id)) throw contentError('WORKSPACE_SNAPSHOT_INVALID')
        drafts.set(document.id, document)
      }
      const staging = join(this.root, 'staging', `restore-${randomUUID().replaceAll('-', '')}`)
      await mkdir(staging)
      try {
        // Validate every received artifact before changing any target document.
        for (const entry of snapshot.versions) {
          const original = entry.version
          checkId(original?.versionId)
          if (versions.has(original.versionId)) throw contentError('WORKSPACE_SNAPSHOT_INVALID')
          const document = normalizeEnvironmentDocument(original.document)
          if (
            document.id !== original.environmentId ||
            !drafts.has(document.id) ||
            typeof original.draftRevision !== 'string' ||
            !Number.isSafeInteger(original.createdAt)
          )
            throw contentError('WORKSPACE_SNAPSHOT_INVALID')
          const versionId = mode === 'restore' ? original.versionId : randomUUID()
          const target = join(staging, versionDirectory(versionId))
          const materials = join(target, 'materials')
          await mkdir(materials, { recursive: true })
          await writeMaterials(materials, entry.files, this.#options)
          const result = await checkedPreparation(
            await preparer({ directory: materials, draft: document, signal: this.#controller.signal }),
            document,
            materials,
          )
          if (result?.contentRevision !== original.contentRevision) throw contentError('ENVIRONMENT_IMPORT_MISMATCH')
          await writeFile(
            join(target, 'version.json'),
            json({
              format: 'arcadia.environment-version/1',
              versionId,
              workspaceId,
              environmentId: document.id,
              document,
              draftRevision: original.draftRevision,
              contentRevision: result.contentRevision,
              packages: result.packages ?? [],
              members: result.members ?? [],
              createdAt: original.createdAt,
              adopted: false,
              materialDirectory: `versions/${versionDirectory(versionId)}/materials`,
            }),
            { flag: 'wx', mode: 0o600 },
          )
          versions.set(original.versionId, versionId)
        }
        this.#controller.signal.throwIfAborted()
        // Callers restore into an inactive staging workspace and switch the whole
        // server directory only after DB/files validation. Never merge online.
        for (const id of versions.values())
          await rename(join(staging, versionDirectory(id)), join(this.root, 'versions', versionDirectory(id)))
        for (const [id, document] of drafts)
          await writeFileAtomic(join(this.root, 'environments', `${id}.json`), json(document), { mode: 0o600 })
        await writeFileAtomic(
          join(this.root, 'workspace.json'),
          json({ format: 'arcadia.content-workspace/1', workspaceId }),
          { mode: 0o600 },
        )
        this.workspaceId = workspaceId
        return { workspaceId, versionIds: Object.fromEntries(versions) }
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    }, true)
  }
  async #importIntents() {
    const intents = []
    for (const name of await readdir(join(this.root, 'imports'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const intent = await readJson(join(this.root, 'imports', name))
      if (
        intent.format !== 'arcadia.environment-import/1' ||
        intent.importId !== name.slice(0, -5) ||
        intent.workspaceId !== this.workspaceId
      )
        throw contentError('IMPORT_INTENT_INVALID')
      checkId(intent.versionId)
      checkId(intent.document?.id, envId)
      intents.push(intent)
    }
    return intents
  }
  async #finishImport(importId) {
    const intent = (await this.#importIntents()).find(x => x.importId === importId)
    if (!intent) throw contentError('IMPORT_INTENT_NOT_FOUND')
    const target = join(this.root, 'versions', versionDirectory(intent.versionId))
    const staging = join(this.root, 'staging', `import-${intent.versionId.replaceAll('-', '')}`)
    const draftFile = join(this.root, 'environments', `${intent.document.id}.json`)
    const text = json(normalizeEnvironmentDocument(intent.document))
    let previous = null
    try {
      previous = await readFile(draftFile, 'utf8')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (
      !intent.completed &&
      previous !== text &&
      (previous === null ? null : revision(previous)) !== intent.expectedRevision
    )
      throw contentError('REVISION_CONFLICT')
    try {
      await lstat(target)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await rename(staging, target)
    }
    const version = await this.#version(intent.versionId)
    if (version.draftRevision !== revision(text) || version.contentRevision !== intent.contentRevision)
      throw contentError('IMPORT_INTENT_INVALID')
    // Replaying a completed receipt must not overwrite a subsequent draft edit.
    if (!intent.completed) {
      if (previous !== text) await writeFileAtomic(draftFile, text, { mode: 0o600 })
      await writeFileAtomic(join(this.root, 'imports', `${importId}.json`), json({ ...intent, completed: true }), {
        mode: 0o600,
      })
    }
    return version
  }
  /** The caller must first establish that its durable operation committed. */
  recoverImport(importId: string): Promise<EnvironmentVersion> {
    checkId(importId, /^[a-f0-9]{64}$/)
    return this.#exclusive(() => this.#finishImport(importId), true)
  }
  /** Acknowledge a completed receipt, or discard a proven uncommitted operation. */
  forgetImport(importId: string, { discard = false }: { discard?: boolean } = {}): Promise<void> {
    checkId(importId, /^[a-f0-9]{64}$/)
    return this.#exclusive(async () => {
      const intent = (await this.#importIntents()).find(x => x.importId === importId)
      if (!intent) return
      if (!intent.completed && !discard) throw contentError('IMPORT_NOT_COMPLETED')
      if (discard) {
        const published = await lstat(join(this.root, 'versions', versionDirectory(intent.versionId))).catch(error => {
          if (error.code === 'ENOENT') return null
          throw error
        })
        if (published) throw contentError('IMPORT_ALREADY_PUBLISHED')
        await rm(join(this.root, 'staging', `import-${intent.versionId.replaceAll('-', '')}`), {
          recursive: true,
          force: true,
        })
      }
      await rm(join(this.root, 'imports', `${importId}.json`))
    }, true)
  }
  async importVersion(
    bundle: EnvironmentExport,
    {
      environmentId,
      expectedRevision = null,
      signal,
      beforeCommit,
      importId,
    }: {
      environmentId?: string
      expectedRevision?: string | null
      signal?: AbortSignal
      beforeCommit?: () => Promise<void>
      importId?: string
    } = {},
    preparer: StaticPreparer,
  ): Promise<EnvironmentVersion> {
    if (bundle?.format !== 'arcadia.environment-export/1') throw contentError('ENVIRONMENT_EXPORT_INVALID')
    if (typeof preparer !== 'function') throw contentError('STATIC_PREPARER_REQUIRED')
    const document = normalizeEnvironmentDocument({
      ...bundle.document,
      ...(environmentId ? { id: environmentId } : {}),
    })
    const versionId = randomUUID()
    if (importId !== undefined) checkId(importId, /^[a-f0-9]{64}$/)
    let journaled = false
    const staging = join(this.root, 'staging', `import-${versionId.replaceAll('-', '')}`)
    const combined = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal
    await this.#assertOwner()
    const materials = join(staging, 'materials')
    await mkdir(materials, { recursive: true })
    this.#activeStaging.add(staging)
    try {
      await writeMaterials(materials, bundle.files, { ...this.#options, signal: combined })
      // Validate received bytes independently; an archive's revision is not a proof.
      const result = await checkedPreparation(
        await preparer({ directory: materials, draft: document, signal: combined }),
        document,
        materials,
      )
      if (result.contentRevision !== bundle.contentRevision) throw contentError('ENVIRONMENT_IMPORT_MISMATCH')
      const text = json(document)
      const metadata = {
        format: 'arcadia.environment-version/1',
        versionId,
        workspaceId: this.workspaceId,
        environmentId: document.id,
        document,
        draftRevision: revision(text),
        contentRevision: result.contentRevision,
        packages: result.packages ?? [],
        members: result.members ?? [],
        createdAt: Date.now(),
        adopted: false,
        materialDirectory: `versions/${versionDirectory(versionId)}/materials`,
      }
      await writeFile(join(staging, 'version.json'), json(metadata), { flag: 'wx', mode: 0o600 })
      return await this.#exclusive(async () => {
        const draftFile = join(this.root, 'environments', `${document.id}.json`)
        let previous = null
        try {
          previous = await readFile(draftFile, 'utf8')
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        if (expectedRevision !== (previous === null ? null : revision(previous)))
          throw contentError('REVISION_CONFLICT')
        combined.throwIfAborted()
        if (importId) {
          if ((await this.#importIntents()).some(x => x.importId === importId))
            throw contentError('IMPORT_ALREADY_EXISTS')
          // Persist prepared material intent before the external DB cancellation boundary.
          // If its response is lost, only the caller's DB may decide recovery vs discard.
          await writeFileAtomic(
            join(this.root, 'imports', `${importId}.json`),
            json({
              format: 'arcadia.environment-import/1',
              importId,
              workspaceId: this.workspaceId,
              versionId,
              document,
              expectedRevision,
              contentRevision: metadata.contentRevision,
              completed: false,
            }),
            { mode: 0o600 },
          )
          journaled = true
          await beforeCommit?.()
          return this.#finishImport(importId)
        }
        await beforeCommit?.()
        combined.throwIfAborted()
        const target = join(this.root, 'versions', versionDirectory(versionId))
        await rename(staging, target)
        try {
          await writeFileAtomic(draftFile, text, { mode: 0o600 })
        } catch (error) {
          // An atomic writer can report an fsync error after rename. Compensate
          // only our own bytes; never overwrite a subsequent external edit.
          const current = await readFile(draftFile, 'utf8').catch(() => null)
          if (current === text) {
            if (previous === null) await rm(draftFile)
            else await writeFileAtomic(draftFile, previous, { mode: 0o600 })
          }
          await rm(target, { recursive: true, force: true })
          throw error
        }
        return { ...metadata, directory: join(target, 'materials'), status: 'ready' }
      }, true)
    } finally {
      this.#activeStaging.delete(staging)
      if (!journaled) await rm(staging, { recursive: true, force: true })
    }
  }
  reconcile(): Promise<{
    workspaceId: string
    versions: (EnvironmentVersion | UnavailableVersion)[]
    abandoned: string[]
  }> {
    return this.#exclusive(() => this.#reconcile())
  }
  async #reconcile() {
    await this.#assertOwner()
    const versions: any[] = await this.listVersions()
    for (const version of versions) {
      if (version.status !== 'ready' || !version.adopted || this.#external.has(version.versionId)) continue
      if (!this.#options.acquireMaterials) {
        version.status = 'unavailable'
        version.reason = 'MATERIAL_OWNER_REQUIRED'
        continue
      }
      const release = await this.#options.acquireMaterials(version.directory, version.versionId)
      if (typeof release !== 'function') throw contentError('MATERIAL_OWNER_REQUIRED')
      this.#external.set(version.versionId, release)
    }
    const abandoned = []
    const pendingImports = new Set((await this.#importIntents()).map(x => `import-${x.versionId.replaceAll('-', '')}`))
    for (const name of await readdir(join(this.root, 'staging'))) {
      const info = await lstat(join(this.root, 'staging', name))
      if (info.isSymbolicLink()) throw contentError('WORKSPACE_PATH_INVALID')
      if (
        !pendingImports.has(name) &&
        !this.#activeStaging.has(join(this.root, 'staging', name)) &&
        Date.now() - info.mtimeMs >= (this.#options.stagingRetentionMs ?? 24 * 3600 * 1000)
      )
        abandoned.push(name)
    }
    return { workspaceId: this.workspaceId, versions, abandoned }
  }
  cleanupStaging(): Promise<string[]> {
    return this.#exclusive(async () => {
      const { abandoned } = await this.#reconcile()
      const removed = []
      for (const name of abandoned) {
        if (!/^(?:(?:import|restore|deleted|prepare)-)?[a-f0-9-]+$/.test(name)) continue
        const path = join(this.root, 'staging', name)
        if (this.#activeStaging.has(path)) continue
        await rm(path, { recursive: true, force: true })
        removed.push(name)
      }
      return removed
    }, true)
  }
  close({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (this.#closed) return Promise.resolve()
    if (this.#closePromise) return this.#closePromise
    if (this.#leases.size && !force) return Promise.reject(contentError('WORKSPACE_IN_USE'))
    this.#closePromise = this.#close()
    return this.#closePromise
  }
  async #close() {
    if (this.#closed) return
    this.#closing = true
    this.#snapshotGeneration++
    this.#snapshotObservations = undefined
    this.#controller.abort(contentError('WORKSPACE_CLOSED'))
    await Promise.allSettled([...this.#pending])
    await this.#queue
    this.#leases.clear()
    for (const release of this.#external.values()) await release()
    this.#external.clear()
    await withSourceLock(this.root, 'workspace-owner', async () => {
      const file = join(this.root, 'workspace-owner.json')
      const owner = await readJson(file).catch(error => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (owner?.bootId === this.bootId) await rm(file)
    })
    this.#closed = true
  }
}

export const ContentWorkspace: ContentWorkspaceConstructor = ContentWorkspaceImplementation

/** Change desired roots only. Resolved material and all published versions remain immutable. */
export async function setEnvironmentPackageEnabled(
  workspace: Pick<ContentWorkspace, 'listDrafts' | 'listVersions' | 'saveDraft'>,
  input: { environmentId: string; expectedRevision: string; name: string; enabled: boolean; cascade?: boolean },
): Promise<EnvironmentDraft> {
  const { environmentId, expectedRevision, name, enabled, cascade = false } = input
  if (typeof name !== 'string' || typeof enabled !== 'boolean' || typeof cascade !== 'boolean')
    throw contentError('ENVIRONMENT_PACKAGE_INVALID')
  const draft = (await workspace.listDrafts()).find(item => item.document.id === environmentId)
  if (!draft) throw contentError('ENVIRONMENT_NOT_FOUND')
  if (draft.revision !== expectedRevision) throw contentError('REVISION_CONFLICT')
  const document = structuredClone(draft.document)
  const disabled = document.disabled ?? { packages: {}, sources: [] }
  document.disabled = disabled
  const active = new Set([...Object.keys(document.packages), ...document.sources])
  if (enabled) {
    if (active.has(name)) return draft
    if (Object.hasOwn(disabled.packages, name)) {
      document.packages[name] = disabled.packages[name]
      delete disabled.packages[name]
    } else if (disabled.sources.includes(name)) {
      document.sources.push(name)
      disabled.sources = disabled.sources.filter(value => value !== name)
    } else throw contentError('ENVIRONMENT_PACKAGE_NOT_FOUND')
  } else {
    const version: any = ((await workspace.listVersions()) as any[])
      .filter(item => item.status === 'ready' && item.environmentId === environmentId && item.members)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    // A graph captured for different roots/ranges cannot justify disabling a shared dependency.
    if (
      !version ||
      Object.entries(document.packages).some(([key, range]) => version.document.packages[key] !== range) ||
      document.sources.some(key => !version.document.sources.includes(key))
    )
      throw contentError('ENVIRONMENT_DEPENDENCIES_UNRESOLVED', '先准备当前组合，再调整依赖的启用状态')
    const affected = new Set([name])
    for (let changed = true; changed;) {
      changed = false
      for (const member of version.members)
        if (!affected.has(member.name) && member.dependencies.some(dep => affected.has(dep))) {
          affected.add(member.name)
          changed = true
        }
    }
    const roots = [...active].filter(key => affected.has(key))
    if (!roots.length) throw contentError('ENVIRONMENT_PACKAGE_NOT_FOUND')
    if (!cascade && roots.some(key => key !== name))
      throw contentError(
        'ENVIRONMENT_PACKAGE_REQUIRED',
        `仍被这些资源包依赖：${roots.filter(key => key !== name).join('、')}`,
      )
    for (const key of roots) {
      if (Object.hasOwn(document.packages, key)) {
        disabled.packages[key] = document.packages[key]
        delete document.packages[key]
      } else {
        disabled.sources.push(key)
        document.sources = document.sources.filter(value => value !== key)
      }
    }
  }
  return workspace.saveDraft({ document, expectedRevision })
}
