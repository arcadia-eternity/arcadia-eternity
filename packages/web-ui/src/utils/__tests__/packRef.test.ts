import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invalidateRuntimePackRefCache, resolveBasePackRef, resolveRuntimePackRef } from '../packRef'

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

it('fresh desktops use the original base manifest with its lockfile for both creation and battle', async () => {
  const base = 'http://127.0.0.1:12345/packs/base/pack.json'
  expect(await resolveBasePackRef()).toBe(base)
  expect(await resolveRuntimePackRef()).toBe(base)
})

it('creator base stays separate from workspace overlays and uses the registered base folder', async () => {
  desktop.listWorkspacePacks.mockResolvedValue([
    { id: 'arcadia-eternity.base', folderName: 'base-1', enabled: true },
    { id: 'custom', folderName: 'custom', enabled: true },
  ])
  expect(await resolveRuntimePackRef()).toBe('http://127.0.0.1:12345/packs/workspace/pack.json')
  expect(await resolveBasePackRef()).toBe('http://127.0.0.1:12345/packs/base-1/pack.json')
})

it('ordinary battles preserve registered workspace layering even when only the base is enabled', async () => {
  desktop.listWorkspacePacks.mockResolvedValue([
    { id: 'arcadia-eternity.base', folderName: 'base-1', enabled: true },
    { id: 'custom', folderName: 'custom', enabled: false },
  ])
  expect(await resolveRuntimePackRef()).toBe('http://127.0.0.1:12345/packs/workspace/pack.json')
  expect(await resolveBasePackRef()).toBe('http://127.0.0.1:12345/packs/base-1/pack.json')
})

it('explicit pack configuration takes precedence for both paths', async () => {
  vi.stubEnv('VITE_PACK_REF', '/test/pack.json')
  expect(await resolveBasePackRef()).toBe('/test/pack.json')
  expect(await resolveRuntimePackRef()).toBe('/test/pack.json')
})

it('uses the application base when the desktop asset server is unavailable', async () => {
  desktop.getLocalServerPort.mockResolvedValue(null)
  expect(await resolveBasePackRef()).toBe('/pack.json')
  expect(await resolveRuntimePackRef()).toBe('/pack.json')
})
