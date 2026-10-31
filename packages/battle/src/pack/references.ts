// Pack references and dependency traversal shared by all battle runtimes.
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

export interface DataPackManifest {
  id: string
  version: string
  engine: 'seer2-v2'
  layoutVersion?: 1
  presentation?: string
  assetsRef?: string | string[]
  dependencies?: DataPackDependency[]
  paths?: {
    dataDir?: string
    localesDir?: string
  }
  data: {
    effects: string[]
    marks: string[]
    skills: string[]
    species: string[]
  }
  locales?:
    | Record<string, string[]>
    | Array<{
        locale: string
        files?: string[]
        namespaces?: string[]
      }>
}

export interface DataPackDependency {
  path: string
  id?: string
  optional?: boolean
}

export async function resolvePackPathFromRef(packRef: string): Promise<string> {
  const resolvedPackPath = await resolvePackReference(packRef)
  if (!resolvedPackPath) throw new Error('Pack reference is required')
  return resolvedPackPath
}

/** Native hosts retain each workspace entry and its own lockfile instead of a temporary aggregate. */
export async function resolvePackEntriesFromRef(packRef: string): Promise<string[]> {
  if (packRef === 'builtin:workspace') {
    const packsDir = await resolveBuiltinPacksDir()
    if (packsDir) {
      const entries = await discoverWorkspacePackDescriptors(packsDir)
      if (entries.length) return entries.map(entry => entry.path)
    }
  }
  return [await resolvePackPathFromRef(packRef)]
}

async function loadPackManifest(packPath: string): Promise<DataPackManifest> {
  const raw = JSON.parse(await readFile(packPath, 'utf-8')) as unknown
  if (typeof raw !== 'object' || raw === null) throw new Error(`Invalid pack manifest: ${packPath}`)
  const manifest = raw as DataPackManifest
  if (!manifest.id || !manifest.version || manifest.engine !== 'seer2-v2' || !manifest.data) {
    throw new Error(`Invalid pack manifest fields: ${packPath}`)
  }
  return manifest
}

interface PackPackageJsonLike {
  arcadiaEternityPack?: string
}

const requireFromLoader = createRequire(import.meta.url)

export async function resolvePackReference(packRef?: string): Promise<string | undefined> {
  if (!packRef || packRef.trim().length === 0) return undefined
  const ref = packRef.trim()
  if (ref === 'builtin:workspace') {
    const workspacePath = await resolveBuiltinWorkspacePackPath()
    if (workspacePath) return workspacePath
    return resolvePackReference('builtin:base')
  }
  if (ref === 'builtin:base') {
    const builtinPath = await resolveBuiltinBasePackPath()
    if (builtinPath) return builtinPath
    return resolvePackReference('npm:@arcadia-eternity/data-pack-base')
  }
  const candidate = ref.startsWith('npm:') ? ref.slice(4) : ref

  if (
    candidate.startsWith('.') ||
    candidate.startsWith('/') ||
    candidate.startsWith('..') ||
    candidate.endsWith('.json')
  ) {
    return resolve(candidate)
  }

  const hashIndex = candidate.indexOf('#')
  const packageName = hashIndex >= 0 ? candidate.slice(0, hashIndex) : candidate
  const explicitPackRelPath = hashIndex >= 0 ? candidate.slice(hashIndex + 1) : undefined
  if (!packageName) throw new Error(`Invalid pack ref '${packRef}'`)

  const packageJsonPath = await resolvePackageJsonPath(packageName)
  const packageRoot = dirname(packageJsonPath)
  if (explicitPackRelPath && explicitPackRelPath.length > 0) {
    return resolve(packageRoot, explicitPackRelPath)
  }

  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8')) as PackPackageJsonLike
  const packEntry =
    typeof packageJson.arcadiaEternityPack === 'string' && packageJson.arcadiaEternityPack.length > 0
      ? packageJson.arcadiaEternityPack
      : 'pack.json'
  return resolve(packageRoot, packEntry)
}

