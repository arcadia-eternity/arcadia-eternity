import { sha256Hex } from '@arcadia-eternity/const'
import { LRUCache } from 'lru-cache'
import { computed, shallowRef } from 'vue'
import { getServerContentText } from '@/i18n/serverContent'
import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { hasOwnedResource, readResourceBytes, ResourceSizeError, RESOURCE_MAX_BYTES } from './resourceTransport'
import { SharedReads } from './sharedRead'
import { inspectMedia, mediaLimits, type MediaKind } from '../../shared/media-formats.mjs'
import { readSwfContainer } from './swf/assets'

import {
  localMediaFiles,
  registeredMediaEnvironment,
  registerMediaEnvironment,
  type MediaCatalog,
  type MediaEnvironment,
  type MediaResource,
} from './mediaRegistry'

const MEMORY_LIMIT = 96 * 1024 * 1024
export type { MediaCatalog, MediaEnvironment, MediaResource } from './mediaRegistry'
export { registerMediaEnvironment } from './mediaRegistry'
// The package declares the roles and their defaults. Old catalogs can still resolve the same resource IDs.
const baseUi = __BASE_BATTLE_UI__
const baseRoles = new Map<string, string[]>()
for (const [role, { id }] of Object.entries(baseUi)) {
  baseRoles.set(id, [...(baseRoles.get(id) ?? []), role])
}
const baseHashes = computed(() => new Map(Object.values(baseUi).map(row => [officialAssetUrl(row.source), row.sha256])))
function indexBattleUi(resources: MediaResource[]) {
  const battleUi = new Map<string, string>()
  const overrides = new Map<string, string>()
  for (const row of resources) {
    const defaults = baseRoles.get(row.id.replace(/^base:/, '')) ?? []
    const url = officialAssetUrl(row.source)
    for (const tag of defaults) battleUi.set(tag, url)
    for (const tag of row.tags ?? [])
      if (tag.startsWith('battle-ui:') && !defaults.includes(tag)) overrides.set(tag, url)
  }
  return new Map([...battleUi, ...overrides])
}
export function battleUiUrl(role: string, allowDefault = true) {
  const tag = 'battle-ui:' + role
  const environment = mediaEnvironment()
  environment.battleUi ??= indexBattleUi(environment.resources)
  const active = environment.battleUi.get(tag)
  const fallback = allowDefault && baseUi[tag]
  return active ?? (fallback ? officialAssetUrl(fallback.source) : '')
}
const fallback = shallowRef<MediaEnvironment>({ scope: 'client', resources: [], hashes: new Map() })
const packCatalog = shallowRef<MediaCatalog | null>(null)
let releaseFallback: (() => void) | undefined

export function localMediaScope(
  location: (string | undefined)[],
  packages: { name: string; version: string }[] | undefined,
  resources: MediaResource[] = [],
) {
  const inventory = resources.map(row => [row.id, row.sha256 ?? row.source, row.tags])
  return JSON.stringify([...location, sha256Hex(JSON.stringify([packages, inventory]))])
}

export function setPackMedia(scope: string, resources: MediaResource[], catalog: MediaCatalog) {
  const release = registerMediaEnvironment(catalog, scope, resources, true)
  releaseFallback?.()
  releaseFallback = release
  fallback.value = registeredMediaEnvironment(catalog)
  packCatalog.value = catalog
}

export const activeMediaCatalog = () => getServerContentText() ?? packCatalog.value

export function mediaEnvironment(content: MediaCatalog | null = getServerContentText()): MediaEnvironment {
  return content ? registeredMediaEnvironment(content) : fallback.value
}

const desktopCache = () => globalThis.window?.arcadiaDesktop ?? globalThis.window?.arcadiaRemotePlay
function canWriteMediaCache() {
  try {
    return !!(desktopCache()?.writeMediaCache || globalThis.caches)
  } catch {
    return false
  }
}
const localContentUrl = /^https?:\/\/127\.0\.0\.1:\d+\/local-content\//
const mediaDigest = (environment: MediaEnvironment, url: string) =>
  environment.hashes.get(url) ?? baseHashes.value.get(url)
