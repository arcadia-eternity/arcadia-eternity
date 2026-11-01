import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import type { IBattleSystem } from '@arcadia-eternity/interface'

const context = vi.hoisted(() => ({
  failInitialization: false,
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
  useRoute: () => ({ query: { endpoint: 'http://127.0.0.1:8123/' + 'a'.repeat(48) } }),
  useRouter: () => ({ replace: context.replace }),
  isNavigationFailure: () => false,
}))
vi.mock('@/stores/battle', () => ({ useBattleStore: () => context.battle }))
vi.mock('@/stores/gameData', () => ({
  useGameDataStore: () => ({
    whenReady: async () => {},
    useLocalBattleContent: () => context.restore,
  }),
}))
vi.mock('@/services/authorPreview', () => ({
  connectAuthorPreview: async () => ({
    content: { species: [], skills: [], marks: [] },
    system: { cleanup: context.stop, getState: async () => ({ players: [{ id: 'player' }] }) },
  }),
}))
import AuthorPreviewPage from '../AuthorPreviewPage.vue'

beforeEach(() => {
  vi.clearAllMocks()
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
