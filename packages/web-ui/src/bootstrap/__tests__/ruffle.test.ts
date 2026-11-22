import { afterEach, expect, it, vi } from 'vitest'
import { sha256Hex } from '@arcadia-eternity/const'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('rejects an incorrect installed entry and allows a clean retry from the static URL', async () => {
  const { prepareSwfEntry } = await import('../../services/swf/assets')
  const good = Uint8Array.of(20, 25)
  vi.stubEnv('VITE_RUFFLE_ENTRY_SHA256', sha256Hex(good))
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('wrong')).mockResolvedValueOnce(new Response(good))
  vi.stubGlobal('fetch', fetcher)
  await expect(prepareSwfEntry()).rejects.toThrow('does not match')
  await prepareSwfEntry()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(new URL(fetcher.mock.calls[0]![0]).pathname).toBe('/ruffle/ruffle.js')
})

it('shares the startup read with another caller and the isolated playback runtime', async () => {
  const { prepareSwfEntry, readSwfRuntime } = await import('../../services/swf/assets')
  const bytes = Uint8Array.of(12, 7)
  vi.stubEnv('VITE_RUFFLE_ENTRY_SHA256', sha256Hex(bytes))
  const fetcher = vi.fn(async () => new Response(bytes))
  vi.stubGlobal('fetch', fetcher)
  await Promise.all([prepareSwfEntry(), prepareSwfEntry(), readSwfRuntime(new AbortController().signal)])
  expect(fetcher).toHaveBeenCalledTimes(5)
  expect(document.querySelector('script[data-arcadia-ruffle]')).toBeNull()
})