async function resolvePackageJsonPath(packageName: string): Promise<string> {
  try {
    return requireFromLoader.resolve(`${packageName}/package.json`)
  } catch {
    const workspaceCandidate = await findWorkspacePackageJson(packageName)
    if (workspaceCandidate) return workspaceCandidate
    throw new Error(`Cannot resolve package '${packageName}' from current environment`)
  }
}

async function findWorkspacePackageJson(packageName: string): Promise<string | undefined> {
  const pkgLeaf = packageName.includes('/') ? packageName.split('/').pop() : packageName
  if (!pkgLeaf) return undefined
  let current = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidates = [
      resolve(current, 'packages', pkgLeaf, 'package.json'),
      resolve(current, 'packs', pkgLeaf, 'package.json'),
    ]
    for (const candidate of candidates) {
      try {
        await access(candidate)
        const raw = JSON.parse(await readFile(candidate, 'utf-8')) as { name?: string }
        if (raw.name === packageName) return candidate
      } catch {
        // continue probing candidates
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

async function resolveBuiltinBasePackPath(): Promise<string | undefined> {
  let current = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(current, 'packs', 'base', 'pack.json')
    try {
      await access(candidate)
      return candidate
    } catch {
      // keep climbing to repo root
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

type WorkspacePackDescriptor = {
  id: string
  path: string
  rawFingerprint: string
  assetRefs: string[]
}

async function resolveBuiltinWorkspacePackPath(): Promise<string | undefined> {
  const packsDir = await resolveBuiltinPacksDir()
  if (!packsDir) return undefined
  const descriptors = await discoverWorkspacePackDescriptors(packsDir)
  if (descriptors.length === 0) return undefined
  if (descriptors.length === 1) return descriptors[0].path
  return createWorkspaceAggregatePack(packsDir, descriptors)
}

async function resolveBuiltinPacksDir(): Promise<string | undefined> {
  const envPath = process.env.ARCADIA_PACKS_DIR?.trim()
  if (envPath) {
    const fromEnv = resolve(envPath)
    try {
      const info = await stat(fromEnv)
      if (info.isDirectory()) return fromEnv
    } catch {
      // ignore invalid env dir and fall back to auto discovery
    }
  }

  let current = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(current, 'packs')
    try {
      const info = await stat(candidate)
      if (info.isDirectory()) return candidate
    } catch {
      // keep climbing to locate workspace packs dir
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

async function discoverWorkspacePackDescriptors(packsDir: string): Promise<WorkspacePackDescriptor[]> {
  const entries = await readdir(packsDir, { withFileTypes: true })
  const descriptors: WorkspacePackDescriptor[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const packPath = resolve(packsDir, entry.name, 'pack.json')
    try {
      await access(packPath)
      const raw = await readFile(packPath, 'utf-8')
      const parsed = JSON.parse(raw) as { id?: string; assetsRef?: string | string[] }
      if (!parsed.id) continue
      const refs = parsed.assetsRef ? (Array.isArray(parsed.assetsRef) ? parsed.assetsRef : [parsed.assetsRef]) : []
      const resolvedRefs = refs.map(ref => {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref)) return ref
        return resolve(dirname(packPath), ref)
      })
      descriptors.push({
        id: parsed.id,
        path: packPath,
        rawFingerprint: raw,
        assetRefs: resolvedRefs,
      })
    } catch {
      // ignore folders that are not valid pack directories
    }
  }

  descriptors.sort((a, b) => {
    const aBase = a.id === 'arcadia-eternity.base'
    const bBase = b.id === 'arcadia-eternity.base'
    if (aBase && !bBase) return -1
    if (!aBase && bBase) return 1
    return a.id.localeCompare(b.id)
  })

  return descriptors
}

async function createWorkspaceAggregatePack(packsDir: string, descriptors: WorkspacePackDescriptor[]): Promise<string> {
  const hashInput = descriptors.map(item => `${item.path}\n${item.rawFingerprint}`).join('\n---\n')
  const hash = createHash('sha1').update(hashInput).digest('hex').slice(0, 16)
  const outputDir = resolve(tmpdir(), 'arcadia-eternity', 'pack-cache')
  const outputPath = resolve(outputDir, `workspace-${hash}.json`)

  const allAssetRefs = [...new Set(descriptors.flatMap(item => item.assetRefs))]
  const aggregate: DataPackManifest = {
    id: 'arcadia-eternity.workspace',
    version: '1.0.0',
    engine: 'seer2-v2',
    layoutVersion: 1,
    data: {
      effects: [],
      marks: [],
      skills: [],
      species: [],
    },
    dependencies: descriptors.map(item => ({
      id: item.id,
      path: item.path,
    })),
  }

  if (allAssetRefs.length === 1) {
    aggregate.assetsRef = allAssetRefs[0]
  } else if (allAssetRefs.length > 1) {
    aggregate.assetsRef = allAssetRefs
  }

  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, JSON.stringify(aggregate, null, 2), 'utf-8')
  return outputPath
}

export interface ResolvedPack {
  path: string
  manifest: DataPackManifest
  dataRoot: string
  localesRoot: string
}

export async function resolvePackLoadOrder(
  entryPackPath: string,
  continueOnError: boolean,
  errors: string[],
): Promise<{ order: ResolvedPack[]; entryManifest: DataPackManifest }> {
  const state = new Map<string, 'visiting' | 'done'>()
  const resolved = new Map<string, ResolvedPack>()
  const order: ResolvedPack[] = []

  const visit = async (
    packPathRaw: string,
    fromPackPath?: string,
    expectedId?: string,
    optional?: boolean,
  ): Promise<void> => {
    const packPath = resolve(packPathRaw)
    const currentState = state.get(packPath)
    if (currentState === 'done') {
      const manifest = resolved.get(packPath)!.manifest
      if (expectedId && manifest.id !== expectedId) {
        const message = `Pack id mismatch for '${packPath}': expected '${expectedId}', got '${manifest.id}'`
        if (optional) {
          errors.push(`Optional dependency skipped: ${message}`)
          return
        }
        errors.push(message)
        throw new Error(message)
      }
      return
    }
    if (currentState === 'visiting') {
      const message = `Pack dependency cycle detected at '${packPath}'`
      errors.push(message)
      throw new Error(message)
    }

    let manifest: DataPackManifest
    try {
      manifest = await loadPackManifest(packPath)
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
      if (optional) {
        errors.push(`Optional dependency skipped: ${packPath} (${msg})`)
        return
      }
      throw err
    }

    if (expectedId && manifest.id !== expectedId) {
      const message = `Pack id mismatch for '${packPath}': expected '${expectedId}', got '${manifest.id}'`
      if (optional) {
        errors.push(`Optional dependency skipped: ${message}`)
        return
      }
      errors.push(message)
      throw new Error(message)
    }

    state.set(packPath, 'visiting')
    for (const dep of manifest.dependencies ?? []) {
      const depPath = resolve(dirname(packPath), dep.path)
      try {
        await visit(depPath, packPath, dep.id, dep.optional)
      } catch (err) {
        if (dep.optional || continueOnError) {
          const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error'
          errors.push(`Dependency load warning from '${manifest.id}' -> '${dep.path}': ${msg}`)
          continue
        }
        throw err
      }
    }

    const roots = getPackRoots(packPath, manifest)
    const item: ResolvedPack = {
      path: packPath,
      manifest,
      dataRoot: roots.dataRoot,
      localesRoot: roots.localesRoot,
    }
    resolved.set(packPath, item)
    order.push(item)
    state.set(packPath, 'done')
    void fromPackPath
  }

  const entryPath = resolve(entryPackPath)
  await visit(entryPath)
  const entry = resolved.get(entryPath)
  if (!entry) throw new Error(`Failed to resolve entry pack: ${entryPath}`)
  return { order, entryManifest: entry.manifest }
}

function getPackRoots(packPath: string, manifest: DataPackManifest): { dataRoot: string; localesRoot: string } {
  const packRoot = dirname(resolve(packPath))
  const dataDir = manifest.paths?.dataDir ?? '.'
  const localesDir = manifest.paths?.localesDir ?? 'locales'
  return {
    dataRoot: resolve(packRoot, dataDir),
    localesRoot: resolve(packRoot, localesDir),
  }
}