export const canPersistMedia = (environment: MediaEnvironment, url: string, digest = mediaDigest(environment, url)) =>
  !!digest || (!environment.scope.startsWith('session/') && /^https?:\/\//.test(url) && !localContentUrl.test(url))
const cacheName = (scope: string) => 'arcadia-environment-media-v1/' + scope
const memory = new LRUCache<string, Uint8Array>({ maxSize: MEMORY_LIMIT, sizeCalculation: bytes => bytes.byteLength })
// A URL without a declared hash is an alias only inside its environment revision.
const aliases = new LRUCache<string, string>({ max: 8192 })
function remember(bytes: Uint8Array, digest: string, alias?: string) {
  if (alias) aliases.set(alias, digest)
  if (!memory.has(digest)) memory.set(digest, bytes)
}
type MediaContent = { bytes: Uint8Array; hash: string }
const pending = new SharedReads<MediaContent, { url: string; maxBytes: number }>()

const digestPrefix = 'https://arcadia-media.invalid/sha256/'
const digestUrl = (digest: string) => digestPrefix + digest
// Receipts follow the lifetime of the verified bytes, without keeping evicted media alive.
let storedKeys = new WeakMap<Uint8Array, Set<string>>()
const writes = new Map<string, { scope: string; done: Promise<void> }>()
const clearing = new Map<string, Promise<void>>()
function noteStored(bytes: Uint8Array, ...keys: string[]) {
  const known = storedKeys.get(bytes) ?? new Set<string>()
  for (const key of keys) known.add(key)
  storedKeys.set(bytes, known)
}
function validBytes(bytes: Uint8Array | null, limit: number, digest?: string): bytes is Uint8Array {
  return !!bytes?.byteLength && bytes.byteLength <= limit && (!digest || sha256Hex(bytes) === digest)
}

const inspected = new WeakMap<Uint8Array, { kind: MediaKind; mime: string }>()
function inspectOwnedMedia(kind: MediaKind, bytes: Uint8Array) {
  const cached = inspected.get(bytes)
  if (cached?.kind === kind) return cached.mime
  const mime = inspectMedia(kind, bytes)
  inspected.set(bytes, { kind, mime })
  return mime
}
type SourceReadOptions = { signal: AbortSignal; maxBytes: number; cache?: RequestCache }
async function readVerifiedSource(url: string, options: SourceReadOptions, digest?: string) {
  const bytes = await readResourceBytes(url, options)
  if (validBytes(bytes, options.maxBytes, digest)) return bytes
  // A pinned URL can have a still-fresh HTTP response from an older manifest.
  if (digest && options.cache === 'default') {
    options.signal.throwIfAborted()
    return readVerifiedSource(url, { ...options, cache: 'reload' }, digest)
  }
  throw new Error('资源内容与清单不一致')
}

async function matchBrowserMedia(scope: string, url: string, digest?: string, ownScope = false) {
  const scoped = { cacheName: cacheName(scope) }
  if (digest) return { response: await caches.match(digestUrl(digest), ownScope ? scoped : {}), digest }
  const response = await caches.match(url, scoped)
  const hash = response?.headers.get('x-arcadia-sha256')
  if (!hash) return { response }
  if (!/^[a-f0-9]{64}$/.test(hash)) return {}
  return { response: await caches.match(digestUrl(hash), ownScope ? scoped : {}), digest: hash }
}

async function readStoredMedia(
  scope: string,
  url: string,
  digest: string | undefined,
  options: SourceReadOptions,
  kind?: MediaKind,
) {
  const { maxBytes } = options
  try {
    const desktop = desktopCache()
    const address = digest ? digestUrl(digest) : url
    let bytes: Uint8Array | null | undefined
    let expected = digest
    if (desktop?.readMediaCache) {
      bytes = await desktop.readMediaCache(scope, address, maxBytes, url)
    } else if (globalThis.caches) {
      const cached = await matchBrowserMedia(scope, url, digest)
      expected = cached.digest
      const response = cached.response
      if (response) bytes = await readResourceBytes(url, options, async () => response)
    }
    if (bytes && validBytes(bytes, maxBytes, expected)) {
      if (kind) inspectOwnedMedia(kind, bytes)
      // Digest lookups can hit another environment or an installed desktop package.
      if (digest) noteStored(bytes, address)
      else noteStored(bytes, JSON.stringify([scope, url]))
      return bytes
    }
  } catch {
    /* A cache miss or unavailable storage falls through to the declared source. */
  }
}

async function writeStoredMedia(scope: string, url: string, pinned: boolean, { bytes, hash }: MediaContent) {
  const desktop = desktopCache()
  const address = pinned ? digestUrl(hash) : url
  if (desktop?.writeMediaCache) await desktop.writeMediaCache(scope, address, bytes)
  else {
    const cache = await caches.open(cacheName(scope))
    await cache.put(
      digestUrl(hash),
      new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Length': String(bytes.byteLength) } }),
    )
    if (!pinned) await cache.put(url, new Response(null, { headers: { 'x-arcadia-sha256': hash } }))
  }
}

// A battle request can claim an item still waiting in its environment's background sweep.
type MediaReadOptions = {
  environment?: MediaEnvironment
  signal?: AbortSignal
  maxBytes?: number
  kind?: MediaKind
  background?: boolean
  requireSave?: boolean
}

function mediaLimit(maxBytes = RESOURCE_MAX_BYTES, kind?: MediaKind) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > RESOURCE_MAX_BYTES)
    throw new Error('资源大小限制无效')
  return kind ? Math.min(maxBytes, mediaLimits[kind]) : maxBytes
}

