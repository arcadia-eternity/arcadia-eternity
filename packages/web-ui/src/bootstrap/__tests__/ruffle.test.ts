import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Ruffle bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    document.head.innerHTML = ''
    delete (window as Window & { RufflePlayer?: unknown }).RufflePlayer
  })
  afterEach(() => {
    document.head.innerHTML = ''
    delete (window as Window & { RufflePlayer?: unknown }).RufflePlayer
  })
  it('rejects a loaded script without the player API and allows retry', async () => {
    const { ensureRuffleRuntime } = await import('../ruffle')
    const loading = ensureRuffleRuntime()
    const rejected = expect(loading).rejects.toThrow('Ruffle player API unavailable')
    document.querySelector('script')!.dispatchEvent(new Event('load'))
    await rejected
    expect(document.querySelector('script')).toBeNull()
    expect((window as Window & { RufflePlayer?: unknown }).RufflePlayer).toBeUndefined()
    const retry = ensureRuffleRuntime()
    const runtime = (window as Window & { RufflePlayer?: { newest?: () => unknown } }).RufflePlayer!
    runtime.newest = () => ({})
    document.querySelector('script')!.dispatchEvent(new Event('load'))
    await retry
  })
  it('shares the loading script between callers and configures local assets', async () => {
    const { ensureRuffleRuntime } = await import('../ruffle')
    const first = ensureRuffleRuntime()
    const second = ensureRuffleRuntime()
    expect(document.querySelectorAll('script[data-arcadia-ruffle]')).toHaveLength(1)
    const runtime = (window as Window & { RufflePlayer?: { newest?: () => unknown; config: { publicPath: string } } })
      .RufflePlayer!
    expect(runtime.config.publicPath).toBe('/ruffle/')
    runtime.newest = () => ({})
    document.querySelector('script')!.dispatchEvent(new Event('load'))
    await Promise.all([first, second])
  })
})
