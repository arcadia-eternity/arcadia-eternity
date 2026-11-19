import { sha256Bytes } from '@arcadia-eternity/const'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { matchesArchiveIntegrity, tarFiles } from './managed-sources.ts'
import { isBaseMaterial } from './environment-host-base.ts'
import { contentError, materialFiles, readJson } from './workspace-materials.ts'
import { errorCode, isRecord } from './types.ts'

type Material = { path: string; bytes: Buffer }
export type ArchiveReference = {
  location: string
  paths: string[]
  digest: string
  bundledBase?: true
  external?: { name: string; version: string; integrity: string; manual: boolean }
}
type Limits = { maxBytes?: number; maxFiles?: number; signal?: AbortSignal }
const candidate = /^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/
const publicTarball =
  /^https:\/\/registry\.npmjs\.org\/(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*\/-\/[a-zA-Z0-9_.+-]+\.tgz$/
const locationPattern =
  /^(?:node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*\/)*node_modules\/(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/

function sourceFor(lock: unknown, location: string) {
  if (!locationPattern.test(location) || !isRecord(lock) || !isRecord(lock.packages)) return
  const pkg = lock.packages[location]
  if (
    !isRecord(pkg) ||
    typeof pkg.version !== 'string' ||
    typeof pkg.resolved !== 'string' ||
    typeof pkg.integrity !== 'string' ||
    !/^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(pkg.integrity)
  )
    return
  if (candidate.test(pkg.resolved) || /^https:\/\//.test(pkg.resolved))
    return { resolved: pkg.resolved, integrity: pkg.integrity, version: pkg.version }
}
export function packageLocation(path: string) {
  const start = path.lastIndexOf('node_modules/')
  if (start < 0 || (start && path[start - 1] !== '/')) return ''
  const parts = path.slice(start + 13).split('/')
  return path.slice(0, start + 13) + parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/')
}
function fileDigest(files: Material[]) {
  const digest = sha256.create()
  for (const file of files) digest.update(Buffer.from(file.path + '\0')).update(sha256Bytes(file.bytes))
  return bytesToHex(digest.digest())
}
export function verifyArchive(bytes: Buffer, integrity: string) {
  if (!matchesArchiveIntegrity(bytes, integrity))
    throw contentError('SOURCE_INTEGRITY_MISMATCH', '内容包归档与锁定摘要不符')
}
export async function readArchiveFiles(bytes: Buffer, limits: Limits) {
  const files = await tarFiles(Readable.from([bytes]), {
    signal: limits.signal ?? AbortSignal.timeout(120000),
    timeoutMs: 120000,
    maxFiles: limits.maxFiles ?? 50000,
    maxBytes: limits.maxBytes ?? 256 * 1024 * 1024,
  })
  // npm strips the first directory component, including in older non-package/ tarballs.
  return new Map(files.map(file => [file.name.slice(file.name.indexOf('/') + 1), file.bytes]))
}
function externalDependency(source: NonNullable<ReturnType<typeof sourceFor>>, location: string) {
  if (!source.resolved.startsWith('https:')) return
  return {
    name: location.slice(location.lastIndexOf('node_modules/') + 13),
    version: source.version,
    integrity: source.integrity,
    manual: !publicTarball.test(source.resolved),
  }
}

export function exportDependencies(materials: Material[]) {
  const lock = JSON.parse(materials.find(file => file.path === 'package-lock.json')!.bytes.toString())
  return [...Map.groupBy(materials, file => packageLocation(file.path))].flatMap(([location, files]) => {
    const source = sourceFor(lock, location)
    const dependency = source && externalDependency(source, location)
    if (!dependency) return []
    const bytes = files.reduce((total, file) => total + Math.ceil(file.bytes.length / 3) * 4, 0)
    return [{ ...dependency, location, bytes }]
  })
}

export async function compactMaterials(materials: Material[], limits: Limits, included: string[] = []) {
  const byPath = new Map(materials.map(file => [file.path, file.bytes]))
  const lock = JSON.parse(byPath.get('package-lock.json')!.toString())
  const groups = Map.groupBy(materials, file => packageLocation(file.path))
  const archives: ArchiveReference[] = []
  const omitted = new Set<string>()
  const selected = new Set(included)
  for (const [location, files] of groups) {
    const source = sourceFor(lock, location)
    const paths = files.map(file => file.path.slice(location.length + 1))
    if (!source) {
      const locked = lock.packages?.[location]
      if (typeof locked?.resolved === 'string' && /^https?:/.test(locked.resolved))
        throw contentError('MATERIAL_INTEGRITY_REQUIRED', `无法核对 ${location} 的归档摘要，请重新准备环境后再试。`)
      continue
    }
    const external = externalDependency(source, location)
    if (external && selected.delete(location)) continue
    if (source.resolved.startsWith('file:')) {
      const bytes = byPath.get(source.resolved.slice(5))
      if (!bytes) throw contentError('ENVIRONMENT_SOURCE_MISSING')
      verifyArchive(bytes, source.integrity)
      const tar = await readArchiveFiles(bytes, limits)
      if (!files.every((file, i) => tar.get(paths[i])?.equals(file.bytes))) continue
    }
    archives.push({
      location,
      paths,
      digest: fileDigest(files),
      ...(external && { external }),
    })
    omitted.add(location)
  }
  if (selected.size) throw contentError('ENVIRONMENT_EXPORT_INVALID')
  return {
    archives,
    materials: materials.filter(file => !omitted.has(packageLocation(file.path))),
  }
}

// A full offline import may already hold the package even after npm's download cache was cleared.
async function installedArchives(environments: string) {
  const index = new Map<string, { directory: string; location: string }[]>()
  for (const entry of await readdir(environments, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(environments, entry.name)
    const lock = await readJson(join(directory, 'package-lock.json'), 16 * 1024 * 1024).catch(() => undefined)
    if (!isRecord(lock?.packages)) continue
    for (const location of Object.keys(lock.packages)) {
      const source = sourceFor(lock, location)
      if (!source) continue
      const matches = index.get(source.integrity) ?? []
      matches.push({ directory, location })
      index.set(source.integrity, matches)
    }
  }
  return index
}

type ImportOptions = Limits & {
  offline: boolean
  cache: string
  environments?: string
  missing?: Set<string>
  supplied?: Record<string, string>
}

async function registryTarball(source: NonNullable<ReturnType<typeof sourceFor>>, name: string, limits: ImportOptions) {
  const manual = !publicTarball.test(source.resolved)
  const options = {
    cache: join(limits.cache, '_cacache'),
    resolved: source.resolved,
    offline: manual || limits.offline,
    preferOffline: true,
    integrity: source.integrity,
    retry: { retries: 0 },
    timeout: 30000,
    signal: limits.signal,
  }
  try {
    const { tarball } = (await import('pacote')).default
    const read = (settings: typeof options) =>
      tarball.stream(
        // A private lock entry can be a hosted Git URL. Keep it on npm's registry/cache path.
        manual ? name : source.resolved,
        async stream => {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of stream) {
            size += chunk.length
            if (size > (limits.maxBytes ?? 256 * 1024 * 1024)) throw contentError('MATERIAL_LIMIT')
            chunks.push(chunk)
          }
          return Buffer.concat(chunks)
        },
        settings,
      )
    // Older Arcadia imports populated the cache root directly, alongside npm's _cacache.
    if (
      await lstat(join(limits.cache, 'content-v2')).then(
        stat => stat.isDirectory(),
        () => false,
      )
    ) {
      try {
        return await read({ ...options, cache: limits.cache, offline: true })
      } catch (error) {
        limits.signal?.throwIfAborted()
        if (errorCode(error) === 'MATERIAL_LIMIT') throw error
      }
    }
    return await read(options)
  } catch (cause) {
    limits.signal?.throwIfAborted()
    if (errorCode(cause) === 'MATERIAL_LIMIT') throw cause
    if (manual)
      throw contentError('PACKAGE_ARCHIVE_REQUIRED', `请补充 ${name}@${source.version} 的归档（${source.integrity}）`)
    throw Object.assign(new Error(`无法取得 ${name} 的锁定归档，请允许下载或补充对应的 .tgz 文件。`, { cause }), {
      code: 'PACKAGE_ARCHIVE_REQUIRED',
    })
  }
}

function matchingFiles(ref: ArchiveReference, available: Map<string, Buffer>) {
  const result: Material[] = []
  for (const path of ref.paths) {
    const bytes = available.get(path)
    const destination = ref.location + '/' + path
    if (!bytes || packageLocation(destination) !== ref.location) return
    result.push({ path: destination, bytes })
  }
  return fileDigest(result) === ref.digest ? result : undefined
}
export async function expandSharedMaterials(
  files: { path: string; data: string }[],
  references: ArchiveReference[],
  limits: ImportOptions,
) {
  if (!Array.isArray(files) || !Array.isArray(references)) throw contentError('ENVIRONMENT_EXPORT_INVALID')
  const maxBytes = limits.maxBytes ?? 256 * 1024 * 1024
  const maxFiles = limits.maxFiles ?? 50000
  let remaining = maxBytes
  const byPath = new Map<string, Buffer>()
  for (const file of files) {
    if (!isRecord(file) || typeof file.data !== 'string' || typeof file.path !== 'string')
      throw contentError('MATERIAL_ENCODING_INVALID')
    remaining -= Buffer.byteLength(file.data, 'base64')
    if (remaining < 0 || files.length > maxFiles) throw contentError('MATERIAL_LIMIT')
    byPath.set(file.path, Buffer.from(file.data, 'base64'))
  }
  const lock = JSON.parse(byPath.get('package-lock.json')?.toString() ?? 'null')
  let suppliedBytes = 0
  const supplied = new Map<string, Buffer>()
  for (const [integrity, data] of Object.entries(limits.supplied ?? {})) {
    if (typeof data !== 'string' || !/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(integrity))
      throw contentError('MATERIAL_ENCODING_INVALID')
    const bytes = Buffer.from(data, 'base64')
    suppliedBytes += bytes.length
    if (suppliedBytes > maxBytes) throw contentError('MATERIAL_LIMIT')
    verifyArchive(bytes, integrity)
    supplied.set(integrity, bytes)
  }
  const expanded: Material[] = []
  const locations = new Set<string>()
  let installed: Awaited<ReturnType<typeof installedArchives>> | undefined
  let fileCount = files.length
  for (const ref of references) {
    limits.signal?.throwIfAborted()
    // Old exports can describe a sender-specific base, including a registry reference.
    if (isRecord(ref) && typeof ref.location === 'string' && isBaseMaterial(ref.location)) continue
    if (
      !isRecord(ref) ||
      ref.bundledBase ||
      typeof ref.location !== 'string' ||
      locations.has(ref.location) ||
      !Array.isArray(ref.paths) ||
      !ref.paths.length ||
      ref.paths.length + fileCount > maxFiles ||
      ref.paths.some(path => typeof path !== 'string')
    )
      throw contentError('ENVIRONMENT_EXPORT_INVALID')
    fileCount += ref.paths.length
    locations.add(ref.location)
    const source = sourceFor(lock, ref.location)
    if (!source) throw contentError('MATERIAL_LOCK_NOT_PORTABLE')
    if (limits.missing) {
      const external = externalDependency(source, ref.location)
      if (
        !external ||
        !ref.external ||
        external.integrity !== ref.external.integrity ||
        external.manual !== ref.external.manual ||
        external.name !== ref.external.name ||
        external.version !== ref.external.version
      )
        throw contentError('ENVIRONMENT_EXPORT_INVALID')
    }
    if (!source.resolved.startsWith('file:') && limits.environments && !supplied.has(source.integrity)) {
      installed ??= await installedArchives(limits.environments)
      let reused = false
      for (const candidate of installed.get(source.integrity) ?? []) {
        const local = await materialFiles(candidate.directory, {
          ...limits,
          subtree: candidate.location,
          maxBytes: remaining,
        }).catch(() => [])
        limits.signal?.throwIfAborted()
        const recorded = new Map(local.map(file => [file.path.slice(candidate.location.length + 1), file.bytes]))
        const matches = matchingFiles(ref, recorded)
        if (matches) {
          remaining -= matches.reduce((sum, file) => sum + file.bytes.length, 0)
          if (remaining < 0) throw contentError('MATERIAL_LIMIT')
          if (!limits.missing) expanded.push(...matches)
          reused = true
          break
        }
      }
      if (reused) continue
    }
    let bytes: Buffer
    if (source.resolved.startsWith('file:')) {
      const local = byPath.get(source.resolved.slice(5))
      if (!local) throw contentError('ENVIRONMENT_SOURCE_MISSING')
      bytes = local
    } else if (supplied.has(source.integrity)) {
      bytes = supplied.get(source.integrity)!
    } else {
      try {
        bytes = await registryTarball(
          source,
          ref.location.slice(ref.location.lastIndexOf('node_modules/') + 13),
          limits,
        )
      } catch (error) {
        limits.signal?.throwIfAborted()
        if (!limits.missing || !limits.offline || errorCode(error) !== 'PACKAGE_ARCHIVE_REQUIRED') throw error
        limits.missing.add(source.integrity)
        continue
      }
    }
    verifyArchive(bytes, source.integrity)
    const archive = await readArchiveFiles(bytes, { ...limits, maxBytes: remaining })
    const restored = matchingFiles(ref, archive)
    if (!restored) throw contentError('SOURCE_INTEGRITY_MISMATCH')
    remaining -= restored.reduce((sum, file) => sum + file.bytes.length, 0)
    if (remaining < 0) throw contentError('MATERIAL_LIMIT')
    if (!limits.missing) expanded.push(...restored)
  }
  return [...files, ...expanded]
}