function mediaLease(url: string, digest?: string) {
  if (url.startsWith('blob:')) return () => hasOwnedResource(url)
  if (localContentUrl.test(url)) return () => !!digest && [...localMediaFiles(digest)].some(file => file.url === url)
}

export async function ensureMediaCached(url: string, options: MediaReadOptions, warm = false) {
  const environment = options.environment ?? mediaEnvironment()
  const { scope } = environment
  const digest = mediaDigest(environment, url)
  const lease = mediaLease(url, digest)
  const live = lease?.() ?? true
  const limit = mediaLimit(options.maxBytes, options.kind)
  options.signal?.throwIfAborted()
  let present: boolean | undefined
  if (options.requireSave && clearing.has(scope)) await clearing.get(scope)
  if (canPersistMedia(environment, url, digest) && live) {
    try {
      const desktop = desktopCache()
      if (desktop?.readMediaCache) {
        present = await desktop.hasMediaCache?.(scope, digest ? digestUrl(digest) : url, limit, !!options.requireSave)
      } else if (globalThis.caches) {
        const { response } = await matchBrowserMedia(scope, url, digest, options.requireSave)
        const size = Number(response?.headers.get('Content-Length'))
        // Entries written before we recorded size metadata are verified through the normal reader.
        present = !!response?.ok && size > 0 && size <= limit
      }
    } catch {
      // Unavailable storage still permits a best-effort warmup.
    }
  }
  options.signal?.throwIfAborted()
  if (lease && live && !lease()) throw new Error('本地资源已释放')
  if (present && !warm && !clearing.has(scope)) return 'cached' as const
  await warmMedia(url, { ...options, environment }, present === false)
}

export async function readMediaBytes(url: string, options?: MediaReadOptions) {
  return (await warmMedia(url, options)).bytes.slice()
}

