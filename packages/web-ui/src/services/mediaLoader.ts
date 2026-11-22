import { sha256Hex } from '@arcadia-eternity/const'
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
export const canPersistMediaUrl = (scope: string, url: string) =>
  !scope.startsWith('session/') &&
  /^https?:\/\//.test(url) &&
  !/^https?:\/\/127\.0\.0\.1:\d+\/local-content\//.test(url)
const cacheName = (scope: string) => 'arcadia-environment-media-v1/' + scope
const memory = new Map<string, Uint8Array>()
let used = 0
// A URL without a declared hash is an alias only inside its environment revision.
const aliases = new Map<string, string>()
function remember(bytes: Uint8Array, digest: string, alias?: string) {
  if (alias) {
    aliases.delete(alias)
    aliases.set(alias, digest)
    if (aliases.size > 8192) aliases.delete(aliases.keys().next().value!)
  }
  if (memory.has(digest)) return
  memory.set(digest, bytes)
  used += bytes.byteLength
  while (used > MEMORY_LIMIT) {
    const oldest = memory.keys().next().value!
    used -= memory.get(oldest)!.byteLength
    memory.delete(oldest)
  }
}
type MediaContent = { bytes: Uint8Array; hash: string }
const pending = new SharedReads<MediaContent, { url: string; maxBytes: number }>()

const digestUrl = (digest: string) => 'https://arcadia-media.invalid/sha256/' + digest
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
type SourceReadOptions = { signal: AbortSignal; maxBytes: number }
async function readVerifiedSource(url: string, options: SourceReadOptions, digest?: string) {
  const bytes = await readResourceBytes(url, options)
  if (!validBytes(bytes, options.maxBytes, digest)) throw new Error('资源内容与清单不一致')
  return bytes
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
      let cached = await caches.match(address, digest ? {} : { cacheName: cacheName(scope) })
      const storedHash = cached?.headers.get('x-arcadia-sha256')
      if (!digest && storedHash) {
        if (!/^[a-f0-9]{64}$/.test(storedHash)) return
        expected = storedHash
        cached = await caches.match(digestUrl(storedHash))
      }
      if (cached) bytes = await readResourceBytes(url, options, async () => cached)
    }
    if (bytes && validBytes(bytes, maxBytes, expected)) {
      if (kind) inspectOwnedMedia(kind, bytes)
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
    await cache.put(digestUrl(hash), new Response(bytes as Uint8Array<ArrayBuffer>))
    if (!pinned) await cache.put(url, new Response(null, { headers: { 'x-arcadia-sha256': hash } }))
  }
}

// A battle request can claim an item still waiting in its environment's background sweep.
type MediaReadOptions = { environment?: MediaEnvironment; signal?: AbortSignal; maxBytes?: number; kind?: MediaKind }

export async function readMediaBytes(url: string, options?: MediaReadOptions) {
  return (await acquireMediaBytes(url, options)).bytes.slice()
}

async function acquireMediaBytes(
  url: string,
  { environment = mediaEnvironment(), signal, kind, maxBytes = RESOURCE_MAX_BYTES }: MediaReadOptions = {},
  foreground = true,
): Promise<MediaContent> {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > RESOURCE_MAX_BYTES)
    throw new Error('资源大小限制无效')
  if (kind) maxBytes = Math.min(maxBytes, mediaLimits[kind])
  const { scope } = environment
  const digest = environment.hashes.get(url) ?? baseHashes.value.get(url)
  const alias = JSON.stringify([scope, url])
  const blob = url.startsWith('blob:')
  const localSession = /^http:\/\/127\.0\.0\.1:\d+\/local-content\//.test(url)
  const ephemeral = blob || localSession
  const available = () =>
    blob
      ? hasOwnedResource(url)
      : !localSession || (!!digest && [...localMediaFiles(digest)].some(file => file.url === url))
  const live = available()
  const assertLive = () => {
    if ((blob || (localSession && live)) && !available()) throw new Error('本地资源已释放')
  }
  assertLive()
  if (foreground) environment.promote?.(url)
  const knownHash = digest ?? aliases.get(alias)
  const hit = live && knownHash && memory.get(knownHash)
  if (hit && knownHash) {
    if (hit.byteLength > maxBytes) throw new ResourceSizeError()
    try {
      if (kind) inspectOwnedMedia(kind, hit)
      memory.delete(knownHash)
      memory.set(knownHash, hit)
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
    if (!ephemeral) {
      if (canPersistMediaUrl(scope, url) || digest) bytes = await readStoredMedia(scope, url, digest, options, kind)
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
    bytes ??= await readVerifiedSource(url, options, digest)
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
    if ((retryLimit || retryMirror) && !signal?.aborted && (!live || available()))
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
  const desktop = desktopCache()
  if (desktop?.clearMediaCache) await desktop.clearMediaCache(scope)
  else await caches.delete(cacheName(scope))
  for (const key of aliases.keys()) if (JSON.parse(key)[0] === scope) aliases.delete(key)
}

export async function warmMedia(
  url: string,
  options: MediaReadOptions & {
    environment: MediaEnvironment
    signal: AbortSignal
    background?: boolean
    save?: boolean
  },
) {
  const content = await acquireMediaBytes(url, options, !options.background)
  if (options.save) {
    const { signal, environment } = options
    signal.throwIfAborted()
    await writeStoredMedia(environment.scope, url, environment.hashes.has(url), content)
  }
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
      ? acquireMediaBytes(source, { kind, signal }).then(result => result.bytes)
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
