import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { errorCode, isRecord } from './types.ts'

export function contentError(code: string, message: string = code) {
  return Object.assign(new Error(message), { code })
}
const materialRoots = new Set(['package.json', 'package-lock.json', 'node_modules', 'candidates'])
const forbidden = new Set(['.git', '.env', '.npmrc', '.arcadia', '.bin'])
function checkedMaterialPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || isAbsolute(value))
    throw contentError('MATERIAL_PATH_INVALID')
  const parts = value.split('/')
  if (
    parts.some(
      part =>
        !part ||
        part === '.' ||
        part === '..' ||
        forbidden.has(part) ||
        /[<>:"|?*]/.test(part) ||
        [...part].some(character => (character.codePointAt(0) ?? 0) < 32) ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    ) ||
    !materialRoots.has(parts[0])
  )
    throw contentError('MATERIAL_PATH_INVALID')
  return value
}

/** Capture data bytes only. Symlink targets must remain inside the installed project. */
export async function materialFiles(
  root: string,
  {
    signal,
    maxBytes = 256 * 1024 * 1024,
    maxFiles = 50000,
    onRead,
  }: {
    signal?: AbortSignal
    maxBytes?: number
    maxFiles?: number
    onRead?: (path: string, stats: Stats) => void
  } = {},
): Promise<Array<{ path: string; bytes: Buffer }>> {
  root = await realpath(root)
  const result: Array<{ path: string; bytes: Buffer }> = []
  const captured: Array<{ path: string; actual: string; size: number; mtimeMs: number; ino: number }> = []
  let total = 0
  async function walk(path: string, name: string, ancestors = new Set<string>()): Promise<void> {
    signal?.throwIfAborted()
    const actual = await realpath(path)
    const rel = relative(root, actual)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw contentError('MATERIAL_PATH_ESCAPE')
    checkedMaterialPath(rel.split('\\').join('/'))
    const info = await lstat(actual)
    captured.push({ path, actual, size: info.size, mtimeMs: info.mtimeMs, ino: info.ino })
    if (info.isDirectory()) {
      if (ancestors.has(actual)) throw contentError('MATERIAL_PATH_CYCLE')
      const next = new Set(ancestors).add(actual)
      for (const child of (await readdir(actual)).sort()) {
        if (forbidden.has(child)) continue
        await walk(join(actual, child), name ? `${name}/${child}` : child, next)
      }
      const after = await lstat(actual)
      if (info.ino !== after.ino || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs)
        throw contentError('MATERIAL_SOURCE_CHANGED')
      onRead?.(actual, after)
      return
    }
    if (!info.isFile()) throw contentError('MATERIAL_FILE_INVALID')
    checkedMaterialPath(name)
    total += info.size
    if (total > maxBytes || result.length >= maxFiles) throw contentError('MATERIAL_LIMIT')
    const bytes = await readFile(actual)
    const after = await lstat(actual)
    if (
      info.size !== bytes.length ||
      info.mtimeMs !== after.mtimeMs ||
      info.ctimeMs !== after.ctimeMs ||
      info.ino !== after.ino
    )
      throw contentError('MATERIAL_SOURCE_CHANGED')
    onRead?.(actual, after)
    result.push({ path: name, bytes })
  }
  for (const name of materialRoots) {
    try {
      await lstat(join(root, name))
    } catch (error) {
      if (errorCode(error) === 'ENOENT' && name !== 'package.json' && name !== 'package-lock.json') continue
      throw error
    }
    try {
      await walk(join(root, name), name)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw contentError('MATERIAL_SOURCE_CHANGED')
      throw error
    }
  }
  // Verify the whole captured tree after the last read. This detects membership
  // changes and retargeted links without a separate content-hash protocol.
  for (const entry of captured) {
    signal?.throwIfAborted()
    try {
      if ((await realpath(entry.path)) !== entry.actual) throw contentError('MATERIAL_SOURCE_CHANGED')
      const info = await lstat(entry.actual)
      if (entry.size !== info.size || entry.mtimeMs !== info.mtimeMs || entry.ino !== info.ino)
        throw contentError('MATERIAL_SOURCE_CHANGED')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') throw contentError('MATERIAL_SOURCE_CHANGED')
      throw error
    }
  }
  return result
}

export async function writeMaterials(
  root: string,
  files: unknown,
  {
    signal,
    maxBytes = 256 * 1024 * 1024,
    maxFiles = 50000,
  }: { signal?: AbortSignal; maxBytes?: number; maxFiles?: number } = {},
): Promise<void> {
  if (!Array.isArray(files) || files.length > maxFiles) throw contentError('MATERIAL_LIMIT')
  const seen = new Set()
  let total = 0
  for (const file of files) {
    if (!isRecord(file)) throw contentError('MATERIAL_PATH_INVALID')
    signal?.throwIfAborted()
    const path = checkedMaterialPath(file.path)
    // Case aliases are rejected even on case-sensitive machines for portable archives.
    const alias = path.toLowerCase()
    if (seen.has(alias)) throw contentError('MATERIAL_PATH_DUPLICATE')
    seen.add(alias)
    const data = typeof file.data === 'string' ? file.data : undefined
    if (!Buffer.isBuffer(file.bytes) && data === undefined) throw contentError('MATERIAL_ENCODING_INVALID')
    if (
      !Buffer.isBuffer(file.bytes) &&
      data !== undefined &&
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
    )
      throw contentError('MATERIAL_ENCODING_INVALID')
    const bytes = Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(data!, 'base64')
    total += bytes.length
    if (total > maxBytes) throw contentError('MATERIAL_LIMIT')
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), bytes, { flag: 'wx', mode: 0o600 })
  }
  if (!seen.has('package.json') || !seen.has('package-lock.json')) throw contentError('MATERIAL_LOCK_REQUIRED')
  // npm may omit this directory for a valid empty dependency graph. Static npm
  // inspection still expects it, including after a file-only archive round trip.
  await mkdir(join(root, 'node_modules'), { recursive: true })
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages || typeof lock.packages !== 'object')
    throw contentError('MATERIAL_LOCK_INVALID')
  for (const pkgValue of Object.values(lock.packages)) {
    if (!isRecord(pkgValue)) throw contentError('MATERIAL_LOCK_INVALID')
    const pkg = pkgValue
    if (pkg.link === true) throw contentError('MATERIAL_LOCK_NOT_PORTABLE')
    if (typeof pkg.resolved === 'string' && /^https?:/.test(pkg.resolved)) {
      const url = new URL(pkg.resolved)
      if (
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some(key => /token|secret|password|credential|authorization/i.test(key))
      )
        throw contentError('MATERIAL_LOCK_CREDENTIALS')
    }
    if (typeof pkg.resolved === 'string' && pkg.resolved.startsWith('file:')) {
      const path = pkg.resolved.slice(5)
      if (!path.startsWith('candidates/')) throw contentError('MATERIAL_LOCK_NOT_PORTABLE')
      checkedMaterialPath(path)
    }
  }
}