export async function warmMedia(url: string, options: MediaReadOptions = {}, missingFromStore = false) {
  const environment = options.environment ?? mediaEnvironment()
  const content = await acquireMediaBytes(url, { ...options, environment }, !options.background)
  const { scope } = environment
  const declaredHash = mediaDigest(environment, url)
  if (!canPersistMedia(environment, url, declaredHash)) return content
  const pinned = !!declaredHash
  const digest = digestUrl(content.hash)
  const key = JSON.stringify([scope, pinned ? digest : url])
  const reset = clearing.get(scope)
  if (reset) {
    if (!options.requireSave) return content
    await reset
  }
  options.signal?.throwIfAborted()
  const known = storedKeys.get(content.bytes)
  if (!options.requireSave && !missingFromStore && (known?.has(key) || (pinned && known?.has(digest)))) return content
  try {
    if (!canWriteMediaCache()) {
      if (options.requireSave) throw new Error('当前无法保存资源到本地')
      return content
    }
    let write = writes.get(key)
    if (!write) {
      const done = writeStoredMedia(scope, url, pinned, content)
        .then(() => noteStored(content.bytes, key, digest))
        .finally(() => writes.delete(key))
      write = { scope, done }
      writes.set(key, write)
    }
    await write.done
  } catch (error) {
    // Automatic caching is best effort. An explicit save reports storage errors to the user.
    if (options.requireSave) throw error
  }
  options.signal?.throwIfAborted()
  return content
}

async function acquireMediaBytes(
  url: string,
  { environment = mediaEnvironment(), signal, kind, maxBytes = RESOURCE_MAX_BYTES }: MediaReadOptions = {},
  foreground = true,
): Promise<MediaContent> {
  signal?.throwIfAborted()
  maxBytes = mediaLimit(maxBytes, kind)
  const { scope } = environment
  const digest = mediaDigest(environment, url)
  const alias = JSON.stringify([scope, url])
  const lease = mediaLease(url, digest)
  const live = lease?.() ?? true
  const assertLive = () => {
    if (lease && (live || url.startsWith('blob:')) && !lease()) throw new Error('本地资源已释放')
  }
  assertLive()
  if (foreground) environment.promote?.(url)
  const knownHash = digest ?? aliases.get(alias)
  const hit = live && knownHash && memory.get(knownHash)
  if (hit && knownHash) {
    if (hit.byteLength > maxBytes) throw new ResourceSizeError()
    try {
      if (kind) inspectOwnedMedia(kind, hit)
      return { bytes: hit, hash: knownHash }
    } catch (error) {
      if (digest) throw error
      aliases.delete(alias) // An unpinned URL may now serve a corrected file.
    }
  }
  // Unregistered loopback tokens must still be read through the owning server.
  const key = live ? (digest ?? alias) : JSON.stringify(['local', url, digest])
  const flight = pending.get(key, { url, maxBytes }, async readSignal => {
    const options = { signal: readSignal, maxBytes }
    assertLive()
    let bytes: Uint8Array | undefined
    if (!lease) {
      if (canPersistMedia(environment, url, digest)) bytes = await readStoredMedia(scope, url, digest, options, kind)
      if (digest && !bytes) {
        const mirrors = new Set(Array.from(localMediaFiles(digest), entry => entry.url))
        for (const local of mirrors) {
          if (local === url) continue
          readSignal.throwIfAborted()
          try {
            bytes = await readVerifiedSource(local, options, digest)
            break
          } catch {
            // A local capture can expire while another environment is preparing.
          }
        }
      }
    }
    readSignal.throwIfAborted()
    const cache = lease ? 'no-store' : 'default'
    bytes ??= await readVerifiedSource(url, { ...options, cache }, digest)
    readSignal.throwIfAborted()
    assertLive()
    return { bytes, hash: digest ?? sha256Hex(bytes) }
  })
  let result
  try {
    result = await flight.join(signal)
  } catch (error) {
    // A larger consumer can retry a capped stream. A second mirror can recover a broken first source.
    const retryLimit = error instanceof ResourceSizeError && maxBytes > flight.source.maxBytes
    const retryMirror = digest && flight.source.url !== url
    if ((retryLimit || retryMirror) && !signal?.aborted && (!live || !lease || lease()))
      return acquireMediaBytes(url, { environment, signal, maxBytes, kind }, foreground)
    throw error
  }
  signal?.throwIfAborted()
  assertLive()
  const { bytes, hash } = result
  if (bytes.byteLength > maxBytes) throw new ResourceSizeError()
  if (kind) inspectOwnedMedia(kind, bytes)
  remember(bytes, hash, digest || !live ? undefined : alias)
  return result
}

