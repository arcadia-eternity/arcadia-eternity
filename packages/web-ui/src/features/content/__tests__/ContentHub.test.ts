import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { defineComponent, ref } from 'vue'
import * as drafts from '../unsavedEnvironment'
import EnvironmentManagerPage from '../EnvironmentManagerPage.vue'
vi.mock('@/bootstrap/deployment', () => ({ getBackendOrigin: () => 'https://paired.example' }))
const { roomStore } = vi.hoisted(() => ({
  roomStore: {
    currentRoom: null as {
      environment: { id: string; environmentId: string; environmentName: string; environmentVersion?: string }
    } | null,
  },
}))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => roomStore }))
const Local = defineComponent({
  props: { selection: String },
  emits: ['catalog'],
  setup(_, { emit }) {
    const draft = ref('')
    drafts.registerEnvironmentDraft(() => !!draft.value)
    emit('catalog', [
      {
        id: 'friends',
        environmentVersion: 'shared-version',
        key: 'local/friends',
        name: '好友环境',
        source: '本机',
        editable: true,
      },
    ])
    return { draft }
  },
  template: '<input v-if="selection !== null" v-model="draft" aria-label="本机草稿" />',
})
const Remote = defineComponent({
  props: ['target', 'selection'],
  emits: ['catalog'],
  setup(_, { emit }) {
    emit('catalog', [
      { id: 'friends', environmentVersion: 'shared-version', key: 'publication', name: '联机好友', source: '服务器' },
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
  roomStore.currentRoom = null
  vi.unstubAllGlobals()
})
it.each(['local', 'host', 'web', 'server', 'all'])(
  'shows the full merged directory for a %s bookmark',
  async target => {
    vi.stubGlobal('arcadiaDesktop', { localEnvironment: vi.fn() })
    const { page } = await open(`/environments?target=${target}`)
    await flushPromises()
    const rows = page.get('nav[aria-label="选择环境"]').findAll('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('本机 · 服务器')
    expect(rows[1]!.text()).toContain('服务器')
    expect(page.find('[aria-label="环境位置"]').exists()).toBe(false)
    if (target === 'server') expect(page.get('[data-remote]').attributes('data-selection')).toBe('publication')
  },
)
it.each(['local', 'host'])('keeps a %s bookmark unprivileged in a browser', async target => {
  vi.stubGlobal('arcadiaDesktop', undefined)
  const { page } = await open(`/environments?target=${target}`)
  expect(page.get('[data-remote]').text()).toBe('server')
  expect(page.find('option[value=local]').exists()).toBe(false)
})

it('lists an applied version once across locations and opens an editable detail directly and guards navigation while editing', async () => {
  vi.stubGlobal('arcadiaDesktop', { localEnvironment: vi.fn() })
  const { page } = await open('/environments')
  await flushPromises()
  const groups = page.get('nav[aria-label="选择环境"]').findAll('button')
  expect(groups).toHaveLength(2)
  expect(groups[0]!.get('strong').text()).toBe('好友环境')
  expect(groups[0]!.text()).toContain('本机 · 服务器')
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

it('keeps every distinct origin on the same row, including a shared host workspace and a room publication', async () => {
  vi.stubGlobal('arcadiaDesktop', { localEnvironment: vi.fn() })
  roomStore.currentRoom = {
    environment: {
      id: 'room-revision',
      environmentId: 'friends',
      environmentName: '房间好友环境',
      environmentVersion: 'shared-version',
    },
  }
  const { page } = await open('/environments')
  page.getComponent(Local).vm.$emit('catalog', [
    {
      id: 'friends',
      environmentVersion: 'shared-version',
      key: 'local/friends',
      name: '好友环境',
      source: '本机',
      sources: ['本机', '本机服务器'],
      editable: true,
    },
  ])
  await flushPromises()
  const rows = page.get('nav[aria-label="选择环境"]').findAll('button')
  expect(rows.map(row => row.get('strong').text())).toEqual(['好友环境', '好友环境'])
  expect(rows[0]!.text()).toContain('本机 · 本机服务器 · 服务器 · 当前房间')
  expect(rows[1]!.get('small').text()).toBe('服务器')
})

it('automatically uses a remaining same-version location when the viewed catalog entry disappears', async () => {
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

it('separates same-ID revisions, including an unknown revision, and selects each independently', async () => {
  vi.stubGlobal('arcadiaDesktop', { localEnvironment: vi.fn() })
  const { page } = await open('/environments')
  page.getComponent(Remote).vm.$emit('catalog', [
    { id: 'alias', environmentVersion: 'shared-version', key: 'copy', name: '相同副本', source: '服务器' },
    { id: 'friends', environmentVersion: 'new-version', key: 'new', name: '更新版本', source: '服务器' },
    { id: 'friends', key: 'legacy', name: '旧版来源', source: '服务器' },
  ])
  await flushPromises()
  const rows = page.get('nav').findAll('button')
  expect(rows).toHaveLength(3)
  expect(rows[0]!.text()).toContain('本机 · 服务器')
  for (const [index, key] of [
    [1, 'new'],
    [2, 'legacy'],
  ] as const) {
    await rows[index]!.trigger('click')
    await flushPromises()
    expect(page.get('[data-remote]').attributes('data-selection')).toBe(key)
    expect(page.get('nav').findAll('[aria-current=true]')).toHaveLength(1)
  }
})
