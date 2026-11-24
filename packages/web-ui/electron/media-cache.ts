import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { mediaLimits } from '../shared/media-formats.mjs'

const maxBytes = mediaLimits.image
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const digestAddress = /^https:\/\/arcadia-media\.invalid\/sha256\/([a-f0-9]{64})$/
const legacyMovie = /^https:\/\/seer2-pet-resource\.yuuinih\.com\/public\/fight\/([1-9]\d*)\.swf$/

export function desktopMediaCache(
  userData: string,
  installedMedia: (digest: string, limit: number) => Promise<Uint8Array | null> = async () => null,
  hasInstalledMedia: (digest: string, limit: number) => Promise<boolean> = async () => false,
) {
  function directory(scope: unknown) {
    if (typeof scope !== 'string' || !scope || scope.length > 8192) throw new Error('环境缓存标识无效')
    return path.join(userData, 'media', hash(scope))
  }
  function file(scope: unknown, url: unknown) {
    if (typeof url !== 'string' || url.length > 8192 || !/^https?:\/\//.test(url)) throw new Error('缓存资源地址无效')
    return path.join(directory(scope), hash(url))
  }
  function validateLimit(limit: unknown): asserts limit is number {
    if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > maxBytes)
      throw new Error('缓存资源大小无效')
  }
  async function fits(target: string, limit: number) {
    try {
      const stat = await fs.stat(target)
      return stat.isFile() && stat.size > 0 && stat.size <= limit
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  async function readFile(target: string, limit: number) {
    if (!(await fits(target, limit))) return null
    return fs.readFile(target).catch(error => {
      if (error.code === 'ENOENT') return null
      throw error
    })
  }
  async function* candidates(scope: unknown, url: string, shared: boolean) {
    const target = file(scope, url)
    yield target
    if (!shared) return
    const dir = path.dirname(target)
    const root = path.dirname(dir)
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== path.basename(dir))
        yield path.join(root, entry.name, path.basename(target))
    }
  }
  async function write(scope: unknown, url: string, bytes: unknown) {
    if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > maxBytes) throw new Error('缓存资源大小无效')
    const digest = digestAddress.exec(url)?.[1]
    if (digest && hash(bytes) !== digest) throw new Error('缓存资源哈希不匹配')
    const target = file(scope, url)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const temporary = target + '.' + randomUUID()
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' })
      if (!digest) {
        const contentFile = file(scope, 'https://arcadia-media.invalid/sha256/' + hash(bytes))
        const link = temporary + '.link'
        try {
          await fs.link(temporary, link)
          await fs.rename(link, contentFile)
        } finally {
          await fs.rm(link, { force: true })
        }
      }
      await fs.rename(temporary, target)
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }
  const legacyDirectory = path.join(userData, 'pets')
  // Older desktop versions stored only a numeric filename. Index these bytes once for new package or CDN URLs.
  let legacyIndex: Promise<Map<string, string>> | undefined
  async function indexLegacyMovies() {
    const movies = new Map<string, string>()
    const entries = await fs.readdir(legacyDirectory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      if (!entry.isFile() || !/^[1-9]\d*\.swf$/.test(entry.name)) continue
      const filename = path.join(legacyDirectory, entry.name)
      const bytes = await readFile(filename, mediaLimits.swf)
      if (bytes) movies.set(hash(bytes), filename)
    }
    return movies
  }
  return {
    async has(scope: unknown, url: string, limit: unknown, ownScope = false) {
      validateLimit(limit)
      const digest = digestAddress.exec(url)?.[1]
      const shared = !!digest && !ownScope
      for await (const target of candidates(scope, url, shared)) if (await fits(target, limit)) return true
      return shared && (await hasInstalledMedia(digest, limit))
    },
    async read(scope: unknown, url: string, limit: unknown, originalUrl = url) {
      validateLimit(limit)
      const digest = digestAddress.exec(url)?.[1]
      for await (const target of candidates(scope, url, !!digest)) {
        const bytes = await readFile(target, limit)
        if (bytes && (!digest || hash(bytes) === digest)) return bytes
      }
      if (digest) {
        const installed = await installedMedia(digest, limit)
        if (installed && installed.length <= limit && hash(installed) === digest) return installed
      }
      const legacy = (digest || originalUrl === url) && legacyMovie.exec(originalUrl)
      const migrate = async (source: string) => {
        const bytes = await readFile(source, limit)
        if (!bytes || (digest && hash(bytes) !== digest)) return null
        await write(scope, url, bytes)
        await fs.rm(source, { force: true })
        return bytes
      }
      if (legacy) {
        const bytes = await migrate(path.join(legacyDirectory, legacy[1] + '.swf'))
        if (bytes) return bytes
      }
      if (digest) {
        legacyIndex ??= indexLegacyMovies().catch(error => {
          legacyIndex = undefined
          throw error
        })
        const candidate = (await legacyIndex).get(digest)
        if (candidate) return migrate(candidate)
      }
      return null
    },
    async usage(scope: unknown) {
      const dir = directory(scope)
      const entries = await fs.readdir(dir).catch(error => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      const seen = new Set<string>()
      let bytes = 0
      for (const name of entries) {
        if (!/^[a-f0-9]{64}$/.test(name)) continue
        const stat = await fs.stat(path.join(dir, name), { bigint: true }).catch(error => {
          if (error.code !== 'ENOENT') throw error
        })
        if (!stat?.isFile()) continue
        // A mutable URL and its digest can be hard links to the same payload.
        const id = stat.ino ? stat.dev + '/' + stat.ino : name
        if (seen.has(id)) continue
        seen.add(id)
        bytes += Number(stat.size)
      }
      return { files: seen.size, bytes }
    },
    write,
    clear: (scope: unknown) => fs.rm(directory(scope), { recursive: true, force: true }),
  }
}
