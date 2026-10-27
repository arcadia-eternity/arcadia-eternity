import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  canonical,
  cloneJson,
  createDraft,
  digestJson,
  fail,
  freeze,
  parseDraft,
  runtimeId,
  type Json,
  type WorkDraft,
} from '../works/model'
import { verifyAssets } from '../works/compiler'
import { effectSdkApiVersion } from '@arcadia-eternity/battle/v4/authoring'

const exec = promisify(execFile)
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/
export interface NpmContentManifest {
  formatVersion: 1
  projectId: string
  namespace: string
  content: string
  effects?: string
  sdkApi?: number
  exports: { id: string; sourceKind: 'skill' | 'petMark' }[]
  /** Asset digest -> package-relative filename. Bytes are checked even in headless mode. */
  assets: Record<string, string>
}
export interface InstalledNpmPackage {
  location: string
  name: string
  version: string
  filesDigest: string
  integrity?: string
  dependencies: Record<string, string>
  manifest?: NpmContentManifest
  draft?: WorkDraft
}
export interface NpmProjectInspection {
  format: 'arcadia.npm-installation'
  version: 1
  /** Actual installed bytes and dependency edges, independent of the absolute installation directory. */
  digest: string
  /** Audit identity of npm's source/solver record, not a replacement for tarball integrity. */
  lockfileDigest: string
  packages: readonly InstalledNpmPackage[]
}
interface NpmTree {
  name?: string
  version?: string
  path?: string
  dependencies?: Record<string, NpmTree>
}

export function packageFile(root: string, file: string): string {
  if (
    typeof file !== 'string' ||
    !file ||
    file.includes('\\') ||
    file.includes('\0') ||
    isAbsolute(file) ||
    file.split('/').some(part => !part || part === '.' || part === '..' || part === 'node_modules')
  )
    fail('NPM_PATH', file, 'Expected a package-relative file outside node_modules')
  return resolve(root, file)
}

function record(value: unknown, path: string): Record<string, Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('NPM_FORMAT', path, 'Expected a JSON object')
  return value as Record<string, Json>
}
async function jsonFile(file: string): Promise<Record<string, Json>> {
  const info = await lstat(file)
  if (!info.isFile() || info.size > 32 * 1024 * 1024) fail('NPM_FILE', file, 'Expected a bounded regular JSON file')
  const value: unknown = JSON.parse(await readFile(file, 'utf8'))
  return record(cloneJson(value), file)
}

async function packageDigest(dir: string): Promise<string> {
  const files: [string, string][] = []
  let bytes = 0,
    nodes = 0
  async function visit(directory: string, prefix: string, depth = 0) {
    if (depth > 64) fail('NPM_LIMIT', prefix, 'Installed package directory nesting exceeds inspection limits')
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      if (++nodes > 50000) fail('NPM_LIMIT', prefix, 'Installed package exceeds inspection limits')
      if (entry.name === 'node_modules') continue
      const file = resolve(directory, entry.name),
        name = `${prefix}${entry.name}`
      if (entry.isSymbolicLink()) fail('NPM_LINK', name, 'Installed packages must not contain symlinks')
      if (entry.isDirectory()) {
        await visit(file, `${name}/`, depth + 1)
        continue
      }
      if (!entry.isFile()) fail('NPM_FILE', name, 'Unsupported installed file')
      bytes += (await lstat(file)).size
      if (bytes > 512 * 1024 * 1024 || files.length >= 50000)
        fail('NPM_LIMIT', name, 'Installed package exceeds inspection limits')
      files.push([
        name,
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ])
    }
  }
  await visit(dir, '')
  return digestJson(files)
}