export async function clearMediaCache(scope: string) {
  const current = clearing.get(scope)
  if (current) return current
  const done = (async () => {
    await Promise.allSettled([...writes.values()].filter(write => write.scope === scope).map(write => write.done))
    const desktop = desktopCache()
    if (desktop?.clearMediaCache) await desktop.clearMediaCache(scope)
    else await globalThis.caches?.delete(cacheName(scope))
    storedKeys = new WeakMap()
    for (const key of aliases.keys()) if (JSON.parse(key)[0] === scope) aliases.delete(key)
  })().finally(() => clearing.delete(scope))
  clearing.set(scope, done)
  return done
}

export async function mediaCacheUsage(scope: string): Promise<{ files: number; bytes: number }> {
  const desktop = desktopCache()
  if (desktop?.mediaCacheUsage) return desktop.mediaCacheUsage(scope)
  if (desktop?.readMediaCache || !globalThis.caches) throw new Error('当前无法查询资源缓存')
  const name = cacheName(scope)
  const usage = { files: 0, bytes: 0 }
  if (!(await caches.has(name))) return usage
  const cache = await caches.open(name)
  for (const request of await cache.keys()) {
    if (!request.url.startsWith(digestPrefix)) continue
    const response = await cache.match(request)
    if (!response) continue
    const length = response.headers.get('Content-Length')
    usage.bytes += length === null ? (await response.blob()).size : Number(length)
    usage.files++
  }
  return usage
}

// Editor reads may share an in-flight request, but a completed read must never hide subsequent edits.
export type DraftMediaSource = {
  scope: string
  url: string
  revision?: number
  sha256?: string
  read?: () => Promise<Uint8Array>
}
export function mediaSourceKey(source: string | DraftMediaSource) {
  return typeof source === 'string'
    ? source
    : JSON.stringify([source.scope, source.url, source.revision, source.sha256])
}
const draftReads = new SharedReads<Uint8Array>()
function acquireDraftBytes(source: DraftMediaSource, kind: MediaKind, signal: AbortSignal) {
  const { url, sha256, read } = source
  const key = kind + '/' + mediaSourceKey(source)
  return draftReads
    .get(key, url, async readSignal => {
      const maxBytes = mediaLimits[kind]
      if (!read) return readVerifiedSource(url, { signal: readSignal, maxBytes }, sha256)
      const result = await read()
      readSignal.throwIfAborted()
      if (result.length > maxBytes) throw new ResourceSizeError()
      const bytes = new Uint8Array(result)
      if (!validBytes(bytes, maxBytes, sha256)) throw new Error('资源内容与清单不一致')
      return bytes
    })
    .join(signal)
}

type MediaSource = string | DraftMediaSource
export function loadMedia(
  kind: 'swf',
  source: MediaSource,
  signal: AbortSignal,
): Promise<{ movie: ArrayBuffer; container: ArrayBuffer }>
export function loadMedia(kind: 'image' | 'audio', source: MediaSource, signal: AbortSignal): Promise<Blob>
export async function loadMedia(kind: MediaKind, source: MediaSource, signal: AbortSignal) {
  signal.throwIfAborted()
  const data =
    typeof source === 'string'
      ? warmMedia(source, { kind, signal }).then(result => result.bytes)
      : acquireDraftBytes(source, kind, signal)
  if (kind === 'swf') {
    const [bytes, container] = await Promise.all([data, readSwfContainer(signal)])
    signal.throwIfAborted()
    inspectOwnedMedia(kind, bytes)
    return { container, movie: bytes.slice().buffer }
  }
  const bytes = await data
  signal.throwIfAborted()
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: inspectOwnedMedia(kind, bytes) })
}
