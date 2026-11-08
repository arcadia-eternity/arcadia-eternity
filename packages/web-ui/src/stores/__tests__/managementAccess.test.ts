import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useManagementAccessStore } from '../managementAccess'
import { rememberManagementDiscovery } from '@/services/managementSession'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})
describe('management navigation discovery', () => {
  it('does not contact any server for an anonymous offline player', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
    await useManagementAccessStore().check('https://offline.example')
    expect(fetcher).not.toHaveBeenCalled()
    expect(useManagementAccessStore().allowed).toBe(false)
    fetcher.mockRestore()
  })
  it('does not treat a forged local discovery hint as management permission', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'MANAGEMENT_UNAUTHENTICATED' } }), { status: 401 }),
      )
    rememberManagementDiscovery('https://forged.example')
    await useManagementAccessStore().check('https://forged.example')
    expect(fetcher).toHaveBeenCalled()
    expect(useManagementAccessStore().allowed).toBe(false)
    fetcher.mockRestore()
  })
})
