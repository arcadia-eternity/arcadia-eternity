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
    teams: [],
    draftKey: 'browser-project',
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
  localStorage.clear()
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
  window.arcadiaAuthorPreview = {
    returnToEditor,
    teams: { list: vi.fn(), readDraft: vi.fn(), writeDraft: vi.fn() },
    environment: vi.fn(),
  }
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

function desktopLibrary() {
  const teams = ['blue', 'orange'].map(id => ({ schemaVersion: 1 as const, id, name: id, team: [], version: 'v1' }))
  const save = vi.fn(async ({ document }: { document: (typeof teams)[number] }) => ({ ...document, version: 'v2' }))
  window.arcadiaAuthorPreview = {
    returnToEditor: vi.fn(),
    teams: {
      list: vi.fn(async () => teams),
      readDraft: vi.fn(async () => null),
      writeDraft: vi.fn(async () => {}),
      files: { save, remove: vi.fn() },
    },
    environment: vi.fn(async () => [
      {
        schemaVersion: 1,
        id: 'named-cli-preview',
        name: '已准备环境',
        packages: {},
        sources: [],
        version: 'prepared-config-hash',
      },
      { schemaVersion: 1, id: 'other', name: '另一环境', packages: {}, sources: [], version: 'other-version' },
    ]) as unknown as NonNullable<Window['arcadiaAuthorPreview']>['environment'],
  }
  delete context.query.resume
  return { save }
}

it('keeps file actions with the edited side and distinguishes drafts from project saves', async () => {
  const { save } = desktopLibrary()
  const wrapper = mount(AuthorPreviewPage)
  const button = (name: string) => wrapper.findAll('button').find(item => item.text() === name)!
  try {
    await flushPromises()
    expect(button('保存队伍').attributes('disabled')).toBeDefined()
    expect(wrapper.find('#team-more-actions').exists()).toBe(false)
    await wrapper.get('[aria-label="编辑对方队伍"]').trigger('click')
    expect(wrapper.get('.team-identity').text()).toContain('orange')
    await button('复制当前队伍').trigger('click')
    await wrapper.get('.rename-form input').setValue('对方副本')
    await wrapper.get('.rename-form').trigger('submit')
    expect(wrapper.get('.save-status').text()).toContain('尚未保存到项目')
    await button('保存队伍').trigger('click')
    await flushPromises()
    expect(save.mock.calls[0]?.[0].document.name).toBe('对方副本')
    expect(wrapper.get('.save-status').text()).toBe('已保存到项目')
    await wrapper.get('[aria-label="编辑我方队伍"]').trigger('click')
    expect(wrapper.get('.team-identity').text()).toContain('blue')
  } finally {
    wrapper.unmount()
  }
})

it('reveals preparation when an environment changes and blocks launch until prepared', async () => {
  desktopLibrary()
  const wrapper = mount(AuthorPreviewPage)
  try {
    await flushPromises()
    expect(wrapper.find('#environment-panel').exists()).toBe(false)
    await wrapper.get('[aria-controls="environment-panel"]').trigger('click')
    await wrapper.get('#environment-panel select').setValue('other')
    expect(wrapper.get('button.start').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#environment-panel').text()).toContain('队伍草稿会保留')
    await wrapper.get('[aria-controls="environment-panel"]').trigger('click')
    expect(wrapper.find('#environment-panel').exists()).toBe(false)
    expect(wrapper.get('[aria-controls="environment-panel"]').attributes('aria-expanded')).toBe('false')
    expect(wrapper.get('button.start').attributes('disabled')).toBeDefined()
  } finally {
    wrapper.unmount()
  }
})

it('closes a rename form when its team is switched and makes selection the editing target', async () => {
  desktopLibrary()
  const wrapper = mount(AuthorPreviewPage)
  try {
    await flushPromises()
    await wrapper
      .findAll('button')
      .find(item => item.text() === '更多操作')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find(item => item.text() === '重命名')!
      .trigger('click')
    await wrapper.get('.rename-form input').setValue('不要误改另一队')
    await wrapper.get('select[aria-label="对方队伍"]').trigger('focusin')
    expect(wrapper.find('.rename-form').exists()).toBe(false)
    expect(wrapper.get('.team-identity').text()).toContain('orange')
    await wrapper.get('[aria-label="编辑我方队伍"]').trigger('click')
    expect(wrapper.get('.team-identity').text()).toContain('blue')
  } finally {
    wrapper.unmount()
  }
})
