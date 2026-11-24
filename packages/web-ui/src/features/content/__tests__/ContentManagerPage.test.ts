import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import ContentManagerPage from '../ContentPackagesPanel.vue'
import type { ContentLibrarySnapshot, InstalledContentPackage, ContentPackageAction } from '@/types/contentPackages'

const { read, list } = vi.hoisted(() => ({ read: vi.fn(), list: vi.fn() }))
const battle = reactive({ serverUrl: 'http://server-a', isConnected: true })
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
  getSpecies: () => undefined,
  getSkill: () => undefined,
  getMark: () => undefined,
  loaded: true,
  serverFallback: null,
  species: { allIds: [], byId: {} },
  skills: { allIds: [], byId: {} },
  marks: { allIds: [], byId: {} },
}
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => battle }))
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => rooms }))
vi.mock('@/stores/petStorage', () => ({ usePetStorageStore: () => pets }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => gameData }))
vi.mock('@/services/serverEnvironment', () => ({ readServerEnvironmentContent: read, listServerEnvironments: list }))
const environment = (id: string) => ({
  id,
  environmentVersion: 'e'.repeat(64),
  packages: [{ projectId: 'custom', name: '@test/custom', version: '1.0.0', namespace: 'custom' }],
})
const base = { projectId: 'base', name: '@arcadia-eternity/data-pack-base', version: '4.0.0', namespace: 'base' }
const defaultEnvironment = { id: 'b'.repeat(64), isDefault: true, packages: [base] }
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
  const page = mount(ContentManagerPage, { attachTo: document.body })
  pages.push(page)
  return page
}
const button = (page: ReturnType<typeof mount>, name: string) =>
  page.findAll('button').find(item => item.text() === name)!
const pickPackage = async (page: ReturnType<typeof mount>) => {
  await page.get('.package-select').trigger('click')
}
function bridge(_active = false) {
  const snapshot: ContentLibrarySnapshot = {
    revision: 1,
    packages: [structuredClone(pkg)],
    serviceStatus: { status: 'idle' },
    serviceNeedsRestart: false,
  }
  const action = vi.fn(async (_input: ContentPackageAction) => {})
  const install = vi.fn(async () => pkg.id)
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
  list.mockReset().mockResolvedValue([defaultEnvironment])
  battle.serverUrl = 'http://server-a'
  battle.isConnected = true
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
  expect(page.get('.fingerprint-value code').text()).toBe('e'.repeat(64))
  expect(page.get('.package-preview summary').text()).toBe('1 只精灵 · 1 个技能 · 1 个印记')
  await page.get('[role=tab][id$=impact]').trigger('click')
  expect(page.text()).toContain('内容引用齐全')
  expect(page.text()).toContain('收藏队伍')
  expect(page.get('.scope').text()).toBe('只读')
  expect(button(page, '添加内容包')).toBeUndefined()
  expect(page.find('input[type=checkbox]').exists()).toBe(false)
  expect(read).toHaveBeenCalledWith('http://server-a', 'a'.repeat(64), expect.any(Function), expect.any(AbortSignal))
  expect(JSON.stringify(pets.teams)).toBe(before)
})
it('shows the paired server default package before connecting or joining a room', async () => {
  battle.isConnected = false
  const customEnvironment = environment('c'.repeat(64))
  list.mockResolvedValue([customEnvironment, defaultEnvironment])
  const page = open()
  await flushPromises()
  expect(page.get('.package-select').text()).toContain(base.name)
  expect(page.findAll('.package-row')).toHaveLength(1)
  expect(list).toHaveBeenCalledWith('http://server-a', expect.any(Function), expect.any(AbortSignal))
  expect(read).toHaveBeenCalledWith(
    'http://server-a',
    defaultEnvironment.id,
    expect.any(Function),
    expect.any(AbortSignal),
  )
  page.getComponent({ name: 'ElSelectV2' }).vm.$emit('update:modelValue', customEnvironment.id)
  await flushPromises()
  expect(page.get('.package-select').text()).toContain('@test/custom')
  expect(page.findAll('.package-row')).toHaveLength(1)
  expect(read).toHaveBeenLastCalledWith(
    'http://server-a',
    customEnvironment.id,
    expect.any(Function),
    expect.any(AbortSignal),
  )
})
it('does not read a server catalog in the disconnected desktop workspace', async () => {
  bridge()
  battle.isConnected = false
  const page = open()
  await flushPromises()
  await button(page, '服务器内容').trigger('click')
  expect(page.text()).toContain('连接服务器后可查看已发布的内容包')
  expect(list).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})
