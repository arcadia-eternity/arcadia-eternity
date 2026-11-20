import {
  sha256Hex,
  skillParameterCatalogSchema,
  type SkillParameterCatalog,
  readElementCatalog,
  type ElementCatalogInput,
} from '@arcadia-eternity/const'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import semver from 'semver'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import {
  normalizeEnvironmentDocument,
  EnvironmentDocumentV2Schema,
  EnvironmentRulesSchema,
  EnvironmentRuleDeclarationSchema,
  type EnvironmentDocumentV2,
} from './debug-environments.ts'
import { z } from 'zod'
import { withSourceLock } from './source-lock.ts'
import { contentError, readJson, materialFiles, writeMaterials } from './workspace-materials.ts'
import { errorCode, isRecord, type UnknownRecord } from './types.ts'

import {
  compactMaterials,
  expandSharedMaterials,
  exportDependencies,
  type ArchiveReference,
} from './environment-sharing.ts'
import { environmentShareMaterials, hostBaseName } from './environment-host-base.ts'
export { copyEnvironmentMember } from './environment-member-transfer.ts'
import { parseManifestDraft, preparedDocument } from './prepared-document.ts'
export { readInstalledEnvironmentDocument } from './prepared-document.ts'
export { normalizeEnvironmentDocument } from './debug-environments.ts'
export type { EnvironmentRules } from './debug-environments.ts'
export type EnvironmentDocument = EnvironmentDocumentV2
export interface EnvironmentDraft {
  document: EnvironmentDocument
  revision: string
}
function hasHostBase(document: EnvironmentDocument) {
  return Object.hasOwn(document.packages, hostBaseName) || document.sources.includes(hostBaseName)
}
function assertBaseRetained(before: EnvironmentDocument | undefined, after: EnvironmentDocument) {
  if (before && hasHostBase(before) && !hasHostBase(after))
    throw contentError('ENVIRONMENT_BASE_REQUIRED', '环境必须保留官方基础包。')
}
const compositionSchema = z
  .object({
    rules: EnvironmentRulesSchema,
    requiredCapabilities: z.array(z.string()).optional(),
    fields: z.array(
      z.object({
        path: z.array(z.string()),
        value: z.unknown(),
        sources: z.array(z.string()),
        effectiveSources: z.array(z.string()),
      }),
    ),
    ruleSets: z.array(z.object({ id: z.string(), name: z.string(), rules: EnvironmentRuleDeclarationSchema })),
  })
  .strict()
const contentChoices = z.array(z.object({ id: z.string(), name: z.string().optional() }))
const contentCatalogSchema = z.object({
  species: contentChoices,
  skills: contentChoices,
  marks: contentChoices,
  stages: contentChoices,
})
type EnvironmentContentCatalog = z.infer<typeof contentCatalogSchema>
export type PreparedRuleComposition = z.infer<typeof compositionSchema>

export interface EnvironmentInstallation {
  format: 'arcadia.environment-installation/1'
  installationId: string
  workspaceId: string
  environmentId: string
  document: EnvironmentDocument
  draftRevision: string
  contentRevision: string
  ruleComposition?: PreparedRuleComposition
  skillParameters?: SkillParameterCatalog
  contentCatalog?: EnvironmentContentCatalog
  elementCatalog?: ReturnType<typeof readElementCatalog>
  members?: EnvironmentMember[]
  packages: unknown[]
  createdAt: number
  materialDirectory: string
  directory: string
  status: 'ready'
}
export interface UnavailableInstallation {
  installationId: string
  workspaceId: string
  environmentId?: string
  status: 'unavailable'
  reason: string
}
export interface PrepareEnvironmentInput {
  onProgress?: (progress: { stage: string; completed?: number; total?: number }) => void | Promise<void>
  environmentId: string
  expectedRevision: string | null
  document?: EnvironmentDocument
  projectDirectory?: string
  seedDirectory?: string
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
  ruleComposition?: PreparedRuleComposition
  skillParameters?: SkillParameterCatalog
  contentCatalog?: EnvironmentContentCatalog
  elementCatalog?: ReturnType<typeof readElementCatalog>
}>
export interface ContentWorkspaceOptions {
  allowShareDownloads?: boolean
  bundledPackageRoot?: string
  npmCache?: string
  maxBytes?: number
  maxFiles?: number
  stagingRetentionMs?: number
  resolveProject?: (environmentId: string) => string | undefined | Promise<string | undefined>
  retentions?: {
    list(installationId: string): Promise<Record<string, unknown>[]>
    put?(installationId: string, retentionId: string): Promise<void>
    remove?(retentionId: string): Promise<void>
  }
}
export const exportSelectionSchema = z
  .object({
    revision: z.string().min(1),
    locations: z.array(z.string().min(1)).max(50000),
  })
  .strict()
