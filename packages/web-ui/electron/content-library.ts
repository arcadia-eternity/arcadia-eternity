import semver from 'semver'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { lstatSync, readFileSync } from 'node:fs'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { NpmProjectInspection } from '@arcadia-eternity/pack-loader/node'
import type {
  findPackageUpdate,
  ManagedProjects,
  ManagedProjectsOptions,
} from '@arcadia-eternity/content-sdk/managed-projects'
import type {
  copyEnvironmentMember,
  EnvironmentDocument,
  PrepareEnvironmentInput,
  readOfficialEnvironments,
} from '@arcadia-eternity/content-sdk/management-workspace'
import type {
  ContentIds,
  ContentLibrarySnapshot,
  InstalledContentPackage,
  RemotePackageSource,
} from '../src/types/contentPackages.ts'
import type { RunContentCommand } from './content-projects.ts'

type ManagedSource = Parameters<ManagedProjects['withSourceArchive']>[0]
type InstalledNpmPackage = NpmProjectInspection['packages'][number]
type PackageUpdate = NonNullable<Awaited<ReturnType<typeof findPackageUpdate>>>
type OfficialEnvironmentCatalog = Awaited<ReturnType<typeof readOfficialEnvironments>>

interface PackageUpdates {
  clientVersion: string
  find: typeof findPackageUpdate
  shippedRoot?: string
  shippedCatalog: () => Promise<OfficialEnvironmentCatalog>
  stageShippedEnvironments?: (directory: string, version: string) => Promise<OfficialEnvironmentCatalog>
  readEnvironments: (directory: string) => Promise<OfficialEnvironmentCatalog>
  catalogDigest?: (root: string) => Promise<string>
  withArchive: <T>(
    candidate: PackageUpdate,
    signal: AbortSignal,
    use: (file: string, environmentPackages: string) => Promise<T>,
  ) => Promise<T>
  validate: (directory: string, signal: AbortSignal, catalog: OfficialEnvironmentCatalog) => Promise<unknown>
}

type EntrySource =
  | { kind: 'file'; file: string; label: string; provenance?: Record<string, string> }
  | { kind: 'npm'; spec: string; label: string }
interface LibraryEntry extends InstalledContentPackage {
  source: EntrySource
  activationPending?: boolean
  previousOfficialId?: string
  materialDigest?: string
  environmentDigest?: string
  validatedHost?: string
  registryUpdate?: boolean
  captured?: boolean
}
interface OfficialReference {
  id: string
  version: string
  materialDigest?: string
}
interface LegacySelection {
  project: string
  packages: Pick<LibraryEntry, 'name' | 'version'>[]
}
interface LibraryState {
  version: 3
  revision: number
  installed: LibraryEntry[]
  bundledDigest?: string
  officialHistory?: OfficialReference[]
  legacySelection?: LegacySelection
}
type LibraryDiskState =
  | LibraryState
  | (Omit<LibraryState, 'version'> & {
      version: 2
      activeIds: string[]
      activeProject: string | null
    })

type ProjectSource = { kind: 'file'; file: string } | { kind: 'npm'; spec: string }
type InstallSource =
  | { kind: 'file'; file: string; label: string; provenance?: Record<string, string> }
  | { kind: 'file'; archive: string; label: string }
  | { kind: 'npm'; spec: string; label: string; verify?: GraphCheck }
/** Rejects a resolved dependency graph before it is recorded, for example against a signed workshop index. */
export type GraphCheck = (graph: ReturnType<typeof graphFor>) => void | Promise<void>
interface InstallPlan {
  id: string
  kind: 'install'
  revision: number
  project: string
  entry: LibraryEntry
}
interface InspectedProject {
  id: string
  directory: string
  inspection: NpmProjectInspection
}
type InstallPreview =
  | { existingId: string; id?: never; package?: never }
  | { existingId?: never; id: string; kind: 'install'; package: ReviewedEntry; requiresApproval: true }
type ReviewedEntry = LibraryEntry & { dependencyRanges: NonNullable<LibraryEntry['dependencyRanges']> }
type InstallTask = (signal: AbortSignal) => Promise<InstallPreview>
type InstallJob = NonNullable<ContentLibrarySnapshot['operations']>[number] & {
  controller: AbortController
  execute: InstallTask
  promise?: Promise<string>
  createdAt: number
  updatedAt?: number
}
interface LibraryOptions {
  root: string
  run: RunContentCommand
  host: {
    status: () => ContentLibrarySnapshot['serviceStatus']
    retainedProjectDirectories?: () => Promise<string[]>
  }
  withDefaultArchive?: (use: (file: string) => Promise<void>) => Promise<void>
  packageUpdates?: PackageUpdates
  sources?: unknown
  createManagedProjects?: (root: string, options: ManagedProjectsOptions) => ManagedProjects | Promise<ManagedProjects>
  copyMember?: typeof copyEnvironmentMember
  reviewInstall?: (pkg: ReviewedEntry, signal: AbortSignal) => boolean | Promise<boolean>
  authorizeEnvironment?: (
    draft: EnvironmentDocument,
    effects: InstalledNpmPackage[],
    signal: AbortSignal,
  ) => boolean | Promise<boolean>
}

export interface OfficialContentUpdateOptions {
  expectedVersion?: string
  signal?: AbortSignal
}

interface ProjectPreparationOptions {
  signal?: AbortSignal
  offline?: boolean
  onProgress?: PrepareEnvironmentInput['onProgress']
  projectDirectory?: string
}

interface PackageManifest {
  version: string
  author?: string | { name?: string }
  description?: string
  license?: string
  engines?: Record<string, string>
  arcadia?: { presentation?: string; sdkApi?: number }
  dependencies?: Record<string, string>
}

const officialPackage = '@arcadia-eternity/data-pack-base'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const exactPackage = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
// npm redacts UUIDs even in npm ls JSON paths; keep opaque handles out of directory names.
const environmentDigest = (catalog: OfficialEnvironmentCatalog) =>
  bytesToHex(sha256(Buffer.from(JSON.stringify(catalog))))
