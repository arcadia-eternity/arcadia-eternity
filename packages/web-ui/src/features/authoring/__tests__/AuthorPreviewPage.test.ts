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

it('revalidates externally edited environments before starting without altering the running battle', async () => {
  desktopLibrary()
  const wrapper = mount(AuthorPreviewPage)
  try {
    await flushPromises()
    expect(wrapper.get('button.start').attributes('disabled')).toBeUndefined()
    vi.mocked(window.arcadiaAuthorPreview!.environment).mockResolvedValue([
      {
        schemaVersion: 1,
        id: 'named-cli-preview',
        name: 'Externally edited',
        packages: {},
        sources: [],
        version: 'new-version',
      },
    ])
    await wrapper.get('button.start').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('所选环境配置已改变')
    expect(wrapper.get('button.start').attributes('disabled')).toBeDefined()
    expect(context.battle.initBattle).not.toHaveBeenCalled()
    expect(context.battle.resetBattleWithoutSurrender).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})

it('refreshes externally changed environment choices on focus without replacing the environment form draft', async () => {
  desktopLibrary()
  const wrapper = mount(AuthorPreviewPage)
  try {
    await flushPromises()
    await wrapper.get('[aria-controls="environment-panel"]').trigger('click')
    await wrapper
      .findAll('button')
      .find(button => button.text() === '管理环境')!
      .trigger('click')
    await wrapper.get('.environment-form input').setValue('My unsaved environment')
    await wrapper.get('.environment-form textarea').setValue('@example/pack=1.0.0')
    vi.mocked(window.arcadiaAuthorPreview!.environment).mockResolvedValue([
      {
        schemaVersion: 1,
        id: 'named-cli-preview',
        name: 'External name',
        packages: {},
        sources: [],
        version: 'external',
      },
    ])
    window.dispatchEvent(new Event('focus'))
    await new Promise(resolve => setTimeout(resolve, 60))
    await flushPromises()
    expect(wrapper.text()).toContain('External name')
    expect(wrapper.get('button.start').attributes('disabled')).toBeDefined()
    expect((wrapper.get('.environment-form input').element as HTMLInputElement).value).toBe('My unsaved environment')
    expect((wrapper.get('.environment-form textarea').element as HTMLTextAreaElement).value).toBe('@example/pack=1.0.0')
    expect(context.battle.initBattle).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})

it('receives project edits without focus changes and preserves drafts while reporting conflicts immediately', async () => {
  desktopLibrary()
  let changed: (() => void) | undefined
  const unsubscribe = vi.fn()
  window.arcadiaAuthorPreview!.onChanged = listener => {
    changed = () => listener({ type: 'change', file: 'debug/teams/blue.yaml' })
    return unsubscribe
  }
  const wrapper = mount(AuthorPreviewPage)
  try {
    await flushPromises()
    await wrapper
      .findAll('button')
      .find(button => button.text() === '更多操作')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find(button => button.text() === '重命名')!
      .trigger('click')
    await wrapper.get('.rename-form input').setValue('Unsaved user name')
    await wrapper.get('.rename-form').trigger('submit')
    vi.mocked(window.arcadiaAuthorPreview!.teams.list).mockResolvedValue([
      { schemaVersion: 1, id: 'blue', name: 'AI blue', team: [], version: 'external' },
      { schemaVersion: 1, id: 'orange', name: 'AI orange', team: [], version: 'external' },
    ])
    changed!()
    await vi.waitFor(() => expect(wrapper.get('.save-status').text()).toContain('项目文件已在外部修改'))
    expect(wrapper.get('.team-identity').text()).toContain('Unsaved user name')
    expect(wrapper.get('select[aria-label="对方队伍"]').text()).toContain('AI orange')
    expect(context.battle.initBattle).not.toHaveBeenCalled()
    expect(context.battle.resetBattleWithoutSurrender).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
  expect(unsubscribe).toHaveBeenCalledOnce()
})

it('replays changes received while a refresh is still reading', async () => {
  desktopLibrary()
  let changed: (() => void) | undefined
  window.arcadiaAuthorPreview!.onChanged = listener => {
    changed = () => listener({ type: 'change' })
    return vi.fn()
  }
  const wrapper = mount(AuthorPreviewPage)
  try {
    await flushPromises()
    let release!: (teams: Awaited<ReturnType<NonNullable<Window['arcadiaAuthorPreview']>['teams']['list']>>) => void
    const list = vi.mocked(window.arcadiaAuthorPreview!.teams.list)
    const before = list.mock.calls.length
    list.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve
        }),
    )
    changed!()
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(before + 1))
    changed!()
    list.mockResolvedValue([
      { schemaVersion: 1, id: 'blue', name: 'Latest edit', team: [], version: 'v3' },
      { schemaVersion: 1, id: 'orange', name: 'orange', team: [], version: 'v1' },
    ])
    release([
      { schemaVersion: 1, id: 'blue', name: 'Earlier edit', team: [], version: 'v2' },
      { schemaVersion: 1, id: 'orange', name: 'orange', team: [], version: 'v1' },
    ])
    await vi.waitFor(() => expect(wrapper.get('.team-identity').text()).toContain('Latest edit'))
    expect(list).toHaveBeenCalledTimes(before + 2)
  } finally {
    wrapper.unmount()
  }
})

