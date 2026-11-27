import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import { isDeepStrictEqual } from 'node:util'
import { satisfies, valid, validRange } from 'semver'
import YAML from 'yaml'
import { environmentManifestDocument } from './debug-environments.ts'
import { assertEnvironmentRequirements, validateEnvironmentRuleDeclaration } from './environment-rules.ts'
import { matchesArchiveIntegrity, tarFiles } from './managed-sources.ts'
import { teamDocument } from './project-teams.ts'
import { isRecord } from './types.ts'
import { contentError } from './workspace-materials.ts'

export type AuthorEnvironmentSource = { kind: 'npm'; name: string; version: string } | { kind: 'archive'; file: string }
type AcquireOptions = {
  offline?: boolean
  cache?: string
  signal?: AbortSignal
  clientVersion?: string
  /** HTTPS npm registry for npm sources; defaults to the public registry. */
  registry?: string
}
const npmName = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/
const candidate = /^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/
const maxBytes = 256 * 1024 * 1024
const sdkVersion: string = createRequire(import.meta.url)('../package.json').version

function exactPackage(name: unknown, version: unknown) {
  if (
    typeof name !== 'string' ||
    name.length > 214 ||
    !npmName.test(name) ||
    typeof version !== 'string' ||
    !/^\d/.test(version) ||
    version.trim() !== version ||
    !valid(version)
  )
    throw contentError('ENVIRONMENT_PACKAGE_ID_INVALID', '环境包需要 npm 包名与完整版本号')
  return { kind: 'npm' as const, name, version }
}

export function parseAuthorEnvironmentNpmSpec(spec: string) {
  const index = typeof spec === 'string' ? spec.lastIndexOf('@') : -1
  if (index < 1) throw contentError('ENVIRONMENT_PACKAGE_ID_INVALID', '请指定带完整版本的 npm 环境包')
  return exactPackage(spec.slice(0, index), spec.slice(index + 1))
}

export function parseAuthorEnvironmentSource(value: unknown): AuthorEnvironmentSource {
  if (isRecord(value)) {
    if (value.kind === 'npm') return exactPackage(value.name, value.version)
    if (
      value.kind === 'archive' &&
      typeof value.file === 'string' &&
      value.file.length > 0 &&
      /\.tgz$/i.test(value.file)
    )
      return { kind: 'archive', file: value.file }
  }
  throw contentError('ENVIRONMENT_PACKAGE_SOURCE_INVALID', '请选择 npm 环境包及完整版本，或环境包 .tgz 文件')
}

async function readArchive(stream: AsyncIterable<Buffer>, signal: AbortSignal) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    signal.throwIfAborted()
    size += chunk.length
    if (size > maxBytes) throw contentError('SOURCE_LIMIT')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

async function archiveBytes(source: AuthorEnvironmentSource, options: AcquireOptions, signal: AbortSignal) {
  if (source.kind === 'archive') {
    if (!isAbsolute(source.file)) throw contentError('SOURCE_PATH_INVALID')
    const file = await open(source.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > maxBytes) throw contentError('SOURCE_ARCHIVE_INVALID')
      return await readArchive(file.createReadStream({ autoClose: false, signal }), signal)
    } finally {
      await file.close()
    }
  }
  const { tarball } = (await import('pacote')).default
  const cache = options.cache ?? process.env.npm_config_cache
  if (options.registry !== undefined) {
    const url = URL.parse(options.registry)
    if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw contentError('INSTALL_DEPENDENCY_SOURCE_FORBIDDEN')
  }
  return tarball.stream(source.name + '@' + source.version, stream => readArchive(stream, signal), {
    ...(cache && { cache: join(cache, '_cacache') }),
    ...(options.registry && { registry: options.registry }),
    offline: options.offline ?? process.env.npm_config_offline === 'true',
    preferOffline: true,
    retry: { retries: 0 },
    signal,
  })
}

function archiveLock(
  bytes: Buffer,
  packages: Record<string, string>,
  files: Map<string, Buffer>,
  retained: Map<string, Buffer>,
) {
  const lock: unknown = JSON.parse(bytes.toString())
  if (
    !isRecord(lock) ||
    ![2, 3].includes(Number(lock.lockfileVersion)) ||
    !isRecord(lock.packages) ||
    !isRecord(lock.packages['']) ||
    !isDeepStrictEqual(lock.packages[''].dependencies ?? {}, packages)
  )
    throw contentError('INSTALL_LOCK_INVALID')
  for (const [name, spec] of Object.entries(packages)) {
    const pin = lock.packages['node_modules/' + name]
    if (
      !isRecord(pin) ||
      typeof pin.version !== 'string' ||
      (candidate.test(spec) ? pin.resolved !== spec : !satisfies(pin.version, spec))
    )
      throw contentError('INSTALL_LOCK_INVALID')
  }
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location) continue
    if (
      !/^(?:node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*\/)*node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/.test(
        location,
      ) ||
      !isRecord(entry) ||
      entry.link ||
      typeof entry.resolved !== 'string' ||
      typeof entry.integrity !== 'string'
    )
      throw contentError('INSTALL_LOCK_INVALID')
    if (candidate.test(entry.resolved)) {
      const bytes = retainCandidate(entry.resolved, files, retained)
      if (!matchesArchiveIntegrity(bytes, entry.integrity)) throw contentError('SOURCE_INTEGRITY_MISMATCH')
    } else {
      const url = URL.parse(entry.resolved)
      if (!url || url.protocol !== 'https:' || url.username || url.password) throw contentError('INSTALL_LOCK_INVALID')
    }
  }
}

