import { createHash } from 'node:crypto'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import { contentError, materialFiles, writeMaterials } from './workspace-materials.ts'
import { packageLocation, verifyArchive, readArchiveFiles } from './environment-sharing.ts'

/** Copy the selected installed npm subtree into a fresh project. Both inputs are read leases. */
export async function copyEnvironmentMember(
  source: string,
  name: string,
  target: string | undefined,
  destination: string,
  signal?: AbortSignal,
) {
  const inspection = await inspectNpmProject(source)
  const root = inspection.packages.find(pkg => pkg.name === name && pkg.manifest)
  if (!root) throw contentError('ENVIRONMENT_PACKAGE_MISMATCH')
  const materials = await materialFiles(source, { signal })
  const groups = Map.groupBy(materials, file => packageLocation(file.path))
  const captured = new Map(materials.map(file => [file.path, file.bytes]))
  const files = new Map(
    (target ? await materialFiles(target, { signal, allowMissingLock: true }) : []).map(file => [
      file.path,
      file.bytes,
    ]),
  )
  const sourceLock = JSON.parse(captured.get('package-lock.json')!.toString())
  const manifest = JSON.parse(
    files.get('package.json')?.toString() ??
      '{"name":"arcadia-member","version":"1.0.0","private":true,"dependencies":{}}',
  )
  const lock = JSON.parse(files.get('package-lock.json')?.toString() ?? '{"lockfileVersion":3,"packages":{"":{}}}')
  const byLocation = new Map(inspection.packages.map(pkg => [pkg.location, pkg]))
  const selected = new Set<string>()
  function visit(location: string) {
    if (selected.has(location)) return
    selected.add(location)
    Object.values(byLocation.get(location)!.dependencies).forEach(visit)
  }
  visit(root.location)
  const relocate = (location: string) =>
    location === root.location || location.startsWith(root.location + '/')
      ? 'node_modules/' + name + location.slice(root.location.length)
      : location
  let rootArchive: string | undefined
  const copied = new Map<string, Buffer>()
  for (const location of selected) {
    const entry = { ...sourceLock.packages[location] }
    if (typeof entry.resolved === 'string' && entry.resolved.startsWith('file:')) {
      const bytes = captured.get(entry.resolved.slice(5))
      if (!bytes || typeof entry.integrity !== 'string') throw contentError('ENVIRONMENT_SOURCE_MISSING')
      verifyArchive(bytes, entry.integrity)
      const archive = await readArchiveFiles(bytes, { signal })
      for (const file of groups.get(location) ?? []) {
        if (!archive.get(file.path.slice(location.length + 1))?.equals(file.bytes))
          throw contentError('SOURCE_INTEGRITY_MISMATCH', '已安装文件与锁定的包归档不一致')
      }
      const path = 'candidates/' + createHash('sha256').update(bytes).digest('hex') + '.tgz'
      copied.set(path, bytes)
      entry.resolved = 'file:' + path
      if (location === root.location) rootArchive = path
    }
    const dest = relocate(location)
    const previous = lock.packages[dest]
    if (previous && (previous.version !== entry.version || previous.integrity !== entry.integrity))
      throw contentError('ENVIRONMENT_DEPENDENCY_CONFLICT', '目标环境已使用不同的依赖版本或构建产物')
    lock.packages[dest] = entry
  }
  if (!rootArchive) throw contentError('ENVIRONMENT_SOURCE_MISSING', '此内容包没有随环境保存的本地归档')
  for (const [path, bytes] of captured) {
    const location = packageLocation(path)
    if (selected.has(location)) copied.set(relocate(location) + path.slice(location.length), bytes)
  }
  for (const [path, bytes] of copied) {
    if (files.has(path) && !files.get(path)!.equals(bytes)) throw contentError('ENVIRONMENT_DEPENDENCY_CONFLICT')
    files.set(path, bytes)
  }
  manifest.dependencies = { ...manifest.dependencies, [name]: 'file:' + rootArchive }
  lock.packages[''] = {
    ...lock.packages[''],
    name: manifest.name,
    version: manifest.version,
    dependencies: manifest.dependencies,
  }
  files.set('package.json', Buffer.from(JSON.stringify(manifest)))
  files.set('package-lock.json', Buffer.from(JSON.stringify(lock)))
  // npm's hidden lock describes the previous tree. The root lock owns the merged project.
  files.delete('node_modules/.package-lock.json')
  await writeMaterials(
    destination,
    [...files].map(([path, bytes]) => ({ path, bytes })),
    { signal },
  )
  const merged = await inspectNpmProject(destination, { includeRuleSets: true })
  const mergedByLocation = new Map(merged.packages.map(pkg => [pkg.location, pkg]))
  for (const location of selected) {
    const original = byLocation.get(location)!
    const restored = mergedByLocation.get(relocate(location))
    if (
      !restored ||
      Object.entries(original.dependencies).some(([key, path]) => restored.dependencies[key] !== relocate(path))
    ) {
      throw contentError('ENVIRONMENT_DEPENDENCY_CONFLICT', '目标环境会改变这个包的依赖，请调整包版本')
    }
  }
  return { archive: rootArchive, inspection: merged }
}
