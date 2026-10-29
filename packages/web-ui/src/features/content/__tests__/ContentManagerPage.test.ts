import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import ContentManagerPage from '../ContentManagerPage.vue'
import type { ContentLibrarySnapshot, InstalledContentPackage, ContentPackageAction } from '@/types/contentPackages'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
const battle = reactive({ serverUrl: 'http://server-a' })
const rooms = reactive<{
  currentRoom: { config: { roomCode: string }; environment: ReturnType<typeof environment> } | null
}>({ currentRoom: null })
const pets = reactive({
  teams: [
    {
      name: '收藏队伍',
      pets: [
        { id: 'pet', name: '自定义精灵', species: 'custom:pet', skills: ['custom:skill'], ability: 'custom:ability' },
      ],
    },
  ],
})
const gameData = {
  loaded: true,
  serverFallback: null,
  species: { allIds: [], byId: {} },
  skills: { allIds: [], byId: {} },
  marks: { allIds: [], byId: {} },
}
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => battle }))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => rooms }))
vi.mock('@/stores/petStorage', () => ({ usePetStorageStore: () => pets }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => gameData }))
vi.mock('@/services/serverEnvironment', () => ({ readServerEnvironmentContent: read }))
const environment = (id: string) => ({
  id,
  packages: [{ projectId: 'custom', name: '@test/custom', version: '1.0.0', namespace: 'custom' }],
})
const content = { species: [{ id: 'custom:pet' }], skills: [{ id: 'custom:skill' }], marks: [{ id: 'custom:ability' }] }
const pkg: InstalledContentPackage = {
  id: 'package',
  name: '@test/custom',
  title: '创作内容',
  version: '1.0.0',
  namespace: 'custom',
  projectId: 'custom',
  author: '作者',
  description: '说明',
  source: { kind: 'file', label: 'custom.tgz', file: 'content-0.tgz' },
  contentIds: { species: ['custom:pet'], skills: ['custom:skill'], marks: ['custom:ability'] },
  graph: [
    { name: '@test/custom', version: '1.0.0', dependencies: { library: '2.0.0' } },
    { name: 'library', version: '2.0.0', dependencies: {} },
  ],
  counts: { species: 1, skills: 1, marks: 1 },
  containsCode: true,
  installedAt: '2026-10-29T00:00:00Z',
}
let pages: ReturnType<typeof mount>[] = []
const open = () => {
  const page = mount(ContentManagerPage)
  pages.push(page)
  return page
}
const button = (page: ReturnType<typeof mount>, name: string) =>
  page.findAll('button').find(item => item.text() === name)!
