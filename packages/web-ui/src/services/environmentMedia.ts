import { sha256Hex } from '@arcadia-eternity/const'
import { shallowRef, toRaw } from 'vue'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'
import type { ContentPresentation } from '@arcadia-eternity/schema'
import { getServerContentText } from '@/i18n/serverContent'
import { officialAssetUrl } from '@/utils/officialAssetUrl'
import { hasOwnedResource, readResourceBytes, ResourceSizeError, RESOURCE_MAX_BYTES } from './resourceTransport'
import { SharedReads } from './sharedRead'
import { startMediaPreload, finishMediaPreload } from './mediaPreloadProgress'

export { isMediaPreloading } from './mediaPreloadProgress'

export const MOVIE_LIMIT = 16 * 1024 * 1024
const IMAGE_LIMIT = 64 * 1024 * 1024
const MEMORY_LIMIT = 96 * 1024 * 1024
type Asset = { url: string; limit: number; label?: string }
export type MediaResource = {
  id: string
  source: string
  tags?: string[]
  sha256?: string
  kind?: string
  mime?: string
}
type Catalog = Pick<ServerEnvironmentContent, 'species' | 'skills' | 'marks'>
export type MediaPet = {
  species: string
  skills?: readonly string[]
  ability?: string
  emblem?: string
  marks?: readonly string[]
}
type MediaEnvironment = { scope: string; resources: MediaResource[]; hashes: Map<string, string> }
const environments = new WeakMap<object, MediaEnvironment>()
const localFiles = new Map<string, Set<{ url: string }>>()
const fallback = shallowRef<MediaEnvironment>({ scope: 'client', resources: [], hashes: new Map() })
const packCatalog = shallowRef<Catalog | null>(null)
let releaseFallback: (() => void) | undefined
let sequence = 0

export function registerMediaEnvironment(
  content: Catalog,
  scope: string,
  resources: MediaResource[] = [],
  local = false,
) {
  const hashes = new Map<string, string>()
  const leases: (() => void)[] = []
  for (const resource of resources) {
    if (!resource.sha256) continue
    if (!/^[a-f0-9]{64}$/.test(resource.sha256)) throw new Error('资源哈希格式无效')
    const url = officialAssetUrl(resource.source)
    if (hashes.has(url) && hashes.get(url) !== resource.sha256) throw new Error('同一资源地址声明了不同的哈希')
    hashes.set(url, resource.sha256)
  }
  const registered = new Set<string>()
  if (local)
    for (const resource of resources) {
      if (!resource.sha256) continue
      const url = officialAssetUrl(resource.source)
      if (!registered.has(url) && (resource.kind === 'file' || url !== resource.source)) {
        registered.add(url)
        const digest = resource.sha256
        const files = localFiles.get(digest) ?? new Set()
        const entry = { url }
        files.add(entry)
        localFiles.set(digest, files)
        leases.push(() => {
          files.delete(entry)
          if (!files.size) localFiles.delete(digest)
        })
      }
    }
  environments.set(toRaw(content), { scope, resources, hashes })
  return () => {
    for (const release of leases) release()
  }
}
export function localMediaScope(
  location: (string | undefined)[],
  packages: { name: string; version: string }[] | undefined,
  resources: MediaResource[] = [],
) {
  const inventory = resources.map(row => [row.id, row.sha256 ?? row.source, row.tags])
  return JSON.stringify([...location, sha256Hex(JSON.stringify([packages, inventory]))])
}

export function setPackMedia(scope: string, resources: MediaResource[], catalog: Catalog) {
  const release = registerMediaEnvironment(catalog, scope, resources, true)
  releaseFallback?.()
  releaseFallback = release
  fallback.value = environments.get(toRaw(catalog))!
  packCatalog.value = catalog
}

export const activeMediaCatalog = () => getServerContentText() ?? packCatalog.value

export function mediaEnvironment(content: Catalog | null = getServerContentText()): MediaEnvironment {
  if (!content) return fallback.value
  const key = toRaw(content)
  if (!environments.has(key)) registerMediaEnvironment(key, 'session/' + ++sequence)
  return environments.get(key)!
}

function presentationAssets(
  row: { id: string; name?: string; presentation?: ContentPresentation },
  movies: boolean,
): Asset[] {
  const p = row.presentation
  if (!p) return []
  const assets: Asset[] = []
  const add = (url: unknown, kind: string, limit = IMAGE_LIMIT) => {
    if (typeof url === 'string' && url)
      assets.push({ url: officialAssetUrl(url), limit, label: `${row.name || row.id} · ${kind}` })
  }
  if (p.battle?.renderer !== 'seer2-swf' || movies)
    add(
      p.battle?.source,
      p.battle?.renderer === 'seer2-swf' ? 'SWF 动画' : '战斗图像',
      p.battle?.renderer === 'seer2-swf' ? MOVIE_LIMIT : IMAGE_LIMIT,
    )
  add(p.icon, '图标')
  add(p.battle?.fallback, '备用图像')
  add(p.portrait, '立绘')
  add(p.cry, '叫声', MOVIE_LIMIT)
  add(p.sfx, '音效', MOVIE_LIMIT)
  add(p.background, '背景')
  add(p.music, '音乐', MOVIE_LIMIT)
  return assets
}

