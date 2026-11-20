import ElementPlus, { ElOption, ElSelect } from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import type { EnvironmentPreference } from '@arcadia-eternity/local-profile'
import PersonalEnvironmentView from '../team/PersonalEnvironmentView.vue'

const { list, prepare, capture } = vi.hoisted(() => ({ list: vi.fn(), prepare: vi.fn(), capture: vi.fn() }))
const team = reactive<{ environmentPreference?: EnvironmentPreference }>({})
const client = reactive({ serverUrl: 'https://paired.example', isConnected: true })
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ serverInfo: { serverId: 'remote' } }) }))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => client }))
vi.mock('@/stores/gameData', () => ({
  useGameDataStore: () => ({ loaded: true, useLocalBattleContent: () => () => {} }),
}))
vi.mock('@/stores/petStorage', () => ({
  usePetStorageStore: () => ({
    initialized: true,
    currentTeamIndex: 0,
    library: { teams: [team] },
    setEnvironmentPreference: (_index: number, pref?: EnvironmentPreference) => {
      team.environmentPreference = pref
    },
  }),
}))
vi.mock('@/services/serverEnvironment', () => ({ listServerEnvironments: list, prepareServerEnvironment: prepare }))
vi.mock('@/services/localContent', () => ({ acquireLocalContent: capture }))
const slot = { template: '<div><slot name="environment" /></div>' }
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  team.environmentPreference = undefined
  client.isConnected = true
})

it('groups the same logical ID and uses the available copy across team and warehouse views on disconnect and failed reads', async () => {
  vi.stubGlobal('arcadiaDesktop', {
    localEnvironment: async () => ({
      result: {
        workspaceId: 'mine',
        installations: [
          {
            status: 'ready',
            document: { name: '本地规则' },
            environmentId: 'friends',
            draftRevision: 'local-r',
            contentRevision: 'local-c',
          },
        ],
      },
    }),
  })
  const descriptor = { environmentId: 'friends', environmentName: '联机规则', id: 'remote-publication', packages: [] }
  list.mockResolvedValue([descriptor])
  prepare.mockResolvedValue({ content: {} })
  capture.mockResolvedValue({ content: {}, release: async () => {} })
  team.environmentPreference = { source: 'server:remote', environmentId: 'friends' }
  const page = mount(PersonalEnvironmentView, {
    props: { warehouse: false },
    global: { plugins: [ElementPlus], stubs: { PersonalTeamEditor: slot, StorageManager: slot } },
  })
  try {
    await flushPromises()
    const picker = (label: string) =>
      page
        .findAllComponents(ElSelect)
        .find(item => item.attributes('aria-label') === label || item.props('ariaLabel') === label)!
    const environment = () => picker('对战环境')
    const options = () =>
      environment()
        .findAllComponents(ElOption)
        .filter(item => item.props('value') === 'friends')
    expect(options()).toHaveLength(1)
    expect(prepare).toHaveBeenCalledWith(client.serverUrl, descriptor, expect.any(Function), expect.any(AbortSignal))
    await page.setProps({ warehouse: true })
    expect(picker('环境来源')).toBeUndefined()
    expect(environment().props('modelValue')).toBe('friends')
    client.isConnected = false
    await flushPromises()
    expect(options()).toHaveLength(1)
    expect(capture).toHaveBeenCalledWith('friends', false)
    expect(team.environmentPreference).toEqual({ source: 'server:remote', environmentId: 'friends' })
    capture.mockClear()
    prepare.mockRejectedValueOnce(new Error('服务器连接已中断'))
    client.isConnected = true
    await flushPromises()
    expect(capture).toHaveBeenCalledWith('friends', false)
    expect(page.find('[role="alert"]').exists()).toBe(false)
    await page.setProps({ warehouse: false })
    expect(environment().props('modelValue')).toBe('friends')
  } finally {
    page.unmount()
  }
})
