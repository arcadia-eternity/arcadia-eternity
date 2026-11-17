import { ElSelect } from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent } from 'vue'
import EnvironmentManagerPage from '../EnvironmentManagerPage.vue'
vi.mock('@/bootstrap/deployment', () => ({ getBackendOrigin: () => 'https://paired.example' }))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => ({ currentRoom: null }) }))
const Local = defineComponent({ template: '<input aria-label="本机草稿" />' })
const Remote = defineComponent({ props: ['target'], template: '<div data-remote>{{ target }}</div>' })
const Packages = defineComponent({ props: ['location'], template: '<div data-packages>{{ location }}</div>' })
const pages: ReturnType<typeof mount>[] = []
async function open(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/environments', component: EnvironmentManagerPage }],
  })
  await router.push(path)
  await router.isReady()
  const page = mount(EnvironmentManagerPage, {
    global: {
      plugins: [router],
      stubs: { LocalEnvironmentPage: Local, ServerEnvironmentPanel: Remote, ContentPackagesPanel: Packages },
    },
  })
  pages.push(page)
  return { page, router }
}
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.unstubAllGlobals()
})
it('switches explicit locations and discards the previous local draft', async () => {
  vi.stubGlobal('arcadiaDesktop', { localEnvironment: vi.fn() })
  const { page, router } = await open('/environments?target=local')
  await page.get('[aria-label="本机草稿"]').setValue('unsaved')
  page.getComponent(ElSelect).vm.$emit('change', 'server')
  await flushPromises()
  expect(router.currentRoute.value.query).toEqual({ target: 'server' })
  expect(page.get('[data-remote]').text()).toBe('server')
  expect(page.find('[aria-label="本机草稿"]').exists()).toBe(false)
  page.getComponent(ElSelect).vm.$emit('change', 'local')
  await flushPromises()
  expect((page.get('[aria-label="本机草稿"]').element as HTMLInputElement).value).toBe('')
})
it('keeps an explicit server target remote even when a local bridge is available', async () => {
  const local = vi.fn()
  vi.stubGlobal('arcadiaDesktop', { localEnvironment: local })
  const { page } = await open('/environments?target=server')
  expect(page.get('[data-remote]').text()).toBe('server')
  expect(local).not.toHaveBeenCalled()
})
it('does not turn a local bookmark into local privileges in a browser', async () => {
  vi.stubGlobal('arcadiaDesktop', undefined)
  const { page } = await open('/environments?target=local')
  expect(page.get('[data-remote]').text()).toBe('server')
  expect(page.find('option[value=local]').exists()).toBe(false)
})