export function environmentAssets(
  content: Catalog,
  pets?: readonly MediaPet[],
  movies = true,
  globalMarks: readonly string[] = [],
): Asset[] {
  if (!pets)
    return [content.species, content.skills, content.marks].flatMap(rows =>
      rows.flatMap(row => presentationAssets(row, movies)),
    )
  const bySpecies = new Map(content.species.map(row => [row.id as string, row]))
  const skills = new Set(pets.flatMap(p => p.skills ?? []))
  const marks = new Set([...globalMarks, ...pets.flatMap(p => [p.ability, p.emblem, ...(p.marks ?? [])])])
  return [
    ...pets.flatMap(p => {
      const species = bySpecies.get(p.species)
      return species ? presentationAssets(species, movies) : []
    }),
    ...content.skills.filter(row => skills.has(row.id)).flatMap(row => presentationAssets(row, movies)),
    ...content.marks.filter(row => marks.has(row.id)).flatMap(row => presentationAssets(row, movies)),
  ]
}

export function declaredMediaAssets(resources: MediaResource[]): Asset[] {
  return resources.map(row => ({
    url: officialAssetUrl(row.source),
    label: row.id,
    limit:
      row.kind === 'audio' ||
      row.kind === 'swf' ||
      row.mime?.startsWith('audio/') ||
      row.mime === 'application/x-shockwave-flash' ||
      row.tags?.includes('music')
        ? MOVIE_LIMIT
        : IMAGE_LIMIT,
  }))
}

const persistent = (scope: string, url: string) =>
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
const pending = new SharedReads<Uint8Array, { url: string; maxBytes: number }>()

const digestUrl = (digest: string) => 'https://arcadia-media.invalid/sha256/' + digest
function validBytes(bytes: Uint8Array | null, limit: number, digest?: string): bytes is Uint8Array {
  return !!bytes?.byteLength && bytes.byteLength <= limit && (!digest || sha256Hex(bytes) === digest)
}

// A battle request can claim an item still waiting in its environment's background sweep.
const environmentQueues = new WeakMap<MediaEnvironment, (url: string) => void>()
type MediaReadOptions = { environment?: MediaEnvironment; signal?: AbortSignal; maxBytes?: number }

export async function readMediaBytes(url: string, options?: MediaReadOptions) {
  return (await acquireMediaBytes(url, options)).slice()
}

