import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { gunzipSync } from 'node:zlib'
import type { Command } from 'commander'
import { inspectNpmProject, readNpmAdmission, resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
import type { CommandContext } from '../context'
import { CliError } from '../reporting/errors'
import { prepareContent } from '../application/prepare'

const namePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const rangePattern = /^[0-9A-Za-z*^~<>=|.\-\s]+$/
const maxArtifactBytes = 64 * 1024 * 1024
const maxTotalBytes = 128 * 1024 * 1024
const maxUnpackedBytes = 128 * 1024 * 1024
const exec = promisify(execFile)

type RecordObject = Record<string, unknown>
function object(value: unknown): RecordObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('PROJECT_FORMAT', 'Invalid project manifest or lockfile')
  return value as RecordObject
}
async function readJson(file: string, limit = 32 * 1024 * 1024): Promise<RecordObject> {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > limit) throw new CliError('PROJECT_FORMAT', 'Expected a bounded regular JSON file')
  try {
    return object(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('PROJECT_FORMAT', 'Invalid project JSON')
  }
}
async function readBounded(file: string, limit: number): Promise<Buffer> {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > limit)
    throw new CliError('PROJECT_FORMAT', 'Expected a bounded regular project file')
  return readFile(file)
}
async function readLocalArtifact(file: string, root: string): Promise<Buffer> {
  const path = relative(root, file)
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new CliError('PROJECT_SOURCE', 'Local artifacts must reside inside the source project')
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxArtifactBytes || (await realpath(file)) !== file)
    throw new CliError('PROJECT_SOURCE', 'Expected an unlinked, bounded regular local tarball')
  let handle
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > maxArtifactBytes || opened.dev !== before.dev || opened.ino !== before.ino)
      throw new CliError('PROJECT_SOURCE', 'Local tarball changed while opening')
    const bytes = Buffer.alloc(opened.size)
    for (let offset = 0; offset < bytes.length; ) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw new CliError('PROJECT_SOURCE', 'Local tarball changed while reading')
      offset += bytesRead
    }
    const after = await handle.stat(),
      current = await lstat(file)
    if (
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino ||
      current.isSymbolicLink() ||
      (await realpath(file)) !== file
    )
      throw new CliError('PROJECT_SOURCE', 'Local tarball changed while reading')
    return bytes
  } catch (error) {
    if (error instanceof CliError) throw error
    throw new CliError('PROJECT_SOURCE', 'Unable to safely read the local tarball')
  } finally {
    await handle?.close()
  }
}
function dependencyMap(value: unknown, allowLocal = false): Record<string, string> {
  if (value === undefined) return {}
  const input = object(value),
    result: Record<string, string> = {}
  for (const [name, spec] of Object.entries(input)) {
    if (
      !namePattern.test(name) ||
      typeof spec !== 'string' ||
      !spec.length ||
      spec.length > 2048 ||
      (!(allowLocal && spec.startsWith('file:')) && (spec.length > 128 || !rangePattern.test(spec)))
    )
      throw new CliError(
        'PROJECT_SOURCE',
        'Only ordinary registry dependencies or explicitly included direct tarballs are portable',
      )
    result[name] = spec
  }
  return result
}
function peerMetadata(value: unknown): RecordObject {
  if (value === undefined) return {}
  const safe: RecordObject = {}
  for (const [name, item] of Object.entries(object(value))) {
    const entry = object(item)
    if (
      !namePattern.test(name) ||
      Object.keys(entry).some(key => key !== 'optional') ||
      typeof entry.optional !== 'boolean'
    )
      throw new CliError('PROJECT_FORMAT', 'Invalid peer dependency metadata')
    safe[name] = { optional: entry.optional }
  }
  return safe
}
function preserveCompatibility(input: RecordObject, output: RecordObject) {
  for (const key of ['os', 'cpu', 'libc'] as const) {
    if (input[key] === undefined) continue
    if (
      !Array.isArray(input[key]) ||
      !(input[key] as unknown[]).every(item => typeof item === 'string' && /^[!a-zA-Z0-9_.-]{1,64}$/.test(item))
    )
      throw new CliError('PROJECT_FORMAT', 'Invalid package platform constraint')
    output[key] = input[key]
  }
  if (input.engines !== undefined) {
    const engines = object(input.engines)
    for (const [name, range] of Object.entries(engines))
      if (
        !/^[a-zA-Z0-9_.-]{1,50}$/.test(name) ||
        typeof range !== 'string' ||
        range.length > 128 ||
        !rangePattern.test(range)
      )
        throw new CliError('PROJECT_FORMAT', 'Invalid package engine requirement')
    output.engines = engines
  }
}
function preserveBin(value: unknown) {
  const validPath = (input: unknown): input is string =>
    typeof input === 'string' &&
    input.length > 0 &&
    input.length <= 256 &&
    !/[\\:<>"|?*]/.test(input) &&
    !isAbsolute(input) &&
    input
      .split('/')
      .every(
        part =>
          part &&
          part !== '.' &&
          part !== '..' &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  if (typeof value === 'string' && validPath(value)) return value
  const bins = object(value)
  for (const [name, path] of Object.entries(bins))
    if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(name) || !validPath(path))
      throw new CliError('PROJECT_FORMAT', 'Invalid package executable path')
  return bins
}
function sha512Integrity(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(value))
    throw new CliError('PROJECT_INTEGRITY', 'Every package needs a strong npm sha512 integrity record')
  const bytes = Buffer.from(value.slice(7), 'base64')
  if (bytes.length !== 64 || bytes.toString('base64') !== value.slice(7))
    throw new CliError('PROJECT_INTEGRITY', 'Invalid npm integrity record')
  return bytes
}
/** Restrict shared tgz files before export; never let an importer unpack links, paths outside package/ or a gzip bomb. */
function checkTarball(bytes: Uint8Array) {
  let archive: Buffer
  try {
    archive = gunzipSync(bytes, { maxOutputLength: maxUnpackedBytes })
  } catch {
    throw new CliError('PROJECT_ARCHIVE', 'Local tarball is invalid or exceeds the unpacked size limit')
  }
  if (archive.length % 512 !== 0) throw new CliError('PROJECT_ARCHIVE', 'Truncated tarball')
  const stringField = (offset: number, length: number) => {
    const data = archive.subarray(offset, offset + length)
    const end = data.indexOf(0)
    return data.subarray(0, end < 0 ? data.length : end).toString('utf8')
  }
  let offset = 0,
    entries = 0,
    ended = false
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      if (offset + 1024 > archive.length || !archive.subarray(offset).every(byte => byte === 0))
        throw new CliError('PROJECT_ARCHIVE', 'Tarball contains data after its end marker')
      ended = true
      break
    }
    if (++entries > 50000) throw new CliError('PROJECT_LIMIT', 'Local tarball contains too many entries')
    const checksumField = stringField(offset + 148, 8).trim()
    if (!/^[0-7]+$/.test(checksumField)) throw new CliError('PROJECT_ARCHIVE', 'Invalid tar header checksum')
    let checksum = 0
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i]
    if (checksum !== Number.parseInt(checksumField, 8))
      throw new CliError('PROJECT_ARCHIVE', 'Invalid tar header checksum')
    const sizeField = stringField(offset + 124, 12).trim()
    if (!/^[0-7]+$/.test(sizeField)) throw new CliError('PROJECT_ARCHIVE', 'Invalid tar entry size')
    const size = Number.parseInt(sizeField, 8)
    const type = header[156]
    if (![0, 48, 53].includes(type))
      throw new CliError('PROJECT_ARCHIVE', 'Tar links and extended entries are unsupported')
    const prefix = stringField(offset + 345, 155),
      name = stringField(offset, 100)
    const full = `${prefix ? `${prefix}/` : ''}${name}`.replace(/\/$/, '')
    const parts = full.split('/')
    if (
      parts[0] !== 'package' ||
      parts.some(
        part =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ) ||
      /[\\:<>"|?*\ufffd]/.test(full) ||
      Array.from(full).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      (parts.length === 1 && type !== 53)
    )
      throw new CliError('PROJECT_ARCHIVE', 'Tar entries must remain inside package/')
    if (!Number.isSafeInteger(size) || size < 0 || (type === 53 && size !== 0))
      throw new CliError('PROJECT_ARCHIVE', 'Invalid tar entry size')
    const next = offset + 512 + Math.ceil(size / 512) * 512
    if (next > archive.length) throw new CliError('PROJECT_ARCHIVE', 'Truncated tarball')
    offset = next
  }
  if (!ended || !entries) throw new CliError('PROJECT_ARCHIVE', 'Incomplete local tarball')
}
function packageName(location: string): string {
  const parts = location.split('/')
  let name = ''
  for (let i = 0; i < parts.length; ) {
    if (parts[i++] !== 'node_modules' || !parts[i])
      throw new CliError('PROJECT_SOURCE', 'Invalid lockfile package location')
    name = parts[i++]
    if (name.startsWith('@')) name += `/${parts[i++] ?? ''}`
    if (!namePattern.test(name)) throw new CliError('PROJECT_SOURCE', 'Invalid package name in lockfile')
  }
  return name
}
async function publicRegistry(
  resolved: unknown,
  name: string,
  version: string,
  probe: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof resolved !== 'string') throw new CliError('PROJECT_SOURCE', 'Package source is missing')
  let url: URL
  try {
    url = new URL(resolved)
  } catch {
    throw new CliError('PROJECT_SOURCE', 'Package source is not a public npm registry artifact')
  }
  const tarName = `${name.split('/').at(-1)}-${version}.tgz`
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    throw new CliError('PROJECT_SOURCE', 'Invalid registry path')
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'registry.npmjs.org' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    path !== `/${name}/-/${tarName}`
  )
    throw new CliError('PROJECT_SOURCE', 'Only public npm registry artifact URLs without credentials are supported')
  let response: Response
  try {
    response = await probe(url, {
      method: 'HEAD',
      redirect: 'manual',
      credentials: 'omit',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    })
  } catch {
    throw new CliError('PROJECT_UNAVAILABLE', 'Could not verify a package is publicly available without credentials')
  }
  if (!response.ok || response.status !== 200)
    throw new CliError('PROJECT_UNAVAILABLE', 'A package is not publicly available without credentials')
  return url.href
}

