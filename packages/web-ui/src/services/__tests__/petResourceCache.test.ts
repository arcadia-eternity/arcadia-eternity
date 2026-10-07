import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/utils/env', () => ({ getDesktopApi: () => null, isDesktop: false }))
import { PetResourceCache } from '../petResourceCache'

afterEach(() => vi.unstubAllGlobals())
describe('pet resource prefetch', () => {
  it('shares a pending request and does not label an opaque response verified', async () => {
    let finish!: (value: unknown) => void
    const fetch = vi.fn(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const cache = new PetResourceCache()
    const first = cache.preloadPetSwf(6)
    let secondDone = false
    const second = cache.preloadPetSwf(6).then(() => {
      secondDone = true
    })
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(secondDone).toBe(false)
    finish({ type: 'opaque' })
    await Promise.all([first, second])
    expect(secondDone).toBe(true)
    expect(cache.isCached(6)).toBe(false)
  })
  it('retries a failed custom URL and rejects empty resources', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ type: 'basic', ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
      .mockResolvedValue({ type: 'basic', ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
    vi.stubGlobal('fetch', fetch)
    const cache = new PetResourceCache()
    await expect(cache.preloadUrl('/custom.swf')).rejects.toThrow('offline')
    await expect(cache.preloadUrl('/custom.swf')).rejects.toThrow('资源为空')
    await cache.preloadUrl('/custom.swf')
    await cache.preloadUrl('/custom.swf')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
