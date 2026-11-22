import { installedRuffleBytes } from './runtimeFixture'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('shares player files between lobby warmup and independent players and isolates container copies', async () => {
  const { preloadSwfPlayer, readSwfRuntime, readSwfContainer } = await import('../assets')
  const fetcher = vi.fn(
    async (url: string) => new Response(url.includes('/ruffle/') ? installedRuffleBytes(url) : Uint8Array.of(5, 8)),
  )
  vi.stubGlobal('fetch', fetcher)
  const first = new AbortController()
  const remaining = new AbortController().signal
  const lobby = preloadSwfPlayer(first.signal)
  const cancelled = readSwfContainer(first.signal)
  const left = readSwfContainer(remaining)
  const right = readSwfContainer(remaining)
  const players = Promise.all([readSwfRuntime(remaining), readSwfRuntime(remaining)])
  first.abort()
  await expect(cancelled).rejects.toThrow()
  const [a, b, [runtime1, runtime2]] = await Promise.all([left, right, players])
  await lobby
  expect(fetcher).toHaveBeenCalledTimes(6)
  new Uint8Array(a)[0] = 0
  expect(new Uint8Array(b)[0]).toBe(5)
  expect(Object.keys(runtime1)).toHaveLength(5)
  expect(runtime1['ruffle.js']).toBe(runtime2['ruffle.js'])
  await preloadSwfPlayer(remaining)
  expect(fetcher).toHaveBeenCalledTimes(6)
})

it('retries only the failed runtime file and reuses its successful siblings', async () => {
  const { readSwfRuntime } = await import('../assets')
  let fail = true
  const calls = new Map<string, number>()
  vi.stubGlobal('fetch', (url: string, options: RequestInit) => {
    calls.set(url, (calls.get(url) ?? 0) + 1)
    if (url.endsWith('878d548199cddef07035.wasm')) {
      if (fail) {
        fail = false
        return Promise.resolve(new Response('<html>SPA fallback</html>'))
      }
      expect(options.cache).toBe('reload')
    }
    return Promise.resolve(new Response(installedRuffleBytes(url)))
  })
  const signal = new AbortController().signal
  await expect(readSwfRuntime(signal)).rejects.toThrow('878d548199cddef07035.wasm')
  await readSwfRuntime(signal)
  expect([...calls.values()]).toEqual([1, 1, 1, 2, 1])
})
