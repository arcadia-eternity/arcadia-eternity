import { ElSelect } from 'element-plus'
import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, ref } from 'vue'
import * as drafts from '../unsavedEnvironment'
import EnvironmentManagerPage from '../EnvironmentManagerPage.vue'
vi.mock('@/bootstrap/deployment', () => ({ getBackendOrigin: () => 'https://paired.example' }))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => ({ currentRoom: null }) }))
const Local = defineComponent({
  props: { selection: String },
  emits: ['catalog'],
  setup(_, { emit }) {
    const draft = ref('')
    drafts.registerEnvironmentDraft(() => !!draft.value)
    emit('catalog', [{ id: 'friends', key: 'local/friends', name: '好友环境', source: '本机', editable: true }])
    return { draft }
  },
  template: '<input v-if="selection !== null" v-model="draft" aria-label="本机草稿" />',
})
const Remote = defineComponent({
  props: ['target', 'selection'],
  emits: ['catalog'],
  setup(_, { emit }) {
    emit('catalog', [
      { id: 'friends', key: 'publication', name: '联机好友', source: '服务器' },
      { id: 'another', key: 'other-publication', name: '好友环境', source: '服务器' },
    ])
  },
  template: '<div v-if="selection !== null" data-remote :data-selection="selection">{{ target }}</div>',
})
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
it('opens old host links in the same local library', async () => {
  vi.stubGlobal('arcadiaDesktop', { localEnvironment: vi.fn(), managementRequest: vi.fn() })
  const { page } = await open('/environments?target=host')
  expect(page.find('[data-remote]').exists()).toBe(false)
  expect(page.find('[aria-label="本机草稿"]').exists()).toBe(true)
})
it.each(['local', 'host'])('keeps a %s bookmark unprivileged in a browser', async target => {
  vi.stubGlobal('arcadiaDesktop', undefined)
  const { page } = await open(`/environments?target=${target}`)
  expect(page.get('[data-remote]').text()).toBe('server')
  expect(page.find('option[value=local]').exists()).toBe(false)
})

it('lists a logical ID once across locations and opens an editable detail directly and guards navigation while editing', async () => {
  vi.stubGlobal('arcadiaDesktop', { localEnvironment: vi.fn() })
  const { page } = await open('/environments')
  await flushPromises()
  const groups = page.get('nav[aria-label="选择环境"]').findAll('button')
  expect(groups).toHaveLength(2)
  expect(groups[0]!.text()).toBe('好友环境')
  expect(page.find('[aria-label="环境来源"]').exists()).toBe(false)
  await page.get('[aria-label="本机草稿"]').setValue('本机修改')
  const other = groups[1]!
  const confirm = vi.spyOn(drafts, 'discardEnvironmentChanges').mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  try {
    await other.trigger('click')
    await flushPromises()
    expect((page.get('[aria-label="本机草稿"]').element as HTMLInputElement).value).toBe('本机修改')
    await other.trigger('click')
    await flushPromises()
    expect(page.get('[data-remote]').attributes('data-selection')).toBe('other-publication')
    expect(page.find('[aria-label="本机草稿"]').exists()).toBe(false)
  } finally {
    confirm.mockRestore()
  }
})

it('automatically uses a remaining same-ID location when the viewed catalog entry disappears', async () => {
  vi.stubGlobal('arcadiaDesktop', { localEnvironment: vi.fn() })
  const { page } = await open('/environments')
  await flushPromises()
  await page.get('[aria-label="本机草稿"]').setValue('保留修改')
  page.getComponent(Local).vm.$emit('catalog', [])
  await flushPromises()
  expect((page.get('[aria-label="本机草稿"]').element as HTMLInputElement).value).toBe('保留修改')
  await page.get('[aria-label="本机草稿"]').setValue('')
  await flushPromises()
  expect(page.get('[data-remote]').attributes('data-selection')).toBe('publication')
  expect(page.find('[aria-label="环境来源"]').exists()).toBe(false)
})
