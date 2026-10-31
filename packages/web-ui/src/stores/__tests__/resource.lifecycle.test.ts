import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import { useResourceStore } from '../resource'
const { loadMetadata, load, packRef, workspace } = vi.hoisted(() => ({
  loadMetadata: vi.fn(),
  load: vi.fn(),
  packRef: vi.fn(),
  workspace: vi.fn(),
}))
vi.mock('@arcadia-eternity/pack-loader/native', async importOriginal => ({
  ...(await importOriginal<typeof import('@arcadia-eternity/pack-loader/native')>()),
  NativePackLoader: class {
    loadMetadata = loadMetadata
  },
}))
vi.mock('@arcadia-eternity/data-pack-base/build', () => ({ nativeBuildIdentity: {} }))
vi.mock('@arcadia-eternity/data-pack-base/native', () => ({ createOfficialContent: vi.fn() }))
vi.mock('@/utils/gameLoader', () => ({
  GameDataLoader: class {
    load = load
  },
}))
vi.mock('@/utils/officialAssetUrl', () => ({ officialAssetUrl: (value: string) => value }))
vi.mock('@/utils/packRef', () => ({ resolveRuntimePackRef: packRef, applyRuntimeAssetBase: vi.fn() }))
vi.mock('@/services/packWorkspace', () => ({
  listWorkspacePacks: workspace,
  resolveWorkspaceFileUrl: async (path: string) => `http://localhost/${path}`,
}))
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
  load.mockReset().mockResolvedValue({})
  packRef.mockReset().mockResolvedValue('http://localhost/packs/base/pack.json')
  workspace.mockReset().mockResolvedValue([])
})
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
  expect(load).not.toHaveBeenCalled()
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
it('late workspace initialization cannot commit its layers over a new scope', async () => {
  const pending = deferred<ReturnType<typeof result>>()
  packRef
    .mockResolvedValueOnce('http://localhost/packs/workspace/pack.json')
    .mockResolvedValue('http://localhost/packs/base/pack.json')
  workspace.mockResolvedValue([{ folderName: 'base', id: 'arcadia-eternity.base', enabled: true }])
  loadMetadata.mockReturnValueOnce(pending.promise).mockResolvedValue(result('fresh'))
  const store = useResourceStore(),
    old = store.initialize().catch(error => error)
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledTimes(1))
  store.reset()
  await store.initialize()
  pending.resolve(result('old-workspace'))
  await old
  await Promise.resolve()
  await Promise.resolve()
  expect(store.workspaceRuntime.active).toBe(false)
  expect(store.background.byId.arena).toBe('http://localhost/fresh.png')
})
it('workspace toggles preserve base resources and reuse unchanged layers', async () => {
  const base = { folderName: 'base', id: 'arcadia-eternity.base', enabled: true },
    addon = { folderName: 'addon', id: 'example.addon', enabled: true }
  packRef.mockResolvedValue('http://localhost/packs/workspace/pack.json')
  workspace.mockResolvedValue([base, addon])
  loadMetadata.mockImplementation(async (url: string) => result(url.includes('/addon/') ? 'addon' : 'base'))
  const store = useResourceStore()
  await store.whenReady()
  expect(store.background.byId.arena).toBe('http://localhost/addon.png')
  workspace.mockResolvedValue([base])
  await store.applyWorkspacePackToggle({ folderName: 'addon', enabled: false })
  expect(store.background.byId.arena).toBe('http://localhost/base.png')
  expect(loadMetadata).toHaveBeenCalledTimes(2)
  workspace.mockResolvedValue([base, addon])
  await store.applyWorkspacePackToggle({ folderName: 'addon', enabled: true })
  expect(store.background.byId.arena).toBe('http://localhost/addon.png')
  expect(loadMetadata).toHaveBeenCalledTimes(3)
  expect(load).not.toHaveBeenCalled()
})
it('late workspace toggles cannot replace a reset scope', async () => {
  const base = { folderName: 'base', id: 'arcadia-eternity.base', enabled: true }
  packRef.mockResolvedValue('http://localhost/packs/workspace/pack.json')
  workspace.mockResolvedValue([base])
  const store = useResourceStore()
  await store.initialize()
  const pending = deferred<(typeof base)[]>()
  workspace.mockReturnValueOnce(pending.promise)
  const toggle = store.applyWorkspacePackToggle({ folderName: 'addon', enabled: true })
  store.reset()
  packRef.mockResolvedValue('http://localhost/packs/base/pack.json')
  loadMetadata.mockResolvedValue(result('fresh'))
  await store.initialize()
  pending.resolve([base])
  await toggle
  expect(store.workspaceRuntime.active).toBe(false)
  expect(store.background.byId.arena).toBe('http://localhost/fresh.png')
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
