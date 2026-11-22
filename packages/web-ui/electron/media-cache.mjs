import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { mediaLimits } from '../shared/media-formats.mjs'

const maxBytes = mediaLimits.image
const hash = value => createHash('sha256').update(value).digest('hex')
const digestAddress = /^https:\/\/arcadia-media\.invalid\/sha256\/([a-f0-9]{64})$/
const legacyMovie = /^https:\/\/seer2-pet-resource\.yuuinih\.com\/public\/fight\/([1-9]\d*)\.swf$/

export function desktopMediaCache(userData, installedMedia = async () => null) {
  function directory(scope) {
    if (typeof scope !== 'string' || !scope || scope.length > 8192) throw new Error('环境缓存标识无效')
    return path.join(userData, 'media', hash(scope))
  }
  function file(scope, url) {
    if (typeof url !== 'string' || url.length > 8192 || !/^https?:\/\//.test(url)) throw new Error('缓存资源地址无效')
    return path.join(directory(scope), hash(url))
  }
  async function readFile(target, limit) {
    try {
      const stat = await fs.stat(target)
      if (!stat.isFile() || stat.size < 1 || stat.size > limit) return null
      return await fs.readFile(target)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }
  async function write(scope, url, bytes) {
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
  let legacyIndex
  async function indexLegacyMovies() {
    const movies = new Map()
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
    async read(scope, url, limit, originalUrl = url) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxBytes) throw new Error('缓存资源大小无效')
      const cached = await readFile(file(scope, url), limit)
      const digest = digestAddress.exec(url)?.[1]
      if (cached && (!digest || hash(cached) === digest)) return cached
      if (digest) {
        const root = path.dirname(directory(scope))
        const dirs = await fs.readdir(root, { withFileTypes: true }).catch(error => {
          if (error.code === 'ENOENT') return []
          throw error
        })
        for (const entry of dirs)
          if (entry.isDirectory()) {
            const bytes = await readFile(path.join(root, entry.name, hash(url)), limit)
            if (bytes && hash(bytes) === digest) return bytes
          }
        const installed = await installedMedia(digest, limit)
        if (installed && installed.length <= limit && hash(installed) === digest) return installed
      }
      const legacy = (digest || originalUrl === url) && legacyMovie.exec(originalUrl)
      const migrate = async source => {
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
    write,
    clear: scope => fs.rm(directory(scope), { recursive: true, force: true }),
  }
}