async function acquireMediaBytes(
  url: string,
  { environment = mediaEnvironment(), signal, maxBytes = IMAGE_LIMIT }: MediaReadOptions = {},
  foreground = true,
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > RESOURCE_MAX_BYTES)
    throw new Error('资源大小限制无效')
  const { scope } = environment
  const digest = environment.hashes.get(url)
  const alias = JSON.stringify([scope, url])
  const blob = url.startsWith('blob:')
  const localSession = /^http:\/\/127\.0\.0\.1:\d+\/local-content\//.test(url)
  const ephemeral = blob || localSession
  const available = () =>
    blob
      ? hasOwnedResource(url)
      : !localSession || (!!digest && [...(localFiles.get(digest) ?? [])].some(file => file.url === url))
  const live = available()
  if (blob && !live) throw new Error('本地资源已释放')
  if (foreground) environmentQueues.get(environment)?.(url)
  const knownHash = digest ?? aliases.get(alias)
  const hit = live && knownHash && memory.get(knownHash)
  if (hit && knownHash) {
    if (hit.byteLength > maxBytes) throw new ResourceSizeError()
    memory.delete(knownHash)
    memory.set(knownHash, hit)
    return hit
  }
  // Unregistered loopback tokens must still be read through the owning server.
  const key = live ? (digest ?? alias) : JSON.stringify(['local', url, digest])
  const flight = pending.get(key, { url, maxBytes }, async readSignal => {
    const options = { signal: readSignal, maxBytes }
    const read = async () => {
      if (ephemeral) {
        if (live && !available()) throw new Error('本地资源已释放')
        const bytes = await readResourceBytes(url, options)
        if (!validBytes(bytes, maxBytes, digest)) throw new Error('资源内容与清单不一致')
        return bytes
      }
      if (persistent(scope, url) || digest) {
        try {
          const desktop = globalThis.window?.arcadiaDesktop ?? globalThis.window?.arcadiaRemotePlay
          const address = digest ? digestUrl(digest) : url
          if (desktop?.readMediaCache) {
            const bytes = await desktop.readMediaCache(scope, address, maxBytes, url)
            if (validBytes(bytes, maxBytes, digest)) return bytes
          } else if (globalThis.caches) {
            let cached = await caches.match(address, digest ? {} : { cacheName: cacheName(scope) })
            const storedHash = !digest && cached?.headers.get('x-arcadia-sha256')
            if (storedHash && /^[a-f0-9]{64}$/.test(storedHash)) cached = await caches.match(digestUrl(storedHash))
            if (cached) {
              const bytes = await readResourceBytes(url, options, async () => cached)
              if (validBytes(bytes, maxBytes, digest ?? (storedHash || undefined))) return bytes
            }
          }
        } catch {
          /* A cache miss or unavailable storage falls through to the declared source. */
        }
      }
      if (digest)
        for (const local of localFiles.get(digest) ?? []) {
          if (local.url === url) continue
          readSignal.throwIfAborted()
          try {
            const bytes = await readResourceBytes(local.url, options)
            if (validBytes(bytes, maxBytes, digest)) return bytes
          } catch {
            /* A local capture can expire while another environment is preparing. */
          }
        }
      readSignal.throwIfAborted()
      const bytes = await readResourceBytes(url, options)
      if (!validBytes(bytes, maxBytes, digest)) throw new Error('资源内容与清单不一致')
      return bytes
    }
    const bytes = await read()
    readSignal.throwIfAborted()
    if (ephemeral && live && !available()) throw new Error('本地资源已释放')
    remember(bytes, digest ?? sha256Hex(bytes), digest || !live ? undefined : alias)
    return bytes
  })
  let bytes: Uint8Array
  try {
    bytes = await flight.join(signal)
  } catch (error) {
    // A larger consumer can retry a capped stream. A second mirror can recover a broken first source.
    const retryLimit = error instanceof ResourceSizeError && maxBytes > flight.source.maxBytes
    const retryMirror = digest && flight.source.url !== url
    if ((retryLimit || retryMirror) && !signal?.aborted && (!live || available()))
      return acquireMediaBytes(url, { environment, signal, maxBytes }, foreground)
    throw error
  }
  signal?.throwIfAborted()
  if (ephemeral && live && !available()) throw new Error('本地资源已释放')
  if (bytes.byteLength > maxBytes) throw new ResourceSizeError()
  return bytes
}

export async function preloadMedia(
  assets: Asset[],
  environment: MediaEnvironment,
  signal: AbortSignal,
  save?: (completed: number, total: number, failed: number) => void,
  label = save ? '缓存环境资源' : '对战资源',
  background = false,
) {
  const { scope } = environment
  const unique = new Map<string, Asset>()
  for (const item of assets) {
    if (save && !environment.hashes.has(item.url) && !persistent(scope, item.url)) continue
    const previous = unique.get(item.url)
    if (!previous) unique.set(item.url, item)
    else if (item.limit < previous.limit) unique.set(item.url, { ...previous, limit: item.limit })
  }
  const items = [...unique.values()]
  save?.(0, items.length, 0)
  if (!items.length || signal.aborted) return 0
  const batch = startMediaPreload(label, items.length)
  const waiting = background ? new Map(items.map((item, index) => [item.url, index])) : undefined
  const promoted = new Set<Promise<void>>()
  let next = 0
  async function processItem(index: number) {
    const { url, limit, label } = items[index]!
    batch.loading.set(index, label ?? `资源 ${index + 1}`)
    try {
      const bytes = await acquireMediaBytes(url, { environment, signal, maxBytes: limit }, !background)
      if (save) {
        signal.throwIfAborted()
        const desktop = globalThis.window?.arcadiaDesktop ?? globalThis.window?.arcadiaRemotePlay
        const digest = environment.hashes.get(url)
        const address = digest ? digestUrl(digest) : url
        if (desktop?.writeMediaCache) await desktop.writeMediaCache(scope, address, bytes)
        else {
          const cache = await caches.open(cacheName(scope))
          const actual = digest ?? sha256Hex(bytes)
          await cache.put(digestUrl(actual), new Response(bytes as Uint8Array<ArrayBuffer>))
          if (!digest) await cache.put(url, new Response(null, { headers: { 'x-arcadia-sha256': actual } }))
        }
      }
    } catch {
      if (!signal.aborted) batch.failed++
    }
    if (signal.aborted) return
    batch.loading.delete(index)
    batch.completed++
    batch.lastProgressAt = performance.now()
    save?.(batch.completed, batch.total, batch.failed)
  }
  function promote(url: string) {
    const index = waiting?.get(url)
    if (index === undefined || signal.aborted) return
    waiting!.delete(url)
    const task = processItem(index)
    promoted.add(task)
    void task.then(() => promoted.delete(task))
  }
  async function worker() {
    while (!signal.aborted && next < items.length) {
      const index = next++
      if (!waiting || waiting.delete(items[index]!.url)) await processItem(index)
    }
  }
  if (waiting) environmentQueues.set(environment, promote)
  const finish = () => {
    if (waiting && environmentQueues.get(environment) === promote) environmentQueues.delete(environment)
    finishMediaPreload(batch, signal.aborted)
  }
  signal.addEventListener('abort', finish, { once: true })
  try {
    await Promise.all(Array.from({ length: Math.min(items.length, 3) }, worker))
    await Promise.all(promoted)
    return batch.failed
  } finally {
    signal.removeEventListener('abort', finish)
    finish()
  }
}

