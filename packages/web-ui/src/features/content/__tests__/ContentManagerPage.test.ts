import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import ContentManagerPage from '../ContentManagerPage.vue'
import type {
  ContentLibrarySnapshot,
  InstalledContentPackage,
  ContentPackageAction,
  ContentPackagePlan,
} from '@/types/contentPackages'

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
    hasSelection: active,
    serviceStatus: { status: 'idle' },
    serviceNeedsRestart: false,
  }
  const action = vi.fn(async (input: ContentPackageAction): Promise<ContentPackagePlan | string | undefined> => {
    if (input.action === 'plan-selection')
      return {
        id: 'plan',
        kind: 'selection',
        ids: input.ids,
        graph: pkg.graph,
        contentIds: input.ids.length ? pkg.contentIds : { species: [], skills: [], marks: [] },
        newDependencies: [],
        requiresApproval: false,
      }
    if (input.action === 'apply-selection') snapshot.activeIds = []
  })
  vi.stubGlobal('arcadiaDesktop', {
    listContentPackages: async () => structuredClone(snapshot),
    contentPackageAction: action,
    selectContentPackageFile: vi.fn(async () => ({
      id: 'install',
      kind: 'install',
      package: pkg,
      requiresApproval: true,
    })),
    inspectNpmContentPackage: vi.fn(),
  })
  return { snapshot, action }
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
  expect(page.text()).toContain('网页端只读')
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
it('stages a disable, checks the plan and preserves teams after applying', async () => {
  const { action } = bridge(true)
  const before = JSON.stringify(pets.teams)
  const page = open()
  await flushPromises()
  await pickPackage(page)
  await page.get('input[aria-label="启用 创作内容"]').setValue(false)
  await button(page, '队伍影响').trigger('click')
  expect(page.text()).toContain('custom:pet')
  expect(action).not.toHaveBeenCalled()
  await button(page, '检查并应用更改').trigger('click')
  await flushPromises()
  expect(page.get('[role=dialog]').text()).toContain('3 项内容将不可用')
  await button(page, '确认应用').trigger('click')
  await flushPromises()
  expect(action).toHaveBeenCalledWith({ action: 'apply-selection', planId: 'plan', allowCode: false })
  expect(page.text()).toContain('本机内容选择已应用')
  expect(JSON.stringify(pets.teams)).toBe(before)
})
it('requires an explicit install confirmation after inspecting a native-selected tarball', async () => {
  const { action } = bridge()
  action.mockImplementation(async input => (input.action === 'confirm-install' ? pkg.id : undefined))
  const page = open()
  await flushPromises()
  await button(page, '添加内容包').trigger('click')
  await button(page, '选择本地 .tgz 文件').trigger('click')
  await flushPromises()
  expect(page.get('[role=dialog]').text()).toContain('library 2.0.0')
  expect(action).not.toHaveBeenCalled()
  await button(page, '安装并允许运行').trigger('click')
  await flushPromises()
  expect(action).toHaveBeenCalledWith({ action: 'confirm-install', planId: 'install', allowCode: true })
  expect(page.find('[role=dialog]').exists()).toBe(false)
})
it('keeps the saved active selection when validation fails', async () => {
  const { action } = bridge(true)
  const original = action.getMockImplementation()!
  action.mockImplementation(async input => {
    if (input.action === 'apply-selection') throw new Error('内容冲突')
    return original(input)
  })
  const page = open()
  await flushPromises()
  await page.get('input[aria-label="启用 创作内容"]').setValue(false)
  await button(page, '检查并应用更改').trigger('click')
  await flushPromises()
  await button(page, '确认应用').trigger('click')
  await flushPromises()
  expect(page.text()).toContain('内容冲突')
  expect(page.text()).toContain('本机内容选择尚未应用')
  await button(page, '撤销').trigger('click')
  expect((page.get('input[aria-label="启用 创作内容"]').element as HTMLInputElement).checked).toBe(true)
})

it('cleans up an unfinished operation plan when its page has already been closed', async () => {
  const { action } = bridge(true)
  let finish!: (value: ContentPackagePlan) => void
  action.mockImplementation(async input =>
    input.action === 'plan-selection'
      ? new Promise<ContentPackagePlan>(resolve => {
          finish = resolve
        })
      : undefined,
  )
  const page = open()
  await flushPromises()
  await page.get('input[aria-label="启用 创作内容"]').setValue(false)
  await button(page, '检查并应用更改').trigger('click')
  await flushPromises()
  page.unmount()
  pages = []
  finish({
    id: 'abandoned',
    kind: 'selection',
    ids: [],
    graph: [],
    contentIds: { species: [], skills: [], marks: [] },
    newDependencies: [],
    requiresApproval: false,
  })
  await flushPromises()
  expect(action).toHaveBeenCalledWith({ action: 'cancel', planId: 'abandoned' })
  expect(action.mock.calls.some(([input]) => input.action === 'apply-selection')).toBe(false)
})
