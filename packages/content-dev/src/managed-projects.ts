import { sha256Hex } from '@arcadia-eternity/const'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { withOfficialUpdateDirectory, type PackageUpdate } from './package-updates.ts'
export {
  officialPackage,
  findPackageUpdate,
  selectPackageUpdate,
  selectServerBase,
  installServerBaseUpdate,
} from './package-updates.ts'
import { isDeepStrictEqual, promisify } from 'node:util'
import { satisfies, valid, validRange } from 'semver'
import {
  inspectNpmProject,
  resolveNpmInvocation,
  withShippedEnvironmentProject,
  withShippedCatalogArchive,
} from '@arcadia-eternity/pack-loader/node'
import { normalizeEnvironmentDocument } from './debug-environments.ts'
import { acquireSource } from './managed-sources.ts'
import { contentError, materialFiles, writeMaterials } from './workspace-materials.ts'
import type {
  ContentWorkspace,
  EnvironmentInstallation,
  PrepareEnvironmentInput,
  StaticPreparer,
} from './content-workspace.ts'
import type { ManagedSource } from './managed-sources.ts'
import { errorCode, isRecord, type UnknownRecord } from './types.ts'

export interface ManagedProjectsOptions {
  bundledPackageRoot?: string
  resolveBaseVersion?: (version: string) => Promise<string | undefined>
  registry?: string
  offline?: boolean
  /** Host permission to acquire metadata/materials; never grants authority to execute them. */
  allowThirdPartyContent?: boolean
  sources?: Record<string, ManagedSource>
  npmUserConfig?: string
  timeoutMs?: number
  maxBytes?: number
  maxFiles?: number
  maxConcurrent?: number
}

const execute = promisify(execFile)
const DEFAULT_TIMEOUT = 120_000
const DEFAULT_BYTES = 256 * 1024 * 1024
const packageName = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/

function limit(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) throw contentError('INSTALL_LIMIT_INVALID')
  return result
}
function registryUrl(value: string | undefined): string {
  const url = new URL(value ?? 'https://registry.npmjs.org/')
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw contentError('INSTALL_REGISTRY_INVALID')
  return url.href
}
function checkDependencySpecs(manifest: UnknownRecord) {
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
    if (manifest[field] === undefined) continue
    if (!manifest[field] || typeof manifest[field] !== 'object' || Array.isArray(manifest[field]))
      throw contentError('INSTALL_DEPENDENCY_INVALID')
    const entries = manifest[field]
    if (!isRecord(entries)) throw contentError('INSTALL_DEPENDENCY_INVALID')
    for (const [name, range] of Object.entries(entries)) {
      if (
        !packageName.test(name) ||
        typeof range !== 'string' ||
        (!validRange(range) && !/^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(range))
      )
        throw contentError('INSTALL_DEPENDENCY_SOURCE_FORBIDDEN')
    }
  }
}
function checkLock(lock: unknown, candidates = false): void {
  if (!isRecord(lock) || lock.lockfileVersion !== 3 || !isRecord(lock.packages))
    throw contentError('INSTALL_LOCK_INVALID')
  for (const [location, value] of Object.entries(lock.packages)) {
    if (!isRecord(value) || value.link) throw contentError('INSTALL_LOCK_INVALID')
    const entry = value
    if (
      location &&
      (!location.startsWith('node_modules/') || location.split('/').includes('..') || location.includes('\\'))
    )
      throw contentError('INSTALL_LOCK_INVALID')
    if (typeof entry.resolved !== 'string') continue
    if (candidates && /^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(entry.resolved)) continue
    const url = new URL(entry.resolved)
    if (url.protocol !== 'https:' || url.username || url.password)
      throw contentError('INSTALL_DEPENDENCY_SOURCE_FORBIDDEN')
  }
}
/** No inherited npm configuration, loader hooks, or author script can alter install behavior. */
function installationEnvironment(cache: string, configuration: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG'])
    if (process.env[key]) result[key] = process.env[key]
  if (process.env.ELECTRON_RUN_AS_NODE === '1' || process.versions.electron) result.ELECTRON_RUN_AS_NODE = '1'
  return {
    ...result,
    npm_config_cache: cache,
    npm_config_userconfig: configuration,
    npm_config_globalconfig: configuration + '.global',
    npm_config_ignore_scripts: 'true',
    npm_config_engine_strict: 'true',
    npm_config_strict_peer_deps: 'true',
    npm_config_force: 'false',
    npm_config_legacy_peer_deps: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  }
}