it('drops the previous server catalog when a server switch wins the race', async () => {
  let resolveOld!: (value: unknown) => void
  const customEnvironment = environment('c'.repeat(64))
  list.mockImplementation(server =>
    server === 'http://server-a'
      ? new Promise(resolve => {
          resolveOld = resolve
        })
      : Promise.resolve([customEnvironment]),
  )
  const page = open()
  await flushPromises()
  battle.serverUrl = 'http://server-b'
  await flushPromises()
  resolveOld([defaultEnvironment])
  await flushPromises()
  expect(page.get('.package-select').text()).toContain('@test/custom')
  expect(read).toHaveBeenCalledExactlyOnceWith(
    'http://server-b',
    customEnvironment.id,
    expect.any(Function),
    expect.any(AbortSignal),
  )
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
  await page.get('[role=tab][id$=impact]').trigger('click')
  expect(page.text()).not.toContain('内容引用齐全')
  expect(page.text()).toContain('暂无队伍引用')
})
it('does not claim teams are compatible when room content cannot be read', async () => {
  rooms.currentRoom = { config: { roomCode: 'ROOM' }, environment: environment('a'.repeat(64)) }
  read.mockRejectedValue(new Error('内容暂不可用'))
  const page = open()
  await flushPromises()
  await pickPackage(page)
  await page.get('[role=tab][id$=impact]').trigger('click')
  expect(page.text()).toContain('暂时无法检查队伍引用')
  expect(page.text()).not.toContain('暂无队伍引用')
})
it('keeps package installation separate from local environment selection', async () => {
  const { action } = bridge(true)
  const page = open()
  await flushPromises()
  await pickPackage(page)
  expect(page.find('input[aria-label="启用 创作内容"]').exists()).toBe(false)
  expect(page.text()).not.toContain('本机已启用')
  expect(page.text()).toContain('已安装')
  expect(action).not.toHaveBeenCalled()
})
it('installs into the library and shows task management without enabling', async () => {
  const { install, action } = bridge()
  const page = open()
  await flushPromises()
  await button(page, '添加内容包').trigger('click')
  await flushPromises()
  const dialogs = new DOMWrapper(document.body)
  const installDialog = dialogs.get('[role=dialog][aria-label="安装内容包"]')
  expect(installDialog.isVisible()).toBe(true)
  await installDialog
    .findAll('button')
    .find(item => item.text() === '安装本地内容包')!
    .trigger('click')
  await flushPromises()
  expect(install).toHaveBeenCalledWith({ offline: false })
  expect(action).not.toHaveBeenCalled()
  expect(dialogs.get('[role=dialog][aria-label="下载与安装"]').isVisible()).toBe(true)
  expect(page.find('input[aria-label="启用 创作内容"]').exists()).toBe(false)
})

it('adds a local version in the package detail, reports a failed apply and retries with the latest revision', async () => {
  bridge()
  let attempt = 0
  const localEnvironment = vi.fn(async (input: Record<string, unknown>) => {
    if (input.action === 'add-package') return { result: { operationId: String(++attempt) } }
    const member = { name: pkg.name, version: pkg.version, direct: true }
    const environments = ['default', 'friends', 'practice'].map(id => ({
      builtin: id === 'default',
      document: { id, name: id },
      revision: String(attempt),
    }))
    return {
      result: {
        environments,
        selectedEnvironmentId: 'default',
        installations: [
          { status: 'ready', environmentId: 'practice', draftRevision: String(attempt), members: [member] },
        ],
        operations: attempt
          ? [
              {
                id: String(attempt),
                status: attempt === 1 ? 'failed' : 'succeeded',
                error: { code: 'REVISION_CONFLICT' },
              },
            ]
          : [],
      },
    }
  })
  window.arcadiaDesktop!.localEnvironment = localEnvironment
  const page = open()
  await flushPromises()
  const targets = page.get('[aria-label="加入本地环境"]')
  expect(targets.text()).not.toContain('default')
  expect(targets.text()).toContain('practice 已加入')
  await targets.get('li button').trigger('click')
  await flushPromises()
  expect(targets.get('[role="alert"]').text()).toContain('环境草稿已更改')
  await targets.get('li button').trigger('click')
  await flushPromises()
  expect(localEnvironment).toHaveBeenCalledWith({
    action: 'add-package',
    environmentId: 'friends',
    expectedRevision: '1',
    name: pkg.name,
    version: pkg.version,
    allowDownload: false,
  })
  expect(targets.get('li').text()).toContain('已加入')
})