const storageName = (id: string) => 'content-' + id.replaceAll('-', '')
export function isExactPackageSpec(spec: unknown): spec is string {
  return typeof spec === 'string' && spec.length <= 256 && exactPackage.test(spec)
}
const contentKinds = ['species', 'skills', 'marks'] as const
const packageName = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/
const sourceError = (code: string) => Object.assign(new Error(code), { code })
function sourceRegistry(value: unknown): Record<string, ManagedSource> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200)
    throw sourceError('INSTALL_SOURCES_INVALID')
  for (const [name, source] of Object.entries(value as Record<string, ManagedSource>)) {
    if (!packageName.test(name) || !source || typeof source !== 'object' || Array.isArray(source))
      throw sourceError('INSTALL_SOURCES_INVALID')
    const keys = {
      archive: ['kind', 'file'],
      directory: ['kind', 'directory'],
      url: ['kind', 'url', 'integrity'],
      git: ['kind', 'url', 'commit', 'artifactPath'],
    }[source.kind]
    if (!keys || Object.keys(source).some(key => !keys.includes(key))) throw sourceError('INSTALL_SOURCES_INVALID')
    if (source.kind === 'archive' || source.kind === 'directory') {
      const path = source.kind === 'archive' ? source.file : source.directory
      if (typeof path !== 'string' || !isAbsolute(path)) throw sourceError('INSTALL_SOURCES_INVALID')
    } else {
      let url
      try {
        url = new URL(source.url)
      } catch {
        throw sourceError('INSTALL_SOURCES_INVALID')
      }
      if (url.protocol !== 'https:' || url.username || url.password) throw sourceError('INSTALL_SOURCES_INVALID')
      if (source.kind === 'git' && !/^[a-fA-F0-9]{40}$/.test(source.commit ?? ''))
        throw sourceError('INSTALL_SOURCES_INVALID')
    }
  }
  return structuredClone(value as Record<string, ManagedSource>)
}
// Called once by the desktop main process, before environment preparation.
export function readDesktopContentSources(args: string[], root: string): unknown {
  const { values } = parseArgs({
    args,
    options: { 'content-sources': { type: 'string' } },
    allowPositionals: true,
    strict: false,
  })
  const explicit = values['content-sources']
  if (explicit !== undefined && (typeof explicit !== 'string' || !explicit.trim()))
    throw new Error('--content-sources 需要指定 JSON 文件')
  const file = explicit ?? join(root, 'content-sources.json')
  try {
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.size > 128 * 1024) throw new Error('内容包来源清单无效')
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (explicit === undefined && (error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}
function validEntry(item: LibraryEntry) {
  return (
    item &&
    uuid.test(item.id) &&
    typeof item.name === 'string' &&
    exactPackage.test(item.name + '@' + item.version) &&
    typeof item.namespace === 'string' &&
    item.namespace &&
    typeof item.title === 'string' &&
    typeof item.projectId === 'string' &&
    ((item.source?.kind === 'file' &&
      (['content-0.tgz', 'candidates/content-0.tgz'].includes(item.source.file) ||
        /^candidates\/[a-f0-9]{64}\.tgz$/.test(item.source.file))) ||
      (item.source?.kind === 'npm' && item.source.spec === item.name + '@' + item.version)) &&
    typeof item.source.label === 'string' &&
    Array.isArray(item.graph) &&
    item.graph.every(
      pkg =>
        pkg &&
        typeof pkg.name === 'string' &&
        typeof pkg.version === 'string' &&
        pkg.dependencies &&
        typeof pkg.dependencies === 'object' &&
        !Array.isArray(pkg.dependencies) &&
        Object.values(pkg.dependencies).every(value => typeof value === 'string'),
    ) &&
    contentKinds.every(
      kind =>
        Array.isArray(item.contentIds?.[kind]) &&
        item.contentIds[kind].every(id => typeof id === 'string') &&
        Number.isSafeInteger(item.counts?.[kind]) &&
        item.counts[kind] >= 0,
    )
  )
}
function pendingActivation(previous: LibraryEntry) {
  return { activationPending: true, previousOfficialId: previous.previousOfficialId ?? previous.id }
}
async function readJson<T>(file: string, limit = 8 * 1024 * 1024): Promise<T> {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > limit) throw new Error('内容包记录无效')
  return JSON.parse(await readFile(file, 'utf8'))
}
function idsFor(packages: NpmProjectInspection['packages']): ContentIds {
  const ids: ContentIds = { species: [], skills: [], marks: [] }
  for (const kind of contentKinds) {
    ids[kind] = packages.flatMap(({ manifest, draft, catalogIds }) =>
      manifest && draft
        ? (draft.data[kind] ?? []).map(item => manifest.namespace + ':' + item.id)
        : (catalogIds?.[kind] ?? []),
    )
  }
  return ids
}
function ruleCatalogFor(inspection: NpmProjectInspection) {
  return { members: [...(inspection.members ?? [])], ruleSets: inspection.ruleSets ?? [] }
}
function graphFor(inspection: NpmProjectInspection) {
  const byLocation = new Map(inspection.packages.map(pkg => [pkg.location, pkg]))
  return inspection.packages.map(pkg => ({
    name: pkg.name,
    version: pkg.version,
    integrity: pkg.integrity,
    dependencies: Object.fromEntries(
      Object.entries(pkg.dependencies ?? {}).map(([name, location]) => [
        name,
        byLocation.get(location)?.version ?? location,
      ]),
    ),
    ...(pkg.manifest
      ? {
          projectId: pkg.manifest.projectId,
          namespace: pkg.manifest.namespace,
          containsCode: !!(pkg.manifest.effects || pkg.manifest.effectArtifact),
        }
      : pkg.officialHost
        ? { projectId: 'base', namespace: 'base', containsCode: true }
        : {}),
  }))
}
function checkedInspection(result: unknown): NpmProjectInspection {
  const value = result as NpmProjectInspection
  if (value?.format !== 'arcadia.npm-installation' || !Array.isArray(value.packages))
    throw new Error('内容检查返回了无效结果')
  return value
}

// Installed projects are immutable. Index only file entries from their installed package manifests.
async function indexInstalledMedia(directory: string) {
  const files = new Map<string, string[]>()
  type Lock = { packages?: Record<string, unknown> }
  const lock = await readJson<Lock>(join(directory, 'npm-shrinkwrap.json')).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return readJson<Lock>(join(directory, 'package-lock.json'))
  })
  const relativeFile = (value: unknown): value is string =>
    typeof value === 'string' &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    value.split('/').every(part => part && !['.', '..', 'node_modules'].includes(part))
  for (const location of Object.keys(lock.packages ?? {})) {
    if (!/^(?:node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*\/?)+$/.test(location)) continue
    const root = join(directory, location)
    const file = join(root, 'package.json')
    if (
      (await realpath(file).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })) !== file
    )
      continue
    const pkg = await readJson<PackageManifest>(file)
    if (!relativeFile(pkg.arcadia?.presentation)) continue
    const manifestFile = join(root, pkg.arcadia.presentation)
    if ((await realpath(manifestFile)) !== manifestFile) continue
    const manifest = await readJson<{ resources?: { kind: string; sha256: string; source: string }[] }>(manifestFile)
    for (const row of manifest.resources ?? []) {
      if (row.kind !== 'file' || !/^[a-f0-9]{64}$/.test(row.sha256) || !relativeFile(row.source)) continue
      const candidates = files.get(row.sha256) ?? []
      candidates.push(join(root, row.source))
      files.set(row.sha256, candidates)
    }
  }
  return files
}