it('retains notifications received while a team save is busy', async () => {
  const { save } = desktopLibrary()
  let changed: (() => void) | undefined
  window.arcadiaAuthorPreview!.onChanged = listener => {
    changed = () => listener({ type: 'change', file: 'debug/teams/orange.yaml' })
    return vi.fn()
  }
  const wrapper = mount(AuthorPreviewPage)
  const button = (text: string) => wrapper.findAll('button').find(item => item.text() === text)!
  try {
    await flushPromises()
    await button('复制当前队伍').trigger('click')
    await wrapper.get('.rename-form input').setValue('Saved copy')
    await wrapper.get('.rename-form').trigger('submit')
    let release!: () => void
    save.mockImplementationOnce(async ({ document }) => {
      await new Promise<void>(resolve => {
        release = resolve
      })
      return { ...document, version: 'saved' }
    })
    await button('保存队伍').trigger('click')
    changed!()
    vi.mocked(window.arcadiaAuthorPreview!.teams.list).mockResolvedValue([
      { schemaVersion: 1, id: 'blue', name: 'blue', team: [], version: 'v1' },
      { schemaVersion: 1, id: 'orange', name: 'Changed while busy', team: [], version: 'v2' },
    ])
    release()
    await vi.waitFor(() => expect(wrapper.get('select[aria-label="对方队伍"]').text()).toContain('Changed while busy'))
  } finally {
    wrapper.unmount()
  }
})

it('does not silently rebase a name being typed when an MCP notification updates its team', async () => {
  const { save } = desktopLibrary()
  let changed!: () => void
  window.arcadiaAuthorPreview!.onChanged = listener => {
    changed = () => listener({ type: 'change', file: 'debug/teams/blue.yaml' })
    return vi.fn()
  }
  const wrapper = mount(AuthorPreviewPage)
  const button = (name: string) => wrapper.findAll('button').find(button => button.text() === name)!
  try {
    await flushPromises()
    await button('更多操作').trigger('click')
    await button('重命名').trigger('click')
    await wrapper.get('.rename-form input').setValue('Still typing my name')
    vi.mocked(window.arcadiaAuthorPreview!.teams.list).mockResolvedValue([
      { schemaVersion: 1, id: 'blue', name: 'MCP renamed', team: [], version: 'v2' },
      { schemaVersion: 1, id: 'orange', name: 'orange', team: [], version: 'v1' },
    ])
    changed()
    await vi.waitFor(() => expect(wrapper.get('.rename-form [role="status"]').text()).toContain('队伍文件已在外部修改'))
    expect((wrapper.get('.rename-form input').element as HTMLInputElement).value).toBe('Still typing my name')
    expect(button('确认名称').attributes('disabled')).toBeDefined()
    await wrapper.get('.rename-form').trigger('submit')
    expect(wrapper.get('.team-identity').text()).toContain('MCP renamed')
    expect(save).not.toHaveBeenCalled()
    await button('取消').trigger('click')
    await button('更多操作').trigger('click')
    await button('重命名').trigger('click')
    expect((wrapper.get('.rename-form input').element as HTMLInputElement).value).toBe('MCP renamed')
    await wrapper.get('.rename-form input').setValue('Reviewed new name')
    await wrapper.get('.rename-form').trigger('submit')
    expect(wrapper.get('.team-identity').text()).toContain('Reviewed new name')
  } finally {
    wrapper.unmount()
  }
})
