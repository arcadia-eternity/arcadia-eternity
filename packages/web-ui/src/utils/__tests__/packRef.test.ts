import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invalidateRuntimePackRefCache, resolveRuntimePackRef } from '../packRef'

const desktop = vi.hoisted(() => ({ getLocalServerPort: vi.fn(), listWorkspacePacks: vi.fn() }))
vi.mock('@/utils/env', () => ({ isDesktop: true, getDesktopApi: () => desktop }))
beforeEach(() => {
  invalidateRuntimePackRefCache()
  vi.stubEnv('VITE_PACK_REF', '')
  desktop.getLocalServerPort.mockResolvedValue(12345)
  desktop.listWorkspacePacks.mockResolvedValue([
    {
      id: 'arcadia-eternity.base',
      folderName: 'base-1',
      manifestPath: 'base-1/dist/pack.json',
      enabled: true,
    },
    { id: 'custom', folderName: 'custom', enabled: true },
  ])
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('never resolves the desktop workspace base for content reads', async () => {
  expect(await resolveRuntimePackRef()).toBe('/pack.json')
  expect(desktop.getLocalServerPort).not.toHaveBeenCalled()
  expect(desktop.listWorkspacePacks).not.toHaveBeenCalled()
})

it('explicit pack configuration takes precedence', async () => {
  vi.stubEnv('VITE_PACK_REF', '/test/pack.json')
  expect(await resolveRuntimePackRef()).toBe('/test/pack.json')
  expect(desktop.listWorkspacePacks).not.toHaveBeenCalled()
})

it('defaults to the application base and busts an explicitly refreshed resolution', async () => {
  expect(await resolveRuntimePackRef()).toBe('/pack.json')
  expect(await resolveRuntimePackRef({ forceRefresh: true })).toMatch(/\/pack\.json\?__ae_pack_ts=\d+$/)
  expect(await resolveRuntimePackRef()).toBe('/pack.json')
})