function retainCandidate(spec: string, files: Map<string, Buffer>, retained: Map<string, Buffer>) {
  const path = spec.slice(5)
  const bytes = files.get('package/' + path)
  if (!bytes) throw contentError('ENVIRONMENT_SOURCE_MISSING', '环境包缺少依赖归档 ' + path)
  retained.set(path, bytes)
  return bytes
}

/** Capture the exact archive once. Only data fields and portable project inputs reach the new directory. */
export async function acquireAuthorEnvironment(
  source: AuthorEnvironmentSource,
  destination: string,
  options: AcquireOptions = {},
) {
  source = parseAuthorEnvironmentSource(source)
  if (!isAbsolute(destination)) throw contentError('SOURCE_PATH_INVALID')
  const signal = AbortSignal.any([AbortSignal.timeout(120_000), ...(options.signal ? [options.signal] : [])])
  signal.throwIfAborted()
  const bytes = await archiveBytes(source, options, signal)
  if (bytes.length < 2 || bytes.readUInt16LE(0) !== 0x8b1f) throw contentError('SOURCE_ARCHIVE_INVALID')
  const entries = await tarFiles(Readable.from([bytes]), {
    signal,
    timeoutMs: 120_000,
    maxFiles: 50000,
    maxBytes,
    rejectPrivateFiles: true,
  })
  if (entries.some(entry => !entry.name.startsWith('package/'))) throw contentError('ENVIRONMENT_PACKAGE_INVALID')
  const files = new Map(entries.map(entry => [entry.name, entry.bytes] as const))
  const raw = files.get('package/package.json')
  if (!raw || raw.length > 1024 * 1024) throw contentError('ENVIRONMENT_PACKAGE_INVALID')
  const manifest: unknown = JSON.parse(raw.toString())
  if (!isRecord(manifest) || manifest.arcadia || !isRecord(manifest.arcadiaEnvironment))
    throw contentError('ENVIRONMENT_PACKAGE_REQUIRED', '请选择带有 arcadiaEnvironment 声明的环境包')
  const { name, version } = exactPackage(manifest.name, manifest.version)
  if (source.kind === 'npm' && (name !== source.name || version !== source.version))
    throw contentError('SOURCE_PACKAGE_IDENTITY_MISMATCH')
  const document = environmentManifestDocument(manifest)
  if (document.sources.length) throw contentError('ENVIRONMENT_SOURCE_NOT_PORTABLE', '请将本机来源打包为可安装的依赖')
  assertEnvironmentRequirements(document.requires)
  validateEnvironmentRuleDeclaration(document.rules)
  const { packages: dependencies, ...arcadiaEnvironment } = document
  const range = isRecord(manifest.engines) ? manifest.engines.arcadia : undefined
  if (
    range !== undefined &&
    (typeof range !== 'string' || !validRange(range) || !satisfies(options.clientVersion ?? sdkVersion, range))
  )
    throw contentError('ARCADIA_VERSION_INCOMPATIBLE')
  const retained = new Map<string, Buffer>()
  for (const [dep, spec] of Object.entries(dependencies)) {
    if (candidate.test(spec)) retainCandidate(spec, files, retained)
    else if (!validRange(spec)) throw contentError('INSTALL_VERSION_INVALID', '无效的依赖版本范围 ' + dep)
  }
  const lock = files.get('package/npm-shrinkwrap.json') ?? files.get('package/package-lock.json')
  if (lock) {
    if (lock.length > 16 * 1024 * 1024) throw contentError('SOURCE_LIMIT')
    archiveLock(lock, dependencies, files, retained)
    retained.set('package-lock.json', lock)
  }
  for (const [key, data] of files) {
    if (/^package\/LICENSE(?:\.(?:md|txt))?$/i.test(key)) retained.set(key.slice('package/'.length), data)
    if (!/^package\/debug\/teams\/[^/]+\.yaml$/.test(key)) continue
    if (data.length > 1024 * 1024) throw contentError('SOURCE_LIMIT')
    const team = teamDocument(YAML.parse(data.toString()))
    const path = 'debug/teams/' + team.id + '.yaml'
    if (key !== 'package/' + path) throw contentError('TEAM_INVALID')
    retained.set(path, data)
  }
  const recipe = {
    name,
    version,
    private: true,
    ...(typeof manifest.license === 'string' && { license: manifest.license }),
    ...(typeof manifest.description === 'string' && { description: manifest.description }),
    ...(range !== undefined && { engines: { arcadia: range } }),
    dependencies,
    arcadiaEnvironment,
  }
  retained.set('package.json', Buffer.from(JSON.stringify(recipe, null, 2) + '\n'))
  await mkdir(destination, { mode: 0o700 })
  try {
    for (const [path, data] of retained) {
      signal.throwIfAborted()
      await mkdir(dirname(join(destination, path)), { recursive: true })
      await writeFile(join(destination, path), data, { flag: 'wx', mode: 0o600 })
    }
    return {
      directory: destination,
      name,
      version,
      document,
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    }
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}