interface Deployment {
  format: 'arcadia.deployment-project'
  version: 1
  installationDigest: string
  revision: string
  build: { coreBuildId: string; registryBuildId: string }
  profile: string
  sourceRuntime: { node: string; npm: string; platform: string; arch: string; minimumNpm: string }
  packages: {
    name: string
    version: string
    source: 'local-artifact' | 'public-registry'
    direct: boolean
    installed: boolean
    hasInstallScript: boolean
    containsEffectCode: boolean | null
  }[]
  files: { manifestSha256: string; lockSha256: string }
}
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
async function npmVersion(): Promise<string> {
  const npm = await resolveNpmInvocation(['--version'])
  let version: string
  try {
    version = (await exec(npm.file, npm.args, { timeout: 10000, maxBuffer: 1024 * 1024 })).stdout.trim()
  } catch {
    throw new CliError('PROJECT_RUNTIME', 'Unable to determine npm runtime version')
  }
  if (!versionPattern.test(version) || Number.parseInt(version, 10) < 9)
    throw new CliError('PROJECT_RUNTIME', 'Deployment projects require npm 9 or later')
  return version
}
const doc = `# Arcadia deployment project\n\nThis is a portable project, not a server backup. It includes only explicitly shared local tarballs; registry dependencies must remain publicly available or be present in the npm cache. No admission, accounts, saved games or server identity are included.\n\nOn a compatible host, use the source Node version, platform and architecture with npm 9 or later (lockfile v3), and a matching Arcadia runtime. Run:\n\n  arcadia content npm install .\n  arcadia content npm inspect . --json\n  arcadia content npm approve . --profile <profile>\n  arcadia content project verify .\n  arcadia server --npm-project .\n\nInstallation never runs lifecycle scripts. Review all dependencies and code before approving. Verification checks the policy, content metadata and dependency graph; local code files are not fingerprinted. Edits inside node_modules are not included in this export. It does not authorize code. Availability, platform compatibility and authenticity are not guaranteed by this project. A server must establish its own identity and credentials.\n`

