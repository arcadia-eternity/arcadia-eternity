import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, expect, it, vi } from 'vitest'
import { sha256Hex } from '@arcadia-eternity/const'
import { registerOwnedResource } from '../resourceTransport'
import {
  createEnvironmentMediaPreloader,
  isMediaPreloading,
  mediaEnvironment,
  readMediaBytes,
  registerMediaEnvironment,
  type MediaResource,
} from '../environmentMedia'

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
  expect(fetcher).toHaveBeenCalledTimes(4)
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
  expect(request).toHaveBeenCalledTimes(2)
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
  expect(request).toHaveBeenCalledTimes(3)
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

it('reopens persisted bytes by hash after a cold start, including an originally unpinned URL', async () => {
  const cachesByName = new Map<string, Map<string, Response>>()
  const storage = {
    async open(name: string) {
      const items = cachesByName.get(name) ?? new Map<string, Response>()
      cachesByName.set(name, items)
      return {
        put: async (key: string, value: Response) => {
          items.set(key, value.clone())
        },
      }
    },
    async match(key: string, options?: { cacheName?: string }) {
      for (const [name, items] of cachesByName)
        if (!options?.cacheName || name === options.cacheName) {
          const hit = items.get(key)
          if (hit) return hit.clone()
        }
    },
    delete: (name: string) => cachesByName.delete(name),
  }
  vi.stubGlobal('caches', storage)
  const bytes = Uint8Array.of(81, 23, 31)
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  const { preloadMedia } = await import('../environmentMedia')
  const progress = vi.fn()
  await preloadMedia([{ url, limit: 100 }], env('saved', []).environment, new AbortController().signal, progress)
  expect(progress).toHaveBeenLastCalledWith(1, 1, 0)
  vi.resetModules()
  const cold = await import('../environmentMedia')
  const catalog = { species: [], skills: [], marks: [] }
  cold.registerMediaEnvironment(catalog, 'different server', [{ id: 'movie', source: cdn, sha256: sha256Hex(bytes) }])
  expect(await cold.readMediaBytes(cdn, { environment: cold.mediaEnvironment(catalog) })).toEqual(bytes)
  expect(fetcher).toHaveBeenCalledOnce()
  await cold.clearMediaCache('saved')
  expect(cachesByName.size).toBe(0)
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
  const app = createEnvironmentMediaPreloader()
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
