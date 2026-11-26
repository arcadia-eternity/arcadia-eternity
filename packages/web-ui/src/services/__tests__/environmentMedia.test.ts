import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, expect, it, vi } from 'vitest'
import { sha256Hex } from '@arcadia-eternity/const'
import { setServerContentText } from '@/i18n/serverContent'
import { registerOwnedResource } from '../resourceTransport'
import {
  battleUiUrl,
  loadMedia,
  mediaEnvironment,
  peekMediaBytes,
  readMediaBytes,
  registerMediaEnvironment,
  type MediaResource,
} from '../mediaLoader'
import { createMediaPreloader, preloadMedia } from '../environmentMedia'
import { isMediaPreloading } from '../mediaPreloadProgress'

const url = 'https://server.test/one.swf'
const cdn = 'https://cdn.test/other.swf'
function env(scope: string, resources: MediaResource[], local = false) {
  const content = { species: [], marks: [], skills: [] }
  const release = registerMediaEnvironment(content, scope, resources, local)
  return { environment: mediaEnvironment(content), release }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
it('uses identical package bytes for another server and URL, and prevents stale capability reads', async () => {
  const bytes = Uint8Array.of(70, 87, 83)
  const sha256 = sha256Hex(bytes)
  vi.stubGlobal('Blob', NodeBlob)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test/movie')
  const embedded = registerOwnedResource(new Blob([bytes]))
  const source = env('personal', [{ id: 'sprite', source: embedded.url, kind: 'file', sha256 }], true)
  const first = env('server', [{ id: 'sprite', source: url, sha256 }])
  const second = env('another', [{ id: 'sprite', source: cdn, sha256 }])
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
  vi.stubGlobal('fetch', fetcher)
  const value = await readMediaBytes(url, first)
  expect([...value]).toEqual([...bytes])
  value.fill(0)
  source.release()
  embedded.release()
  expect(await readMediaBytes(cdn, second)).toEqual(bytes)
  await expect(readMediaBytes(embedded.url, source)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('rejects a wrong digest, retries, and isolates unhashed URLs by environment', async () => {
  const bytes = Uint8Array.of(3, 4, 5)
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('stale'))
    .mockResolvedValueOnce(new Response('wrong'))
    .mockResolvedValueOnce(new Response(bytes))
    .mockResolvedValueOnce(new Response('a'))
    .mockResolvedValueOnce(new Response('b'))
  vi.stubGlobal('fetch', fetcher)
  const declared = env('revision-2', [{ id: 'sprite', source: url, sha256: sha256Hex(bytes) }])
  await expect(readMediaBytes(url, declared)).rejects.toThrow('清单')
  expect(await readMediaBytes(url, declared)).toEqual(bytes)
  const a = await readMediaBytes(url, env('revision-a', []))
  const b = await readMediaBytes(url, env('revision-b', []))
  expect(a).not.toEqual(b)
  expect(fetcher).toHaveBeenCalledTimes(5)
  expect(fetcher.mock.calls.slice(0, 2).map(call => call[1].cache)).toEqual(['default', 'reload'])
})

it('shares concurrent requests by digest and retries a working mirror when the first fails integrity', async () => {
  const bytes = Uint8Array.of(8, 10, 4)
  const sha256 = sha256Hex(bytes)
  const first = env('mirror-a', [{ id: 'movie', source: url, sha256 }])
  const second = env('mirror-b', [{ id: 'movie', source: cdn, sha256 }])
  const request = vi.fn(async (address: string) => new Response(address === url ? Uint8Array.of(0) : bytes))
  vi.stubGlobal('fetch', request)
  const results = await Promise.allSettled([readMediaBytes(url, first), readMediaBytes(cdn, second)])
  expect(results[0].status).toBe('rejected')
  expect(results[1]).toEqual({ status: 'fulfilled', value: bytes })
  expect(request).toHaveBeenCalledTimes(3)
  const good = Uint8Array.of(5, 5, 5)
  request.mockImplementation(async () => new Response(good))
  const shared = env(
    'mirrors',
    [url, cdn].map(source => ({ id: source, source, sha256: sha256Hex(good) })),
  )
  const controller = new AbortController()
  const cancelled = readMediaBytes(url, { ...shared, signal: controller.signal })
  const other = readMediaBytes(cdn, shared)
  controller.abort()
  await expect(cancelled).rejects.toThrow()
  expect(await other).toEqual(good)
  expect(request).toHaveBeenCalledTimes(4)
})

it('reuses previously unpinned bytes when a later package declares their hash', async () => {
  const bytes = Uint8Array.of(71, 52, 33)
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  await readMediaBytes(url, env('unversioned', []))
  expect(await readMediaBytes(cdn, env('versioned', [{ id: 'same', source: cdn, sha256: sha256Hex(bytes) }]))).toEqual(
    bytes,
  )
  expect(fetcher).toHaveBeenCalledOnce()
})

function mockBrowserCache() {
  const cachesByName = new Map<string, Map<string, Response>>()
  const bodyRead = vi.fn()
  const writes = vi.fn()
  const storage = {
    has: async (name: string) => cachesByName.has(name),
    async open(name: string) {
      const items = cachesByName.get(name) ?? new Map<string, Response>()
      cachesByName.set(name, items)
      return {
        keys: async () => [...items.keys()].map(key => new Request(key)),
        match: async (request: Request) => items.get(request.url)?.clone(),
        put: async (key: string, value: Response) => {
          writes(key)
          items.set(key, value.clone())
        },
      }
    },
    async match(key: string, options?: { cacheName?: string }) {
      for (const [name, items] of cachesByName)
        if (!options?.cacheName || name === options.cacheName) {
          const hit = items.get(key)
          if (hit) {
            const response = hit.clone()
            const body = response.body
            Object.defineProperty(response, 'body', {
              get: () => {
                bodyRead(key)
                return body
              },
            })
            return response
          }
        }
    },
    delete: (name: string) => cachesByName.delete(name),
  }
  vi.stubGlobal('caches', storage)
  return { cachesByName, bodyRead, writes }
}

it('reopens persisted bytes by hash after a cold start, including an originally unpinned URL', async () => {
  const { cachesByName } = mockBrowserCache()
  const bytes = Uint8Array.of(81, 23, 31)
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  const environment = env('saved', []).environment
  expect(await preloadMedia([{ url, limit: 100 }], environment, new AbortController().signal)).toBe(0)
  vi.resetModules()
  const cold = await import('../mediaLoader')
  const catalog = { species: [], skills: [], marks: [] }
  cold.registerMediaEnvironment(catalog, 'different server', [{ id: 'movie', source: cdn, sha256: sha256Hex(bytes) }])
  expect(await cold.readMediaBytes(cdn, { environment: cold.mediaEnvironment(catalog) })).toEqual(bytes)
  expect(fetcher).toHaveBeenCalledOnce()
  expect(await cold.mediaCacheUsage('saved')).toEqual({ files: 1, bytes: bytes.length })
  expect(await cold.mediaCacheUsage('different server')).toEqual({ files: 0, bytes: 0 })
  await cold.clearMediaCache('saved')
  expect(await cold.mediaCacheUsage('saved')).toEqual({ files: 0, bytes: 0 })
  expect(cachesByName.size).toBe(0)
})

it('checks individual objects on cold sweeps, warms the team, and restores only an evicted alias target', async () => {
  const { cachesByName, bodyRead, writes } = mockBrowserCache()
  const items = ['team', 'pinned', 'mutable'].map(id => ({
    id,
    url: 'https://cdn.test/partial/' + id,
    kind: 'audio' as const,
  }))
  const bytes = items.map(({ id }) => new TextEncoder().encode('OggS' + id))
  const digestKeys = bytes.map(value => 'https://arcadia-media.invalid/sha256/' + sha256Hex(value))
  const resources = items.map((asset, i) => ({
    id: asset.id,
    source: asset.url,
    sha256: i < 2 ? sha256Hex(bytes[i]!) : undefined,
  }))
  const environment = env('partial', resources).environment
  const signal = new AbortController().signal
  const fetcher = vi.fn(async (address: string) => new Response(bytes[items.findIndex(item => item.url === address)]))
  vi.stubGlobal('fetch', fetcher)
  expect(await preloadMedia(items, environment, signal, { background: true })).toBe(0)
  expect(fetcher).toHaveBeenCalledTimes(3)
  fetcher.mockClear()
  writes.mockClear()
  bodyRead.mockClear()

  vi.resetModules()
  const cold = await import('../environmentMedia')
  const { mediaPreloadBatches } = await import('../mediaPreloadProgress')
  expect(
    await cold.preloadMedia(items, environment, signal, { background: true, teamUrls: new Set([items[0]!.url]) }),
  ).toBe(0)
  expect(mediaPreloadBatches.value[0]?.cached).toBe(2)
  expect(new Set(bodyRead.mock.calls.map(([key]) => key))).toEqual(new Set([digestKeys[0]]))
  expect(writes).not.toHaveBeenCalled()
  expect(fetcher).not.toHaveBeenCalled()

  const cache = [...cachesByName.values()][0]!
  cache.delete(digestKeys[2]!)
  bodyRead.mockClear()
  const save = vi.fn()
  expect(await cold.preloadMedia(items, environment, signal, { save })).toBe(0)
  expect(fetcher.mock.calls.map(([source]) => source)).toEqual([items[2]!.url])
  expect(writes.mock.calls.map(([key]) => key)).toEqual([digestKeys[2], items[2]!.url])
  expect(bodyRead).not.toHaveBeenCalled()
  expect(save).toHaveBeenLastCalledWith(3, 3, 0)

  cache.delete(digestKeys[2]!)
  writes.mockClear()
  expect(await cold.preloadMedia(items, environment, signal, { background: true })).toBe(0)
  expect(writes.mock.calls.map(([key]) => key)).toEqual([digestKeys[2], items[2]!.url])
  expect(fetcher).toHaveBeenCalledOnce()
  expect(mediaPreloadBatches.value[0]?.cached).toBe(2)
})

it('shares automatic desktop writes across preloading and playback and reports explicit save errors', async () => {
  const bytes = new TextEncoder().encode('OggSdesktop')
  const source = 'https://cdn.test/desktop-sound'
  const resources = [{ id: 'sound', source, sha256: sha256Hex(bytes) }]
  const catalog = { species: [], skills: [], marks: [] }
  registerMediaEnvironment(catalog, 'desktop', resources)
  setServerContentText(catalog)
  const writeMediaCache = vi.fn(async (_scope: string, _key: string, _bytes: Uint8Array) => {})
  const readMediaCache = vi.fn(async () => null)
  const hasMediaCache = vi.fn(async () => false)
  const fetcher = vi.fn(async () => new Response(bytes))
  vi.stubGlobal('arcadiaDesktop', { readMediaCache, writeMediaCache, hasMediaCache })
  vi.stubGlobal('fetch', fetcher)
  const items = [{ url: source, kind: 'audio' as const }]
  const signal = new AbortController().signal
  try {
    const environment = mediaEnvironment(catalog)
    await Promise.all([loadMedia('audio', source, signal), preloadMedia(items, environment, signal)])
    expect(writeMediaCache).toHaveBeenCalledOnce()
    const [scope, key, written] = writeMediaCache.mock.calls[0]!
    expect(scope).toBe('desktop')
    expect(key).toBe('https://arcadia-media.invalid/sha256/' + resources[0]!.sha256)
    expect([...written]).toEqual([...bytes])
    expect(fetcher).toHaveBeenCalledOnce()
    hasMediaCache.mockResolvedValueOnce(true)
    readMediaCache.mockClear()
    expect(await preloadMedia(items, environment, signal, { background: true })).toBe(0)
    expect(hasMediaCache).toHaveBeenCalledWith('desktop', key, 16 * 1024 * 1024, false)
    expect(readMediaCache).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(writeMediaCache).toHaveBeenCalledOnce()
    writeMediaCache.mockRejectedValue(new Error('quota'))
    const other = [{ url: 'https://cdn.test/desktop-new', kind: 'audio' as const }]
    expect(await preloadMedia(other, environment, signal)).toBe(0)
    const save = vi.fn()
    expect(await preloadMedia(other, environment, signal, { save })).toBe(1)
    expect(save).toHaveBeenLastCalledWith(1, 1, 1)
  } finally {
    setServerContentText(null)
  }
})

it('shares one imported Blob stream across a room, a mirror and consumers with different size limits', async () => {
  vi.stubGlobal('Blob', NodeBlob)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shared/movie')
  const bytes = Uint8Array.of(11, 8, 22)
  const blob = new Blob([bytes])
  const stream = vi.spyOn(blob, 'stream')
  const owned = registerOwnedResource(blob)
  const hash = sha256Hex(bytes)
  const room = env('blob-room', [{ id: 'pet', source: owned.url, kind: 'file', sha256: hash }], true)
  const mirror = env('blob-mirror', [{ id: 'pet', source: cdn, sha256: hash }])
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  try {
    const cancel = new AbortController()
    const first = readMediaBytes(owned.url, { ...room, signal: cancel.signal, maxBytes: 64 })
    const narrow = readMediaBytes(owned.url, { ...room, maxBytes: 2 })
    const remaining = readMediaBytes(cdn, mirror)
    cancel.abort()
    await expect(first).rejects.toThrow()
    await expect(narrow).rejects.toThrow('大小')
    expect(await remaining).toEqual(bytes)
    expect(stream).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    room.release()
    owned.release()
  }
  await expect(readMediaBytes(owned.url, room)).rejects.toThrow('释放')
})

it('shares local session reads, checks each token lifetime, and retries an interrupted last consumer', async () => {
  const bytes = Uint8Array.of(67, 4, 9, 50)
  const local = 'http://127.0.0.1:4321/local-content/test/animation'
  const room = env('local-session', [{ id: 'pet', kind: 'file', source: local, sha256: sha256Hex(bytes) }], true)
  let respond!: (value: Response) => void
  const fetcher = vi.fn(
    () =>
      new Promise<Response>(resolve => {
        respond = resolve
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const stop = new AbortController()
  const first = readMediaBytes(local, { ...room, signal: stop.signal })
  const second = readMediaBytes(local, { ...room, maxBytes: 16 })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
  stop.abort()
  await expect(first).rejects.toThrow()
  room.release()
  respond(new Response(bytes))
  await expect(second).rejects.toThrow('释放')
  const next = env('new-session', [{ id: 'pet', source: url, sha256: sha256Hex(bytes) }])
  const last = new AbortController()
  const interrupted = readMediaBytes(url, { ...next, signal: last.signal })
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  last.abort()
  await expect(interrupted).rejects.toThrow()
  const retry = readMediaBytes(url, next)
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
  respond(new Response(bytes))
  expect(await retry).toEqual(bytes)
})

it('lets a larger consumer retry a stream capped by a stricter first caller', async () => {
  const bytes = Uint8Array.of(15, 123, 73)
  const fetcher = vi.fn(async () => new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  const source = env('limits', [])
  const small = readMediaBytes(url, { ...source, maxBytes: 2 })
  const large = readMediaBytes(url, { ...source, maxBytes: 4 })
  await expect(small).rejects.toThrow('大小')
  expect(await large).toEqual(bytes)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('warms all declared media once per environment and promotes a queued battle asset without rereading it', async () => {
  const content = { species: [], skills: [], marks: [] }
  const resources = Array.from({ length: 7 }, (_, i) => ({ id: 'icon-' + i, source: 'https://cdn.test/sweep/' + i }))
  registerMediaEnvironment(content, 'bulk', resources)
  const environment = mediaEnvironment(content)
  const responses = new Map<string, (r: Response) => void>()
  const fetcher = vi.fn(
    (url: string) =>
      new Promise<Response>(resolve => {
        responses.set(url, resolve)
      }),
  )
  vi.stubGlobal('fetch', fetcher)
  const app = createMediaPreloader('环境全量预载', 'environment')
  const settings = { battleRenderer: 'image', background: 'random', battleMusic: 'random' }
  try {
    app.update(content, [], settings)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    const urgent = resources[6]!.source
    const controller = new AbortController()
    const battle = readMediaBytes(urgent, { environment, signal: controller.signal })
    await vi.waitFor(() => expect(responses.has(urgent)).toBe(true))
    controller.abort()
    await expect(battle).rejects.toThrow()
    responses.get(urgent)!(new Response('promoted'))
    for (const item of resources.slice(0, 6)) {
      await vi.waitFor(() => expect(responses.has(item.source)).toBe(true))
      responses.get(item.source)!(new Response(item.id))
    }
    await vi.waitFor(() => expect(isMediaPreloading.value).toBe(false))
    app.update(content, [], settings)
    expect(new TextDecoder().decode(await readMediaBytes(urgent, { environment }))).toBe('promoted')
    expect(fetcher).toHaveBeenCalledTimes(resources.length)
  } finally {
    app.stop()
  }
})

it('waits for the current roster and shares its resolved element icons with the renderer', async () => {
  const catalog = { species: [], skills: [], marks: [] }
  const source = 'https://roster.test/twin-elements'
  registerMediaEnvironment(catalog, 'roster', [
    {
      id: 'custom-icon',
      source,
      tags: ['battle-ui:element:Water', 'battle-ui:element:Ice'],
    },
  ])
  const read = Promise.withResolvers<Response>()
  const fetcher = vi.fn(() => read.promise)
  vi.stubGlobal('fetch', fetcher)
  const preloader = createMediaPreloader('当前对战')
  const settings = { battleRenderer: 'image', background: 'random', battleMusic: 'random' }
  try {
    preloader.update(catalog, [{ species: 'pet', elements: ['Water', 'Ice'] }], settings)
    const done = vi.fn()
    const waiting = preloader.ready!.then(done)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    expect(done).not.toHaveBeenCalled()
    const png = new Uint8Array(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.set([73, 72, 68, 82], 12)
    png[19] = png[23] = 1
    read.resolve(new Response(png))
    await waiting
    expect(done).toHaveBeenCalledWith(0)
    const environment = mediaEnvironment(catalog)
    expect(await readMediaBytes(battleUiUrl('element:Ice', true, environment), { environment })).toEqual(png)
    expect(fetcher).toHaveBeenCalledOnce()
  } finally {
    preloader.stop()
  }
})

it('reports the team ready before its skill VFX and keeps the VFX bytes for playback', async () => {
  const vfx = 'https://cdn.test/vfx/hit.swf'
  const swf = new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0])
  const catalog = {
    species: [],
    marks: [],
    skills: [{ id: 'hit', presentation: { sfx: 'https://cdn.test/hit.mp3', vfx } }],
  } as unknown as Parameters<typeof mediaEnvironment>[0] & object
  registerMediaEnvironment(catalog, 'vfx', [])
  const environment = mediaEnvironment(catalog)
  const effect = Promise.withResolvers<Response>()
  const fetcher = vi.fn((address: string) =>
    address === vfx ? effect.promise : Promise.resolve(new Response(Uint8Array.of(73, 68, 51))),
  )
  vi.stubGlobal('fetch', fetcher)
  const preloader = createMediaPreloader('当前对战')
  try {
    preloader.update(catalog, [{ species: 'pet', skills: ['hit'] }], {
      battleRenderer: 'seer2-swf',
      background: 'random',
      battleMusic: 'random',
    })
    expect(await preloader.ready).toBe(0)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledWith(vfx, expect.anything()))
    expect(peekMediaBytes(vfx, 'swf', environment)).toBeUndefined()
    effect.resolve(new Response(swf))
    await vi.waitFor(() => expect(peekMediaBytes(vfx, 'swf', environment)).toEqual(swf))
  } finally {
    preloader.stop()
  }
})

it('reports the team ready after its static images and loads pet movies afterwards at low priority', async () => {
  const movie = 'https://cdn.test/pet/movie.swf'
  const fallback = 'https://cdn.test/pet/fallback.png'
  const catalog = {
    marks: [],
    skills: [],
    species: [
      {
        id: 'pet',
        presentation: { battle: { renderer: 'seer2-swf', source: movie, fallback }, cry: 'https://cdn.test/pet/cry' },
      },
    ],
  } as unknown as Parameters<typeof mediaEnvironment>[0] & object
  registerMediaEnvironment(catalog, 'deferred-movie', [])
  const image = Promise.withResolvers<Response>()
  const reads = new Map<string, RequestInit>()
  const fetcher = vi.fn((address: string, init: RequestInit) => {
    reads.set(address, init)
    return address === fallback ? image.promise : new Promise<Response>(() => {})
  })
  vi.stubGlobal('fetch', fetcher)
  const preloader = createMediaPreloader('当前对战')
  try {
    preloader.update(catalog, [{ species: 'pet' }], {
      battleRenderer: 'seer2-swf',
      background: 'random',
      battleMusic: 'random',
    })
    await vi.waitFor(() => expect(reads.has(fallback)).toBe(true))
    expect(reads.get(fallback)?.priority).toBe('high')
    expect(reads.has(movie)).toBe(false)
    const png = new Uint8Array(24)
    png.set([137, 80, 78, 71, 13, 10, 26, 10])
    png.set([73, 72, 68, 82], 12)
    png[19] = png[23] = 1
    image.resolve(new Response(png))
    expect(await preloader.ready).toBe(0)
    await vi.waitFor(() => expect(reads.get(movie)?.priority).toBe('low'))
  } finally {
    preloader.stop()
  }
})

it('validates during preload, retries corrected content and plays the warmed bytes without another fetch', async () => {
  const address = 'https://cdn.test/extensionless-sound'
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('not audio'))
    .mockResolvedValueOnce(new Response('OggS123'))
  vi.stubGlobal('fetch', fetcher)
  const signal = new AbortController().signal
  const items = [{ url: address, kind: 'audio' as const }]
  expect(await preloadMedia(items, mediaEnvironment(), signal)).toBe(1)
  expect(await preloadMedia(items, mediaEnvironment(), signal)).toBe(0)
  expect((await loadMedia('audio', address, signal)).type).toBe('audio/ogg')
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(await preloadMedia([...items, { url: address, kind: 'image' }], mediaEnvironment(), signal)).toBe(1)
  expect(fetcher).toHaveBeenCalledTimes(2)
})

it('shares active draft reads, checks declared hashes and reads fresh bytes after an edit', async () => {
  const bytes = Uint8Array.of(73, 68, 51)
  const read = vi.fn(async () => bytes)
  const source = { scope: 'draft', url: 'sounds/sample', revision: 1, sha256: sha256Hex(bytes), read }
  const controller = new AbortController()
  const signal = new AbortController().signal
  const first = loadMedia('audio', source, controller.signal)
  const second = loadMedia('audio', source, signal)
  controller.abort()
  await expect(first).rejects.toThrow()
  expect((await second).type).toBe('audio/mpeg')
  expect(read).toHaveBeenCalledOnce()
  bytes.fill(0)
  await expect(loadMedia('audio', source, signal)).rejects.toThrow('清单')
  await expect(loadMedia('audio', { ...source, revision: 2, sha256: undefined }, signal)).rejects.toThrow('音频格式')
  expect(read).toHaveBeenCalledTimes(3)
})

it('uses pinned base URLs by role, accepts old IDs and lets the active environment supply a replacement', async () => {
  const catalog = { species: [], marks: [], skills: [] }
  const role = 'element:Water'
  const legacyId = 'builtin-6a1645184b15'
  try {
    registerMediaEnvironment(catalog, 'default-ui', [])
    setServerContentText(catalog)
    const baseUrl = 'https://seer2-resource.yuuinih.com/png/petElementIcon/3.png'
    expect(battleUiUrl(role)).toBe(baseUrl)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('incorrect CDN bytes')),
    )
    await expect(readMediaBytes(baseUrl)).rejects.toThrow('清单')
    const original = { id: legacyId, source: 'https://older-server.test/element-water' }
    registerMediaEnvironment(catalog, 'legacy-ui', [original])
    expect(battleUiUrl(role)).toBe(original.source)
    const replacement = { id: 'mod:water', tags: ['battle-ui:element:Water'], source: 'https://mod.test/element-water' }
    registerMediaEnvironment(catalog, 'custom-ui', [replacement, { ...original, tags: replacement.tags }])
    expect(battleUiUrl(role)).toBe(replacement.source)
  } finally {
    setServerContentText(null)
  }
})