/** Construct a deliberately filtered npm project. Registry URLs are independently probed without credentials. */
export async function exportProject(
  source: string,
  destination: string,
  includeLocalArtifacts: boolean,
  probe: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const root = await realpath(source)
  const parent = await realpath(dirname(resolve(destination)))
  const target = resolve(parent, basename(destination))
  const inner = relative(root, target)
  if (!inner || (!inner.startsWith(`..${sep}`) && inner !== '..' && !isAbsolute(inner)))
    throw new CliError('PROJECT_OUTPUT', 'Export must be outside the source installation')
  try {
    await lstat(target)
    throw new CliError('OUTPUT_EXISTS', 'Export destination already exists')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const npm = await npmVersion()
  const installed = await inspectNpmProject(root)
  const admission = await readNpmAdmission(resolve(root, 'arcadia-admission.json'))
  const manifest = await readJson(resolve(root, 'package.json'), 1024 * 1024)
  if (manifest.overrides || manifest.workspaces || manifest.bundleDependencies || manifest.bundledDependencies)
    throw new CliError(
      'PROJECT_SOURCE',
      'Workspace links, bundled dependencies and npm overrides are not portable in this export',
    )
  const shrink = resolve(root, 'npm-shrinkwrap.json')
  let rawLock: RecordObject
  try {
    rawLock = await readJson(shrink)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    rawLock = await readJson(resolve(root, 'package-lock.json'))
  }
  if (rawLock.lockfileVersion !== 3) throw new CliError('PROJECT_FORMAT', 'Expected npm lockfile version 3')
  const inputPackages = object(rawLock.packages)
  if (Object.keys(inputPackages).length > 257) throw new CliError('PROJECT_LIMIT', 'Too many locked packages')
  const rootLock = object(inputPackages[''])
  const rootDependencies = dependencyMap(manifest.dependencies, true)
  const optionalDependencies = dependencyMap(manifest.optionalDependencies, true)
  const peerDependencies = dependencyMap(manifest.peerDependencies)
  for (const [key, value] of [
    ['dependencies', rootDependencies],
    ['optionalDependencies', optionalDependencies],
    ['peerDependencies', peerDependencies],
  ] as const)
    if (
      JSON.stringify(Object.entries(value).sort()) !==
      JSON.stringify(Object.entries(dependencyMap(rootLock[key], key !== 'peerDependencies')).sort())
    )
      throw new CliError('PROJECT_FORMAT', 'Project dependencies differ from the npm lockfile')
  const local = new Map<string, { path: string; bytes: Buffer; integrity: string }>()
  let total = 0
  const allRoot = { ...rootDependencies, ...optionalDependencies }
  for (const [name, spec] of Object.entries(allRoot)) {
    if (signal?.aborted) throw new CliError('PROJECT_CANCELLED', 'Export was cancelled')
    if (!spec.startsWith('file:')) continue
    if (!includeLocalArtifacts)
      throw new CliError(
        'PROJECT_LOCAL_PERMISSION',
        'Local tarballs require --include-local-artifacts and permission to redistribute their contents',
      )
    if (!spec.slice(5).endsWith('.tgz'))
      throw new CliError('PROJECT_SOURCE', 'Only regular local .tgz artifacts are supported')
    const file = resolve(root, spec.slice(5))
    const bytes = await readLocalArtifact(file, root)
    total += bytes.length
    if (total > maxTotalBytes) throw new CliError('PROJECT_LIMIT', 'Local artifacts exceed the export size limit')
    const locked = object(inputPackages[`node_modules/${name}`])
    const expected = sha512Integrity(locked.integrity)
    const lockedPath =
      typeof locked.resolved === 'string' && locked.resolved.startsWith('file:')
        ? resolve(root, locked.resolved.slice(5))
        : ''
    if (
      !lockedPath ||
      (await realpath(lockedPath)) !== (await realpath(file)) ||
      !installed.packages.some(pkg => pkg.location === `node_modules/${name}` && pkg.name === name)
    )
      throw new CliError('PROJECT_SOURCE', 'Only directly installed, approved local tarballs are supported')
    if (!createHash('sha512').update(bytes).digest().equals(expected))
      throw new CliError('PROJECT_INTEGRITY', 'Local tarball bytes differ from the npm lock')
    checkTarball(bytes)
    const path = `artifacts/${hash(bytes)}.tgz`
    local.set(name, { path, bytes, integrity: locked.integrity as string })
  }
  function rewriteRoot(map: Record<string, string>) {
    return Object.fromEntries(
      Object.entries(map).map(([name, spec]) => [name, local.has(name) ? `file:${local.get(name)!.path}` : spec]),
    )
  }
  const outputManifest: RecordObject = { name: 'arcadia-deployment', version: '1.0.0', private: true }
  const outputRoot: RecordObject = { name: 'arcadia-deployment', version: '1.0.0' }
  for (const [field, map] of [
    ['dependencies', rewriteRoot(rootDependencies)],
    ['optionalDependencies', rewriteRoot(optionalDependencies)],
    ['peerDependencies', peerDependencies],
  ] as const) {
    if (Object.keys(map).length) {
      outputManifest[field] = map
      outputRoot[field] = map
    }
  }
  if (manifest.peerDependenciesMeta !== undefined || rootLock.peerDependenciesMeta !== undefined) {
    const safe = peerMetadata(manifest.peerDependenciesMeta)
    if (
      JSON.stringify(Object.entries(safe).sort()) !==
      JSON.stringify(Object.entries(peerMetadata(rootLock.peerDependenciesMeta)).sort())
    )
      throw new CliError('PROJECT_FORMAT', 'Peer dependency metadata differs from the npm lockfile')
    outputManifest.peerDependenciesMeta = safe
    outputRoot.peerDependenciesMeta = safe
  }
  preserveCompatibility(manifest, outputManifest)
  preserveCompatibility(manifest, outputRoot)
  const outputPackages: Record<string, RecordObject> = { '': outputRoot }
  for (const [location, value] of Object.entries(inputPackages)) {
    if (signal?.aborted) throw new CliError('PROJECT_CANCELLED', 'Export was cancelled')
    if (!location) continue
    const entry = object(value)
    if (entry.dev === true) {
      if (installed.packages.some(pkg => pkg.location === location))
        throw new CliError('PROJECT_FORMAT', 'A development-only package was unexpectedly installed')
      continue
    }
    if (entry.link || entry.inBundle || entry.bundled)
      throw new CliError('PROJECT_SOURCE', 'Linked or bundled dependencies are unsupported')
    const name = packageName(location)
    if (typeof entry.version !== 'string' || !versionPattern.test(entry.version))
      throw new CliError('PROJECT_FORMAT', 'Invalid locked package version')
    sha512Integrity(entry.integrity)
    const file = local.get(name)
    let resolved: string
    if (typeof entry.resolved === 'string' && entry.resolved.startsWith('file:')) {
      if (!file || location !== `node_modules/${name}` || entry.integrity !== file.integrity)
        throw new CliError('PROJECT_SOURCE', 'Nested, unavailable or unapproved local dependencies are unsupported')
      resolved = `file:${file.path}`
    } else resolved = await publicRegistry(entry.resolved, name, entry.version, probe, signal)
    const clean: RecordObject = { version: entry.version, resolved, integrity: entry.integrity }
    for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      const map = dependencyMap(entry[key])
      if (Object.keys(map).length) clean[key] = map
    }
    if (entry.peerDependenciesMeta !== undefined) clean.peerDependenciesMeta = peerMetadata(entry.peerDependenciesMeta)
    if (entry.bin !== undefined) clean.bin = preserveBin(entry.bin)
    preserveCompatibility(entry, clean)
    if (entry.optional === true) clean.optional = true
    if (entry.peer === true) clean.peer = true
    if (entry.devOptional === true) clean.devOptional = true
    if (entry.hasInstallScript === true) clean.hasInstallScript = true
    outputPackages[location] = clean
  }
  const outputLock = {
    name: 'arcadia-deployment',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: outputPackages,
  }
  const manifestText = json(outputManifest),
    lockText = json(outputLock)
  // Export locked artifacts, not edits inside node_modules. Check that their metadata and graph rebuild.
  // Local code files are not fingerprinted or compared with the retained tarball.
  const scratch = await mkdtemp(resolve(tmpdir(), 'arcadia-export-check-'))
  try {
    if (local.size) await mkdir(resolve(scratch, 'artifacts'))
    const artifacts = new Map([...local.values()].map(value => [value.path, value]))
    for (const artifact of artifacts.values())
      await writeFile(resolve(scratch, artifact.path), artifact.bytes, { flag: 'wx' })
    await writeFile(resolve(scratch, 'package.json'), manifestText, { flag: 'wx' })
    await writeFile(resolve(scratch, 'package-lock.json'), lockText, { flag: 'wx' })
    const localOnly = Object.values(outputPackages).every(
      entry => entry === outputRoot || (typeof entry.resolved === 'string' && entry.resolved.startsWith('file:')),
    )
    const npm = await resolveNpmInvocation([
      'ci',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      ...(localOnly ? ['--offline'] : []),
    ])
    const env: NodeJS.ProcessEnv = {}
    for (const key of [
      'PATH',
      'Path',
      'SystemRoot',
      'WINDIR',
      'TEMP',
      'TMP',
      'TMPDIR',
      'HOME',
      'USERPROFILE',
      'LANG',
      'ELECTRON_RUN_AS_NODE',
    ])
      if (process.env[key]) env[key] = process.env[key]
    Object.assign(env, {
      npm_config_cache: process.env.npm_config_cache || resolve(scratch, 'cache'),
      npm_config_userconfig: resolve(scratch, 'empty-user-npmrc'),
      npm_config_globalconfig: resolve(scratch, 'empty-global-npmrc'),
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_engine_strict: 'true',
    })
    try {
      await exec(npm.file, npm.args, { cwd: scratch, env, signal, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
    } catch {
      throw new CliError(
        'PROJECT_REBUILD',
        'Unable to rebuild the sanitized project without scripts or private credentials',
      )
    }
    if ((await inspectNpmProject(scratch)).digest !== installed.digest)
      throw new CliError('PROJECT_MISMATCH', 'Rebuilt artifacts differ from the approved installation')
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
  const prepared = await prepareContent('builtin:workspace', root, { npmProject: root })
  if (signal?.aborted) {
    await (prepared as typeof prepared & { dispose?: () => Promise<void> }).dispose?.()
    throw new CliError('PROJECT_CANCELLED', 'Export was cancelled')
  }
  const deployment: Deployment = {
    format: 'arcadia.deployment-project',
    version: 1,
    installationDigest: installed.digest,
    revision: prepared.revision,
    build: { coreBuildId: prepared.build.coreBuildId, registryBuildId: prepared.build.registryBuildId },
    profile: String(admission.policy.profile),
    sourceRuntime: {
      node: process.versions.node,
      npm,
      platform: process.platform,
      arch: process.arch,
      minimumNpm: '9',
    },
    packages: Object.entries(outputPackages)
      .filter(([location]) => !!location)
      .map(([location, entry]) => {
        const name = packageName(location)
        const installedPackage = installed.packages.find(pkg => pkg.location === location)
        const source =
          typeof entry.resolved === 'string' && entry.resolved.startsWith('file:')
            ? 'local-artifact'
            : 'public-registry'
        return {
          name,
          version: entry.version as string,
          source,
          direct:
            location === `node_modules/${name}` &&
            Object.hasOwn({ ...rootDependencies, ...optionalDependencies, ...peerDependencies }, name),
          installed: !!installedPackage,
          hasInstallScript: entry.hasInstallScript === true,
          containsEffectCode: installedPackage ? !!installedPackage.manifest?.effects : null,
        }
      }),
    files: { manifestSha256: hash(manifestText), lockSha256: hash(lockText) },
  }
  await (prepared as typeof prepared & { dispose?: () => Promise<void> }).dispose?.()
  let created = false
  const writeNew = async (file: string, value: string | Uint8Array) => {
    if (signal?.aborted) throw new CliError('PROJECT_CANCELLED', 'Export was cancelled')
    await writeFile(file, value, { flag: 'wx' })
  }
  try {
    await mkdir(target)
    created = true
    if (local.size) await mkdir(resolve(target, 'artifacts'))
    for (const artifact of new Map([...local.values()].map(value => [value.path, value])).values())
      await writeNew(resolve(target, artifact.path), artifact.bytes)
    await writeNew(resolve(target, 'package.json'), manifestText)
    await writeNew(resolve(target, 'package-lock.json'), lockText)
    await writeNew(resolve(target, 'README.md'), doc)
    // The deployment record is the completion marker and is written last.
    await writeNew(resolve(target, 'arcadia-deployment.json'), json(deployment))
  } catch (error) {
    // The destination may have been modified or replaced by another process; never remove its files.
    if (created) throw new CliError('PROJECT_OUTPUT', 'Export failed; the incomplete destination was left for review')
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new CliError('OUTPUT_EXISTS', 'Export destination already exists')
    throw error
  }
  return deployment
}

export async function verifyProject(directory: string) {
  const root = await realpath(directory),
    deployment = await readJson(resolve(root, 'arcadia-deployment.json'), 256 * 1024)
  const files = object(deployment.files),
    build = object(deployment.build),
    sourceRuntime = object(deployment.sourceRuntime)
  if (
    deployment.format !== 'arcadia.deployment-project' ||
    deployment.version !== 1 ||
    typeof deployment.installationDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(deployment.installationDigest) ||
    typeof deployment.revision !== 'string' ||
    typeof deployment.profile !== 'string' ||
    typeof build.coreBuildId !== 'string' ||
    typeof build.registryBuildId !== 'string' ||
    typeof sourceRuntime.node !== 'string' ||
    typeof sourceRuntime.platform !== 'string' ||
    typeof sourceRuntime.arch !== 'string' ||
    sourceRuntime.minimumNpm !== '9'
  )
    throw new CliError('PROJECT_FORMAT', 'Invalid deployment identity')
  await npmVersion()
  if (
    sourceRuntime.node !== process.versions.node ||
    sourceRuntime.platform !== process.platform ||
    sourceRuntime.arch !== process.arch
  )
    throw new CliError(
      'PROJECT_RUNTIME',
      'This project requires the same Node version, platform and architecture as its source',
    )
  const manifest = await readBounded(resolve(root, 'package.json'), 1024 * 1024),
    lock = await readBounded(resolve(root, 'package-lock.json'), 32 * 1024 * 1024)
  if (hash(manifest) !== files.manifestSha256 || hash(lock) !== files.lockSha256)
    throw new CliError('PROJECT_CHANGED', 'Deployment project manifest or lockfile changed')
  let lockedPackages: RecordObject
  try {
    lockedPackages = object(object(JSON.parse(lock.toString('utf8'))).packages)
  } catch {
    throw new CliError('PROJECT_FORMAT', 'Invalid deployment lockfile')
  }
  for (const [location, raw] of Object.entries(lockedPackages)) {
    if (!location) continue
    const entry = object(raw)
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith('file:')) continue
    const path = entry.resolved.slice(5)
    if (!/^artifacts\/[a-f0-9]{64}\.tgz$/.test(path))
      throw new CliError('PROJECT_SOURCE', 'Invalid local artifact reference')
    const bytes = await readLocalArtifact(resolve(root, path), root)
    if (
      `artifacts/${hash(bytes)}.tgz` !== path ||
      !createHash('sha512').update(bytes).digest().equals(sha512Integrity(entry.integrity))
    )
      throw new CliError('PROJECT_INTEGRITY', 'A shared local artifact differs from its fixed identity')
    checkTarball(bytes)
  }
  const installation = await inspectNpmProject(root)
  if (installation.digest !== deployment.installationDigest)
    throw new CliError('PROJECT_MISMATCH', 'Rebuilt installation differs from the exported environment')
  const approval = await readNpmAdmission(resolve(root, 'arcadia-admission.json'))
  if (approval.policy.profile !== deployment.profile)
    throw new CliError('PROJECT_POLICY', 'Approval profile differs from the exported environment')
  const prepared = await prepareContent('builtin:workspace', root, { npmProject: root })
  try {
    if (
      prepared.revision !== deployment.revision ||
      prepared.build.coreBuildId !== build.coreBuildId ||
      prepared.build.registryBuildId !== build.registryBuildId
    )
      throw new CliError('PROJECT_MISMATCH', 'Rebuilt runtime identity differs from the exported environment')
    return {
      format: 'arcadia.deployment-verification',
      version: 1,
      verified: true,
      revision: prepared.revision,
      installationDigest: installation.digest,
    }
  } finally {
    await (prepared as typeof prepared & { dispose?: () => Promise<void> }).dispose?.()
  }
}

export function registerProjectCommands(content: Command, context: CommandContext) {
  const project = content
    .command('project')
    .description('Export and verify portable, explicitly approved server projects')
  project
    .command('export')
    .argument('<source>')
    .argument('<destination>')
    .option('--include-local-artifacts', 'Share approved local tarballs; you must have permission to redistribute them')
    .option('--json', 'JSON output')
    .action(
      async (source: string, destination: string, options: { includeLocalArtifacts?: boolean; json?: boolean }) => {
        const result = await exportProject(
          resolve(context.cwd, source),
          resolve(context.cwd, destination),
          !!options.includeLocalArtifacts,
          fetch,
          context.signal,
        )
        await context.stdout(
          options.json
            ? json(result)
            : `Exported project for ${result.revision}. Review dependencies and re-approve on the new host.\n`,
        )
      },
    )
  project
    .command('verify')
    .argument('<directory>')
    .option('--json', 'JSON output')
    .action(async (directory: string, options: { json?: boolean }) => {
      const result = await verifyProject(resolve(context.cwd, directory))
      await context.stdout(options.json ? json(result) : `Verified ${result.revision}\n`)
    })
}