export type EnvironmentExportSelection = z.infer<typeof exportSelectionSchema>
export type EnvironmentExportMode = 'share' | 'offline' | EnvironmentExportSelection
export interface EnvironmentExportPreview {
  revision: string
  dependencies: ReturnType<typeof exportDependencies>
}
function exportRevision(draft: string, content: string, dependencies: EnvironmentExportPreview['dependencies']) {
  return sha256Hex(JSON.stringify([draft, content, dependencies]))
}
// Only the lock and external references are needed to check the receiving workspace.
export interface EnvironmentImportProbe {
  lock: { path: string; data: string }
  archives: ArchiveReference[]
}
export interface EnvironmentExport {
  format: 'arcadia.environment-export/2' | 'arcadia.environment-export/3' | 'arcadia.environment-export/4'
  suppliedArchives?: Record<string, string>
  archives?: ArchiveReference[]
  document: EnvironmentDocument
  contentRevision: string
  files: { path: string; data: string }[]
}
export interface WorkspaceSnapshot {
  format: 'arcadia.workspace-snapshot/2'
  builtinEnvironmentAliases?: Readonly<Record<string, string>>
  builtinEnvironmentIds?: Readonly<Record<string, string>>
  workspaceId: string
  drafts: (EnvironmentDraft & { files?: { path: string; data: string }[] })[]
  installations: {
    version: Pick<
      EnvironmentInstallation,
      'installationId' | 'environmentId' | 'document' | 'draftRevision' | 'contentRevision' | 'packages' | 'createdAt'
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
  readonly builtinEnvironmentAliases?: Readonly<Record<string, string>>
  readonly builtinEnvironmentIds?: Readonly<Record<string, string>>
  listDrafts(): Promise<EnvironmentDraft[]>
  getDraft(environmentId: string): Promise<EnvironmentDraft>
  saveDraft(input: { document: unknown; expectedRevision: string | null }): Promise<EnvironmentDraft>
  deleteDraft(input: { environmentId: string; expectedRevision: string }): Promise<void>
  prepareEnvironment(input: PrepareEnvironmentInput, preparer: StaticPreparer): Promise<EnvironmentInstallation>
  getInstallation(installationId: string): Promise<EnvironmentInstallation>
  listInstallations(environmentId?: string): Promise<(EnvironmentInstallation | UnavailableInstallation)[]>
  acquire(installationId: string, owner?: string): Promise<EnvironmentInstallation & { release(): Promise<void> }>
  retain(installationId: string, retentionId: string): Promise<void>
  releaseRetention(retentionId: string): Promise<void>
  clearInstallation(installationId: string): Promise<void>
  previewEnvironmentExport(installationId: string): Promise<EnvironmentExportPreview>
  missingEnvironmentArchives(probe: EnvironmentImportProbe): Promise<string[]>
  exportEnvironment(installationId: string, mode?: EnvironmentExportMode): Promise<EnvironmentExport>
  exportSnapshot(): Promise<WorkspaceSnapshot>
  captureSnapshot(): Promise<WorkspaceSnapshotCapture>
  isSnapshotCurrent(stamp: WorkspaceSnapshotStamp): Promise<boolean>
  restoreSnapshot(
    snapshot: WorkspaceSnapshot,
    input: { mode: 'restore' | 'clone' },
    preparer: StaticPreparer,
  ): Promise<{ workspaceId: string; installationIds: Record<string, string> }>
  importEnvironment(
    bundle: EnvironmentExport,
    input: {
      environmentId?: string
      expectedRevision?: string | null
      signal?: AbortSignal
      beforeCommit?: () => Promise<void>
      importId?: string
      allowDownload?: boolean
    },
    preparer: StaticPreparer,
  ): Promise<EnvironmentInstallation>
  recoverImport(importId: string): Promise<EnvironmentInstallation>
  forgetImport(importId: string, input?: { discard?: boolean }): Promise<void>
  reconcile(): Promise<{
    workspaceId: string
    installations: (EnvironmentInstallation | UnavailableInstallation)[]
    abandoned: string[]
  }>
  close(input?: { force?: boolean }): Promise<void>
  cleanupStaging(): Promise<string[]>
}
export interface OwnedContentWorkspace extends ContentWorkspace {
  registerBuiltinEnvironments(
    keys: string[],
    adopted: Record<string, string>,
  ): Promise<Readonly<Record<string, string>>>
}
export interface ContentWorkspaceConstructor {
  new (root: string, options?: ContentWorkspaceOptions): ContentWorkspace
  open(directory: string, options?: ContentWorkspaceOptions): Promise<OwnedContentWorkspace>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const envId = /^[a-z0-9][a-z0-9_-]{0,79}$/
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const checkId = (id: unknown, pattern = uuid): string => {
  if (typeof id !== 'string' || !pattern.test(id)) throw contentError('RESOURCE_ID_INVALID')
  return id
}
// 4.8.0 wrote a single slot in both workspace metadata and backups.
function readBuiltinEnvironmentIds(value: object): Record<string, string> {
  if ('builtinEnvironmentIds' in value && value.builtinEnvironmentIds !== undefined) {
    const entries = value.builtinEnvironmentIds
    if (!isRecord(entries)) throw contentError('WORKSPACE_FORMAT_INVALID')
    const ids = Object.entries(entries).map(([key, id]) => [checkId(key, envId), checkId(id, envId)] as const)
    if (new Set(ids.map(([, id]) => id)).size !== ids.length) throw contentError('WORKSPACE_FORMAT_INVALID')
    return Object.fromEntries(ids)
  }
  return 'builtin120EnvironmentId' in value && value.builtin120EnvironmentId !== undefined
    ? { 'training-120': checkId(value.builtin120EnvironmentId, new RegExp('^builtin-120-' + uuid.source.slice(1))) }
    : {}
}
function readBuiltinEnvironmentAliases(value: object): Record<string, string> {
  if (!('builtinEnvironmentAliases' in value)) return {}
  if (!isRecord(value.builtinEnvironmentAliases)) throw contentError('WORKSPACE_FORMAT_INVALID')
  return Object.fromEntries(
    Object.entries(value.builtinEnvironmentAliases).map(([oldId, id]) => [checkId(oldId, envId), checkId(id, envId)]),
  )
}
async function regularDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw contentError('WORKSPACE_PATH_INVALID')
}

export interface EnvironmentMember {
  archiveIntegrity?: string
  name: string
  version: string
  projectId: string
  namespace: string
  direct: boolean
  dependencies: string[]
  requiredBy: string[]
}

interface PreparationResult {
  ruleComposition?: PreparedRuleComposition
  skillParameters?: SkillParameterCatalog
  contentCatalog?: EnvironmentContentCatalog
  elementCatalog?: ReturnType<typeof readElementCatalog>
  contentRevision: string
  packages: unknown[]
  members: EnvironmentMember[]
}

async function checkedPreparation(
  result: unknown,
  document: EnvironmentDocument,
  directory: string,
): Promise<PreparationResult> {
  if (
    !isRecord(result) ||
    typeof result.contentRevision !== 'string' ||
    !result.contentRevision ||
    !(result.packages === undefined || Array.isArray(result.packages))
  )
    throw contentError('STATIC_PREPARATION_INVALID')
  const packages: unknown[] = Array.isArray(result.packages) ? result.packages : []
  const inspection = await inspectNpmProject(directory)
  for (const [name, range] of Object.entries(document.packages)) {
    const matches = inspection.packages.filter(pkg => isRecord(pkg) && pkg.name === name)
    if (
      (!semver.validRange(range) && !/^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(range)) ||
      !matches.some(pkg => {
        if (!isRecord(pkg) || typeof pkg.version !== 'string') return false
        return (
          semver.valid(pkg.version) !== null &&
          (range.startsWith('file:candidates/') || semver.satisfies(pkg.version, range))
        )
      })
    )
      throw contentError('ENVIRONMENT_PACKAGE_MISMATCH', `Prepared packages do not satisfy ${name}@${range}`)
  }
  for (const name of document.sources)
    if (!inspection.packages.some(pkg => isRecord(pkg) && pkg.name === name))
      throw contentError('ENVIRONMENT_SOURCE_MISSING', name)
  return {
    contentRevision: result.contentRevision,
    packages,
    ...(result.contentCatalog !== undefined && { contentCatalog: contentCatalogSchema.parse(result.contentCatalog) }),
    ...(result.ruleComposition !== undefined && { ruleComposition: compositionSchema.parse(result.ruleComposition) }),
    ...(result.skillParameters !== undefined && {
      skillParameters: skillParameterCatalogSchema.parse(result.skillParameters),
    }),
    ...(isRecord(result.elementCatalog) && {
      elementCatalog: readElementCatalog(result.elementCatalog as ElementCatalogInput),
    }),
    members: (inspection.members ?? []) as EnvironmentMember[],
  }
}

function activeProcess(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false
    if (errorCode(error) === 'EPERM') return true
    throw error
  }
}

