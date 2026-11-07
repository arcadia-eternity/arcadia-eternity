import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invalidateRuntimePackRefCache, resolveRuntimePackRef } from '../packRef'

const desktop = vi.hoisted(() => ({ getLocalServerPort: vi.fn(), listWorkspacePacks: vi.fn() }))
vi.mock('@/utils/env', () => ({ isDesktop: true, getDesktopApi: () => desktop }))
beforeEach(() => {
  invalidateRuntimePackRefCache()
  vi.stubEnv('VITE_PACK_REF', '')
  desktop.getLocalServerPort.mockResolvedValue(12345)
  desktop.listWorkspacePacks.mockResolvedValue([])
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true })),
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('resolves the base manifest when the workspace has no enabled layers', async () => {
  const base = 'http://127.0.0.1:12345/packs/base/pack.json'
  expect(await resolveRuntimePackRef()).toBe(base)
})

it('resolves the workspace manifest when layers are enabled', async () => {
  desktop.listWorkspacePacks.mockResolvedValue([
    { id: 'arcadia-eternity.base', folderName: 'base-1', enabled: true },
    { id: 'custom', folderName: 'custom', enabled: true },
  ])
  expect(await resolveRuntimePackRef()).toBe('http://127.0.0.1:12345/packs/workspace/pack.json')
})

it('ordinary battles preserve registered workspace layering even when only the base is enabled', async () => {
  desktop.listWorkspacePacks.mockResolvedValue([
    { id: 'arcadia-eternity.base', folderName: 'base-1', enabled: true },
    { id: 'custom', folderName: 'custom', enabled: false },
  ])
  expect(await resolveRuntimePackRef()).toBe('http://127.0.0.1:12345/packs/workspace/pack.json')
})

it('explicit pack configuration takes precedence', async () => {
  vi.stubEnv('VITE_PACK_REF', '/test/pack.json')
  expect(await resolveRuntimePackRef()).toBe('/test/pack.json')
})

it('uses the application base when the desktop asset server is unavailable', async () => {
  desktop.getLocalServerPort.mockResolvedValue(null)
  expect(await resolveRuntimePackRef()).toBe('/pack.json')
})
