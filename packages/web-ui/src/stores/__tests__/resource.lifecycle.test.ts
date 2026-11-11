import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useResourceStore } from '../resource'
const { loadMetadata, packRef, localContent } = vi.hoisted(() => ({
  loadMetadata: vi.fn(),
  packRef: vi.fn(),
  localContent: vi.fn(),
}))
vi.mock('@arcadia-eternity/pack-loader/native', async importOriginal => ({
  ...(await importOriginal<typeof import('@arcadia-eternity/pack-loader/native')>()),
  PackMetadataLoader: class {
    loadMetadata = loadMetadata
  },
}))
vi.mock('@/utils/officialAssetUrl', () => ({ officialAssetUrl: (value: string) => value }))
vi.mock('@/utils/packRef', () => ({ resolveRuntimePackRef: packRef, applyRuntimeAssetBase: vi.fn() }))
vi.mock('@/services/localContent', () => ({ acquireLocalContent: localContent }))
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const result = (name: string) => ({
  presentation: [
    {
      version: 2,
      bindings: [],
      defaultLocale: 'zh-CN',
      locales: {},
      resources: [{ id: 'arena', kind: 'http', source: `http://localhost/${name}.png`, tags: ['background'] }],
    },
  ],
})
beforeEach(() => {
  setActivePinia(createPinia())
  loadMetadata.mockReset().mockResolvedValue(result('base'))
  packRef.mockReset().mockResolvedValue('http://localhost/packs/base/pack.json')
  localContent.mockReset()
})
afterEach(() => vi.unstubAllGlobals())
it('shares pending metadata without requesting retired resource mapping files', async () => {
  const pending = deferred<ReturnType<typeof result>>()
  loadMetadata.mockReturnValue(pending.promise)
  const store = useResourceStore(),
    first = store.initialize(),
    second = store.initialize()
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalled())
  pending.resolve(result('shared'))
  await Promise.all([first, second])
  expect(loadMetadata).toHaveBeenCalledTimes(1)
})
it('late metadata success cannot replace resources loaded after reset', async () => {
  const pending = deferred<ReturnType<typeof result>>()
  loadMetadata.mockReturnValueOnce(pending.promise).mockResolvedValue(result('fresh'))
  const store = useResourceStore(),
    old = store.initialize().catch(error => error)
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledTimes(1))
  store.reset()
  await store.initialize()
  pending.resolve(result('old'))
  await old
  expect(store.background.byId.arena).toBe('http://localhost/fresh.png')
  expect(store.loaded).toBe(true)
})
it('late metadata failure cannot poison the new successful scope', async () => {
  const pending = deferred<ReturnType<typeof result>>()
  loadMetadata.mockReturnValueOnce(pending.promise).mockResolvedValue(result('fresh'))
  const store = useResourceStore(),
    old = store.initialize().catch(error => error)
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledTimes(1))
  store.reset()
  await store.initialize()
  pending.reject(new Error('old failure'))
  await old
  expect(store.error).toBeNull()
  expect(store.loaded).toBe(true)
})

it('whenReady consumers follow forceReload without waiting for the cancelled loader', async () => {
  const pending = deferred<ReturnType<typeof result>>()
  loadMetadata.mockReturnValueOnce(pending.promise).mockResolvedValue(result('fresh'))
  const store = useResourceStore(),
    consumer = store.whenReady()
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledTimes(1))
  await store.initialize({ forceReload: true })
  await consumer
  expect(store.background.byId.arena).toBe('http://localhost/fresh.png')
  expect(loadMetadata).toHaveBeenCalledTimes(2)
  pending.resolve(result('old'))
  await Promise.resolve()
  expect(store.background.byId.arena).toBe('http://localhost/fresh.png')
})
it('reset promptly rejects old owners and late pack resolution cannot start stale metadata loads', async () => {
  const pending = deferred<string>()
  packRef.mockReturnValueOnce(pending.promise)
  const store = useResourceStore(),
    owner = store.initialize().catch(error => error)
  await vi.waitFor(() => expect(packRef).toHaveBeenCalledTimes(1))
  store.reset()
  expect((await owner).name).toBe('AbortError')
  await store.whenReady()
  pending.resolve('http://localhost/stale/pack.json')
  await Promise.resolve()
  await Promise.resolve()
  expect(loadMetadata).toHaveBeenCalledTimes(1)
  expect(store.markImage.byId.stale).toBeUndefined()
})
it('a current failure is shared and a subsequent consumer can retry', async () => {
  loadMetadata.mockRejectedValueOnce(new Error('current failure')).mockResolvedValue(result('retried'))
  const store = useResourceStore()
  const failures = await Promise.allSettled([store.initialize(), store.initialize()])
  expect(failures.every(value => value.status === 'rejected')).toBe(true)
  expect(loadMetadata).toHaveBeenCalledTimes(1)
  expect(store.loaded).toBe(false)
  expect(store.error).toBe('current failure')
  await store.whenReady()
  expect(store.loaded).toBe(true)
  expect(store.error).toBeNull()
  expect(store.background.byId.arena).toBe('http://localhost/retried.png')
})
it('a current loader AbortError propagates once and only an explicit retry reloads', async () => {
  const aborted = new DOMException('Current request aborted', 'AbortError')
  loadMetadata.mockRejectedValueOnce(aborted).mockResolvedValue(result('retried'))
  const store = useResourceStore()
  await expect(store.whenReady()).rejects.toBe(aborted)
  expect(loadMetadata).toHaveBeenCalledTimes(1)
  expect(store.loaded).toBe(false)
  expect(store.error).not.toBeNull()
  await store.whenReady()
  expect(loadMetadata).toHaveBeenCalledTimes(2)
  expect(store.background.byId.arena).toBe('http://localhost/retried.png')
})

it('desktop resources come from the prepared content session instead of the legacy base pack', async () => {
  const release = vi.fn(async () => {})
  localContent.mockResolvedValue({
    content: { species: [], skills: [], marks: [] },
    resources: [
      { kind: 'http', id: 'bg:prepared', source: 'http://localhost/prepared.png', tags: ['background'] },
      { kind: 'http', id: 'example-slow:theme', source: 'http://localhost/theme.mp3', tags: ['music'] },
    ],
    release,
  })
  vi.stubGlobal('window', { arcadiaDesktop: {} })
  const store = useResourceStore()
  await store.initialize()
  expect(store.background.byId['bg:prepared']).toBe('http://localhost/prepared.png')
  expect(store.music.byId['example-slow:theme']).toBe('http://localhost/theme.mp3')
  expect(localContent).toHaveBeenCalledOnce()
  expect(packRef).not.toHaveBeenCalled()
  expect(loadMetadata).not.toHaveBeenCalled()
  await store.reload()
  expect(release).toHaveBeenCalledOnce()
  store.reset()
})
