import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { withShippedEnvironmentProject, withShippedCatalogArchive } from '@arcadia-eternity/pack-loader/node'
import type { EnvironmentDocumentV2 } from './debug-environments.ts'
import { contentError, materialFiles } from './workspace-materials.ts'

const hostBaseName = '@arcadia-eternity/data-pack-base'
const baseLocation = 'node_modules/' + hostBaseName
type Material = { path: string; bytes: Buffer }
type Host = { bundledPackageRoot?: string; signal?: AbortSignal; maxBytes?: number; maxFiles?: number }

export function isBaseMaterial(path: string) {
  return ('/' + path.toLowerCase() + '/').includes('/' + baseLocation + '/')
}

/** Transfer only membership of the host base. Rebuild its installation and lock from the receiving host. */
export async function environmentShareMaterials(files: Material[], document: EnvironmentDocumentV2, receiver?: Host) {
  const manifestFile = files.find(file => file.path === 'package.json')!
  const lockFile = files.find(file => file.path === 'package-lock.json')!
  const manifest = JSON.parse(manifestFile.bytes.toString())
  const lock = JSON.parse(lockFile.bytes.toString())
  let hasBase = Object.hasOwn(document.packages, hostBaseName) || document.sources.includes(hostBaseName)
  const candidates = new Set<string>()
  for (const [location, entry] of Object.entries(lock.packages) as [
    string,
    { name?: string; resolved?: string; inBundle?: boolean },
  ][]) {
    if (isBaseMaterial(location)) {
      // An enclosing npm tarball can itself contain the base. Its bytes cannot be split without breaking its integrity.
      if (entry.inBundle)
        throw contentError('BUNDLED_BASE_IN_DEPENDENCY', '请将基础包从第三方包的内嵌依赖中移除后再分享。')
      hasBase = true
      delete lock.packages[location]
    } else if (location && entry.name === hostBaseName) {
      throw contentError('BUNDLED_BASE_ALIAS', '请使用基础包的正式包名。')
    } else if (entry.resolved?.startsWith('file:')) candidates.add(entry.resolved.slice(5))
  }
  // Startup synchronization can leave old base archives with arbitrary candidate filenames.
  const portable = files.filter(
    file => !isBaseMaterial(file.path) && (!file.path.startsWith('candidates/') || candidates.has(file.path)),
  )
  if (!hasBase) return { files: portable, document, usesBase: false }
  const sources = document.sources.filter(name => name !== hostBaseName)
  let version = '*'
  let spec = version
  const materials = portable.filter(
    file => file !== manifestFile && file !== lockFile && file.path !== 'node_modules/.package-lock.json',
  )
  if (receiver) {
    if (!receiver.bundledPackageRoot) throw contentError('BUNDLED_PACKAGE_UNAVAILABLE', '接收端缺少内置基础包。')
    const shipped = await withShippedEnvironmentProject(receiver.bundledPackageRoot, dir =>
      materialFiles(dir, { ...receiver, subtree: baseLocation }),
    )
    const pkg = shipped.find(file => file.path === baseLocation + '/package.json')
    if (!pkg) throw contentError('BUNDLED_PACKAGE_INVALID')
    const installed = JSON.parse(pkg.bytes.toString())
    if (installed.name !== hostBaseName || typeof installed.version !== 'string')
      throw contentError('BUNDLED_PACKAGE_INVALID')
    version = installed.version
    materials.push(...shipped)
    spec = version
    const entry: { name: string; version: string; resolved?: string; integrity?: string } = {
      name: hostBaseName,
      version,
    }
    // Mixed projects use the same local npm candidate as a normal managed installation.
    if (Object.keys(lock.packages).some(location => location && location !== baseLocation)) {
      const bytes = await withShippedCatalogArchive(receiver.bundledPackageRoot, undefined, path => readFile(path))
      const path = 'candidates/base-' + createHash('sha256').update(bytes).digest('hex') + '.tgz'
      spec = 'file:' + path
      entry.resolved = spec
      entry.integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
      materials.push({ path, bytes })
    }
    lock.packages[baseLocation] = entry
  }
  manifest.dependencies = { ...manifest.dependencies, [hostBaseName]: spec }
  if (manifest.arcadiaManagedSources) delete manifest.arcadiaManagedSources[hostBaseName]
  if (manifest.arcadiaEnvironment) manifest.arcadiaEnvironment.sources = sources
  lock.packages[''] = { ...lock.packages[''], dependencies: manifest.dependencies }
  // Version 2 locks may also carry npm's redundant legacy dependency tree.
  if (lock.lockfileVersion === 2) {
    delete lock.dependencies
    lock.lockfileVersion = 3
  }
  materials.push(
    { path: manifestFile.path, bytes: Buffer.from(JSON.stringify(manifest)) },
    { path: lockFile.path, bytes: Buffer.from(JSON.stringify(lock)) },
  )
  return {
    files: materials,
    document: { ...document, packages: { ...document.packages, [hostBaseName]: version }, sources },
    usesBase: true,
  }
}
