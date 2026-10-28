import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DevelopmentWorkspacePage from '../DevelopmentWorkspacePage.vue'

const state = reactive({ serverUrl: 'http://127.0.0.1:8102' })
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => state }))

const token = 'a'.repeat(40)
const revision = 'a'.repeat(64)
const content = {
  metadata: { title: 'Keep me', extension: { enabled: true } },
  data: {
    species: [
      {
        id: 'pet',
        name: 'Before',
        baseStats: { hp: 10, custom: 7 },
        learnable_skills: [
          { skill_id: { $ref: { projectId: 'other', kind: 'skill', id: 's' } }, level: 5, custom: true },
        ],
        ability: [],
        emblem: [],
      },
    ],
    skills: [
      { id: 'attack', name: 'Attack', behaviors: [{ useId: 'old', definitionId: 'other', params: { dynamic: 3 } }] },
    ],
    marks: [],
    behaviors: [],
  },
}
const snapshot = () => ({
  revision,
  content: structuredClone(content),
  project: { projectId: 'demo', namespace: 'demo' },
})
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response
const mountPage = () => mount(DevelopmentWorkspacePage, { global: { stubs: { RouterLink: true } } })
const load = async (wrapper: ReturnType<typeof mountPage>) => {
  await wrapper.get('[data-testid="development-token"]').setValue(token)
  await wrapper.get('[data-testid="development-load"]').trigger('click')
  await flushPromises()
}

