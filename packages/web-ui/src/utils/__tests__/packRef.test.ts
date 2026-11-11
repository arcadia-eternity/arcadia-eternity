import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { invalidateRuntimePackRefCache, resolveRuntimePackRef } from '../packRef'

beforeEach(() => {
  invalidateRuntimePackRefCache()
  vi.stubEnv('VITE_PACK_REF', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('defaults to the application base', async () => {
  expect(await resolveRuntimePackRef()).toBe('/pack.json')
})

it('explicit pack configuration takes precedence', async () => {
  vi.stubEnv('VITE_PACK_REF', '/test/pack.json')
  expect(await resolveRuntimePackRef()).toBe('/test/pack.json')
})

it('defaults to the application base and busts an explicitly refreshed resolution', async () => {
  expect(await resolveRuntimePackRef()).toBe('/pack.json')
  expect(await resolveRuntimePackRef({ forceRefresh: true })).toMatch(/\/pack\.json\?__ae_pack_ts=\d+$/)
  expect(await resolveRuntimePackRef()).toBe('/pack.json')
})
