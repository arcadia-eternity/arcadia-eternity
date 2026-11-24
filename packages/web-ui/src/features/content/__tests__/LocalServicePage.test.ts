import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import LocalServicePage from '../LocalServicePage.vue'
afterEach(() => vi.unstubAllGlobals())
it('keeps project tools separate and directs ordinary hosting to Servers', async () => {
  const start = vi.fn()
  vi.stubGlobal('arcadiaDesktop', {
    listContentProjects: async () => [{ id: 'sample', name: '示例项目' }],
    addContentProject: async () => 'sample',
    localServer: start,
  })
  const page = mount(LocalServicePage, {
    global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
  })
  await flushPromises()
  expect(page.get('a[href="/servers"]').text()).toBe('服务器列表')
  const register = page.findAll('button').find(button => button.text() === '登记项目目录')
  expect(register).toBeDefined()
  await register!.trigger('click')
  await flushPromises()
  expect(page.text()).toContain('校验项目')
  expect(page.text()).not.toContain('使用此项目托管联机对战')
  expect(start).not.toHaveBeenCalled()
  page.unmount()
})
