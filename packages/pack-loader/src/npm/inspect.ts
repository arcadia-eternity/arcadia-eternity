import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  canonical,
  cloneJson,
  createDraft,
  digestJson,
  fail,
  freeze,
  parseDraft,
  type Json,
  type WorkDraft,
} from '../works/model'
import { verifyAssets } from '../works/compiler'
import { PresentationManifestSchema, parseWithErrors, type PresentationManifest } from '@arcadia-eternity/schema'
import { effectSdkApiVersion } from '@arcadia-eternity/battle/authoring'
import { resolveNpmInvocation } from './runner'

const exec = promisify(execFile)
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/
export interface NpmContentManifest {
  formatVersion: 1
  projectId: string
  namespace: string
  content: string
  effects?: string
  /** Author-produced closed EffectModuleArtifact JSON, consumed without compiling or evaluating code. */
  effectArtifact?: string
  sdkApi?: number
  /** Asset digest -> package-relative filename. Bytes are checked even in headless mode. */
  presentation?: string
  assets: Record<string, string>
}
export interface InstalledNpmPackage {
  location: string
  name: string
  version: string
  integrity?: string
  dependencies: Record<string, string>
  dependencyRanges?: Record<string, string>
  manifest?: NpmContentManifest
  draft?: WorkDraft
  presentation?: PresentationManifest
  /** Static adapter for the reserved, unnamespaced official catalog. */
  officialHost?: string
  catalogIds?: Record<'species' | 'skills' | 'marks', string[]>
}
export interface NpmContentMember {
  name: string
  version: string
  projectId: string
  namespace: string
  direct: boolean
  dependencies: string[]
  requiredBy: string[]
}
export interface NpmProjectInspection {
  format: 'arcadia.npm-installation'
  version: 1
  /** Content metadata and dependency graph, not a fingerprint of locally editable code files. */
  digest: string
  /** Audit identity of npm's source/solver record, not a replacement for tarball integrity. */
  lockfileDigest: string
  members: readonly NpmContentMember[]
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
        ![
          'formatVersion',
          'projectId',
          'namespace',
          'content',
          'effects',
          'effectArtifact',
          'sdkApi',
          'assets',
          'presentation',
        ].includes(key),
    )
  )
    fail('NPM_METADATA', 'arcadia', 'Unsupported Arcadia package metadata')
  createDraft(input.projectId, input.projectId, input.namespace)
  packageFile('/', input.content)
  if (input.effects !== undefined) packageFile('/', input.effects)
  if (input.effectArtifact !== undefined) packageFile('/', input.effectArtifact)
  if (input.presentation !== undefined) packageFile('/', input.presentation)
  if (
    (input.effects !== undefined || input.effectArtifact !== undefined || input.sdkApi !== undefined) &&
    input.sdkApi !== effectSdkApiVersion
  )
    fail('SDK_INCOMPATIBLE', 'arcadia.sdkApi', `Code packages require Effect SDK API ${effectSdkApiVersion}`)
  input.assets ??= {}
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
  if (lock.lockfileVersion !== 3)
    fail('NPM_LOCK', 'package-lock.json', 'An npm lockfile v3 with an installed package tree is required')
  const lockedPackages = record(lock.packages, 'packages')
  const lockedRoot = record(lockedPackages[''], 'packages[""]')
  const rootPackage = await jsonFile(resolve(root, 'package.json'))
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'])
    if (canonical(rootPackage[field] ?? {}) !== canonical(lockedRoot[field] ?? {}))
      fail('NPM_LOCK', field, 'Server project dependencies differ from its npm lockfile')
  let tree: NpmTree
  const npm = await resolveNpmInvocation(['ls', '--all', '--long', '--json', '--omit=dev', '--ignore-scripts'])
  try {
    const result = await exec(npm.file, npm.args, {
      cwd: root,
      env: process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60000,
      windowsHide: true,
    })
    tree = JSON.parse(result.stdout) as NpmTree
  } catch (error) {
    fail('NPM_TREE', 'node_modules', `npm rejected the installed dependency tree: ${(error as Error).message}`)
  }
  const nodes = new Map<string, NpmTree>()
  const resolvedDependencies = new Map<string, string>()
  async function dependencyDirectory(parent: string, name: string): Promise<string> {
    if (!packageName.test(name)) fail('NPM_TREE', name, 'Invalid dependency name')
    const key = parent + '\0' + name
    const cached = resolvedDependencies.get(key)
    if (cached) return cached
    let ancestor = parent
    for (;;) {
      if (ancestor === root || basename(ancestor) !== 'node_modules') {
        const candidate = resolve(ancestor, 'node_modules', name)
        let info
        try {
          info = await lstat(candidate)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (info) {
          const location = relative(root, candidate).split(sep).join('/')
          if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(candidate)) !== candidate)
            fail('NPM_LINK', location, 'Linked package installations are not immutable')
          if (!Object.hasOwn(lockedPackages, location))
            fail('NPM_LOCK', location, 'Installed dependency is missing from its npm lockfile')
          resolvedDependencies.set(key, candidate)
          return candidate
        }
      }
      if (ancestor === root) break
      ancestor = dirname(ancestor)
      const location = relative(root, ancestor)
      if (isAbsolute(location) || location === '..' || location.startsWith('..' + sep)) break
    }
    return fail('NPM_TREE', name, 'Missing installed dependency within this project')
  }
  async function visit(node: NpmTree, parent: string, name: string): Promise<NpmTree> {
    // npm represents omitted optional dependencies and optional peers as {}.
    // Required missing dependencies already make the npm ls command fail.
    if (!Object.keys(node).length) return node
    // npm sanitizes UUIDs and credentials even in machine-readable path fields.
    // Resolve graph edges using the actual filesystem and standard nearest
    // node_modules lookup, then verify every location against the npm lock.
    // Neither a sanitized path nor replacing "***" can authorize a directory.
    const path = await dependencyDirectory(parent, name)
    const location = relative(root, path).split(sep).join('/')
    const dependencies: Record<string, NpmTree> = {}
    for (const [name, child] of Object.entries(node.dependencies ?? {}))
      dependencies[name] = await visit(child, path, name)
    const normalized = { ...node, path, dependencies }
    const previous = nodes.get(location)
    if (!previous || Object.keys(dependencies).length > Object.keys(previous.dependencies ?? {}).length)
      nodes.set(location, normalized)
    return normalized
  }
  for (const [name, child] of Object.entries(tree.dependencies ?? {})) await visit(child, root, name)
  await checkInstalledDirectories(root, nodes)
  const packages: InstalledNpmPackage[] = []
  const contentNames = new Set<string>()
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
      if (!Object.keys(child).length) continue
      if (!child.path) fail('NPM_TREE', name, 'Missing installed dependency')
      dependencies[name] = relative(root, child.path).split(sep).join('/')
    }
    const entry: InstalledNpmPackage = {
      location,
      name: pkg.name,
      version: pkg.version,
      dependencies,
      ...(typeof locked.integrity === 'string' ? { integrity: locked.integrity } : {}),
    }
    if (pkg.name === '@arcadia-eternity/data-pack-base' && pkg.arcadiaEternityPack !== undefined) {
      if (contentNames.has(pkg.name))
        fail('CONTENT_VERSION_CONFLICT', location, 'Official base must have one installed version')
      contentNames.add(pkg.name)
      if (projects.has('base')) fail('CONTENT_VERSION_CONFLICT', location, 'Content project base is already registered')
      if (namespaces.has('base')) fail('NAMESPACE_CONFLICT', location, 'Content namespace base is already registered')
      projects.set('base', location)
      namespaces.set('base', location)
      const catalog =
        pkg.arcadia && typeof pkg.arcadia === 'object' && !Array.isArray(pkg.arcadia) && pkg.arcadia.catalog
      if (typeof catalog !== 'string')
        fail('NPM_BASE_HOST_REQUIRED', location, 'Installed base package needs its compiled catalog artifact')
      packageFile(dir, catalog)
      entry.officialHost = catalog
      const manifest = record(pkg.arcadia, 'arcadia')
      if (typeof manifest.content !== 'string')
        fail('NPM_METADATA', 'arcadia.content', 'Expected a catalog content file')
      const content = await jsonFile(packageFile(dir, manifest.content))
      const data = record(content.data, 'content.data')
      entry.catalogIds = { species: [], skills: [], marks: [] }
      for (const kind of ['species', 'skills', 'marks'] as const) {
        const rows = data[kind]
        if (!Array.isArray(rows)) fail('NPM_METADATA', kind, 'Expected catalog records')
        entry.catalogIds[kind] = rows.map(row => {
          const { id } = record(row, kind)
          if (typeof id !== 'string') fail('NPM_METADATA', kind, 'Expected a catalog record ID')
          return id
        })
      }
    }
    if (pkg.arcadia !== undefined && !entry.officialHost) {
      if (contentNames.has(pkg.name))
        fail('CONTENT_VERSION_CONFLICT', location, `Resource pack ${pkg.name} must have one installed version`)
      contentNames.add(pkg.name)
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
      if (manifest.effectArtifact && !(await lstat(packageFile(dir, manifest.effectArtifact))).isFile())
        fail('NPM_FILE', manifest.effectArtifact, 'Prebuilt effect artifact must be a regular file')
      const blobs: Record<string, Uint8Array> = {}
      for (const [hash, file] of Object.entries(manifest.assets)) blobs[hash] = await readFile(packageFile(dir, file))
      await verifyAssets(draft.assets, blobs)
      if (manifest.presentation) {
        const raw = await jsonFile(packageFile(dir, manifest.presentation))
        entry.presentation = parseWithErrors(PresentationManifestSchema, raw)
        const ids = new Set<string>()
        for (const asset of entry.presentation.resources) {
          if (ids.has(asset.id)) fail('RESOURCE_CONFLICT', asset.id, 'Duplicate resource ID')
          ids.add(asset.id)
          if (asset.kind === 'file') packageFile(dir, asset.source)
          else {
            const url = new URL(asset.source)
            if (url.username || url.password)
              fail('RESOURCE_URL', asset.source, 'Resource URL must not contain credentials')
          }
        }
      }
      entry.dependencyRanges = {
        ...record(pkg.dependencies ?? {}, location),
        ...record(pkg.optionalDependencies ?? {}, location),
        ...record(pkg.peerDependencies ?? {}, location),
      } as Record<string, string>
      entry.manifest = manifest
      entry.draft = draft
    }
    packages.push(entry)
  }
  const byLocation = new Map(packages.map(pkg => [pkg.location, pkg]))
  const rootDependencies = record(rootPackage.dependencies ?? {}, 'dependencies')
  const rootOptional = record(rootPackage.optionalDependencies ?? {}, 'optionalDependencies')
  const rootPeers = record(rootPackage.peerDependencies ?? {}, 'peerDependencies')
  const members: NpmContentMember[] = packages
    .filter(pkg => pkg.manifest || pkg.officialHost)
    .map(pkg => {
      const dependencies = new Set<string>()
      const visited = new Set<string>()
      const visit = (location: string) => {
        if (visited.has(location)) return
        visited.add(location)
        const target = byLocation.get(location)
        if (!target) return
        if (target.manifest || target.officialHost) dependencies.add(target.name)
        else Object.values(target.dependencies).forEach(visit)
      }
      Object.values(pkg.dependencies).forEach(visit)
      return {
        name: pkg.name,
        version: pkg.version,
        projectId: pkg.manifest?.projectId ?? 'base',
        namespace: pkg.manifest?.namespace ?? 'base',
        direct:
          Object.hasOwn(rootDependencies, pkg.name) ||
          Object.hasOwn(rootOptional, pkg.name) ||
          Object.hasOwn(rootPeers, pkg.name),
        dependencies: [...dependencies].sort(),
        requiredBy: [],
      }
    })
  for (const member of members)
    member.requiredBy = members
      .filter(other => other.dependencies.includes(member.name))
      .map(other => other.name)
      .sort()
  const identity = packages.map(({ integrity: _integrity, dependencyRanges: _ranges, ...pkg }) => pkg)
  return freeze({
    format: 'arcadia.npm-installation',
    version: 1,
    digest: await digestJson(identity),
    lockfileDigest: createHash('sha256').update(canonical(lock)).digest('hex'),
    packages,
    members,
  })
}
