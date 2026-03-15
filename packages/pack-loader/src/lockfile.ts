import { createHash } from 'node:crypto'
import { basename, dirname, relative, resolve } from 'node:path'
import { readdir, readFile, stat } from 'node:fs/promises'

type LockProvenance = 'npm' | 'workspace' | 'file' | 'git' | 'http' | 'builtin' | 'unknown'

type LockImporterDependency = {
  specifier: string
  version: string
  packageKey: string
}

type LockImporterSnapshot = {
  specifiers?: Record<string, string>
  dependencies?: Record<string, LockImporterDependency>
}

type LockPackageSnapshot = {
  name: string
  version: string
  kind: 'data' | 'asset'
  engine: string
  source: string
  entry: string
  provenance: LockProvenance
  resolution?: {
    integrity?: string
    resolved?: string
    tarball?: string
    path?: string
    commit?: string
  }
  dependencies?: Record<string, string>
}

type PackLockfile = {
  lockfileVersion: 1
  generatedAt: string
  importers: Record<string, LockImporterSnapshot>
  packages: Record<string, LockPackageSnapshot>
}

type PackDependency = {
  path: string
}

type PackManifest = {
  id: string
  version: string
  engine: string
  assetsRef?: string | string[]
  dependencies?: PackDependency[]
}

type AssetManifest = {
  id: string
  version: string
  engine: string
  dependencies?: string[]
}

type QueueItem = {
  absPath: string
  importer: string
  kind: 'data' | 'asset'
  parentKey?: string
  dependencyName?: string
}

type PackageMeta = {
  packageName?: string
  packageRoot?: string
  packEntry?: string
  assetsEntry?: string
}

function toSRI(content: string): string {
  const digest = createHash('sha512').update(content).digest('base64')
  return `sha512-${digest}`
}

function packageKeyOf(name: string, version: string): string {
  return `/${name}@${version}`
}

async function findNearestPackageMeta(startPath: string): Promise<PackageMeta> {
  let current = dirname(startPath)
  while (true) {
    const pkgPath = resolve(current, 'package.json')
    try {
      await stat(pkgPath)
      const raw = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        name?: string
        arcadiaEternityPack?: string
        arcadiaEternityAssets?: string
      }
      return {
        packageName: raw.name,
        packageRoot: current,
        packEntry: raw.arcadiaEternityPack,
        assetsEntry: raw.arcadiaEternityAssets,
      }
    } catch {
      const parent = dirname(current)
      if (parent === current) return {}
      current = parent
    }
  }
}

async function detectSourceRef(absPath: string, kind: 'data' | 'asset'): Promise<{ source: string; provenance: LockProvenance }> {
  const meta = await findNearestPackageMeta(absPath)
  if (meta.packageName && meta.packageRoot) {
    const expectedEntry = kind === 'data' ? meta.packEntry : meta.assetsEntry
    const relPath = relative(meta.packageRoot, absPath).replace(/\\/g, '/')
    if (expectedEntry && relPath === expectedEntry) {
      return {
        source: `workspace:${meta.packageName}#${expectedEntry}`,
        provenance: 'workspace',
      }
    }
  }

  return {
    source: `file:${absPath}`,
    provenance: 'file',
  }
}

async function registerImporterDependency(
  importers: Record<string, LockImporterSnapshot>,
  importer: string,
  packageName: string,
  packageVersion: string,
  packageKey: string,
  specifier: string,
): Promise<void> {
  const importerSnapshot = importers[importer] ?? { specifiers: {}, dependencies: {} }
  importerSnapshot.specifiers ??= {}
  importerSnapshot.dependencies ??= {}
  importerSnapshot.specifiers[packageName] = specifier
  importerSnapshot.dependencies[packageName] = {
    specifier,
    version: packageVersion,
    packageKey,
  } satisfies LockImporterDependency
  importers[importer] = importerSnapshot
}

function parsePackManifest(raw: string): PackManifest {
  return JSON.parse(raw) as PackManifest
}

function parseAssetManifest(raw: string): AssetManifest {
  return JSON.parse(raw) as AssetManifest
}

