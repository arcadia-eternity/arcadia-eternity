import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { valid, validRange } from 'semver'
import { inspectNpmProject, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
import { normalizeEnvironmentDocument } from './debug-environments.ts'
import { acquireSource } from './managed-sources.ts'
import { contentError, materialFiles } from './workspace-materials.ts'
import type {
  ContentWorkspace,
  EnvironmentInstallation,
  PrepareEnvironmentInput,
  StaticPreparer,
} from './content-workspace.ts'
import type { ManagedSource } from './managed-sources.ts'
import { errorCode, isRecord, type UnknownRecord } from './types.ts'

export interface ManagedProjectsOptions {
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
  prepareEnvironment(
    workspace: ContentWorkspace,
    input: {
      onProgress?: PrepareEnvironmentInput['onProgress']
      environmentId: string
      expectedRevision: string
      signal?: AbortSignal
      beforeCommit?: () => Promise<void>
    },
    validate: StaticPreparer,
  ): Promise<EnvironmentInstallation> {
    if (typeof validate !== 'function') return Promise.reject(contentError('STATIC_PREPARER_REQUIRED'))
    return this.#track(
      this.#prepare(
        async () => {
          const draft = await workspace.getDraft(input.environmentId)
          if (draft.revision !== input.expectedRevision) throw contentError('REVISION_CONFLICT')
          return draft.document
        },
        { ...input, projectDirectory: join(workspace.root, 'environments', input.environmentId) },
        async (directory, signal) => {
          const current = await workspace.getDraft(input.environmentId)
          if (current.revision !== input.expectedRevision) throw contentError('REVISION_CONFLICT')
          return workspace.prepareEnvironment({ ...input, projectDirectory: directory, signal }, validate)
        },
      ),
    )
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
    input: { signal?: AbortSignal; onProgress?: PrepareEnvironmentInput['onProgress']; projectDirectory?: string },
    consume: (directory: string, signal: AbortSignal) => Promise<T>,
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
      // Acquisition approval is separate from any runtime execution policy. This
      // installer never evaluates author modules or invokes lifecycle scripts.
      if (!this.#options.allowThirdPartyContent && (Object.keys(dependencies).length || document.sources.length))
        throw contentError('THIRD_PARTY_CONTENT_NOT_AUTHORIZED')
      await mkdir(join(this.root, 'staging'), { recursive: true, mode: 0o700 })
      directory = await mkdtemp(join(this.root, 'staging', 'prepare-'))
      await mkdir(join(directory, 'candidates'))
      for (const spec of Object.values(dependencies)) {
        if (!spec.startsWith('file:')) continue
        if (!input.projectDirectory) throw contentError('ENVIRONMENT_SOURCE_MISSING')
        const relativeFile = spec.slice(5)
        const sourceFile = join(await realpath(input.projectDirectory), relativeFile)
        if ((await realpath(sourceFile)) !== sourceFile) throw contentError('MATERIAL_PATH_ESCAPE')
        await writeFile(join(directory, relativeFile), await readFile(sourceFile))
      }
      const provenance: Record<string, unknown> = {}
      for (const [index, name] of document.sources.entries()) {
        if (Object.hasOwn(dependencies, name)) throw contentError('INSTALL_DUPLICATE_PACKAGE')
        const source = this.#options.sources[name]
        if (!source) throw contentError('INSTALL_SOURCE_NOT_REGISTERED')
        if (this.#options.offline && (source.kind === 'url' || source.kind === 'git'))
          throw contentError('INSTALL_SOURCE_OFFLINE')
        await input.onProgress?.({ stage: 'acquiring', completed: index, total: document.sources.length })
        const captured = await acquireSource(source, {
          destination: join(directory, 'source-' + index),
          signal,
          maxBytes: this.#options.maxBytes,
          maxFiles: this.#options.maxFiles,
          timeoutMs: this.#options.timeoutMs,
        })
        const manifest = JSON.parse(await readFile(join(captured.directory, 'package.json'), 'utf8')) as UnknownRecord
        if (manifest.name !== name) throw contentError('INSTALL_SOURCE_IDENTITY')
        if (typeof manifest.version !== 'string' || !valid(manifest.version))
          throw contentError('INSTALL_SOURCE_VERSION')
        checkDependencySpecs(manifest)
        try {
          checkLock(JSON.parse(await readFile(join(captured.directory, 'npm-shrinkwrap.json'), 'utf8')))
        } catch (error) {
          if (errorCode(error) !== 'ENOENT') throw error
        }
        const output = join(directory, 'packed-' + index)
        await mkdir(output)
        await this.#npm(
          ['pack', '--ignore-scripts', '--json', '--pack-destination', output, '--registry', this.#options.registry],
          captured.directory,
          signal,
        )
        const { readdir } = await import('node:fs/promises')
        const files = await readdir(output)
        if (files.length !== 1 || !files[0].endsWith('.tgz')) throw contentError('INSTALL_PACK_INVALID')
        const archiveDigest = createHash('sha256')
          .update(await readFile(join(output, files[0])))
          .digest('hex')
        const filename = `candidates/source-${index}-${archiveDigest}.tgz`
        await rename(join(output, files[0]), join(directory, filename))
        dependencies[name] = 'file:' + filename
        provenance[name] = captured.provenance
        await rm(captured.directory, { recursive: true, force: true })
        await rm(output, { recursive: true, force: true })
      }
      const savedManifest = input.projectDirectory
        ? (JSON.parse(await readFile(join(input.projectDirectory, 'package.json'), 'utf8')) as UnknownRecord)
        : {}
      if (input.projectDirectory) {
        const lock = await readFile(join(input.projectDirectory, 'package-lock.json')).catch(error => {
          if (errorCode(error) !== 'ENOENT') throw error
          return undefined
        })
        if (lock) await writeFile(join(directory, 'package-lock.json'), lock)
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
      checkLock(JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8')), true)
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
      return await consume(directory, signal)
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