/** Package-level local authority. No HTTP endpoints or renderer-supplied paths/commands. */
export class ContentLibrary {
  declare packageUpdates: LibraryOptions['packageUpdates']
  declare catalogDigest: NonNullable<PackageUpdates['catalogDigest']>
  declare root: string
  declare reviewInstall: LibraryOptions['reviewInstall']
  declare authorizeEnvironment: LibraryOptions['authorizeEnvironment']
  declare run: RunContentCommand
  declare host: LibraryOptions['host']
  declare withDefaultArchive: LibraryOptions['withDefaultArchive']
  declare copyMember: typeof copyEnvironmentMember
  #state!: LibraryState
  #loading: Promise<void> | undefined
  #busy = false
  #idle: Promise<void> | undefined
  #controller = new AbortController()
  #legacyRuleCatalogs = new Map<string, Promise<ReturnType<typeof ruleCatalogFor> | undefined>>()
  #mediaIndexes = new Map<string, ReturnType<typeof indexInstalledMedia>>()
  #inspectTail = Promise.resolve()
  #plans = new Map<string, InstallPlan>()
  #installJobs = new Map<string, InstallJob>()
  #installTail: Promise<unknown> = Promise.resolve()
  #writes = Promise.resolve()
  #leases = new Map<string, number>()
  #gcTimer: NodeJS.Timeout | undefined
  #sources: Record<string, ManagedSource>
  #createManagedProjects: NonNullable<LibraryOptions['createManagedProjects']>
  constructor({
    root,
    run,
    host,
    withDefaultArchive,
    packageUpdates,
    sources = {},
    createManagedProjects,
    copyMember,
    reviewInstall,
    authorizeEnvironment,
  }: LibraryOptions) {
    this.packageUpdates = packageUpdates
    this.catalogDigest =
      packageUpdates?.catalogDigest ??
      (async root => {
        const { catalogMaterialDigest } = await import('@arcadia-eternity/pack-loader/node')
        return catalogMaterialDigest(root)
      })
    this.root = root
    this.reviewInstall = reviewInstall
    this.authorizeEnvironment = authorizeEnvironment
    this.run = run
    this.host = host
    this.withDefaultArchive = withDefaultArchive
    this.copyMember =
      copyMember ??
      (async (...args) => {
        const { copyEnvironmentMember } = await import('@arcadia-eternity/content-sdk/management-workspace')
        return copyEnvironmentMember(...args)
      })
    this.#sources = sourceRegistry(sources)
    this.#createManagedProjects =
      createManagedProjects ??
      (async (root, options) => {
        const { ManagedProjects } = await import('@arcadia-eternity/content-sdk/managed-projects')
        return new ManagedProjects(root, {
          ...options,
          bundledPackageRoot: dirname(
            fileURLToPath(import.meta.resolve('@arcadia-eternity/data-pack-base/package.json')),
          ),
        })
      })
  }
  async #load() {
    if (this.#state) return
    this.#loading ??= (async () => {
      await mkdir(this.root, { recursive: true })
      this.root = await realpath(this.root)
      const projects = join(this.root, 'projects')
      await mkdir(projects, { recursive: true })
      if ((await realpath(projects)) !== projects) throw new Error('内容包目录不能是外部链接')
      let state: LibraryDiskState,
        needsSave = false
      try {
        state = await readJson(join(this.root, 'library.json'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        needsSave = true
        state = { version: 3, revision: 0, installed: [] }
      }
      if (state.version === 2) {
        needsSave = true
        const legacy = state
        if (
          !Array.isArray(state.installed) ||
          !Array.isArray(state.activeIds) ||
          legacy.activeIds.some(id => !legacy.installed.some(entry => entry.id === id)) ||
          (state.activeProject !== null && !uuid.test(state.activeProject))
        )
          throw new Error('旧内容选择记录格式不正确')
        await writeFile(join(this.root, 'library-v2.backup.json'), JSON.stringify(state), { flag: 'wx' }).catch(
          error => {
            if (error.code !== 'EEXIST') throw error
          },
        )
        state = {
          version: 3,
          revision: state.revision,
          installed: state.installed,
          bundledDigest: state.bundledDigest,
          ...(state.activeProject
            ? {
                legacySelection: {
                  project: state.activeProject,
                  packages: legacy.installed
                    .filter(entry => legacy.activeIds.includes(entry.id))
                    .map(entry => ({ name: entry.name, version: entry.version })),
                },
              }
            : {}),
        }
      }
      if (
        state.version !== 3 ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0 ||
        !Array.isArray(state.installed) ||
        state.installed.length > 200 ||
        state.installed.some(item => !validEntry(item)) ||
        new Set(state.installed.map(item => item.id)).size !== state.installed.length ||
        (state.officialHistory !== undefined &&
          (!Array.isArray(state.officialHistory) ||
            state.officialHistory.some(item => !item || !uuid.test(item.id) || !semver.valid(item.version)))) ||
        (state.legacySelection &&
          (!uuid.test(state.legacySelection.project) || !Array.isArray(state.legacySelection.packages)))
      )
        throw new Error('本机内容包记录格式不正确')
      if (this.withDefaultArchive) await this.#synchronizeDefault(state)
      if (!this.#state) {
        if (needsSave) await this.#save(state)
        else this.#state = state
      }
    })().catch(error => {
      this.#loading = undefined
      throw error
    })
    await this.#loading
  }
  async #digestEntry(entry: LibraryEntry) {
    return this.catalogDigest(join(await this.#directory(entry.id), 'node_modules', officialPackage))
  }
  async #readOfficial(ref: OfficialReference) {
    const entry = await readJson<LibraryEntry>(join(await this.#directory(ref.id), 'official-entry.json'))
    if (
      !validEntry(entry) ||
      !entry.bundled ||
      entry.name !== officialPackage ||
      entry.id !== ref.id ||
      entry.version !== ref.version
    )
      throw new Error('官方基础包历史记录无效')
    return entry
  }
  async #rememberOfficial(state: LibraryState, entry: LibraryEntry, nextId: string) {
    const history = (state.officialHistory ?? []).filter(ref => ref.id !== entry.id && ref.id !== nextId)
    if (entry.activationPending) return history
    const path = join(this.root, 'projects', storageName(entry.id))
    const directory = await realpath(path).catch(error => {
      if (error.code !== 'ENOENT') throw error
    })
    if (!directory) return history
    if (directory !== path) throw new Error('安装目录已改变')
    await writeFile(join(directory, 'official-entry.json'), JSON.stringify(entry))
    return [...history, { id: entry.id, version: entry.version, materialDigest: entry.materialDigest }]
  }
  async #synchronizeDefault(state: LibraryState) {
    const active = state.installed.find(entry => entry.bundled)
    if (!active) return this.#installShipped(state)
    const updates = this.packageUpdates
    const shippedRoot = updates?.shippedRoot
    if (!shippedRoot) return this.#installShipped(state, active)
    const manifest = await readJson<PackageManifest>(join(shippedRoot, 'package.json'))
    const shipped = manifest.version
    const host = updates.clientVersion
    const bundledCompatible =
      manifest.engines?.arcadia === undefined || semver.satisfies(host, manifest.engines.arcadia)
    const refs: (OfficialReference | { id?: undefined; version: string })[] = [active, ...(state.officialHistory ?? [])]
    // For equal versions, reuse the installed project only if its materials match the shipped copy.
    if (bundledCompatible) refs.push({ version: shipped })
    refs.sort((a, b) => semver.rcompare(a.version, b.version))
    let shippedDigest, shippedCatalog, lastError
    for (const ref of refs) {
      if (!ref.id) {
        try {
          await this.#installShipped(state, active)
          return
        } catch (error) {
          lastError = error
          console.warn('Unable to activate shipped official base', shipped, error)
          continue
        }
      }
      let entry, digest
      try {
        entry = ref.id === active.id ? active : await this.#readOfficial(ref)
        const equalShipped = bundledCompatible && entry.version === shipped
        const range = entry.engines?.arcadia
        if (!equalShipped && (range === undefined || !semver.satisfies(host, range))) continue
        digest = await this.#digestEntry(entry)
        if (entry.materialDigest && entry.materialDigest !== digest)
          throw new Error('OFFICIAL_MATERIAL_DIGEST_MISMATCH')
        const project = await this.#directory(entry.id)
        const catalog = await updates.readEnvironments(project)
        if (environmentDigest(catalog) !== entry.environmentDigest)
          throw new Error('OFFICIAL_ENVIRONMENT_DIGEST_MISMATCH')
        if (equalShipped) {
          shippedCatalog ??= await updates.shippedCatalog()
          shippedDigest ??= await this.catalogDigest(shippedRoot)
          if (shippedDigest !== digest || !isDeepStrictEqual(catalog, shippedCatalog)) {
            console.warn('OFFICIAL_BASE_VERSION_CONFLICT', shipped, 'using bundled materials')
            continue
          }
        }
        if (entry.validatedHost !== host) await updates.validate(project, this.#controller.signal, catalog)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'OFFICIAL_ENVIRONMENT_PACKAGES_MISSING') continue
        lastError = error
        console.warn('Skipping unusable cached official base', ref.version, error)
        continue
      }
      if (entry.id !== active.id || entry.validatedHost !== host || !entry.materialDigest) {
        const officialHistory =
          entry.id === active.id ? state.officialHistory : await this.#rememberOfficial(state, active, entry.id)
        const selected = {
          ...entry,
          materialDigest: digest,
          validatedHost: host,
          ...(entry.id !== active.id && pendingActivation(active)),
        }
        await this.#save({
          ...state,
          revision: state.revision + 1,
          officialHistory,
          installed: state.installed.map(item => (item.id === active.id ? selected : item)),
        })
      }
      return
    }
    throw lastError ?? new Error('没有与当前 Arcadia 兼容的已安装基础包')
  }
  async #installShipped(state: LibraryState, active?: LibraryEntry) {
    await this.withDefaultArchive!(async file => {
      const digest = bytesToHex(sha256(await readFile(file)))
      if (active && !this.packageUpdates?.shippedRoot && !active.registryUpdate && state.bundledDigest === digest)
        return
      const candidate = await this.#stageInstall(
        { kind: 'file', file, label: '随应用提供' },
        true,
        this.#controller.signal,
        { ...state, installed: state.installed.filter(entry => entry.name !== officialPackage) },
      )
      const plan = this.#plans.get(candidate.id!)!
      try {
        if (plan.entry.name !== officialPackage || plan.entry.projectId !== 'base')
          throw new Error('默认包缺少基础内容声明')
        await this.run(
          ['content', 'npm', 'approve', await this.#directory(plan.project), '--profile', 'local-development'],
          this.#controller.signal,
        )
        const directory = await this.#directory(plan.project)
        const catalog = await this.packageUpdates?.stageShippedEnvironments?.(directory, plan.entry.version)
        await this.packageUpdates?.validate?.(directory, this.#controller.signal, catalog!)
        const entry = {
          ...plan.entry,
          bundled: true,
          materialDigest: await this.#digestEntry(plan.entry),
          ...(catalog && { environmentDigest: environmentDigest(catalog) }),
          validatedHost: this.packageUpdates?.clientVersion,
          ...(active && this.packageUpdates?.shippedRoot && pendingActivation(active)),
        }
        const officialHistory = active ? await this.#rememberOfficial(state, active, entry.id) : state.officialHistory
        await this.#save({
          ...state,
          revision: active || state.installed.length ? state.revision + 1 : state.revision,
          bundledDigest: digest,
          officialHistory,
          installed: active
            ? state.installed.map(item => (item.id === active.id ? entry : item))
            : [...state.installed, entry],
        })
      } catch (error) {
        await rm(await this.#directory(plan.project), { recursive: true, force: true })
        throw error
      } finally {
        this.#plans.delete(plan.id)
      }
    })
  }
  async knowsOfficialMaterial(digest: string) {
    await this.#load()
    const active = this.#state.installed.find(entry => entry.bundled)
    return (
      /^[a-f0-9]{64}$/.test(digest) &&
      [active, ...(this.#state.officialHistory ?? [])].some(entry => entry?.materialDigest === digest)
    )
  }
  get officialPackageRoot() {
    const entry = this.#state?.installed.find(item => item.bundled)
    return entry && join(this.root, 'projects', storageName(entry.id), 'node_modules', officialPackage)
  }
  async officialEnvironmentCatalog() {
    await this.#load()
    const entry = this.#state.installed.find(item => item.bundled)
    if (!entry) throw new Error('未找到官方基础包')
    return this.packageUpdates!.readEnvironments(await this.#directory(entry.id))
  }
  get pendingOfficialUpdateId() {
    return this.#state?.installed.find(item => item.bundled && item.activationPending)?.id
  }
  isOfficialPackage(id: string) {
    return (
      this.#state?.installed.some(item => item.bundled && item.id === id) ||
      this.#state?.officialHistory?.some(item => item.id === id)
    )
  }
  async checkPackageUpdate(id: string, signal = this.#controller.signal) {
    await this.#load()
    const entry = this.#entry(id)
    if (entry.name === officialPackage && !entry.bundled) throw new Error('请选择官方基础包')
    if (!this.packageUpdates || (!entry.bundled && entry.source.kind !== 'npm'))
      throw new Error('该来源不支持检查 npm 更新')
    if (entry.activationPending) return { name: entry.name, version: entry.version }
    const current = this.#state.installed
      .filter(item => item.name === entry.name && (entry.bundled ? item.bundled : item.source.kind === 'npm'))
      .map(item => item.version)
      .sort(semver.rcompare)[0]
    return this.packageUpdates.find(entry.name, current, this.packageUpdates.clientVersion, signal)
  }
  async updatePackage(id: string, version: string) {
    if (typeof version !== 'string') throw new Error('请选择要更新的版本')
    await this.#load()
    if (this.isOfficialPackage(id)) return this.updateOfficialPackage({ expectedVersion: version })
    const candidate = await this.checkPackageUpdate(id)
    if (!candidate || candidate.version !== version) throw new Error('可用版本已变更，请重新检查更新')
    return this.installNpm(candidate.name + '@' + version)
  }
  async updateOfficialPackage({ expectedVersion, signal }: OfficialContentUpdateOptions = {}) {
    await this.#load()
    const old = this.#state.installed.find(item => item.bundled)
    if (!old || old.name !== officialPackage) throw new Error('未找到官方基础包')
    const updateSignal = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal
    updateSignal.throwIfAborted()
    if (old.version === expectedVersion) return old.id
    const available = await this.checkPackageUpdate(old.id, updateSignal)
    if (expectedVersion !== undefined && available?.version !== expectedVersion)
      throw new Error('可用版本已变更，请重新检查更新')
    if (!available) return null
    if (old.activationPending) return old.id
    const candidate = available as PackageUpdate
    const updates = this.packageUpdates!
    // Existing environments can still acquire read leases during the network download.
    return updates.withArchive(candidate, updateSignal, (file, environmentPackages) =>
      this.#exclusive(async () => {
        updateSignal.throwIfAborted()
        if (old.id !== this.#state.installed.find(item => item.bundled)?.id)
          throw new Error('基础包已变更，请重新检查更新')
        const staged = await this.#stageInstall({ kind: 'file', file, label: '官方 npm 发行包' }, true, updateSignal, {
          ...this.#state,
          installed: this.#state.installed.filter(entry => entry.name !== officialPackage),
        })
        const plan = this.#plans.get(staged.id!)!
        try {
          const entry = plan.entry
          if (
            entry.name !== officialPackage ||
            entry.version !== candidate.version ||
            entry.engines?.arcadia !== candidate.range ||
            !semver.satisfies(updates.clientVersion, candidate.range)
          )
            throw new Error('基础包与客户端不兼容')
          const directory = await this.#directory(plan.project)
          await cp(environmentPackages, join(directory, basename(environmentPackages)), {
            recursive: true,
            force: false,
            errorOnExist: true,
          })
          const catalog = await updates.readEnvironments(directory)
          await this.run(['content', 'npm', 'approve', directory, '--profile', 'local-development'], updateSignal)
          await updates.validate(directory, updateSignal, catalog)
          const materialDigest = await this.#digestEntry(entry)
          const officialHistory = await this.#rememberOfficial(this.#state, old, entry.id)
          updateSignal.throwIfAborted()
          await this.#update(state => ({
            ...state,
            revision: state.revision + 1,
            officialHistory,
            installed: state.installed.map(item =>
              item.id === old.id
                ? {
                    ...entry,
                    bundled: true,
                    registryUpdate: true,
                    ...pendingActivation(old),
                    materialDigest,
                    environmentDigest: environmentDigest(catalog),
                    validatedHost: updates.clientVersion,
                  }
                : item,
            ),
          }))
          this.#scheduleGc()
          return entry.id
        } catch (error) {
          await rm(await this.#directory(plan.project), { recursive: true, force: true })
          throw error
        } finally {
          this.#plans.delete(plan.id)
        }
      }),
    )
  }
  async finishOfficialUpdate(id: string | undefined) {
    if (!id) return
    return this.#exclusive(async () => {
      if (id !== this.pendingOfficialUpdateId) return
      await this.#update(state => ({
        ...state,
        revision: state.revision + 1,
        installed: state.installed.map(item => {
          if (item.id !== id) return item
          const { activationPending: _pending, previousOfficialId: _previous, ...active } = item
          return active
        }),
      }))
    })
  }
  async rollbackOfficialUpdate(id: string | undefined) {
    if (!id) return false
    return this.#exclusive(async () => {
      if (id !== this.pendingOfficialUpdateId) return false
      const pending = this.#entry(id)
      const ref = this.#state.officialHistory?.find(item => item.id === pending.previousOfficialId)
      if (!ref) return false
      const previous = await this.#readOfficial(ref)
      const directory = await this.#directory(previous.id)
      const updates = this.packageUpdates!
      const catalog = await updates.readEnvironments(directory).catch(error => {
        if (error.code !== 'ENOENT' && error.code !== 'OFFICIAL_ENVIRONMENT_PACKAGES_MISSING') throw error
      })
      if (!catalog || environmentDigest(catalog) !== previous.environmentDigest) return false
      const digest = await this.#digestEntry(previous)
      if (previous.materialDigest && previous.materialDigest !== digest) return false
      if (previous.engines?.arcadia) {
        if (!semver.satisfies(updates.clientVersion, previous.engines.arcadia)) return false
      } else if (!updates.shippedRoot || digest !== (await this.catalogDigest(updates.shippedRoot))) return false
      if (previous.validatedHost !== updates.clientVersion)
        await updates.validate(directory, this.#controller.signal, catalog)
      await this.#update(state => ({
        ...state,
        revision: state.revision + 1,
        officialHistory: state.officialHistory!.filter(item => item.id !== ref.id),
        installed: state.installed.map(item => (item.id === id ? previous : item)),
      }))
      this.#scheduleGc()
      return true
    })
  }
  #update(change: (state: LibraryState) => LibraryState) {
    const update = this.#writes.then(() => {
      if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
      return this.#save(change(this.#state))
    })
    this.#writes = update.catch(() => {})
    return update
  }
  async #save(next: LibraryState) {
    const contents = JSON.stringify(next, null, 2)
    if (Buffer.byteLength(contents) > 8 * 1024 * 1024) throw new Error('内容包记录过大，请先移除不再使用的版本')
    const file = join(this.root, 'library.json'),
      temp = file + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, contents, { flag: 'wx' })
      await rename(temp, file)
      this.#state = next
    } finally {
      await rm(temp, { force: true })
    }
  }
  async #exclusive<T>(action: () => T | Promise<T>) {
    if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
    while (this.#busy) await this.#idle
    if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
    this.#busy = true
    let settle!: () => void
    this.#idle = new Promise(resolve => {
      settle = resolve
    })
    try {
      await this.#load()
      if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
      return await action()
    } finally {
      this.#busy = false
      settle()
    }
  }
  async #directory(id: string) {
    if (!uuid.test(id)) throw new Error('内容包标识无效')
    const dir = join(this.root, 'projects', storageName(id))
    try {
      if ((await realpath(dir)) !== dir) throw new Error('内容包目录已改变')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('安装目录已丢失，请卸载记录后重新安装此版本')
      throw error
    }
    return dir
  }
  /** Only used to seed the first named environment, never as a runtime selection. */
  async acquireInitialEnvironment() {
    return this.#exclusive(async () => {
      const base = this.#state.installed.find(entry => entry.bundled)
      const legacy = this.#state.legacySelection
      const lease = await this.#leaseProject(legacy?.project ?? base?.id ?? null)
      return {
        ...lease,
        legacy: !!legacy,
        packages: legacy?.packages ?? (base ? [{ name: base.name, version: base.version }] : []),
      }
    })
  }
  async acquireDefaultProject() {
    return this.#exclusive(() => this.#leaseProject(this.#state.installed.find(entry => entry.bundled)?.id ?? null))
  }
  async #leaseProject(id: string | null) {
    const directory = id ? await this.#directory(id) : null
    if (id) this.#leases.set(id, (this.#leases.get(id) ?? 0) + 1)
    let released = false
    return {
      directory,
      release: async () => {
        if (released) return
        released = true
        if (id) {
          const count = this.#leases.get(id)! - 1
          if (count) this.#leases.set(id, count)
          else this.#leases.delete(id)
        }
        if (!this.#controller.signal.aborted) await this.collectGarbage()
      },
    }
  }
  /** Fixed project materials may also be owned by immutable workspace versions. */
  async ownsProjectDirectory(directory: unknown) {
    if (typeof directory !== 'string') return false
    await this.#load()
    const name = basename(directory)
    if (!/^content-[0-9a-f]{32}$/.test(name) || directory !== join(this.root, 'projects', name)) return false
    return (await realpath(directory).catch(() => null)) === directory
  }
  async retainProjectDirectory(directory: string) {
    return this.#exclusive(async () => {
      if (!(await this.ownsProjectDirectory(directory))) throw new Error('环境材料不属于此内容工作区')
      const id = basename(directory)
        .slice(8)
        .replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5')
      await this.#directory(id)
      this.#leases.set(id, (this.#leases.get(id) ?? 0) + 1)
      let released = false
      return async () => {
        if (released) return
        released = true
        const count = (this.#leases.get(id) ?? 1) - 1
        if (count) this.#leases.set(id, count)
        else this.#leases.delete(id)
        // Collection is scheduled independently; releasing a workspace lease can
        // occur while that workspace holds its own deletion critical section.
        this.#scheduleGc()
      }
    })
  }
  async collectGarbage() {
    return this.#exclusive(() => this.#collectGarbage())
  }
  async #collectGarbage() {
    clearTimeout(this.#gcTimer)
    this.#gcTimer = undefined
    const protectedIds = new Set([
      ...this.#state.installed.map(entry => entry.id),
      ...(this.#state.officialHistory ?? []).map(ref => ref.id),
      this.#state.legacySelection?.project,
      ...Array.from(this.#plans.values(), plan => plan.project),
      ...this.#leases.keys(),
    ])
    // Retirement is only a request: rooms, checkpoints and asset streams may still own leases.
    let retained: string[]
    try {
      if (this.host.retainedProjectDirectories) retained = await this.host.retainedProjectDirectories()
      else if (this.host.status().status !== 'idle') return
      else retained = []
    } catch {
      this.#scheduleGc()
      return
    }
    const held = new Set(retained)
    const projects = join(this.root, 'projects')
    for (const entry of await readdir(projects, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^content-[0-9a-f]{32}$/.test(entry.name)) continue
      const id = entry.name.slice(8).replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5')
      if (protectedIds.has(id)) continue
      const directory = join(projects, entry.name)
      if (held.has(directory)) {
        this.#scheduleGc()
        continue
      }
      if ((await realpath(directory)) !== directory) continue
      await rm(directory, { recursive: true, force: true })
    }
  }
  #scheduleGc() {
    if (this.#controller.signal.aborted || this.#gcTimer) return
    this.#gcTimer = setTimeout(() => {
      this.#gcTimer = undefined
      void this.collectGarbage().catch(() => {})
    }, 30000)
    this.#gcTimer.unref?.()
  }
  installedMedia(hash: string, limit: number) {
    return this.#findInstalledMedia(hash, limit, false)
  }
  async hasInstalledMedia(hash: string, limit: number) {
    return !!(await this.#findInstalledMedia(hash, limit, true))
  }
  #findInstalledMedia(hash: string, limit: number, presenceOnly: false): Promise<Buffer | null>
  #findInstalledMedia(hash: string, limit: number, presenceOnly: true): Promise<true | null>
  async #findInstalledMedia(hash: string, limit: number, presenceOnly: boolean): Promise<Buffer | true | null> {
    if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(limit) || limit < 1 || limit > 64 * 1024 * 1024)
      throw new Error('资源标识或大小无效')
    await this.#load()
    const installed = new Set(this.#state.installed.map(entry => entry.id))
    for (const id of this.#mediaIndexes.keys()) if (!installed.has(id)) this.#mediaIndexes.delete(id)
    for (const entry of this.#state.installed) {
      let index = this.#mediaIndexes.get(entry.id)
      if (!index) {
        index = this.#directory(entry.id).then(indexInstalledMedia)
        this.#mediaIndexes.set(entry.id, index)
      }
      try {
        for (const file of (await index).get(hash) ?? []) {
          if ((await realpath(file)) !== file) continue
          const info = await lstat(file)
          if (!info.isFile() || !info.size || info.size > limit) continue
          if (presenceOnly) return true
          const data = await readFile(file)
          if (data.length <= limit && bytesToHex(sha256(data)) === hash) return data
        }
      } catch {
        this.#mediaIndexes.delete(entry.id)
      }
    }
    return null
  }
  async authorProject(id: string) {
    await this.#load()
    const entry = this.#entry(id)
    const root = await this.#directory(id)
    const directory = join(root, 'node_modules', entry.name)
    const resolved = await realpath(directory)
    if (resolved !== directory) throw new Error('安装内容目录已改变')
    return { id, name: entry.name, directory: resolved, readOnly: true, published: true }
  }
  #entry(id: string) {
    const entry = this.#state.installed.find(item => item.id === id)
    if (!entry) throw new Error('未安装此内容包')
    return entry
  }
  #plan(id: string, kind: InstallPlan['kind']) {
    const plan = this.#plans.get(id)
    if (!plan || plan.kind !== kind) throw new Error('操作清单已失效，请重新准备')
    if (plan.revision !== this.#state.revision) throw new Error('内容包列表已变化，请重新准备操作')
    return plan
  }
  async #createProject(sources: ProjectSource[], offline = false, signal = this.#controller.signal) {
    const id = randomUUID(),
      directory = join(this.root, 'projects', storageName(id))
    await mkdir(directory)
    try {
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ name: 'arcadia-local-content', version: '1.0.0', private: true }),
      )
      const inputs = []
      await mkdir(join(directory, 'candidates'))
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index]
        if (source.kind === 'file') {
          const file = 'candidates/content-' + index + '.tgz'
          await copyFile(source.file, join(directory, file))
          inputs.push('file:./' + file)
        } else inputs.push(source.spec)
      }
      const inspection = checkedInspection(
        await this.run(
          [
            'content',
            'npm',
            'stage',
            directory,
            '--rule-sets',
            ...(offline ? ['--offline'] : []),
            ...(inputs.length ? ['--package', ...inputs] : []),
          ],
          signal,
        ),
      )
      return { id, directory, inspection }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }
  async list(): Promise<ContentLibrarySnapshot> {
    await this.#load()
    const state = this.#state
    const status = this.host.status()
    return structuredClone({
      revision: state.revision,
      operations: [...this.#installJobs.values()].map(({ controller, execute, promise, ...job }) => job).reverse(),
      packages: await Promise.all(
        state.installed.map(async entry => {
          try {
            const directory = await this.#directory(entry.id)
            await lstat(join(this.root, 'projects', storageName(entry.id), 'node_modules', entry.name, 'package.json'))
            if (entry.ruleCatalog) return entry
            let catalog = this.#legacyRuleCatalogs.get(entry.id)
            if (!catalog) {
              catalog = this.#inspectTail
                .then(() => this.run(['content', 'npm', 'inspect', directory, '--rule-sets'], this.#controller.signal))
                .then(value => ruleCatalogFor(checkedInspection(value)))
                .catch(() => {
                  this.#legacyRuleCatalogs.delete(entry.id)
                  return undefined
                })
              this.#inspectTail = catalog.then(() => {})
              this.#legacyRuleCatalogs.set(entry.id, catalog)
            }
            return { ...entry, ruleCatalog: await catalog }
          } catch (error) {
            return {
              ...entry,
              error:
                (error as NodeJS.ErrnoException).code === 'ENOENT'
                  ? '包文件已丢失，请卸载记录后重新安装此版本'
                  : (error as Error).message,
            }
          }
        }),
      ),
      serviceStatus: status,
      serviceNeedsRestart: false,
    })
  }
  async #stageFile(file: string, offline = false, signal = this.#controller.signal) {
    return this.#exclusive(async () => {
      if (typeof file !== 'string' || !/\.(?:tgz|zip)$/i.test(file)) throw new Error('请选择 .tgz 或 .zip 内容包')
      const source = await realpath(file),
        info = await lstat(source)
      if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('内容包必须是小于 64 MiB 的普通文件')
      const stage = (archive: string) =>
        this.#stageInstall({ kind: 'file', file: archive, label: basename(source) }, offline, signal)
      if (!/\.zip$/i.test(file)) return stage(source)
      const installer = await this.#createManagedProjects(join(this.root, 'acquisition'), { offline })
      try {
        return await installer.withLocalArchive(source, signal, stage)
      } finally {
        await installer.close()
      }
    })
  }
  async installFile(file: string, offline = false) {
    return this.#installTask(basename(file), signal => this.#stageFile(file, offline, signal))
  }
  async installNpm(spec: unknown, offline = false, verify?: GraphCheck) {
    return this.#installTask(String(spec), signal => this.#stageNpm(spec, offline, signal, verify))
  }
  async installRemote(descriptor: RemotePackageSource) {
    if (!descriptor || !['url', 'git'].includes(descriptor.kind)) throw sourceError('SOURCE_KIND_UNSUPPORTED')
    const source = sourceRegistry({ candidate: descriptor }).candidate as RemotePackageSource
    const url = new URL(source.url)
    if (url.search || url.hash || url.href.length > 2048) throw sourceError('SOURCE_URL_INVALID')
    if (
      source.kind === 'url' &&
      source.integrity !== undefined &&
      (typeof source.integrity !== 'string' ||
        source.integrity.length > 1024 ||
        !source.integrity
          .trim()
          .split(/\s+/)
          .every(token => /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(token)))
    )
      throw sourceError('SOURCE_INTEGRITY_INVALID')
    const label =
      source.kind === 'git'
        ? url.href + '@' + source.commit + (source.artifactPath ? '/' + source.artifactPath : '')
        : url.href
    return this.#installTask(label, signal =>
      this.#exclusive(async () => {
        const installer = await this.#createManagedProjects(join(this.root, 'acquisition'), {})
        try {
          return await installer.withSourceArchive(source, signal, (file, provenance) =>
            this.#stageInstall({ kind: 'file', file, label, provenance }, false, signal),
          )
        } finally {
          await installer.close()
        }
      }),
    )
  }
  #installTask(label: string, execute: InstallTask) {
    if ([...this.#installJobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 30)
      throw new Error('安装队列已满')
    const job: InstallJob = {
      id: randomUUID(),
      label,
      status: 'queued',
      stage: 'queued',
      createdAt: Date.now(),
      controller: new AbortController(),
      execute,
    }
    this.#installJobs.set(job.id, job)
    for (const [id, item] of this.#installJobs)
      if (this.#installJobs.size > 30 && !['queued', 'running'].includes(item.status)) this.#installJobs.delete(id)
    const signal = AbortSignal.any([job.controller.signal, this.#controller.signal])
    job.promise = this.#installTail.then(async () => {
      let plan: InstallPreview | undefined
      try {
        signal.throwIfAborted()
        job.status = 'running'
        job.stage = 'installing'
        plan = await execute(signal)
        signal.throwIfAborted()
        if (plan.existingId === undefined && this.reviewInstall) {
          job.stage = 'reviewing'
          if (!(await this.reviewInstall(plan.package, signal))) job.controller.abort()
          signal.throwIfAborted()
        }
        job.stage = 'recording'
        const id = await this.#installOnly(plan, signal)
        job.status = 'succeeded'
        return id
      } catch (error) {
        if (plan?.id) await this.#cancel(plan.id).catch(() => {})
        job.status = signal.aborted ? 'cancelled' : 'failed'
        job.error = signal.aborted ? '已取消' : (error as Error).message
        throw error
      } finally {
        job.updatedAt = Date.now()
      }
    })
    this.#installTail = job.promise.catch(() => {})
    return job.promise
  }
  cancelInstall(id: string) {
    const job = this.#installJobs.get(id)
    if (!job) throw new Error('安装任务不存在')
    if (job.status === 'queued' || (job.status === 'running' && job.stage !== 'recording')) {
      job.controller.abort()
      if (job.status === 'queued') {
        job.status = 'cancelled'
        job.error = '已移出队列'
        job.updatedAt = Date.now()
      }
    }
  }
  retryInstall(id: string) {
    const job = this.#installJobs.get(id)
    if (!job || !['failed', 'cancelled'].includes(job.status)) throw new Error('此安装任务不能重试')
    return this.#installTask(job.label, job.execute)
  }
  clearInstallTasks() {
    for (const [id, job] of this.#installJobs)
      if (!['queued', 'running'].includes(job.status)) this.#installJobs.delete(id)
  }
  async #installOnly(plan: InstallPreview, signal: AbortSignal) {
    signal.throwIfAborted()
    if (plan.existingId !== undefined) return plan.existingId
    let id
    try {
      signal.throwIfAborted()
      id = await this.#exclusive(async () => {
        signal.throwIfAborted()
        const current = this.#plan(plan.id, 'install')
        const saved = await this.#saveInstalledPlan(current)
        this.#plans.delete(plan.id)
        return saved
      })
    } catch (error) {
      await this.#cancel(plan.id).catch(() => {})
      throw error
    }
    return id
  }
  async #stageNpm(spec: unknown, offline = false, signal = this.#controller.signal, verify?: GraphCheck) {
    return this.#exclusive(async () => {
      if (!isExactPackageSpec(spec)) throw new Error('请输入 npm 包名和明确版本，例如 @author/pets@1.0.0')
      return this.#stageInstall({ kind: 'npm', spec, label: spec, ...(verify && { verify }) }, offline, signal)
    })
  }
  async #stageInstall(
    source: Extract<InstallSource, ProjectSource>,
    offline: boolean,
    signal: AbortSignal,
    state = this.#state,
  ) {
    if (this.#plans.size >= 8) throw new Error('请先完成或取消已有操作')
    if (state.installed.length >= 200) throw new Error('已安装内容包数量达到上限')
    const project = await this.#createProject([source], offline, signal)
    return this.#recordInstall(source, project, state)
  }
  async saveEnvironmentMember(directory: string, name: string, signal: AbortSignal) {
    return this.#exclusive(async () => {
      if (this.#state.installed.length >= 200) throw new Error('已安装内容包数量达到上限')
      const id = randomUUID()
      const destination = join(this.root, 'projects', storageName(id))
      await mkdir(destination)
      try {
        const { archive, inspection } = await this.copyMember(directory, name, undefined, destination, signal)
        const result = await this.#recordInstall(
          { kind: 'file', archive, label: name },
          { id, directory: destination, inspection },
          this.#state,
        )
        if (result.existingId !== undefined) {
          const existing = this.#entry(result.existingId)
          if (!existing.captured) {
            signal.throwIfAborted()
            await this.#update(state => ({
              ...state,
              revision: state.revision + 1,
              installed: state.installed.map(item => (item.id === existing.id ? { ...item, captured: true } : item)),
            }))
          }
          return existing.id
        }
        const plan = this.#plan(result.id, 'install')
        try {
          signal.throwIfAborted()
          return await this.#saveInstalledPlan(plan)
        } finally {
          this.#plans.delete(plan.id)
        }
      } catch (error) {
        await rm(destination, { recursive: true, force: true })
        throw error
      }
    })
  }
  async #recordInstall(source: InstallSource, project: InspectedProject, state: LibraryState): Promise<InstallPreview> {
    try {
      const archive = 'archive' in source ? source.archive : undefined
      const provenance = 'provenance' in source ? source.provenance : undefined
      const manifest = await readJson<PackageManifest>(join(project.directory, 'package.json'))
      const names = Object.keys(manifest.dependencies ?? {})
      if (names.length !== 1) throw new Error('一次只能添加一个根内容包')
      const root = project.inspection.packages.find(pkg => pkg.location === 'node_modules/' + names[0])
      if (!root?.catalogIds && (!root?.manifest || !root.draft)) throw new Error('该 npm 包没有 Arcadia 内容声明')
      if (provenance && project.inspection.packages.some(pkg => pkg.manifest?.effects && !pkg.manifest.effectArtifact))
        throw new Error('远程安装需要预构建的 Effect 产物，请选择发行归档或预构建目录')
      if (source.kind === 'npm' && source.verify) await source.verify(graphFor(project.inspection))
      const existing = state.installed.find(item => item.name === root.name && item.version === root.version)
      if (existing) {
        if (source.kind === 'file' && existing.source.kind === 'file') {
          const previous = await readFile(join(await this.#directory(existing.id), existing.source.file))
          const next = await readFile(join(project.directory, archive ?? 'candidates/content-0.tgz'))
          if (
            previous.equals(next) &&
            JSON.stringify(existing.graph) === JSON.stringify(graphFor(project.inspection))
          ) {
            await rm(project.directory, { recursive: true, force: true })
            return { existingId: existing.id }
          }
        }
        throw new Error('此包版本已有不同材料，请使用新的版本号')
      }
      const packageManifest = await readJson<PackageManifest>(join(project.directory, root.location, 'package.json'))
      const author = typeof packageManifest.author === 'string' ? packageManifest.author : packageManifest.author?.name
      const entry: ReviewedEntry = {
        id: project.id,
        ...(archive && { captured: true }),
        name: root.name,
        title: root.draft?.project.title || (root.officialHost ? '官方基础内容' : root.name),
        version: root.version,
        namespace: root.manifest?.namespace ?? 'base',
        projectId: root.manifest?.projectId ?? 'base',
        description: root.draft?.project.description || packageManifest.description || '',
        author: typeof author === 'string' ? author : '',
        sdkApi: root.manifest?.sdkApi ?? packageManifest.arcadia?.sdkApi,
        license: typeof packageManifest.license === 'string' ? packageManifest.license : undefined,
        engines:
          packageManifest.engines && typeof packageManifest.engines === 'object' ? packageManifest.engines : undefined,
        dependencyRanges: root.dependencyRanges ?? {},
        source:
          source.kind === 'npm'
            ? { kind: 'npm', spec: source.spec, label: source.label }
            : {
                kind: 'file',
                file: archive ?? 'candidates/content-0.tgz',
                label: source.label,
                ...(provenance && { provenance }),
              },
        graph: graphFor(project.inspection),
        ruleCatalog: ruleCatalogFor(project.inspection),
        contentIds: idsFor(project.inspection.packages),
        counts: Object.fromEntries(
          contentKinds.map(kind => [kind, (root.draft?.data[kind] ?? root.catalogIds?.[kind])?.length ?? 0]),
        ) as LibraryEntry['counts'],
        containsCode: project.inspection.packages.some(
          pkg => !!(pkg.officialHost || pkg.manifest?.effects || pkg.manifest?.effectArtifact),
        ),
        installedAt: new Date().toISOString(),
      }
      const plan: InstallPlan = {
        id: randomUUID(),
        kind: 'install',
        revision: state.revision,
        project: project.id,
        entry,
      }
      this.#plans.set(plan.id, plan)
      return { id: plan.id, kind: 'install', package: structuredClone(entry), requiresApproval: true }
    } catch (error) {
      await rm(project.directory, { recursive: true, force: true })
      throw error
    }
  }
  async #saveInstalledPlan(plan: InstallPlan) {
    await this.#update(state => ({
      ...state,
      revision: state.revision + 1,
      installed: [...state.installed, plan.entry],
    }))
    return plan.entry.id
  }
  /** Prepare a named management environment without changing local-play selection.
   * Material resolution depends only on explicit declarations and registered sources.
   */
  async prepareEnvironmentProject(
    document: EnvironmentDocument,
    { signal, offline = false, onProgress, projectDirectory }: ProjectPreparationOptions = {},
  ) {
    return this.#exclusive(async () => {
      if (!document || typeof document.packages !== 'object' || !document.packages || Array.isArray(document.packages))
        throw new Error('环境包配置无效')
      await onProgress?.({ stage: 'resolving' })
      const requested = Object.entries(document.packages).sort(([a], [b]) => a.localeCompare(b))
      const sourceIds = document.sources ?? []
      if (
        !Array.isArray(sourceIds) ||
        new Set(sourceIds).size !== sourceIds.length ||
        sourceIds.some(name => typeof name !== 'string' || !packageName.test(name)) ||
        requested.length + sourceIds.length > 100 ||
        requested.some(
          ([name, version]) =>
            !packageName.test(name) ||
            typeof version !== 'string' ||
            !version.trim() ||
            (!/^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(version) &&
              (/[\/\\]/.test(version) || /^(?:file|link|workspace):/.test(version))),
        )
      )
        throw new Error('环境包配置无效')
      const combined = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal
      combined.throwIfAborted()
      const selectedSources: Record<string, ManagedSource> = {},
        installedSources = new Map<string, LibraryEntry>()
      for (const name of sourceIds) {
        if (name === '@arcadia-eternity/data-pack-base') continue
        if (Object.hasOwn(document.packages, name)) throw sourceError('INSTALL_DUPLICATE_PACKAGE')
        if (Object.hasOwn(this.#sources, name)) selectedSources[name] = this.#sources[name]
        else {
          const installed = this.#state.installed.filter(entry => entry.name === name)
          if (!installed.length) throw sourceError('INSTALL_SOURCE_NOT_REGISTERED')
          if (installed.length !== 1) throw sourceError('INSTALL_SOURCE_AMBIGUOUS')
          const entry = installed[0]
          installedSources.set(name, entry)
          requested.push([name, entry.version])
        }
      }
      requested.sort(([a], [b]) => a.localeCompare(b))
      let id: string, directory: string
      {
        let project: { id: string; directory: string; inspection?: NpmProjectInspection }
        const savedMembers = new Map<string, LibraryEntry>()
        for (const [name, version] of requested) {
          const stored = this.#state.installed.find(
            entry => entry.captured && entry.name === name && entry.version === version,
          )
          if (stored) savedMembers.set(name, stored)
        }
        if (
          projectDirectory ||
          savedMembers.size ||
          requested.some(([name]) => name === '@arcadia-eternity/data-pack-base') ||
          sourceIds.includes('@arcadia-eternity/data-pack-base') ||
          Object.keys(selectedSources).length
        ) {
          // Share the headless source/lock/install pipeline, then transfer its one
          // tree into the client library before committing the persistent environment.
          const packages = Object.fromEntries(requested)
          for (const [name, version] of requested) {
            if (savedMembers.has(name)) continue
            if (name === '@arcadia-eternity/data-pack-base') continue
            const entry =
              installedSources.get(name) ??
              this.#state.installed.find(
                item => item.name === name && item.version === version && item.source.kind === 'file',
              )
            if (entry?.source.kind === 'file') {
              selectedSources[name] = {
                kind: 'archive',
                file: join(await this.#directory(entry.id), entry.source.file),
              }
              delete packages[name]
            }
          }
          const acquisition = join(this.root, 'acquisition')
          await mkdir(acquisition, { recursive: true })
          if ((await realpath(acquisition)) !== acquisition) throw sourceError('INSTALL_ROOT_INVALID')
          const installer = await this.#createManagedProjects(acquisition, {
            sources: selectedSources,
            resolveBaseVersion: async version => {
              for (const ref of this.#state.officialHistory ?? []) {
                if (ref.version !== version) continue
                const entry = await this.#readOfficial(ref)
                if (
                  entry.engines?.arcadia &&
                  (this.packageUpdates?.clientVersion === undefined ||
                    !semver.satisfies(this.packageUpdates.clientVersion, entry.engines.arcadia))
                )
                  continue
                if (entry.materialDigest && entry.materialDigest !== (await this.#digestEntry(entry))) continue
                return join(await this.#directory(entry.id), 'node_modules', officialPackage)
              }
            },
            offline,
            allowThirdPartyContent: true,
          })
          const seeds = []
          try {
            for (const [name, entry] of savedMembers) {
              const merged = await mkdtemp(join(acquisition, 'member-'))
              seeds.push(merged)
              const hasProject =
                projectDirectory &&
                (await lstat(join(projectDirectory, 'package.json')).catch(error => {
                  if (error.code !== 'ENOENT') throw error
                }))
              const { archive } = await this.copyMember(
                await this.#directory(entry.id),
                name,
                hasProject ? projectDirectory : undefined,
                merged,
                combined,
              )
              packages[name] = 'file:' + archive
              projectDirectory = merged
            }
            project = await installer.prepareProject(
              {
                ...document,
                packages,
                sources: [
                  ...sourceIds.filter(name => name === '@arcadia-eternity/data-pack-base'),
                  ...Object.keys(selectedSources),
                ],
              },
              { signal: combined, onProgress, projectDirectory },
              async staged => {
                combined.throwIfAborted()
                const id = randomUUID(),
                  directory = join(this.root, 'projects', storageName(id))
                await rename(staged, directory)
                return { id, directory }
              },
            )
          } finally {
            for (const seed of seeds) await rm(seed, { recursive: true, force: true })
            await installer.close()
          }
        } else {
          const sources: ProjectSource[] = []
          for (const [name, version] of requested) {
            const installed =
              installedSources.get(name) ??
              this.#state.installed.find(entry => entry.name === name && entry.version === version)
            sources.push(
              installed?.source.kind === 'file'
                ? { kind: 'file', file: join(await this.#directory(installed.id), installed.source.file) }
                : { kind: 'npm', spec: `${name}@${version}` },
            )
          }
          await onProgress?.({ stage: 'installing' })
          project = await this.#createProject(sources, offline, combined)
        }
        id = project.id
        directory = project.directory
        try {
          combined.throwIfAborted()
          if (this.authorizeEnvironment) {
            const inspection =
              project.inspection ??
              checkedInspection(await this.run(['content', 'npm', 'inspect', directory], combined))
            const effects = inspection.packages.filter(
              pkg => !pkg.officialHost && (pkg.manifest?.effects || pkg.manifest?.effectArtifact),
            )
            if (effects.length && !(await this.authorizeEnvironment(document, effects, combined)))
              throw new Error('未授权本机环境使用这些效果')
            combined.throwIfAborted()
          }
          await this.run(['content', 'npm', 'approve', directory, '--profile', 'local-development'], combined)
          combined.throwIfAborted()
        } catch (error) {
          await rm(directory, { recursive: true, force: true })
          throw error
        }
      }
      this.#leases.set(id, (this.#leases.get(id) ?? 0) + 1)
      let released = false
      return {
        directory,
        release: async () => {
          if (released) return
          released = true
          const count = (this.#leases.get(id) ?? 1) - 1
          if (count) this.#leases.set(id, count)
          else this.#leases.delete(id)
          this.#scheduleGc()
        },
      }
    })
  }
  async #cancel(id: string) {
    return this.#exclusive(async () => {
      const plan = this.#plans.get(id)
      if (!plan) return
      this.#plans.delete(id)
      await rm(await this.#directory(plan.project), { recursive: true, force: true })
    })
  }
  /** Forget migration-only state after the named environment has been committed. */
  async retireLegacySelection() {
    return this.#exclusive(async () => {
      if (!this.#state.legacySelection) return
      await this.#update(state => {
        const { legacySelection: _legacy, ...current } = state
        return { ...current, revision: state.revision + 1 }
      })
    })
  }
  async uninstall(id: string) {
    return this.#exclusive(async () => {
      if (this.#entry(id).bundled) throw new Error('默认环境必须保留基础内容包')
      if (this.#state.legacySelection?.project === id) throw new Error('内容仍用于旧环境迁移')
      const directory = join(this.root, 'projects', storageName(id))
      try {
        await this.#directory(id)
      } catch (error) {
        if ((await lstat(directory).catch(() => null)) !== null) throw error
      }
      await this.#update(state => {
        return { ...state, revision: state.revision + 1, installed: state.installed.filter(item => item.id !== id) }
      })
      this.#legacyRuleCatalogs.delete(id)
      await rm(directory, { recursive: true, force: true })
    })
  }
  async resume() {
    await this.#load()
    await this.collectGarbage().catch(() => {})
  }
  async close() {
    this.#controller.abort()
    clearTimeout(this.#gcTimer)
    await this.#installTail
    await this.#idle
    await this.#writes
    for (const plan of this.#plans.values()) {
      await rm(join(this.root, 'projects', storageName(plan.project)), { recursive: true, force: true })
    }
    this.#plans.clear()
  }
}