/** One write owner publishes prepared documents alongside the locked npm materials. */
class ContentWorkspaceImplementation implements OwnedContentWorkspace {
  readonly root: string
  readonly bootId = randomUUID()
  workspaceId!: string
  builtinEnvironmentAliases: Readonly<Record<string, string>> = {}
  builtinEnvironmentIds: Readonly<Record<string, string>> = {}
  #queue: Promise<unknown> = Promise.resolve()
  #closed = false
  #controller = new AbortController()
  #options: ContentWorkspaceOptions
  #leases = new Map<string, { installationId: string; owner: string }>()
  #snapshotGeneration = 0
  #snapshotFingerprint?: string
  constructor(root: string, options: ContentWorkspaceOptions = {}) {
    this.root = root
    this.#options = options
  }
  static async open(directory: string, options: ContentWorkspaceOptions = {}): Promise<OwnedContentWorkspace> {
    await regularDirectory(resolve(directory))
    const root = await realpath(directory)
    const workspace = new ContentWorkspaceImplementation(root, options)
    await withSourceLock(root, 'workspace-owner', async () => {
      const file = join(root, 'workspace-owner.json')
      const owner = await readJson<{ pid: number }>(file).catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return undefined
      })
      if (owner && activeProcess(owner.pid)) throw contentError('WORKSPACE_BUSY')
      await writeFileAtomic(file, json({ pid: process.pid, bootId: workspace.bootId }))
    })
    try {
      for (const name of ['environments', 'staging', 'imports']) await regularDirectory(join(root, name))
      const file = join(root, 'workspace.json')
      const metadata = await readJson(file).catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return undefined
      })
      if (metadata) {
        if (metadata.format !== 'arcadia.content-workspace/2') throw contentError('WORKSPACE_FORMAT_INVALID')
        workspace.workspaceId = checkId(metadata.workspaceId, uuid)
      } else {
        workspace.workspaceId = randomUUID()
      }
      workspace.builtinEnvironmentAliases = readBuiltinEnvironmentAliases(metadata ?? {})
      workspace.builtinEnvironmentIds = readBuiltinEnvironmentIds(metadata ?? {})
      if (!metadata || 'builtin120EnvironmentId' in metadata) await workspace.#saveMetadata()
      // Recover an interrupted directory replacement before exposing projects.
      for (const name of await readdir(join(root, 'staging'))) {
        if (!name.startsWith('replaced-') || !envId.test(name.slice(9))) continue
        const previous = join(root, 'staging', name)
        const target = workspace.#directory(name.slice(9))
        const current = await lstat(target).catch(error => {
          if (errorCode(error) !== 'ENOENT') throw error
          return undefined
        })
        if (current) await rm(previous, { recursive: true })
        else await rename(previous, target)
      }
      return workspace
    } catch (error) {
      await workspace.close({ force: true })
      throw error
    }
  }
  registerBuiltinEnvironments(keys: string[], adopted: Record<string, string>) {
    return this.#exclusive(async () => {
      const ids = readBuiltinEnvironmentIds({ builtinEnvironmentIds: Object.fromEntries(keys.map(key => [key, key])) })
      const aliases = { ...this.builtinEnvironmentAliases }
      const retiring = new Map<string, string>()
      for (const key of keys) {
        const previous = Object.hasOwn(this.builtinEnvironmentIds, key)
          ? this.builtinEnvironmentIds[key]
          : Object.hasOwn(adopted, key)
            ? adopted[key]
            : undefined
        if (previous === key) continue
        // An unregistered custom draft may already own the requested ID.
        if (
          await lstat(this.#directory(key)).catch(error => {
            if (errorCode(error) !== 'ENOENT') throw error
            return undefined
          })
        )
          throw contentError('BUILTIN_ENVIRONMENT_ID_CONFLICT', key)
        if (previous !== undefined) {
          checkId(previous, envId)
          if (Object.hasOwn(ids, previous)) throw contentError('BUILTIN_ENVIRONMENT_ID_CONFLICT', previous)
          retiring.set(previous, key)
        }
      }
      for (const [oldId, id] of retiring) {
        // Preserve the previous installation intact. A restart can repeat this step before the metadata commits.
        const archive = join(this.root, 'migration-backups')
        await regularDirectory(archive)
        await rename(this.#directory(oldId), join(archive, oldId)).catch(error => {
          if (errorCode(error) !== 'ENOENT') throw error
        })
        aliases[oldId] = id
      }
      if (!isDeepStrictEqual(ids, this.builtinEnvironmentIds) || retiring.size) {
        await this.#saveMetadata(ids, aliases)
        this.builtinEnvironmentIds = ids
        this.builtinEnvironmentAliases = aliases
      }
      return ids
    }, true)
  }
  async #saveMetadata(ids = this.builtinEnvironmentIds, aliases = this.builtinEnvironmentAliases) {
    await writeFileAtomic(
      join(this.root, 'workspace.json'),
      json({
        format: 'arcadia.content-workspace/2',
        workspaceId: this.workspaceId,
        builtinEnvironmentIds: ids,
        ...(Object.keys(aliases).length && { builtinEnvironmentAliases: aliases }),
      }),
    )
  }
  async #assertOwner() {
    if (this.#closed) throw contentError('WORKSPACE_CLOSED')
    const owner = await readJson(join(this.root, 'workspace-owner.json'))
    if (owner.bootId !== this.bootId || owner.pid !== process.pid) throw contentError('WORKSPACE_OWNERSHIP_LOST')
  }
  #exclusive<T>(action: () => Promise<T>, mutation = false): Promise<T> {
    const result = this.#queue.then(async () => {
      await this.#assertOwner()
      if (mutation) {
        this.#snapshotGeneration++
        this.#snapshotFingerprint = undefined
      }
      return action()
    })
    this.#queue = result.catch(() => {})
    return result
  }
  #directory(id: string) {
    return join(this.root, 'environments', checkId(id, envId))
  }
  async #archiveRemovedDeclarations(id: string) {
    const text = await readFile(join(this.#directory(id), 'package.json'), 'utf8').catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error
      return undefined
    })
    if (!text || !Object.hasOwn(JSON.parse(text).arcadiaEnvironment ?? {}, 'disabled')) return
    const archive = join(this.root, 'migration-backups')
    await regularDirectory(archive)
    await writeFileAtomic(join(archive, `${id}-${sha256Hex(text)}.json`), text)
  }
  #manifest(document: EnvironmentDocument, previous: UnknownRecord = {}): UnknownRecord {
    const { packages, ...metadata } = document
    const priorDependencies = isRecord(previous.dependencies) ? previous.dependencies : {}
    return {
      ...previous,
      name: typeof previous.name === 'string' ? previous.name : `arcadia-environment-${document.id}`,
      version: typeof previous.version === 'string' ? previous.version : '1.0.0',
      private: true,
      dependencies: {
        ...packages,
        ...Object.fromEntries(
          document.sources.flatMap(name =>
            typeof priorDependencies[name] === 'string' ? [[name, priorDependencies[name]]] : [],
          ),
        ),
      },
      arcadiaEnvironment: metadata,
    }
  }
  async #draft(id: string): Promise<EnvironmentDraft> {
    const directory = this.#directory(id)
    if ((await realpath(directory)) !== directory) throw contentError('WORKSPACE_PATH_INVALID')
    await readJson(join(directory, 'package.json'))
    const text = await readFile(join(this.#directory(id), 'package.json'), 'utf8')
    const draft = parseManifestDraft(text)
    if (draft.document.id !== id) throw contentError('ENVIRONMENT_ID_MISMATCH')
    return draft
  }
  listDrafts() {
    return this.#exclusive(() => this.#listDrafts())
  }
  async #listDrafts() {
    await this.#assertOwner()
    const results: EnvironmentDraft[] = []
    for (const id of (await readdir(join(this.root, 'environments'))).sort()) {
      if (envId.test(id)) results.push(await this.#draft(id))
    }
    return results
  }
  getDraft(id: string) {
    return this.#exclusive(() => this.#draft(id))
  }
  saveDraft(input: { document: unknown; expectedRevision: string | null }) {
    return this.#exclusive(async () => {
      const document = normalizeEnvironmentDocument(input.document)
      const directory = this.#directory(document.id)
      const file = join(directory, 'package.json')
      const previous = await readFile(file, 'utf8').catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return null
      })
      if ((previous === null ? null : sha256Hex(previous)) !== input.expectedRevision)
        throw contentError('REVISION_CONFLICT')
      if (previous !== null) assertBaseRetained(parseManifestDraft(previous).document, document)
      await regularDirectory(directory)
      await this.#archiveRemovedDeclarations(document.id)
      if (previous !== null) {
        const receiptFile = join(directory, '.arcadia-prepared.json')
        const receipt = await readJson(receiptFile).catch(error => {
          if (errorCode(error) !== 'ENOENT') throw error
          return undefined
        })
        if (receipt && !receipt.document && receipt.draftRevision === sha256Hex(previous))
          await writeFileAtomic(receiptFile, json({ ...receipt, document: parseManifestDraft(previous).document }))
      }
      await writeFileAtomic(file, json(this.#manifest(document, previous ? JSON.parse(previous) : {})))
      return this.#draft(document.id)
    }, true)
  }
  deleteDraft(input: { environmentId: string; expectedRevision: string }) {
    return this.#exclusive(async () => {
      const current = await this.#draft(input.environmentId)
      if (current.revision !== input.expectedRevision) throw contentError('REVISION_CONFLICT')
      const references = await this.#references(input.environmentId)
      if (references.length) throw Object.assign(contentError('ENVIRONMENT_IN_USE'), { references })
      await rm(this.#directory(input.environmentId), { recursive: true })
    }, true)
  }
  async #installation(id: string): Promise<EnvironmentInstallation> {
    const directory = this.#directory(id)
    const lock = await readJson(join(directory, 'package-lock.json'), 16 * 1024 * 1024)
    await lstat(join(directory, 'node_modules'))
    const metadata = await readJson(join(directory, '.arcadia-prepared.json'))
    if (
      metadata.format !== 'arcadia.environment-installation/1' ||
      metadata.installationId !== id ||
      typeof metadata.contentRevision !== 'string'
    )
      throw contentError('ENVIRONMENT_INSTALLATION_INVALID')
    const document = preparedDocument(
      metadata,
      metadata.document === undefined ? await readFile(join(directory, 'package.json'), 'utf8') : '',
    )
    const locked = isRecord(lock.packages) ? lock.packages : {}
    const members = Array.isArray(metadata.members)
      ? metadata.members.map(member => {
          const entry = locked['node_modules/' + member.name]
          return isRecord(entry) &&
            typeof entry.resolved === 'string' &&
            /^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(entry.resolved) &&
            typeof entry.integrity === 'string' &&
            member.name !== '@arcadia-eternity/data-pack-base'
            ? { ...member, archiveIntegrity: entry.integrity }
            : member
        })
      : undefined
    return {
      ...metadata,
      members,
      installationId: id,
      environmentId: id,
      workspaceId: this.workspaceId,
      document,
      directory,
      materialDirectory: `environments/${id}`,
      status: 'ready',
    } as EnvironmentInstallation
  }
  getInstallation(id: string) {
    return this.#exclusive(() => this.#installation(id))
  }
  listInstallations(environmentId?: string) {
    return this.#exclusive(() => this.#listInstallations(environmentId))
  }
  async #listInstallations(environmentId?: string): Promise<(EnvironmentInstallation | UnavailableInstallation)[]> {
    await this.#assertOwner()
    const drafts = environmentId ? [await this.#draft(environmentId)] : await this.#listDrafts()
    const results: (EnvironmentInstallation | UnavailableInstallation)[] = []
    for (const { document } of drafts) {
      try {
        results.push(await this.#installation(document.id))
      } catch (error) {
        if (errorCode(error) !== 'ENOENT')
          results.push({
            installationId: document.id,
            environmentId: document.id,
            workspaceId: this.workspaceId,
            status: 'unavailable',
            reason: errorCode(error) ?? 'ENVIRONMENT_INSTALLATION_INVALID',
          })
      }
    }
    return results
  }
  prepareEnvironment(input: PrepareEnvironmentInput, preparer: StaticPreparer) {
    return this.#exclusive(async () => {
      const draft = await this.#draft(input.environmentId).catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return undefined
      })
      if ((draft?.revision ?? null) !== input.expectedRevision) throw contentError('REVISION_CONFLICT')
      const document = normalizeEnvironmentDocument(input.document ?? draft?.document)
      if (document.id !== input.environmentId) throw contentError('ENVIRONMENT_ID_MISMATCH')
      assertBaseRetained(draft?.document, document)
      const source =
        input.projectDirectory ??
        input.directory ??
        input.seedDirectory ??
        (await this.#options.resolveProject?.(input.environmentId)) ??
        this.#directory(input.environmentId)
      return this.#install(document, source, preparer, input)
    }, true)
  }
  async #install(
    document: EnvironmentDocument,
    source: string,
    preparer: StaticPreparer,
    input: Pick<PrepareEnvironmentInput, 'signal' | 'beforeCommit' | 'onProgress'> & {
      importId?: string
      expectedRevision?: string | null
      importing?: boolean
    } = {},
  ) {
    const signal = input.signal ? AbortSignal.any([input.signal, this.#controller.signal]) : this.#controller.signal
    signal.throwIfAborted()
    const staging = join(this.root, 'staging', `prepare-${randomUUID()}`)
    const target = this.#directory(document.id)
    const previous = join(this.root, 'staging', `replaced-${document.id}`)
    await mkdir(staging)
    let moved = false
    let journaled = false
    try {
      await input.onProgress?.({ stage: 'preparing' })
      const limits = { ...this.#options, signal }
      let materials = await materialFiles(source, limits)
      if (input.importing) {
        const restored = await environmentShareMaterials(materials, document, limits)
        materials = restored.files
        document = restored.document
      }
      await writeMaterials(staging, materials, limits)
      const manifest = await readJson(join(staging, 'package.json'))
      if (hasHostBase(document)) {
        const installed = await readJson(join(staging, 'node_modules', hostBaseName, 'package.json'))
        if (typeof installed.version !== 'string') throw contentError('BUNDLED_PACKAGE_INVALID')
        document = {
          ...document,
          packages: { ...document.packages, [hostBaseName]: installed.version },
          sources: document.sources.filter(name => name !== hostBaseName),
        }
      }
      await writeFile(
        join(staging, 'package.json'),
        json({ ...this.#manifest(document, manifest), dependencies: manifest.dependencies ?? {} }),
      )
      const result = await checkedPreparation(
        await preparer({ directory: staging, draft: document, signal }),
        document,
        staging,
      )
      const text = await readFile(join(staging, 'package.json'), 'utf8')
      await writeFile(
        join(staging, '.arcadia-prepared.json'),
        json({
          format: 'arcadia.environment-installation/1',
          installationId: document.id,
          document,
          draftRevision: sha256Hex(text),
          contentRevision: result.contentRevision,
          packages: result.packages,
          members: result.members,
          ruleComposition: result.ruleComposition,
          skillParameters: result.skillParameters,
          contentCatalog: result.contentCatalog,
          elementCatalog: result.elementCatalog,
          createdAt: Date.now(),
          ...(input.importId ? { importId: input.importId } : {}),
        }),
      )
      signal.throwIfAborted()
      if (input.importId) {
        checkId(input.importId, /^[a-f0-9]{64}$/)
        const receipt = join(this.root, 'imports', input.importId + '.json')
        await writeFile(
          receipt,
          json({
            environmentId: document.id,
            staging: staging.slice(staging.lastIndexOf('/') + 1),
            expectedRevision: input.expectedRevision ?? null,
            completed: false,
          }),
          { flag: 'wx' },
        )
        journaled = true
      }
      await input.beforeCommit?.()
      signal.throwIfAborted()
      await this.#archiveRemovedDeclarations(document.id)
      if (input.importId) return this.#finishImport(input.importId)
      try {
        await rename(target, previous)
        moved = true
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
      try {
        await rename(staging, target)
      } catch (error) {
        if (moved) await rename(previous, target)
        throw error
      }
      await rm(previous, { recursive: true, force: true })
      return this.#installation(document.id)
    } finally {
      if (!journaled) await rm(staging, { recursive: true, force: true })
    }
  }
  acquire(id: string, owner = 'runtime') {
    return this.#exclusive(async () => {
      const installation = await this.#installation(id)
      const token = randomUUID()
      const directory = join(this.root, 'staging', `read-${token}`)
      await mkdir(directory)
      try {
        await writeMaterials(directory, await materialFiles(installation.directory, this.#options), this.#options)
      } catch (error) {
        await rm(directory, { recursive: true, force: true })
        throw error
      }
      this.#leases.set(token, { installationId: id, owner })
      return {
        ...installation,
        directory,
        release: async () => {
          await rm(directory, { recursive: true, force: true })
          this.#leases.delete(token)
        },
      }
    })
  }
  retain(id: string, retentionId: string) {
    return this.#exclusive(async () => {
      await this.#draft(id)
      if (!this.#options.retentions?.put) throw contentError('RETENTION_UNAVAILABLE')
      await this.#options.retentions.put(id, retentionId)
    })
  }
  releaseRetention(retentionId: string) {
    return this.#exclusive(async () => {
      await this.#options.retentions?.remove?.(retentionId)
    })
  }
  async #references(id: string): Promise<Record<string, unknown>[]> {
    checkId(id, envId)
    return [
      ...[...this.#leases.values()].filter(x => x.installationId === id).map(x => ({ kind: 'runtime', ...x })),
      ...((await this.#options.retentions?.list(id)) ?? []).map(x => ({ kind: 'retention', ...x })),
    ]
  }
  clearInstallation(id: string) {
    return this.#exclusive(async () => {
      const references = await this.#references(id)
      if (references.length) throw Object.assign(contentError('ENVIRONMENT_IN_USE'), { references })
      const directory = this.#directory(id)
      await rm(join(directory, 'node_modules'), { recursive: true, force: true })
      await rm(join(directory, '.arcadia-prepared.json'), { force: true })
    }, true)
  }
  async #exportVersion(id: string) {
    const draft = await this.#draft(id)
    const installation = await this.#installation(id)
    if (installation.draftRevision !== draft.revision)
      throw contentError('ENVIRONMENT_PREPARATION_REQUIRED', '环境已修改，请先准备环境再导出')
    return { draft, installation }
  }
  async #shareFiles(id: string, document: EnvironmentDocument) {
    return environmentShareMaterials(await materialFiles(this.#directory(id), this.#options), document)
  }
  previewEnvironmentExport(id: string) {
    return this.#exclusive(async () => {
      const { draft, installation } = await this.#exportVersion(id)
      const lock = await readJson(join(this.#directory(id), 'package-lock.json'), 16 * 1024 * 1024)
      const hasOnline = Object.values(lock.packages ?? {}).some(
        entry => isRecord(entry) && typeof entry.resolved === 'string' && entry.resolved.startsWith('https:'),
      )
      const dependencies = hasOnline ? exportDependencies((await this.#shareFiles(id, draft.document)).files) : []
      return { revision: exportRevision(draft.revision, installation.contentRevision, dependencies), dependencies }
    })
  }
  missingEnvironmentArchives(probe: EnvironmentImportProbe) {
    return this.#exclusive(async () => {
      if (
        probe?.lock?.path !== 'package-lock.json' ||
        !Array.isArray(probe.archives) ||
        probe.archives.length > (this.#options.maxFiles ?? 50000) ||
        probe.archives.some(ref => !ref?.external)
      )
        throw contentError('ENVIRONMENT_EXPORT_INVALID')
      const missing = new Set<string>()
      await expandSharedMaterials([probe.lock], probe.archives, {
        ...this.#options,
        offline: true,
        missing,
        signal: this.#controller.signal,
        environments: join(this.root, 'environments'),
        cache: this.#options.npmCache ?? join(this.root, 'npm-cache'),
      })
      return [...missing]
    })
  }
  async #export(id: string, mode: EnvironmentExportMode): Promise<EnvironmentExport> {
    const { draft, installation } = await this.#exportVersion(id)
    const { contentRevision } = installation
    const shared = await this.#shareFiles(id, draft.document)
    let files = shared.files
    let archives: ArchiveReference[] = []
    if (mode !== 'offline') {
      let locations: string[] = []
      if (mode !== 'share') {
        const selection = exportSelectionSchema.safeParse(mode)
        if (!selection.success) throw contentError('ENVIRONMENT_EXPORT_INVALID')
        if (exportRevision(draft.revision, contentRevision, exportDependencies(files)) !== selection.data.revision)
          throw contentError('REVISION_CONFLICT', '环境已修改，请重新导出')
        locations = selection.data.locations
      }
      const compact = await compactMaterials(files, this.#options, locations)
      files = compact.materials
      archives = compact.archives
    }
    return {
      format: shared.usesBase
        ? 'arcadia.environment-export/4'
        : archives.length
          ? 'arcadia.environment-export/3'
          : 'arcadia.environment-export/2',
      ...(archives.length || shared.usesBase ? { archives } : {}),
      document: shared.document,
      contentRevision,
      files: files.map(({ path, bytes }) => ({ path, data: bytes.toString('base64') })),
    }
  }
  exportEnvironment(id: string, mode: EnvironmentExportMode = 'share') {
    return this.#exclusive(() => this.#export(id, mode))
  }
  async #snapshot(): Promise<WorkspaceSnapshot> {
    for (const name of await readdir(join(this.root, 'imports'))) {
      const receipt = await readJson(join(this.root, 'imports', name))
      if (!receipt.completed) throw contentError('WORKSPACE_SNAPSHOT_UNSETTLED')
    }
    const drafts: WorkspaceSnapshot['drafts'] = await this.#listDrafts()
    const installations: WorkspaceSnapshot['installations'] = []
    for (const draft of drafts) {
      const installed = await this.#installation(draft.document.id).catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return undefined
      })
      if (!installed) {
        draft.files = (
          await materialFiles(this.#directory(draft.document.id), { ...this.#options, allowMissingLock: true })
        ).map(({ path, bytes }) => ({ path, data: bytes.toString('base64') }))
        continue
      }
      const { directory: _dir, materialDirectory: _path, status: _status, ...version } = installed
      const files = await materialFiles(this.#directory(draft.document.id), this.#options)
      installations.push({ version, files: files.map(({ path, bytes }) => ({ path, data: bytes.toString('base64') })) })
    }
    return {
      format: 'arcadia.workspace-snapshot/2',
      workspaceId: this.workspaceId,
      builtinEnvironmentIds: this.builtinEnvironmentIds,
      ...(Object.keys(this.builtinEnvironmentAliases).length && {
        builtinEnvironmentAliases: this.builtinEnvironmentAliases,
      }),
      drafts,
      installations,
    }
  }
  exportSnapshot() {
    return this.#exclusive(() => this.#snapshot())
  }
  captureSnapshot() {
    return this.#exclusive(async () => {
      const snapshot = await this.#snapshot()
      this.#snapshotFingerprint = sha256Hex(json(snapshot))
      const stamp = { workspaceId: this.workspaceId, bootId: this.bootId, generation: ++this.#snapshotGeneration }
      return { snapshot, stamp }
    })
  }
  isSnapshotCurrent(stamp: WorkspaceSnapshotStamp) {
    return this.#exclusive(async () => {
      if (
        stamp.workspaceId !== this.workspaceId ||
        stamp.bootId !== this.bootId ||
        stamp.generation !== this.#snapshotGeneration ||
        !this.#snapshotFingerprint
      )
        return false
      const expected = this.#snapshotFingerprint
      this.#snapshotFingerprint = undefined
      return sha256Hex(json(await this.#snapshot())) === expected
    })
  }
  restoreSnapshot(snapshot: WorkspaceSnapshot, { mode }: { mode: 'restore' | 'clone' }, preparer: StaticPreparer) {
    return this.#exclusive(async () => {
      if (
        snapshot?.format !== 'arcadia.workspace-snapshot/2' ||
        !['restore', 'clone'].includes(mode) ||
        !Array.isArray(snapshot.drafts) ||
        !Array.isArray(snapshot.installations)
      )
        throw contentError('WORKSPACE_SNAPSHOT_INVALID')
      const builtinEnvironmentIds = readBuiltinEnvironmentIds(snapshot)
      const builtinEnvironmentAliases = readBuiltinEnvironmentAliases(snapshot)
      if ((await this.#listDrafts()).length) throw contentError('WORKSPACE_NOT_EMPTY')
      const drafts = new Map(
        snapshot.drafts.map(draft => {
          const document = normalizeEnvironmentDocument(draft.document)
          return [document.id, document]
        }),
      )
      if (drafts.size !== snapshot.drafts.length) throw contentError('WORKSPACE_SNAPSHOT_INVALID')
      const ids = new Set<string>()
      for (const entry of snapshot.installations) {
        const id = entry.version.environmentId
        if (!drafts.has(id) || ids.has(id) || entry.version.installationId !== id)
          throw contentError('WORKSPACE_SNAPSHOT_INVALID')
        ids.add(id)
        const staging = join(this.root, 'staging', `restore-${randomUUID()}`)
        await mkdir(staging)
        try {
          await writeMaterials(staging, entry.files, this.#options)
          // Validate the installed tree against its lock, preserving pending manifest edits.
          const manifestText = await readFile(join(staging, 'package.json'), 'utf8')
          const manifest = JSON.parse(manifestText)
          const lock = await readJson<{ packages: Record<string, { dependencies?: Record<string, string> }> }>(
            join(staging, 'package-lock.json'),
          )
          await writeFile(
            join(staging, 'package.json'),
            json({ ...manifest, dependencies: lock.packages['']?.dependencies ?? {} }),
          )
          const applied = normalizeEnvironmentDocument(entry.version.document)
          if (applied.id !== id) throw contentError('WORKSPACE_SNAPSHOT_INVALID')
          const result = await preparer({ directory: staging, draft: applied })
          await inspectNpmProject(staging)
          await writeFile(join(staging, 'package.json'), manifestText)
          await writeFile(
            join(staging, '.arcadia-prepared.json'),
            json({
              ...entry.version,
              format: 'arcadia.environment-installation/1',
              contentRevision: result.contentRevision,
              packages: result.packages ?? [],
              ruleComposition: result.ruleComposition,
              skillParameters: result.skillParameters,
              contentCatalog: result.contentCatalog,
              elementCatalog: result.elementCatalog,
            }),
          )
          await rename(staging, this.#directory(id))
        } finally {
          await rm(staging, { recursive: true, force: true })
        }
      }
      for (const [id, document] of drafts) {
        if (ids.has(id)) continue
        await regularDirectory(this.#directory(id))
        const saved = snapshot.drafts.find(draft => draft.document.id === id)
        if (!saved?.files) throw contentError('WORKSPACE_SNAPSHOT_INVALID')
        await writeMaterials(this.#directory(id), saved.files, { ...this.#options, allowMissingLock: true })
        if (json((await this.#draft(id)).document) !== json(document)) throw contentError('WORKSPACE_SNAPSHOT_INVALID')
      }
      this.workspaceId = mode === 'restore' ? checkId(snapshot.workspaceId, uuid) : this.workspaceId
      this.builtinEnvironmentAliases = builtinEnvironmentAliases
      this.builtinEnvironmentIds = builtinEnvironmentIds
      await this.#saveMetadata()
      return { workspaceId: this.workspaceId, installationIds: Object.fromEntries([...ids].map(id => [id, id])) }
    }, true)
  }
  importEnvironment(
    bundle: EnvironmentExport,
    input: {
      environmentId?: string
      expectedRevision?: string | null
      signal?: AbortSignal
      beforeCommit?: () => Promise<void>
      importId?: string
      allowDownload?: boolean
    },
    preparer: StaticPreparer,
  ) {
    return this.#exclusive(async () => {
      if (
        !['arcadia.environment-export/2', 'arcadia.environment-export/3', 'arcadia.environment-export/4'].includes(
          bundle?.format,
        )
      )
        throw contentError('ENVIRONMENT_EXPORT_INVALID')
      const document = normalizeEnvironmentDocument({
        ...bundle.document,
        ...(input.environmentId ? { id: input.environmentId } : {}),
      })
      const previous = await this.#draft(document.id).catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return undefined
      })
      if ((previous?.revision ?? null) !== (input.expectedRevision ?? null)) throw contentError('REVISION_CONFLICT')
      assertBaseRetained(previous?.document, document)
      const staging = join(this.root, 'staging', `import-${randomUUID()}`)
      await mkdir(staging)
      try {
        const files =
          bundle.format !== 'arcadia.environment-export/2'
            ? await expandSharedMaterials(bundle.files, bundle.archives!, {
                ...this.#options,
                signal: input.signal
                  ? AbortSignal.any([input.signal, this.#controller.signal])
                  : this.#controller.signal,
                offline: this.#options.allowShareDownloads !== true || input.allowDownload === false,
                environments: join(this.root, 'environments'),
                supplied: bundle.suppliedArchives,
                cache: this.#options.npmCache ?? join(this.root, 'npm-cache'),
              })
            : bundle.files
        await writeMaterials(staging, files, { ...this.#options, signal: input.signal })
        // The recipient owns the captured local archives, including registered ZIP sources.
        const manifest = await readJson(join(staging, 'package.json'))
        const dependencies = manifest.dependencies
        for (const name of [...document.sources]) {
          const spec = isRecord(dependencies) ? dependencies[name] : undefined
          if (typeof spec === 'string' && /^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(spec)) {
            document.packages[name] = spec
            document.sources = document.sources.filter(source => source !== name)
          }
        }
        const result = await this.#install(document, staging, preparer, { ...input, importing: true })
        return result
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    }, true)
  }
  async #finishImport(id: string): Promise<EnvironmentInstallation> {
    checkId(id, /^[a-f0-9]{64}$/)
    const file = join(this.root, 'imports', id + '.json')
    const receipt = await readJson(file)
    const environmentId = checkId(receipt.environmentId, envId)
    if (typeof receipt.staging !== 'string' || !/^prepare-[0-9a-f-]{36}$/.test(receipt.staging))
      throw contentError('IMPORT_INTENT_INVALID')
    const target = this.#directory(environmentId)
    const metadata = await readJson(join(target, '.arcadia-prepared.json')).catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error
      return undefined
    })
    if (receipt.completed || metadata?.importId === id) {
      if (!receipt.completed) await writeFileAtomic(file, json({ ...receipt, completed: true }))
      return this.#installation(environmentId)
    }
    const current = await this.#draft(environmentId).catch(error => {
      if (errorCode(error) !== 'ENOENT') throw error
      return undefined
    })
    if ((current?.revision ?? null) !== receipt.expectedRevision) throw contentError('REVISION_CONFLICT')
    const staging = join(this.root, 'staging', receipt.staging)
    const prepared = await readJson(join(staging, '.arcadia-prepared.json'))
    if (prepared.importId !== id || prepared.installationId !== environmentId)
      throw contentError('IMPORT_INTENT_INVALID')
    await this.#archiveRemovedDeclarations(environmentId)
    const previous = join(this.root, 'staging', `replaced-${environmentId}`)
    let moved = false
    try {
      await rename(target, previous)
      moved = true
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
    try {
      await rename(staging, target)
    } catch (error) {
      if (moved) await rename(previous, target)
      throw error
    }
    await writeFileAtomic(file, json({ ...receipt, completed: true }))
    await rm(previous, { recursive: true, force: true })
    return this.#installation(environmentId)
  }
  recoverImport(id: string) {
    return this.#exclusive(() => this.#finishImport(id), true)
  }
  forgetImport(id: string, { discard = false }: { discard?: boolean } = {}) {
    return this.#exclusive(async () => {
      checkId(id, /^[a-f0-9]{64}$/)
      const file = join(this.root, 'imports', id + '.json')
      const receipt = await readJson(file).catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return undefined
      })
      if (!receipt) return
      if (!receipt.completed && !discard) throw contentError('IMPORT_NOT_COMPLETED')
      if (discard && !receipt.completed) {
        if (typeof receipt.staging !== 'string' || !/^prepare-[0-9a-f-]{36}$/.test(receipt.staging))
          throw contentError('IMPORT_INTENT_INVALID')
        await rm(join(this.root, 'staging', receipt.staging), { recursive: true, force: true })
      }
      await rm(file)
    }, true)
  }
  reconcile() {
    return this.#exclusive(async () => ({
      workspaceId: this.workspaceId,
      installations: await this.#listInstallations(),
      abandoned: await readdir(join(this.root, 'staging')),
    }))
  }
  cleanupStaging() {
    return this.#exclusive(async () => {
      const retained = new Set<string>()
      for (const file of await readdir(join(this.root, 'imports'))) {
        const receipt = await readJson(join(this.root, 'imports', file))
        if (!receipt.completed && typeof receipt.staging === 'string') retained.add(receipt.staging)
      }
      const names: string[] = []
      for (const name of await readdir(join(this.root, 'staging'))) {
        if (name.startsWith('read-') && this.#leases.has(name.slice(5))) continue
        if (retained.has(name) || !/^(?:(?:prepare|import|restore|read)-)?[a-f0-9-]{36}$/.test(name)) continue
        const info = await lstat(join(this.root, 'staging', name))
        if (
          !info.isSymbolicLink() &&
          Date.now() - info.mtimeMs >= (this.#options.stagingRetentionMs ?? 24 * 3600 * 1000)
        )
          names.push(name)
      }
      for (const name of names) await rm(join(this.root, 'staging', name), { recursive: true, force: true })
      return names
    }, true)
  }
  async close({ force = false }: { force?: boolean } = {}) {
    if (this.#closed) return
    if (this.#leases.size && !force) throw contentError('WORKSPACE_IN_USE')
    this.#controller.abort()
    await this.#queue
    this.#closed = true
    await withSourceLock(this.root, 'workspace-owner', async () => {
      const file = join(this.root, 'workspace-owner.json')
      const owner = await readJson(file).catch(() => undefined)
      if (owner?.bootId === this.bootId) await rm(file)
    })
  }
}
export const ContentWorkspace: ContentWorkspaceConstructor = ContentWorkspaceImplementation

/** Change desired roots only. Resolved material and all published installations remain immutable. */
export type AddEnvironmentPackageInput = {
  environmentId: string
  expectedRevision: string
  name: string
  version?: string
  source?: boolean
}
export type RemoveEnvironmentPackageInput = {
  environmentId: string
  expectedRevision: string
  name: string
  cascade?: boolean
}
type PackageWorkspace = Pick<ContentWorkspace, 'listDrafts' | 'listInstallations' | 'saveDraft'>
export function addEnvironmentPackage(workspace: PackageWorkspace, input: AddEnvironmentPackageInput) {
  return changeEnvironmentPackage(workspace, { ...input, action: 'add' })
}
export function removeEnvironmentPackage(workspace: PackageWorkspace, input: RemoveEnvironmentPackageInput) {
  return changeEnvironmentPackage(workspace, { ...input, action: 'remove' })
}
async function changeEnvironmentPackage(
  workspace: PackageWorkspace,
  input: (AddEnvironmentPackageInput & { action: 'add' }) | (RemoveEnvironmentPackageInput & { action: 'remove' }),
): Promise<EnvironmentDraft> {
  const { environmentId, expectedRevision, name } = input
  const cascade = input.action === 'remove' ? (input.cascade ?? false) : false
  if (!EnvironmentDocumentV2Schema.shape.sources.safeParse([name]).success || typeof cascade !== 'boolean')
    throw contentError('ENVIRONMENT_PACKAGE_INVALID')
  if (
    input.action === 'add' &&
    ((input.version !== undefined && (typeof input.version !== 'string' || !input.version.trim())) ||
      (input.source !== undefined && typeof input.source !== 'boolean') ||
      (input.version !== undefined && input.source === true))
  )
    throw contentError('ENVIRONMENT_PACKAGE_INVALID')
  const draft = (await workspace.listDrafts()).find(item => item.document.id === environmentId)
  if (!draft) throw contentError('ENVIRONMENT_NOT_FOUND')
  if (draft.revision !== expectedRevision) throw contentError('REVISION_CONFLICT')
  const document = structuredClone(draft.document)
  const active = new Set([...Object.keys(document.packages), ...document.sources])
  if (input.action === 'add') {
    const version = input.version?.trim()
    if (version !== undefined) {
      document.packages[name] = version
      document.sources = document.sources.filter(value => value !== name)
    } else if (input.source === true) {
      delete document.packages[name]
      if (!document.sources.includes(name)) document.sources.push(name)
    } else throw contentError('ENVIRONMENT_PACKAGE_DECLARATION_REQUIRED', '新增内容包需要指定版本或已登记来源')
  } else {
    const version = (await workspace.listInstallations())
      .filter((item): item is EnvironmentInstallation => item.status === 'ready')
      .filter(item => item.environmentId === environmentId && item.members)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    // A graph captured for different roots/ranges cannot justify removing a shared dependency.
    if (
      !version ||
      Object.entries(document.packages).some(([key, range]) => version.document.packages[key] !== range) ||
      document.sources.some(key => !version.document.sources.includes(key))
    )
      throw contentError('ENVIRONMENT_DEPENDENCIES_UNRESOLVED', '请先准备当前组合，再移出内容包')
    const affected = new Set([name])
    for (let changed = true; changed;) {
      changed = false
      for (const member of version.members ?? [])
        if (!affected.has(member.name) && member.dependencies.some((dep: string) => affected.has(dep))) {
          affected.add(member.name)
          changed = true
        }
    }
    if (affected.has(hostBaseName)) throw contentError('ENVIRONMENT_BASE_REQUIRED', '环境必须保留官方基础包。')
    const roots = [...active].filter(key => affected.has(key))
    if (!roots.length) throw contentError('ENVIRONMENT_PACKAGE_NOT_FOUND')
    if (!cascade && roots.some(key => key !== name))
      throw contentError(
        'ENVIRONMENT_PACKAGE_REQUIRED',
        `仍被这些资源包依赖：${roots.filter(key => key !== name).join('、')}`,
      )
    for (const key of roots) {
      delete document.packages[key]
      document.sources = document.sources.filter(value => value !== key)
    }
  }
  return workspace.saveDraft({ document: normalizeEnvironmentDocument(document), expectedRevision })
}

/** The host supplies this catalog from the application distribution. */
export async function readShippedEnvironments(file: string | URL, bundledVersions: Record<string, string>) {
  const schema = z
    .object({
      defaultEnvironment: z.string(),
      environments: z.array(EnvironmentDocumentV2Schema).min(1),
    })
    .strict()
  const catalog = schema.parse(JSON.parse(await readFile(file, 'utf8')))
  const keys = new Set(catalog.environments.map(doc => doc.id))
  if (keys.size !== catalog.environments.length || !keys.has(catalog.defaultEnvironment))
    throw contentError('SHIPPED_ENVIRONMENT_CATALOG_INVALID')
  for (const { packages } of catalog.environments)
    for (const [name, version] of Object.entries(bundledVersions))
      if (Object.hasOwn(packages, name)) {
        if (!semver.satisfies(version, packages[name])) throw contentError('SHIPPED_PACKAGE_VERSION_MISMATCH')
        packages[name] = version
      }
  return catalog
}

export async function synchronizeShippedEnvironments(
  workspace: OwnedContentWorkspace,
  catalog: Awaited<ReturnType<typeof readShippedEnvironments>>,
  adopted: Record<string, string>,
  prepare: (document: EnvironmentDocument, expectedRevision: string | null) => Promise<unknown>,
) {
  await workspace.registerBuiltinEnvironments(
    catalog.environments.map(doc => doc.id),
    adopted,
  )
  const drafts = await workspace.listDrafts()
  for (const document of catalog.environments) {
    const id = document.id
    const current = drafts.find(item => item.document.id === id)
    if (current && isDeepStrictEqual(current.document, document)) {
      const [installed] = await workspace.listInstallations(id)
      if (installed?.status === 'ready' && installed.draftRevision === current.revision) continue
    }
    await prepare(document, current?.revision ?? null)
  }
  return catalog.defaultEnvironment
}
