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

it.each([true, false])(
  'falls back across team and warehouse views only for equal versions (equal = %s)',
  async equal => {
    const localVersion = equal ? 'server-version' : 'different-version'
    vi.stubGlobal('arcadiaDesktop', {
      localEnvironment: async () => ({
        result: {
          workspaceId: 'mine',
          installations: [
            {
              status: 'ready',
              document: { name: '训练环境' },
              environmentId: 'training-120',
              draftRevision: 'local-r',
              contentRevision: 'local-c',
              environmentVersion: localVersion,
            },
          ],
        },
      }),
    })
    const descriptor = {
      previousEnvironmentIds: ['builtin-previous'],
      environmentId: 'training-120',
      environmentName: '训练环境',
      id: 'remote-publication',
      environmentVersion: 'server-version',
      packages: [],
    }
    list.mockResolvedValue([descriptor])
    prepare.mockResolvedValue({ content: {} })
    capture.mockResolvedValue({ environmentVersion: localVersion, content: {}, release: async () => {} })
    team.environmentPreference = { source: 'server:remote', environmentId: 'builtin-previous' }
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
          .filter(item => String(item.props('value')).startsWith('version/'))
      expect(options()).toHaveLength(equal ? 1 : 2)
      const tags = () => options().map(item => item.findAll('.source-tag').map(tag => tag.text()))
      const activeTag = () => environment().find('.selected-environment .source-tag')
      expect(tags()).toEqual(equal ? [['本机', '服务器']] : [['本机'], ['服务器']])
      expect(options().map(item => item.find('.option-version').exists())).toEqual(equal ? [false] : [true, true])
      expect(activeTag().text()).toBe('服务器')
      expect(prepare).toHaveBeenCalledWith(client.serverUrl, descriptor, expect.any(Function), expect.any(AbortSignal))
      await page.setProps({ warehouse: true })
      expect(picker('环境来源')).toBeUndefined()
      expect(environment().props('modelValue')).toBe('version/server-version')
      client.isConnected = false
      await flushPromises()
      expect(options()).toHaveLength(equal ? 1 : 2)
      expect(activeTag().exists() ? activeTag().text() : undefined).toBe(equal ? '本机' : undefined)
      if (equal) expect(capture).toHaveBeenCalledWith('training-120', false)
      else expect(capture).not.toHaveBeenCalled()
      expect(team.environmentPreference).toEqual({
        source: 'server:remote',
        environmentId: 'training-120',
        environmentVersion: 'server-version',
      })
      capture.mockClear()
      prepare.mockRejectedValueOnce(new Error('服务器连接已中断'))
      client.isConnected = true
      await flushPromises()
      expect(activeTag().exists() ? activeTag().text() : undefined).toBe(equal ? '本机' : undefined)
      if (equal) expect(capture).toHaveBeenCalledWith('training-120', false)
      else expect(capture).not.toHaveBeenCalled()
      if (equal) expect(page.find('[role="alert"]').exists()).toBe(false)
      await page.setProps({ warehouse: false })
      expect(environment().props('modelValue')).toBe('version/server-version')
    } finally {
      page.unmount()
    }
  },
)