export async function generatePackLockfileFromEntry(entryPath: string, importer = '.'): Promise<PackLockfile> {
  const rootPath = resolve(entryPath)
  const importers: Record<string, LockImporterSnapshot> = {
    [importer]: { specifiers: {}, dependencies: {} },
  }
  const packages: Record<string, LockPackageSnapshot> = {}
  const visited = new Set<string>()
  const queue: QueueItem[] = [{ absPath: rootPath, importer, kind: 'data' }]

  while (queue.length > 0) {
    const current = queue.shift()!
    const visitKey = `${current.kind}:${current.absPath}`
    if (visited.has(visitKey)) continue
    visited.add(visitKey)

    const raw = await readFile(current.absPath, 'utf8')

    if (current.kind === 'data') {
      const manifest = parsePackManifest(raw)
      const key = packageKeyOf(manifest.id, manifest.version)
      const resolvedRef = await detectSourceRef(current.absPath, 'data')

      packages[key] = {
        name: manifest.id,
        version: manifest.version,
        kind: 'data',
        engine: manifest.engine,
        source: resolvedRef.source,
        entry: 'pack.json',
        provenance: resolvedRef.provenance,
        resolution: {
          integrity: toSRI(raw),
          path: current.absPath,
        },
        dependencies: {},
      }

      await registerImporterDependency(importers, current.importer, manifest.id, manifest.version, key, resolvedRef.source)

      for (const dep of manifest.dependencies ?? []) {
        const depAbs = resolve(dirname(current.absPath), dep.path)
        const depRaw = await readFile(depAbs, 'utf8')
        const depManifest = parsePackManifest(depRaw)
        const depKey = packageKeyOf(depManifest.id, depManifest.version)
        packages[key].dependencies![depManifest.id] = depKey
        queue.push({
          absPath: depAbs,
          importer: current.importer,
          kind: 'data',
          parentKey: key,
          dependencyName: depManifest.id,
        })
      }

      const assetRefs = manifest.assetsRef ? (Array.isArray(manifest.assetsRef) ? manifest.assetsRef : [manifest.assetsRef]) : []
      for (const assetRef of assetRefs) {
        const resolvedAssetPaths = await resolveAssetManifestPaths(dirname(current.absPath), assetRef)
        for (const assetPath of resolvedAssetPaths) {
          queue.push({
            absPath: assetPath,
            importer: current.importer,
            kind: 'asset',
            parentKey: key,
          })
        }
      }

      continue
    }

    const manifest = parseAssetManifest(raw)
    const key = packageKeyOf(manifest.id, manifest.version)
    const resolvedRef = await detectSourceRef(current.absPath, 'asset')

    packages[key] = {
      name: manifest.id,
      version: manifest.version,
      kind: 'asset',
      engine: manifest.engine,
      source: resolvedRef.source,
      entry: 'assets.json',
      provenance: resolvedRef.provenance,
      resolution: {
        integrity: toSRI(raw),
        path: current.absPath,
      },
      dependencies: {},
    }

    if (current.parentKey) {
      const depName = current.dependencyName ?? manifest.id
      packages[current.parentKey].dependencies ??= {}
      packages[current.parentKey].dependencies![depName] = key
    }

    for (const dep of manifest.dependencies ?? []) {
      queue.push({
        absPath: resolve(dirname(current.absPath), dep),
        importer: current.importer,
        kind: 'asset',
        parentKey: key,
      })
    }
  }

  return {
    lockfileVersion: 1,
    generatedAt: new Date().toISOString(),
    importers,
    packages,
  }
}

async function resolveAssetManifestPaths(baseDir: string, assetRef: string): Promise<string[]> {
  const candidate = resolve(baseDir, assetRef)
  try {
    const info = await stat(candidate)
    if (!info.isDirectory()) {
      return [candidate]
    }
    const entries = await readdir(candidate, { withFileTypes: true })
    const manifests = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map(entry => resolve(candidate, entry.name))
    if (manifests.length === 0) {
      return [resolve(candidate, 'assets.json')]
    }
    manifests.sort((a, b) => {
      const aIsDefault = basename(a).toLowerCase() === 'assets.json'
      const bIsDefault = basename(b).toLowerCase() === 'assets.json'
      if (aIsDefault && !bIsDefault) return -1
      if (!aIsDefault && bIsDefault) return 1
      return a.localeCompare(b)
    })
    return manifests
  } catch {
    const normalizedRef = assetRef.endsWith('.json') ? assetRef : `${assetRef.replace(/\/+$/, '')}/assets.json`
    return [resolve(baseDir, normalizedRef)]
  }
}