describe('development workspace page', () => {
  beforeEach(() => {
    state.serverUrl = 'http://127.0.0.1:8102'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('saves an edited field with the revision and preserves unrelated data and references', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response(snapshot()))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountPage()
    await load(wrapper)
    await wrapper.get('[data-testid="development-record"]').setValue('pet')
    await wrapper.get('[data-testid="development-name"]').setValue('After')
    await wrapper.get('[data-testid="development-save"]').trigger('click')
    await flushPromises()
    const request = fetch.mock.calls[1][1]
    const body = JSON.parse(request.body)
    expect(body.revision).toBe(revision)
    expect(body.content).toEqual({
      ...content,
      data: { ...content.data, species: [{ ...content.data.species[0], name: 'After' }] },
    })
    expect(request.credentials).toBe('omit')
    wrapper.unmount()
  })

  it('reports an unavailable development service without creating a local draft', async () => {
    const fetch = vi.fn().mockResolvedValue(response({}, 404))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountPage()
    await load(wrapper)
    expect(wrapper.text()).toContain('没有启用本机开发工作区')
    expect(wrapper.find('[data-testid="development-editor"]').exists()).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it.each(['REVISION_CONFLICT', 'DEVELOPMENT_CHANGED'])('retains edited input on %s', async code => {
    const fetch = vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response({ code }, 409))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountPage()
    await load(wrapper)
    await wrapper.get('[data-testid="development-record"]').setValue('pet')
    await wrapper.get('[data-testid="development-name"]').setValue('Unsaved')
    await wrapper.get('[data-testid="development-save"]').trigger('click')
    await flushPromises()
    expect((wrapper.get('[data-testid="development-name"]').element as HTMLInputElement).value).toBe('Unsaved')
    expect((wrapper.get('[aria-label="保留的本地输入"]').element as HTMLTextAreaElement).value).toContain('Unsaved')
    wrapper.unmount()
  })

  it('disables editing malformed nested data instead of replacing it', async () => {
    const bad = snapshot()
    bad.content.data.species[0].baseStats = null as never
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(bad)))
    const wrapper = mountPage()
    await load(wrapper)
    await wrapper.get('[data-testid="development-record"]').setValue('pet')
    expect(wrapper.text()).toContain('baseStats 不是对象')
    expect(wrapper.get('[data-testid="development-editor"] fieldset').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('adds an effect reference without a duplicate package declaration while preserving existing parameters', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(snapshot())).mockResolvedValueOnce(response(snapshot()))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountPage()
    await load(wrapper)
    await wrapper
      .findAll('button')
      .find(button => button.text().startsWith('技能（'))!
      .trigger('click')
    await wrapper.get('[data-testid="development-record"]').setValue('attack')
    await wrapper.get('[data-testid="development-effect"]').setValue('effect')
    await wrapper.get('[data-testid="development-effect-use-id"]').setValue('new-use')
    await wrapper
      .findAll('button')
      .find(button => button.text() === '添加效果引用')!
      .trigger('click')
    await wrapper.get('[data-testid="development-save"]').trigger('click')
    await flushPromises()
    const body = JSON.parse(fetch.mock.calls[1][1].body)
    expect(body.content.data.skills[0].behaviors).toEqual([
      content.data.skills[0].behaviors[0],
      { useId: 'new-use', definitionId: { $ref: { projectId: 'demo', kind: 'behavior', id: 'effect' } } },
    ])
    wrapper.unmount()
  })

  it('adds local, official and cross-package references from a selected public environment without sending its token', async () => {
    const id = 'b'.repeat(64)
    const descriptor = { id, protocolVersion: 1, packages: [{ projectId: 'other', namespace: 'other-ns' }] }
    const publicContent = {
      species: [],
      skills: [
        { id: 'other-ns:strike', name: 'Strike' },
        { id: 'skill_base', name: 'Base' },
      ],
      marks: [{ id: 'other-ns:guard' }],
    }
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(response({ protocolVersion: 1, environments: [descriptor] }))
      .mockResolvedValueOnce(response(publicContent))
      .mockResolvedValueOnce(response(snapshot()))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountPage()
    await load(wrapper)
    await wrapper.get('[data-testid="development-reference-catalog"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="development-reference-environment"]').setValue(id)
    await flushPromises()
    await wrapper.get('[data-testid="development-record"]').setValue('pet')
    const add = async (selector: string, projectId: string, id: string, label: string) => {
      await wrapper.get(selector).setValue(JSON.stringify([projectId, id]))
      await wrapper
        .findAll('button')
        .find(button => button.text() === label)!
        .trigger('click')
    }
    await add('[data-testid="development-skill-reference"]', 'demo', 'attack', '添加技能引用')
    await add('[data-testid="development-skill-reference"]', 'other', 'strike', '添加技能引用')
    await add('[data-testid="development-skill-reference"]', 'base', 'skill_base', '添加技能引用')
    await add('[data-testid="development-mark-reference"]', 'other', 'guard', '添加印记引用')
    await wrapper.get('[data-testid="development-save"]').trigger('click')
    await flushPromises()
    const body = JSON.parse(fetch.mock.calls[3][1].body)
    expect(body.content.data.species[0].learnable_skills).toEqual([
      content.data.species[0].learnable_skills[0],
      ...[
        ['demo', 'attack'],
        ['other', 'strike'],
        ['base', 'skill_base'],
      ].map(([projectId, id]) => ({
        skill_id: { $ref: { projectId, kind: 'skill', id } },
        level: 1,
        hidden: false,
      })),
    ])
    expect(body.content.data.species[0].ability).toEqual([{ $ref: { projectId: 'other', kind: 'mark', id: 'guard' } }])
    expect(fetch.mock.calls[1][1].credentials).toBe('omit')
    expect(fetch.mock.calls[2][1].credentials).toBe('omit')
    expect(fetch.mock.calls[1][1].headers).toBeUndefined()
    expect(fetch.mock.calls[2][1].headers).toBeUndefined()
    expect(wrapper.text()).toContain('无法确认源码项目的 npm 依赖')
    wrapper.unmount()
  })

  it('discards a public content response from an environment that is no longer selected', async () => {
    const first = 'b'.repeat(64),
      second = 'c'.repeat(64)
    let finishFirst!: (value: Response) => void
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(snapshot()))
      .mockResolvedValueOnce(
        response({
          protocolVersion: 1,
          environments: [first, second].map(id => ({
            id,
            protocolVersion: 1,
            packages: [{ projectId: 'other', namespace: 'other' }],
          })),
        }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>(resolve => {
            finishFirst = resolve
          }),
      )
      .mockResolvedValueOnce(response({ species: [], skills: [{ id: 'other:new' }], marks: [] }))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountPage()
    await load(wrapper)
    await wrapper.get('[data-testid="development-reference-catalog"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="development-reference-environment"]').setValue(first)
    await wrapper.get('[data-testid="development-reference-environment"]').setValue(second)
    await flushPromises()
    finishFirst(response({ species: [], skills: [{ id: 'other:old' }], marks: [] }))
    await flushPromises()
    await wrapper.get('[data-testid="development-record"]').setValue('pet')
    expect(wrapper.get('[data-testid="development-skill-reference"]').text()).toContain('new')
    expect(wrapper.get('[data-testid="development-skill-reference"]').text()).not.toContain('old')
    wrapper.unmount()
  })

  it('retains a draft and clears the token when the selected server changes', async () => {
    const fetch = vi.fn().mockResolvedValue(response(snapshot()))
    vi.stubGlobal('fetch', fetch)
    const wrapper = mountPage()
    await load(wrapper)
    await wrapper.get('[data-testid="development-record"]').setValue('pet')
    await wrapper.get('[data-testid="development-name"]').setValue('Unsaved')
    state.serverUrl = 'http://127.0.0.1:8103'
    await flushPromises()
    expect((wrapper.get('[data-testid="development-token"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('[data-testid="development-save"]').attributes('disabled')).toBeDefined()
    expect((wrapper.get('[aria-label="保留的本地输入"]').element as HTMLTextAreaElement).value).toContain('Unsaved')
    expect(fetch).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
