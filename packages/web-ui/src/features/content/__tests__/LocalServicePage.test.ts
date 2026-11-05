import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import LocalServicePage from '../LocalServicePage.vue'
afterEach(() => vi.unstubAllGlobals())
it('keeps project tools separate and directs ordinary hosting to Servers', async () => {
  const start = vi.fn()
  vi.stubGlobal('arcadiaDesktop', {
    listContentPackages: async () => ({ packages: [], activeIds: [] }),
    listContentProjects: async () => [],
    getLocalBattleStatus: async () => ({ status: 'idle' }),
    localServer: start,
  })
  const page = mount(LocalServicePage, { global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } } })
  await flushPromises()
  expect(page.text()).toContain('开服、连接地址与服务器设置已移至')
  expect(page.text()).toContain('登记项目目录')
  expect(start).not.toHaveBeenCalled()
  page.unmount()
})