/**
 * Resolves a captured draft into a standard installed npm project. Construction and
 * source registration belong to the host, while requests contain only environment IDs.
 * The ContentWorkspace still owns immutable versions, leases, and publication.
 */
export class ManagedProjects {
  readonly root: string
  #options: ManagedProjectsOptions & {
    registry: string
    sources: Record<string, ManagedSource>
    timeoutMs: number
    maxBytes: number
    maxFiles: number
    maxConcurrent: number
  }
  #controller = new AbortController()
  #pending = new Set<Promise<unknown>>()
  #active = 0
  constructor(root: string, options: ManagedProjectsOptions = {}) {
    this.root = resolve(root)
    if (
      options.sources !== undefined &&
      (!options.sources || typeof options.sources !== 'object' || Array.isArray(options.sources))
    )
      throw contentError('INSTALL_SOURCES_INVALID')
    this.#options = {
      ...options,
      registry: registryUrl(options.registry),
      sources: structuredClone(options.sources ?? {}),
      timeoutMs: limit(options.timeoutMs, DEFAULT_TIMEOUT, 3600_000),
      maxBytes: limit(options.maxBytes, DEFAULT_BYTES, 4 * 1024 * 1024 * 1024),
      maxFiles: limit(options.maxFiles, 50_000, 1_000_000),
      maxConcurrent: limit(options.maxConcurrent, 2, 16),
    }
    for (const name of Object.keys(this.#options.sources))
      if (!packageName.test(name)) throw contentError('INSTALL_SOURCE_NAME_INVALID')
  }
  async #npm(args: string[], cwd: string, signal: AbortSignal): Promise<void> {
    const invocation = await resolveNpmInvocation(args)
    const cache = join(this.root, 'npm-cache')
    const configuration = this.#options.npmUserConfig ?? join(this.root, 'empty.npmrc')
    await mkdir(cache, { recursive: true, mode: 0o700 })
    if (!this.#options.npmUserConfig) {
      await writeFile(configuration, '', { mode: 0o600 })
      await writeFile(configuration + '.global', '', { mode: 0o600 })
    }
    try {
      await execute(invocation.file, invocation.args, {
        cwd,
        signal,
        timeout: this.#options.timeoutMs,
        killSignal: 'SIGTERM',
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
        env: installationEnvironment(cache, configuration),
      })
    } catch (error) {
      signal.throwIfAborted()
      if (isRecord(error) && typeof error.stderr === 'string' && /\bERESOLVE\b/.test(error.stderr))
        throw contentError('ENVIRONMENT_DEPENDENCY_CONFLICT')
      // Do not include subprocess output/configuration paths in public task errors.
      throw contentError('NPM_INSTALL_FAILED')
    }
  }
  /** Resolve an author lock in isolation from the source tree and its linked development SDK. */
  async authorLock(manifest: UnknownRecord, previous?: string) {
    const allowed = [
      'name',
      'version',
      'license',
      'engines',
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
      'peerDependenciesMeta',
    ]
    const metadata = Object.fromEntries(
      allowed.filter(key => Object.hasOwn(manifest, key)).map(key => [key, manifest[key]]),
    )
    checkDependencySpecs(metadata)
    checkDependencySpecs({ dependencies: metadata.devDependencies })
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const specs = metadata[field]
      if (isRecord(specs) && Object.values(specs).some(value => typeof value !== 'string' || !validRange(value)))
        throw contentError('INSTALL_DEPENDENCY_SOURCE_FORBIDDEN')
    }
    if (previous) checkLock(JSON.parse(previous))
    const project = join(this.root, 'project')
    await mkdir(project)
    await writeFile(join(project, 'package.json'), JSON.stringify(metadata))
    const path = join(project, 'package-lock.json')
    if (previous) await writeFile(path, previous)
    await this.#npm(
      ['install', '--package-lock-only', '--ignore-scripts', '--registry', this.#options.registry],
      project,
      this.#controller.signal,
    )
    const result = await readFile(path, 'utf8')
    checkLock(JSON.parse(result))
    return result
  }
  async #packSource(source: ManagedSource, destination: string, signal: AbortSignal, expectedName?: string) {
    const captured = await acquireSource(source, {
      destination,
      preserveNpmArchive: true,
      signal,
      maxBytes: this.#options.maxBytes,
      maxFiles: this.#options.maxFiles,
      timeoutMs: this.#options.timeoutMs,
    })
    const manifest: UnknownRecord = JSON.parse(await readFile(join(captured.directory, 'package.json'), 'utf8'))
    if (
      typeof manifest.name !== 'string' ||
      !packageName.test(manifest.name) ||
      (expectedName && manifest.name !== expectedName)
    )
      throw contentError('INSTALL_SOURCE_IDENTITY')
    if (typeof manifest.version !== 'string' || !valid(manifest.version)) throw contentError('INSTALL_SOURCE_VERSION')
    checkDependencySpecs(manifest)
    try {
      checkLock(JSON.parse(await readFile(join(captured.directory, 'npm-shrinkwrap.json'), 'utf8')))
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
    if (captured.archive) return { file: captured.archive, provenance: captured.provenance }
    const output = join(destination, 'packed')
    await mkdir(output)
    await this.#npm(
      ['pack', '--ignore-scripts', '--json', '--pack-destination', output, '--registry', this.#options.registry],
      captured.directory,
      signal,
    )
    const files = await readdir(output)
    if (files.length !== 1 || !files[0].endsWith('.tgz')) throw contentError('INSTALL_PACK_INVALID')
    return { file: join(output, files[0]), provenance: captured.provenance }
  }
  async withLocalArchive<T>(file: string, signal: AbortSignal, consume: (archive: string) => Promise<T>) {
    return this.withSourceArchive({ kind: 'archive', file }, signal, consume)
  }
  async withSourceArchive<T>(
    source: ManagedSource,
    signal: AbortSignal,
    consume: (archive: string, provenance: Record<string, string>) => Promise<T>,
  ) {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(this.root, 'archive-'))
    try {
      const captured = await this.#packSource(source, join(staging, 'source'), signal)
      return await consume(captured.file, captured.provenance)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
  prepareEnvironment(
    workspace: ContentWorkspace,
    input: {
      onProgress?: PrepareEnvironmentInput['onProgress']
      environmentId: string
      seedDirectory?: string
      useSelectedBase?: boolean
      expectedRevision: string | null
      document?: PrepareEnvironmentInput['document']
      signal?: AbortSignal
      beforeCommit?: () => Promise<void>
    },
    validate: StaticPreparer,
  ): Promise<EnvironmentInstallation> {
    if (typeof validate !== 'function') return Promise.reject(contentError('STATIC_PREPARER_REQUIRED'))
    return this.#track(
      this.#prepare(
        async () => {
          const draft = await workspace.getDraft(input.environmentId).catch(error => {
            if (errorCode(error) !== 'ENOENT') throw error
            return undefined
          })
          if ((draft?.revision ?? null) !== input.expectedRevision) throw contentError('REVISION_CONFLICT')
          return input.document ?? draft?.document
        },
        {
          ...input,
          projectDirectory: input.seedDirectory ?? join(workspace.root, 'environments', input.environmentId),
        },
        async (directory, signal, document) => {
          return workspace.prepareEnvironment({ ...input, document, projectDirectory: directory, signal }, validate)
        },
      ),
    )
  }
  /** Refresh only shipped bytes, without resolving or downloading third-party dependencies. */
  async synchronizeBundledBase(workspace: ContentWorkspace, validate: StaticPreparer): Promise<void> {
    for (const draft of await workspace.listDrafts()) {
      await this.synchronizeProject(
        join(workspace.root, 'environments', draft.document.id),
        async (directory, version) => {
          const name = '@arcadia-eternity/data-pack-base'
          await workspace.prepareEnvironment(
            {
              environmentId: draft.document.id,
              expectedRevision: draft.revision,
              document: {
                ...draft.document,
                packages: { ...draft.document.packages, [name]: version },
                sources: draft.document.sources.filter(source => source !== name),
              },
              projectDirectory: directory,
              signal: this.#controller.signal,
            },
            validate,
          )
        },
      )
    }
  }
  synchronizeProject<T>(
    project: string,
    consume: (directory: string, version: string) => Promise<T>,
  ): Promise<T | undefined> {
    return this.#track(this.#synchronizeProject(project, consume))
  }
  async #synchronizeProject<T>(
    project: string,
    consume: (directory: string, version: string) => Promise<T>,
  ): Promise<T | undefined> {
    const signal = this.#controller.signal
    signal.throwIfAborted()
    const base = '@arcadia-eternity/data-pack-base'
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    const installed = join('node_modules', base).replaceAll('\\', '/')
    const lock = JSON.parse(
      await readFile(join(project, 'package-lock.json'), 'utf8').catch(error => {
        if (errorCode(error) !== 'ENOENT') throw error
        return JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: manifest.dependencies ?? {} } } })
      }),
    )
    if (
      !Object.hasOwn(manifest.dependencies ?? {}, base) &&
      !lock.packages?.[installed] &&
      !manifest.arcadiaEnvironment?.sources?.includes(base)
    )
      return
    if (!this.#options.bundledPackageRoot) throw contentError('BUNDLED_PACKAGE_UNAVAILABLE')
    return withShippedEnvironmentProject(this.#options.bundledPackageRoot, async shipped => {
      const fresh = await materialFiles(shipped, { signal })
      const current = await materialFiles(project, { allowMissingLock: true, signal })
      const baseFiles = fresh.filter(file => file.path.startsWith(installed + '/'))
      const version = JSON.parse(baseFiles.find(file => file.path === installed + '/package.json')!.bytes.toString())
        .version as string
      const previous = new Map(
        current.filter(file => file.path.startsWith(installed + '/')).map(file => [file.path, file.bytes]),
      )
      if (
        manifest.dependencies?.[base] === version &&
        previous.size === baseFiles.length &&
        baseFiles.every(file => previous.get(file.path)?.equals(file.bytes))
      )
        return
      await mkdir(this.root, { recursive: true })
      const directory = await mkdtemp(join(this.root, 'sync-base-'))
      try {
        manifest.dependencies = { ...manifest.dependencies, [base]: version }
        if (manifest.arcadiaManagedSources) delete manifest.arcadiaManagedSources[base]
        lock.packages[''] = { ...lock.packages[''], dependencies: manifest.dependencies }
        for (const key of Object.keys(lock.packages))
          if (key === installed || key.startsWith(installed + '/')) delete lock.packages[key]
        lock.packages[installed] = { name: base, version }
        const files = current.filter(
          file =>
            !file.path.startsWith(installed + '/') &&
            file.path !== 'node_modules/.package-lock.json' &&
            file.path !== 'package.json' &&
            file.path !== 'package-lock.json',
        )
        await writeMaterials(directory, [
          ...files,
          ...baseFiles,
          { path: 'package.json', bytes: Buffer.from(JSON.stringify(manifest)) },
          { path: 'package-lock.json', bytes: Buffer.from(JSON.stringify(lock)) },
        ])
        await inspectNpmProject(directory)
        signal.throwIfAborted()
        return await consume(directory, version)
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }
  /** Transfer an installed project to the host's existing library without a second copy. */
  prepareProject<T>(
    document: unknown,
    input: { signal?: AbortSignal; onProgress?: PrepareEnvironmentInput['onProgress']; projectDirectory?: string },
    consume: (directory: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.#track(this.#prepare(async () => document, input ?? {}, consume))
  }
  #track<T>(task: Promise<T>): Promise<T> {
    this.#pending.add(task)
    task.finally(() => this.#pending.delete(task)).catch(() => {})
    return task
  }
  async #prepare<T>(
    readDocument: () => Promise<unknown>,
    input: {
      signal?: AbortSignal
      onProgress?: PrepareEnvironmentInput['onProgress']
      projectDirectory?: string
      useSelectedBase?: boolean
    },
    consume: (directory: string, signal: AbortSignal, document: PrepareEnvironmentInput['document']) => Promise<T>,
  ): Promise<T> {
    if (this.#controller.signal.aborted) throw contentError('INSTALLER_CLOSED')
    if (this.#active >= this.#options.maxConcurrent) throw contentError('INSTALL_BUSY')
    if (typeof consume !== 'function') throw contentError('PROJECT_CONSUMER_REQUIRED')
    this.#active++
    let directory: string | undefined
    const signal = AbortSignal.any([
      this.#controller.signal,
      ...(input.signal ? [input.signal] : []),
      AbortSignal.timeout(this.#options.timeoutMs),
    ])
    try {
      signal.throwIfAborted()
      await input.onProgress?.({ stage: 'resolving' })
      const document = normalizeEnvironmentDocument(await readDocument())
      if (Object.keys(document.packages).length + document.sources.length > 200)
        throw contentError('INSTALL_PACKAGE_LIMIT')
      const dependencies: Record<string, string> = {}
      for (const [name, range] of Object.entries(document.packages)) {
        if (
          typeof range !== 'string' ||
          range.length > 256 ||
          (!validRange(range) && !/^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(range))
        )
          throw contentError('INSTALL_VERSION_INVALID')
        dependencies[name] = range
      }
      const baseName = '@arcadia-eternity/data-pack-base'
      const includesBase = Object.hasOwn(dependencies, baseName) || document.sources.includes(baseName)
      if (Object.hasOwn(dependencies, baseName) && document.sources.includes(baseName))
        throw contentError('INSTALL_DUPLICATE_PACKAGE')
      let baseRoot = this.#options.bundledPackageRoot
      if (includesBase && !baseRoot) throw contentError('BUNDLED_PACKAGE_UNAVAILABLE')
      if (includesBase) {
        let range = dependencies[baseName]
        if (!input.useSelectedBase && input.projectDirectory && range) {
          const seed = join(input.projectDirectory, 'node_modules', baseName)
          const resolved = await realpath(seed).catch(error => {
            if (errorCode(error) !== 'ENOENT') throw error
          })
          if (resolved) {
            if (resolved !== join(await realpath(input.projectDirectory), 'node_modules', baseName))
              throw contentError('MATERIAL_PATH_ESCAPE')
            const pinned = JSON.parse(await readFile(join(seed, 'package.json'), 'utf8'))
            if (range.startsWith('file:')) {
              const lock = JSON.parse(await readFile(join(input.projectDirectory, 'package-lock.json'), 'utf8'))
              const member = lock.packages?.['node_modules/' + baseName]
              if (member?.resolved !== range || member.version !== pinned.version)
                throw contentError('BASE_PACK_VERSION_UNAVAILABLE')
              range = member.version
            }
            if (pinned.name === baseName && satisfies(pinned.version, range)) baseRoot = resolved
          }
        }
        let baseManifest = JSON.parse(await readFile(join(baseRoot!, 'package.json'), 'utf8'))
        if (range && !satisfies(baseManifest.version, range)) {
          const cached = valid(range) && (await this.#options.resolveBaseVersion?.(range))
          if (!cached) throw contentError('BASE_PACK_VERSION_UNAVAILABLE', '本机缺少环境所需的基础包 ' + range)
          baseRoot = cached
          baseManifest = JSON.parse(await readFile(join(cached, 'package.json'), 'utf8'))
          if (!satisfies(baseManifest.version, range)) throw contentError('BASE_PACK_VERSION_UNAVAILABLE')
        }
        if (baseManifest.name !== baseName) throw contentError('BUNDLED_PACKAGE_INVALID')
        dependencies[baseName] = baseManifest.version
        document.packages[baseName] = baseManifest.version
        document.sources = document.sources.filter(name => name !== baseName)
        if (Object.keys(dependencies).every(name => name === baseName) && document.sources.length === 0) {
          await input.onProgress?.({ stage: 'preparing' })
          return await withShippedEnvironmentProject(baseRoot!, async staged => {
            const manifest = JSON.parse(await readFile(join(staged, 'package.json'), 'utf8'))
            const saved = input.projectDirectory
              ? JSON.parse(
                  await readFile(join(input.projectDirectory, 'package.json'), 'utf8').catch(error => {
                    if (errorCode(error) !== 'ENOENT') throw error
                    return '{}'
                  }),
                )
              : {}
            const project = {
              ...manifest,
              ...saved,
              dependencies: {
                [baseName]: baseManifest.version,
              },
            }
            const lock = JSON.parse(await readFile(join(staged, 'package-lock.json'), 'utf8'))
            lock.name = project.name
            lock.version = project.version
            lock.packages[''] = { name: project.name, version: project.version, dependencies: project.dependencies }
            await writeFile(join(staged, 'package.json'), JSON.stringify(project))
            await writeFile(join(staged, 'package-lock.json'), JSON.stringify(lock))
            signal.throwIfAborted()
            return consume(staged, signal, document)
          })
        }
      }
      // Acquisition approval is separate from any runtime execution policy. This
      // installer never evaluates author modules or invokes lifecycle scripts.
      if (
        !this.#options.allowThirdPartyContent &&
        (Object.keys(dependencies).some(name => name !== baseName) || document.sources.some(name => name !== baseName))
      )
        throw contentError('THIRD_PARTY_CONTENT_NOT_AUTHORIZED')
      await mkdir(join(this.root, 'staging'), { recursive: true, mode: 0o700 })
      directory = await mkdtemp(join(this.root, 'staging', 'prepare-'))
      await mkdir(join(directory, 'candidates'))
      const localSpecs = new Set(
        Object.entries(dependencies)
          .filter(([name, spec]) => name !== baseName && spec.startsWith('file:'))
          .map(([, spec]) => spec),
      )
      if (input.projectDirectory && localSpecs.size) {
        const previous = await readFile(join(input.projectDirectory, 'package-lock.json'), 'utf8').catch(error => {
          if (errorCode(error) !== 'ENOENT') throw error
        })
        if (previous)
          for (const entry of Object.values(JSON.parse(previous).packages ?? {})) {
            if (
              isRecord(entry) &&
              typeof entry.resolved === 'string' &&
              /^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(entry.resolved)
            )
              localSpecs.add(entry.resolved)
          }
      }
      for (const spec of localSpecs) {
        if (!input.projectDirectory) throw contentError('ENVIRONMENT_SOURCE_MISSING')
        const relativeFile = spec.slice(5)
        const sourceFile = join(await realpath(input.projectDirectory), relativeFile)
        if ((await realpath(sourceFile)) !== sourceFile) throw contentError('MATERIAL_PATH_ESCAPE')
        await writeFile(join(directory, relativeFile), await readFile(sourceFile))
      }
      if (includesBase) {
        await withShippedCatalogArchive(baseRoot!, undefined, async file => {
          const bytes = await readFile(file)
          const filename = `candidates/base-${sha256Hex(bytes)}.tgz`
          await writeFile(join(directory!, filename), bytes)
          dependencies[baseName] = 'file:' + filename
        })
      }
      const provenance: Record<string, unknown> = {}
      for (const [index, name] of document.sources.entries()) {
        if (name === baseName) continue
        if (Object.hasOwn(dependencies, name)) throw contentError('INSTALL_DUPLICATE_PACKAGE')
        const source = this.#options.sources[name]
        if (!source) throw contentError('INSTALL_SOURCE_NOT_REGISTERED')
        if (this.#options.offline && (source.kind === 'url' || source.kind === 'git'))
          throw contentError('INSTALL_SOURCE_OFFLINE')
        await input.onProgress?.({ stage: 'acquiring', completed: index, total: document.sources.length })
        const staged = join(directory, 'source-' + index)
        const captured = await this.#packSource(source, staged, signal, name)
        const archiveDigest = sha256Hex(await readFile(captured.file))
        const filename = `candidates/source-${index}-${archiveDigest}.tgz`
        await rename(captured.file, join(directory, filename))
        dependencies[name] = 'file:' + filename
        provenance[name] = captured.provenance
        await rm(staged, { recursive: true, force: true })
      }
      const savedManifest = input.projectDirectory
        ? (JSON.parse(
            await readFile(join(input.projectDirectory, 'package.json'), 'utf8').catch(error => {
              if (errorCode(error) !== 'ENOENT') throw error
              return '{}'
            }),
          ) as UnknownRecord)
        : {}
      if (input.projectDirectory) {
        const lock = await readFile(join(input.projectDirectory, 'package-lock.json')).catch(error => {
          if (errorCode(error) !== 'ENOENT') throw error
          return undefined
        })
        if (lock) {
          await writeFile(join(directory, 'package-lock.json'), lock)
          // A captured installation is sufficient for rule edits and reuse after the source/cache is gone.
          if (
            localSpecs.size &&
            !document.sources.length &&
            isDeepStrictEqual(savedManifest.dependencies, dependencies)
          ) {
            const locked = JSON.parse(lock.toString())
            checkLock(locked, true)
            if (isDeepStrictEqual(locked.packages['']?.dependencies, dependencies)) {
              const inspection = await inspectNpmProject(input.projectDirectory).catch(() => undefined)
              signal.throwIfAborted()
              if (inspection) {
                const captured = await mkdtemp(join(directory, 'captured-'))
                const limits = { signal, maxBytes: this.#options.maxBytes, maxFiles: this.#options.maxFiles }
                await writeMaterials(captured, await materialFiles(input.projectDirectory, limits), limits)
                return await consume(captured, signal, document)
              }
            }
          }
        }
      }
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify(
          {
            ...savedManifest,
            name: savedManifest.name ?? 'arcadia-managed-environment',
            version: '1.0.0',
            private: true,
            dependencies,
            arcadiaManagedSources: provenance,
          },
          null,
          2,
        ) + '\n',
        { mode: 0o600 },
      )
      await this.#npm(
        [
          'install',
          '--package-lock-only',
          '--ignore-scripts',
          '--omit=dev',
          '--package-lock=true',
          '--no-audit',
          '--no-fund',
          '--registry',
          this.#options.registry,
          ...(this.#options.offline ? ['--offline'] : []),
        ],
        directory,
        signal,
      )
      const nextLock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'))
      checkLock(nextLock, true)
      const retained = new Set(
        Object.values(nextLock.packages).flatMap(entry => (isRecord(entry) ? [entry.resolved] : [])),
      )
      for (const file of await readdir(join(directory, 'candidates')))
        if (!retained.has('file:candidates/' + file)) await rm(join(directory, 'candidates', file))

      await input.onProgress?.({ stage: 'installing' })
      await this.#npm(
        [
          'ci',
          '--ignore-scripts',
          '--omit=dev',
          '--no-audit',
          '--no-fund',
          '--registry',
          this.#options.registry,
          ...(this.#options.offline ? ['--offline'] : []),
        ],
        directory,
        signal,
      )
      await mkdir(join(directory, 'node_modules'), { recursive: true })
      // Standard package/lock validation and bounded material capture before static preparation.
      await input.onProgress?.({ stage: 'verifying' })
      await inspectNpmProject(directory)
      await materialFiles(directory, { signal, maxBytes: this.#options.maxBytes, maxFiles: this.#options.maxFiles })
      signal.throwIfAborted()
      await input.onProgress?.({ stage: 'preparing' })
      return await consume(directory, signal, document)
    } catch (error) {
      if (isRecord(error) && (error.name === 'AbortError' || error.name === 'TimeoutError')) throw error
      const diagnostics = isRecord(error) && Array.isArray(error.diagnostics) ? error.diagnostics : []
      const firstDiagnostic = isRecord(diagnostics[0]) ? diagnostics[0] : undefined
      const code = isRecord(error) ? (error.code ?? firstDiagnostic?.code) : undefined
      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/.test(code)) throw contentError(code)
      throw contentError('ENVIRONMENT_INSTALL_FAILED')
    } finally {
      try {
        if (directory) await rm(directory, { recursive: true, force: true })
      } finally {
        this.#active--
      }
    }
  }
  async close(): Promise<void> {
    this.#controller.abort(contentError('INSTALLER_CLOSED'))
    await Promise.allSettled([...this.#pending])
  }
}

// Discard the npm development/runtime dependencies before passing the official catalog
// to the same offline installer used for the application's bundled copy.
export async function withOfficialUpdateArchive<T>(
  candidate: PackageUpdate,
  npmCli: string | undefined,
  signal: AbortSignal,
  use: (file: string) => Promise<T>,
) {
  return withOfficialUpdateDirectory(candidate, signal, directory => withShippedCatalogArchive(directory, npmCli, use))
}
