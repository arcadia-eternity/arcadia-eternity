import { afterEach, expect, it, vi } from 'vitest'
import { installedRuffleBytes } from '../../services/swf/__tests__/runtimeFixture'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

it('rejects an incorrect installed entry and allows a clean retry from the static URL', async () => {
  const { prepareSwfEntry } = await import('../../services/swf/assets')
  const good = installedRuffleBytes('https://test.invalid/ruffle/ruffle.js')
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('wrong')).mockResolvedValueOnce(new Response(good))
  vi.stubGlobal('fetch', fetcher)
  await expect(prepareSwfEntry()).rejects.toThrow('does not match')
  await prepareSwfEntry()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(new URL(fetcher.mock.calls[0]![0]).pathname).toBe('/ruffle/ruffle.js')
})

it('shares the startup read with another caller and the isolated playback runtime', async () => {
  const { prepareSwfEntry, readSwfRuntime } = await import('../../services/swf/assets')
  const fetcher = vi.fn(async (url: string) => new Response(installedRuffleBytes(url)))
  vi.stubGlobal('fetch', fetcher)
  await Promise.all([prepareSwfEntry(), prepareSwfEntry(), readSwfRuntime(new AbortController().signal)])
  expect(fetcher).toHaveBeenCalledTimes(5)
  expect(document.querySelector('script[data-arcadia-ruffle]')).toBeNull()
})
