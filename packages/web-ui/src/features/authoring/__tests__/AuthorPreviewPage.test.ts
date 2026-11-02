import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IBattleSystem } from '@arcadia-eternity/interface'

const context = vi.hoisted(() => ({
  failInitialization: false,
  query: {} as Record<string, string>,
  whenReady: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  restore: vi.fn(),
  replace: vi.fn(async () => {
    throw new Error('navigation failed')
  }),
  battle: {
    battleInterface: null as IBattleSystem | null,
    errorMessage: null as string | null,
    initBattle: vi.fn(),
    resetBattleWithoutSurrender: vi.fn(),
  },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: context.query }),
  useRouter: () => ({ replace: context.replace }),
  isNavigationFailure: () => false,
}))
vi.mock('@/stores/battle', () => ({ useBattleStore: () => context.battle }))
vi.mock('@/stores/gameData', () => ({
  useGameDataStore: () => ({
    whenReady: context.whenReady,
    useLocalBattleContent: () => context.restore,
  }),
}))
vi.mock('@/components/team/TeamEditor.vue', () => ({ default: { props: ['delegate'], template: '<div />' } }))
vi.mock('@/utils/basicTeamValidation', () => ({ validateBasicTeam: () => [] }))
vi.mock('@/services/authorPreview', () => ({
  loadAuthorPreviewSetup: async () => ({
    content: { species: [], skills: [], marks: [] },
    players: [0, 1].map(side => ({ id: String(side).repeat(21), name: `Side ${side}`, team: [] })),
    active: false,
    candidate: { environmentId: 'named-cli-preview', environmentConfigVersion: 'prepared-config-hash' },
  }),
  connectAuthorPreview: async () => ({
    content: { species: [], skills: [], marks: [] },
    system: { cleanup: context.stop, getState: async () => ({ players: [{ id: 'player' }] }) },
  }),
}))
vi.mock('@/components/battle/BattleLoading.vue', () => ({
  default: {
    props: ['error'],
    emits: ['exit', 'retry'],
    template: `<div><p v-if="error" role="alert">{{ error }}</p><button @click="$emit('exit')">返回</button></div>`,
  },
}))
import AuthorPreviewPage from '../AuthorPreviewPage.vue'

afterEach(() => {
  delete window.arcadiaAuthorPreview
})

beforeEach(() => {
  vi.clearAllMocks()
  context.query = { endpoint: 'http://127.0.0.1:8123/' + 'a'.repeat(48), resume: 'true' }
  context.battle.battleInterface = null
  context.battle.initBattle.mockImplementation(async (system: IBattleSystem) => {
    context.battle.battleInterface = system
    if (context.failInitialization) throw new Error('initialization failed')
  })
  context.battle.resetBattleWithoutSurrender.mockImplementation(async () => {
    context.battle.battleInterface = null
  })
})

it.each([true, false])(
  'releases the owned battle after a failed handoff (initialization=%s)',
  async failInitialization => {
    context.failInitialization = failInitialization
    const wrapper = mount(AuthorPreviewPage)
    try {
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toContain(
        failInitialization ? 'initialization failed' : 'navigation failed',
      )
      expect(context.stop).toHaveBeenCalledOnce()
      expect(context.restore).toHaveBeenCalledOnce()
      expect(context.battle.resetBattleWithoutSurrender).toHaveBeenCalledOnce()
      expect(context.battle.battleInterface).toBeNull()
    } finally {
      wrapper.unmount()
    }
  },
)

it('isolated previews skip base content loading and return to the existing editor on failure', async () => {
  const returnToEditor = vi.fn()
  window.arcadiaAuthorPreview = { returnToEditor }
  context.failInitialization = true
  const wrapper = mount(AuthorPreviewPage)
  try {
    await flushPromises()
    expect(context.whenReady).not.toHaveBeenCalled()
    await wrapper.get('button').trigger('click')
    expect(returnToEditor).toHaveBeenCalledOnce()
  } finally {
    wrapper.unmount()
  }
})

it('allows a captured named CLI environment in a browser without project-management capabilities', async () => {
  delete context.query.resume
  const wrapper = mount(AuthorPreviewPage)
  try {
    await flushPromises()
    expect(wrapper.get('button.start').attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('所选环境尚未准备或配置已改变')
  } finally {
    wrapper.unmount()
  }
})