/** Refuse uninspected development/extraneous packages that Node could otherwise resolve at runtime. */
async function checkInstalledDirectories(root: string, nodes: ReadonlyMap<string, NpmTree>) {
  async function visit(directory: string, scope = false) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    if ((await realpath(directory)) !== directory)
      fail('NPM_LINK', directory, 'Linked node_modules directories are unsupported')
    for (const entry of entries) {
      if (!scope && ['.bin', '.package-lock.json'].includes(entry.name)) continue
      const path = resolve(directory, entry.name)
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail('NPM_TREE', path, 'Unsupported node_modules entry')
      if (!scope && entry.name.startsWith('@')) {
        await visit(path, true)
        continue
      }
      const location = relative(root, path).split(sep).join('/')
      if (!nodes.has(location))
        fail('NPM_UNINSPECTED', location, 'Reinstall with npm ci --omit=dev --ignore-scripts in a fresh environment')
      await visit(resolve(path, 'node_modules'))
    }
  }
  await visit(resolve(root, 'node_modules'))
}

function readManifest(value: unknown): NpmContentManifest {
  const input = cloneJson(value) as NpmContentManifest
  if (
    !input ||
    input.formatVersion !== 1 ||
    Object.keys(input).some(
      key =>
        !['formatVersion', 'projectId', 'namespace', 'content', 'effects', 'sdkApi', 'exports', 'assets'].includes(key),
    )
  )
    fail('NPM_METADATA', 'arcadia', 'Unsupported Arcadia package metadata')
  createDraft(input.projectId, input.projectId, input.namespace)
  packageFile('/', input.content)
  if (input.effects !== undefined) packageFile('/', input.effects)
  if ((input.effects !== undefined || input.sdkApi !== undefined) && input.sdkApi !== effectSdkApiVersion)
    fail('SDK_INCOMPATIBLE', 'arcadia.sdkApi', `Code packages require Effect SDK API ${effectSdkApiVersion}`)
  input.exports ??= []
  input.assets ??= {}
  if (!Array.isArray(input.exports) || input.exports.length > 256)
    fail('NPM_METADATA', 'arcadia.exports', 'Invalid effect exports')
  const ids = new Set<string>()
  for (const entry of input.exports) {
    if (
      !entry ||
      Object.keys(entry).some(key => key !== 'id' && key !== 'sourceKind') ||
      !['skill', 'petMark'].includes(entry.sourceKind)
    )
      fail('NPM_METADATA', 'arcadia.exports', 'Invalid effect export')
    runtimeId(input.namespace, entry.id)
    if (ids.has(entry.id)) fail('DUPLICATE_EXPORT', entry.id, 'Duplicate effect export')
    ids.add(entry.id)
  }
  if (input.exports.length && !input.effects) fail('NPM_METADATA', 'arcadia.effects', 'Effect exports require a module')
  if (!input.assets || typeof input.assets !== 'object' || Array.isArray(input.assets))
    fail('NPM_METADATA', 'arcadia.assets', 'Invalid asset files')
  for (const [hash, path] of Object.entries(input.assets)) {
    if (!/^[a-f0-9]{64}$/.test(hash)) fail('NPM_METADATA', 'arcadia.assets', 'Invalid asset hash')
    packageFile('/', path)
  }
  return input
}