const pickPackage = async (page: ReturnType<typeof mount>) => {
  await page.findAll('.package-select')[1].trigger('click')
}
function bridge(active = false) {
  const snapshot: ContentLibrarySnapshot = {
    revision: 1,
    packages: [structuredClone(pkg)],
    activeIds: active ? [pkg.id] : [],
    desiredIds: active ? [pkg.id] : [],
    selection: { status: active ? 'ready' : 'idle' },
    hasSelection: active,
    serviceStatus: { status: 'idle' },
    serviceNeedsRestart: false,
  }
  const action = vi.fn(async (input: ContentPackageAction) => {
    if (input.action === 'set-selection') {
      snapshot.desiredIds = [...input.ids]
      snapshot.selection = { status: 'preparing' }
    }
  })
  const install = vi.fn(async () => {
    snapshot.desiredIds = [pkg.id]
    snapshot.selection = { status: 'preparing' }
    return pkg.id
  })
  vi.stubGlobal('arcadiaDesktop', {
    listContentPackages: async () => structuredClone(snapshot),
    contentPackageAction: action,
    installContentPackageFile: install,
    installNpmContentPackage: install,
  })
  return { snapshot, action, install }
}
beforeEach(() => {
  read.mockReset().mockResolvedValue(content)
  battle.serverUrl = 'http://server-a'
  rooms.currentRoom = null
  vi.stubGlobal('arcadiaDesktop', undefined)
})
afterEach(() => {
  pages.forEach(page => page.unmount())
  pages = []
  vi.unstubAllGlobals()
})
it('shows only the current room packages in the browser and never changes saved team references', async () => {
  rooms.currentRoom = { config: { roomCode: 'ROOM' }, environment: environment('a'.repeat(64)) }
  const before = JSON.stringify(pets.teams)
  const page = open()
  await flushPromises()
  await pickPackage(page)
  await button(page, '队伍影响').trigger('click')
  expect(page.text()).toContain('内容引用齐全')
  expect(page.text()).toContain('收藏队伍')
  expect(page.get('.scope').text()).toBe('只读')
  expect(button(page, '添加内容包')).toBeUndefined()
  expect(page.find('input[type=checkbox]').exists()).toBe(false)
  expect(read).toHaveBeenCalledWith('http://server-a', 'a'.repeat(64), expect.any(Function), expect.any(AbortSignal))
  expect(JSON.stringify(pets.teams)).toBe(before)
})
it('shows the built-in fallback with no selected room rather than aggregating server catalogues', async () => {
  const page = open()
  await flushPromises()
  expect(page.text()).toContain('尚未进入房间')
  expect(page.findAll('.package-row')).toHaveLength(1)
  expect(read).not.toHaveBeenCalled()
})
it('discards stale room content when the connection changes', async () => {
  rooms.currentRoom = { config: { roomCode: 'ROOM' }, environment: environment('a'.repeat(64)) }
  let resolveOld!: (value: unknown) => void
  read.mockImplementation(server =>
    server === 'http://server-a'
      ? new Promise(resolve => {
          resolveOld = resolve
        })
      : Promise.resolve({ species: [], skills: [], marks: [] }),
  )
  const page = open()
  await flushPromises()
  battle.serverUrl = 'http://server-b'
  await flushPromises()
  resolveOld(content)
  await flushPromises()
  await pickPackage(page)
  await button(page, '队伍影响').trigger('click')
  expect(page.text()).not.toContain('内容引用齐全')
  expect(page.text()).toContain('暂无队伍引用')
})
it('does not claim teams are compatible when room content cannot be read', async () => {
  rooms.currentRoom = { config: { roomCode: 'ROOM' }, environment: environment('a'.repeat(64)) }
  read.mockRejectedValue(new Error('内容暂不可用'))
  const page = open()
  await flushPromises()
  await pickPackage(page)
  await button(page, '队伍影响').trigger('click')
  expect(page.text()).toContain('暂时无法检查队伍引用')
  expect(page.text()).not.toContain('暂无队伍引用')
})
it('sends the desired state as soon as a checkbox changes, without apply or confirmation controls', async () => {
  const { action } = bridge(true)
  const before = JSON.stringify(pets.teams)
  const page = open()
  await flushPromises()
  await pickPackage(page)
  await page.get('input[aria-label="启用 创作内容"]').setValue(false)
  await flushPromises()
  expect(action).toHaveBeenCalledWith({ action: 'set-selection', ids: [], offline: false })
  expect(page.find('[role=dialog]').exists()).toBe(false)
  expect(button(page, '检查并应用更改')).toBeUndefined()
  expect(page.text()).toContain('正在准备所选内容')
  await button(page, '队伍影响').trigger('click')
  expect(page.text()).toContain('custom:pet')
  expect(JSON.stringify(pets.teams)).toBe(before)
})
it('keeps rapid checkbox changes responsive and does not restore an older response', async () => {
  const { snapshot, action } = bridge()
  let finish!: () => void
  const original = action.getMockImplementation()!
  action.mockImplementation(async input => {
    await original(input)
    if (input.action === 'set-selection' && input.ids.length)
      await new Promise<void>(resolve => {
        finish = resolve
      })
  })
  const page = open()
  await flushPromises()
  const checkbox = page.get('input[aria-label="启用 创作内容"]')
  await checkbox.setValue(true)
  await flushPromises()
  expect(checkbox.attributes('disabled')).toBeUndefined()
  await checkbox.setValue(false)
  await flushPromises()
  finish()
  await flushPromises()
  expect(snapshot.desiredIds).toEqual([])
  expect((checkbox.element as HTMLInputElement).checked).toBe(false)
  expect(action.mock.calls.map(([input]) => (input.action === 'set-selection' ? input.ids : null))).toEqual([
    ['package'],
    [],
  ])
})
it('installs and enables from the source dialog without a second confirmation', async () => {
  const { install, action } = bridge()
  const page = open()
  await flushPromises()
  await button(page, '添加内容包').trigger('click')
  expect(page.get('[role=dialog]').text()).toContain('内容包及其依赖将在本机运行')
  await button(page, '安装本地 .tgz 文件').trigger('click')
  await flushPromises()
  expect(install).toHaveBeenCalledWith({ offline: false })
  expect(action).not.toHaveBeenCalled()
  expect(page.find('[role=dialog]').exists()).toBe(false)
  expect((page.get('input[aria-label="启用 创作内容"]').element as HTMLInputElement).checked).toBe(true)
})
it('shows a failed desired selection and retries it while retaining the old available content', async () => {
  const { snapshot, action } = bridge(true)
  snapshot.desiredIds = []
  snapshot.selection = { status: 'failed', message: '内容冲突' }
  const page = open()
  await flushPromises()
  expect(page.text()).toContain('未能启用所选内容，原有内容仍可用')
  expect(page.text()).toContain('内容冲突')
  await button(page, '重试准备').trigger('click')
  await flushPromises()
  expect(action).toHaveBeenCalledWith({ action: 'set-selection', ids: [], offline: false })
  expect(snapshot.activeIds).toEqual(['package'])
  expect(page.find('[role=dialog]').exists()).toBe(false)
})
it('lets an accepted desired selection continue after leaving the page', async () => {
  const { action, snapshot } = bridge(true)
  let finish!: () => void
  const original = action.getMockImplementation()!
  action.mockImplementation(async input => {
    await original(input)
    await new Promise<void>(resolve => {
      finish = resolve
    })
  })
  const page = open()
  await flushPromises()
  await page.get('input[aria-label="启用 创作内容"]').setValue(false)
  await flushPromises()
  page.unmount()
  pages = []
  finish()
  await flushPromises()
  expect(snapshot.desiredIds).toEqual([])
  expect(action).toHaveBeenCalledTimes(1)
  expect(action).toHaveBeenCalledWith({ action: 'set-selection', ids: [], offline: false })
})