export async function clearMediaCache(scope: string) {
  const desktop = globalThis.window?.arcadiaDesktop ?? globalThis.window?.arcadiaRemotePlay
  if (desktop?.clearMediaCache) await desktop.clearMediaCache(scope)
  else await caches.delete(cacheName(scope))
  for (const key of aliases.keys()) if (JSON.parse(key)[0] === scope) aliases.delete(key)
}

let sceneChoices = { music: Math.random(), background: Math.random() }
export function resetBattleScene() {
  sceneChoices = { music: Math.random(), background: Math.random() }
}
export function battleScene(environment: MediaEnvironment, tag: 'music' | 'background', choice: string) {
  const rows = environment.resources.filter(row => row.tags?.includes(tag))
  const row = rows.find(row => row.id === choice) ?? rows[Math.floor(sceneChoices[tag] * rows.length)]
  return row && officialAssetUrl(row.source)
}

type PreloadSettings = { battleRenderer: string; battleMusic: string; background: string }
function teamMediaAssets(
  content: Catalog,
  env: MediaEnvironment,
  pets: readonly MediaPet[],
  settings: PreloadSettings,
  globalMarks: readonly string[] = [],
) {
  const scene = (['background', 'music'] as const).flatMap(tag => {
    const url = battleScene(env, tag, tag === 'music' ? settings.battleMusic : settings.background)
    return url
      ? [{ url, label: tag === 'music' ? '战斗音乐' : '战斗背景', limit: tag === 'music' ? MOVIE_LIMIT : IMAGE_LIMIT }]
      : []
  })
  return [...scene, ...environmentAssets(content, pets, settings.battleRenderer !== 'image', globalMarks)]
}

/** Owned by the application so routing from the lobby to a match does not abandon queued reads. */
export function createEnvironmentMediaPreloader() {
  let current: MediaEnvironment | undefined
  let controller: AbortController | undefined
  function stop() {
    controller?.abort()
    controller = undefined
    current = undefined
  }
  return {
    stop,
    update(content: Catalog | null, pets: readonly MediaPet[], settings: PreloadSettings) {
      if (!content) return stop()
      const env = mediaEnvironment(content)
      if (current === env) return
      const previous = controller
      const next = new AbortController()
      current = env
      controller = next
      const first = teamMediaAssets(content, env, pets, settings)
      const all = [...first, ...environmentAssets(content), ...declaredMediaAssets(env.resources)]
      void preloadMedia(all, env, next.signal, undefined, '环境全量预载', true).then(failed => {
        if (failed && controller === next) current = undefined
      })
      previous?.abort()
    },
  }
}

export function createTeamMediaPreloader(label = '队伍资源') {
  let controller: AbortController | undefined
  let previous = ''
  let previousEnvironment: MediaEnvironment | undefined
  function stop() {
    previous = ''
    previousEnvironment = undefined
    controller?.abort()
    controller = undefined
  }
  return {
    stop,
    update(
      content: Catalog | null,
      pets: readonly MediaPet[],
      settings: PreloadSettings,
      globalMarks: readonly string[] = [],
    ) {
      if (!content) return stop()
      const env = mediaEnvironment(content)
      const key = JSON.stringify([
        env.scope,
        pets,
        globalMarks,
        settings.battleRenderer,
        settings.background,
        settings.battleMusic,
      ])
      if (key === previous && env === previousEnvironment) return
      const old = controller
      controller = new AbortController()
      previous = key
      previousEnvironment = env
      void preloadMedia(
        teamMediaAssets(content, env, pets, settings, globalMarks),
        env,
        controller.signal,
        undefined,
        label,
      )
      old?.abort()
    },
  }
}