/** npm owns semver/peer resolution. This command only reads its installed tree; it never runs lifecycle scripts. */
export async function inspectNpmProject(directory: string): Promise<NpmProjectInspection> {
  const root = await realpath(directory)
  let lock: Record<string, Json>
  try {
    lock = await jsonFile(resolve(root, 'npm-shrinkwrap.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    lock = await jsonFile(resolve(root, 'package-lock.json'))
  }
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3)
    fail('NPM_LOCK', 'package-lock.json', 'An npm lockfile v2/v3 with an installed package tree is required')
  const lockedPackages = record(lock.packages, 'packages')
  const lockedRoot = record(lockedPackages[''], 'packages[""]')
  const rootPackage = await jsonFile(resolve(root, 'package.json'))
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'])
    if (canonical(rootPackage[field] ?? {}) !== canonical(lockedRoot[field] ?? {}))
      fail('NPM_LOCK', field, 'Server project dependencies differ from its npm lockfile')
  let tree: NpmTree
  try {
    const result = await exec('npm', ['ls', '--all', '--long', '--json', '--omit=dev', '--ignore-scripts'], {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60000,
    })
    tree = JSON.parse(result.stdout) as NpmTree
  } catch (error) {
    fail('NPM_TREE', 'node_modules', `npm rejected the installed dependency tree: ${(error as Error).message}`)
  }
  const nodes = new Map<string, NpmTree>()
  function visit(node: NpmTree) {
    if (!node.path) fail('NPM_TREE', '', 'npm did not provide an installed package path')
    const location = relative(root, node.path).split(sep).join('/')
    if (!location.startsWith('node_modules/') || location.split('/').includes('..'))
      fail('NPM_LINK', location, 'Use packed npm artifacts; linked workspaces are not fixed installations')
    const previous = nodes.get(location)
    if (!previous || Object.keys(node.dependencies ?? {}).length > Object.keys(previous.dependencies ?? {}).length)
      nodes.set(location, node)
    for (const child of Object.values(node.dependencies ?? {})) visit(child)
  }
  for (const child of Object.values(tree.dependencies ?? {})) visit(child)
  await checkInstalledDirectories(root, nodes)
  const packages: InstalledNpmPackage[] = []
  const projects = new Map<string, string>(),
    namespaces = new Map<string, string>()
  for (const [location, node] of [...nodes].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const dir = resolve(root, location)
    if ((await realpath(dir)) !== dir) fail('NPM_LINK', location, 'Linked package installations are not immutable')
    const pkg = await jsonFile(resolve(dir, 'package.json')),
      locked = record(lockedPackages[location], location)
    if (
      typeof pkg.name !== 'string' ||
      !packageName.test(pkg.name) ||
      typeof pkg.version !== 'string' ||
      locked.link ||
      locked.version !== pkg.version ||
      node.version !== pkg.version
    )
      fail('NPM_LOCK', location, 'Installed package does not match its npm lock entry')
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'])
      if (canonical(pkg[field] ?? {}) !== canonical(locked[field] ?? {}))
        fail('NPM_LOCK', location, 'Installed dependency declarations differ from the npm lockfile')
    const dependencies: Record<string, string> = {}
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (!child.path) fail('NPM_TREE', name, 'Missing installed dependency')
      dependencies[name] = relative(root, child.path).split(sep).join('/')
    }
    const entry: InstalledNpmPackage = {
      location,
      name: pkg.name,
      version: pkg.version,
      dependencies,
      filesDigest: await packageDigest(dir),
      ...(typeof locked.integrity === 'string' ? { integrity: locked.integrity } : {}),
    }
    if (pkg.arcadia !== undefined) {
      const manifest = readManifest(pkg.arcadia)
      for (const [map, key, code] of [
        [projects, manifest.projectId, 'CONTENT_VERSION_CONFLICT'],
        [namespaces, manifest.namespace, 'NAMESPACE_CONFLICT'],
      ] as const) {
        if (map.has(key)) fail(code, location, `Content identity ${key} is also registered by ${map.get(key)}`)
        map.set(key, location)
      }
      const data = await jsonFile(packageFile(dir, manifest.content))
      const draft = parseDraft({ ...createDraft(manifest.projectId, pkg.name, manifest.namespace), ...data })
      if (draft.project.id !== manifest.projectId || draft.project.namespace !== manifest.namespace)
        fail('NPM_IDENTITY', manifest.content, 'Content identity differs from package metadata')
      if (draft.dependencies.length || draft.requirements.length)
        fail(
          'NPM_DEPENDENCIES',
          manifest.content,
          'npm packages derive dependency/build requirements from the installed tree',
        )
      if (manifest.effects && !(await lstat(packageFile(dir, manifest.effects))).isFile())
        fail('NPM_FILE', manifest.effects, 'Effect module must be a regular file')
      const blobs: Record<string, Uint8Array> = {}
      for (const [hash, file] of Object.entries(manifest.assets)) blobs[hash] = await readFile(packageFile(dir, file))
      await verifyAssets(draft.assets, blobs)
      entry.manifest = manifest
      entry.draft = draft
    }
    packages.push(entry)
  }
  const identity = packages.map(({ integrity: _integrity, ...pkg }) => pkg)
  return freeze({
    format: 'arcadia.npm-installation',
    version: 1,
    digest: await digestJson(identity),
    lockfileDigest: createHash('sha256').update(canonical(lock)).digest('hex'),
    packages,
  })
}
