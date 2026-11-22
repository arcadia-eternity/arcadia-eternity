import { sha256Hex } from '@arcadia-eternity/const'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('shares player files between lobby warmup and independent players and isolates container copies', async () => {
  const { preloadSwfPlayer, readSwfRuntime, readSwfContainer } = await import('../assets')
  vi.stubEnv('VITE_RUFFLE_ENTRY_SHA256', sha256Hex(Uint8Array.of(5, 8)))
  const fetcher = vi.fn(async () => new Response(Uint8Array.of(5, 8)))
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
  vi.stubEnv('VITE_RUFFLE_ENTRY_SHA256', sha256Hex(new TextEncoder().encode('installed')))
  let fail = true
  const calls = new Map<string, number>()
  vi.stubGlobal('fetch', (url: string) => {
    calls.set(url, (calls.get(url) ?? 0) + 1)
    if (url.includes('core.ruffle.') && fail) {
      fail = false
      return Promise.resolve(new Response(null, { status: 503 }))
    }
    return Promise.resolve(new Response('installed'))
  })
  const signal = new AbortController().signal
  await expect(readSwfRuntime(signal)).rejects.toThrow('503')
  await readSwfRuntime(signal)
  expect([...calls.values()]).toEqual([1, 2, 1, 1, 1])
})
