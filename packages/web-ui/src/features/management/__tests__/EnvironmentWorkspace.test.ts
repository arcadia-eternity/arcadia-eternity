import { skillParameterKey } from '@arcadia-eternity/const'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElInputNumber, ElMessageBox, ElSelect } from 'element-plus'
import { mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import EnvironmentWorkspace from '../EnvironmentWorkspace.vue'
import type { ManagedReadyEnvironmentInstallation } from '@arcadia-eternity/protocol'
import type { ManagedEnvironment, ManagedEnvironmentInstallation } from '@/types/management'

const environment = (): ManagedEnvironment => ({
  revision: 'draft-7',
  document: {
    schemaVersion: 2,
    id: 'friends',
    name: '好友环境',
    packages: { '@test/ice': '1.2.3' },
    sources: ['@test/local'],
    rules: { schemaVersion: 1, tier: 'standard', deny: { species: ['base:boss'] }, team: { maxSize: 3 } },
    requires: { engine: '4', capabilities: ['custom-effects'] },
  },
})
const version = (draft: ManagedEnvironment, id = 'version-1'): ManagedReadyEnvironmentInstallation => ({
  installationId: id,
  environmentId: draft.document.id,
  workspaceId: 'workspace-a',
  document: draft.document,
  draftRevision: draft.revision,
  contentRevision: 'content-a',
  packages: [],
  createdAt: 1793808000000,
  status: 'ready',
})
const pages: VueWrapper[] = []
const button = (page: VueWrapper, text: string) => page.findAll('button').find(item => item.text() === text)!
async function openTab(page: VueWrapper, label: string) {
  await page
    .findAll('[role="tab"]')
    .find(tab => tab.text() === label)!
    .trigger('click')
}
const limitField = (page: VueWrapper, kind: string, side: string) =>
  page
    .findAllComponents({ name: 'ElFormItem' })
    .find(item => item.props('label') === side && item.element.closest('[aria-label="' + kind + '限制"]'))!
function open(overrides: Record<string, unknown> = {}) {
  const draft = reactive(environment())
  const page = mount(EnvironmentWorkspace, {
    props: {
      environments: [draft],
      installations: [version(draft)],
      canEdit: true,
      canPrepare: true,
      canDelete: true,
      canUse: true,
      busy: false,
      ...overrides,
    },
  })
  pages.push(page)
  return { page, draft }
}
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.restoreAllMocks()
})

describe('shared environment workspace', () => {
  it('previews only the selected installation materials and removes the fingerprint when the draft changes', async () => {
    const draft = environment()
    const fingerprint = 'a'.repeat(64)
    const installation: ManagedEnvironmentInstallation = {
      ...version(draft),
      environmentVersion: fingerprint,
      contentCatalog: {
        species: [
          { id: 'ice:pet', name: '冰灵' },
          { id: 'base_pet', name: '基础精灵' },
        ],
        skills: [{ id: 'ice:skill', name: '冰击' }],
        marks: [],
        stages: [],
      },
      members: [
        {
          name: '@test/ice',
          version: '1.2.3',
          projectId: 'ice',
          namespace: 'ice',
          direct: true,
          dependencies: [],
          requiredBy: [],
        },
      ],
    }
    const { page } = open({ environments: [draft], installations: [installation] })
    expect(page.get('.fingerprint-value code').text()).toBe(fingerprint)
    expect(page.get('.package-preview summary').text()).toBe('1 只精灵 · 1 个技能 · 0 个印记')
    expect(page.get('.package-preview dl').text()).toContain('冰灵')
    expect(page.text()).not.toContain('基础精灵')
    await page.setProps({ environments: [{ ...draft, revision: 'draft-8' }] })
    expect(page.find('.environment-fingerprint').exists()).toBe(false)
    expect(page.text()).toContain('上次应用的内容包')
  })

  it('hides deletion for builtin environments but allows deleting user environments', async () => {
    const builtin = { ...environment(), builtin: true }
    const { page } = open({ environments: [builtin] })
    expect(page.findAll('button').some(item => item.text() === '删除环境')).toBe(false)
    expect(page.findAll('button').some(item => item.text() === '编辑')).toBe(false)
    expect(button(page, '复制环境').exists()).toBe(true)
    await page.setProps({ environments: [environment()] })
    await button(page, '删除环境').trigger('click')
    await button(page, '确认删除环境').trigger('click')
    expect(page.emitted('deleteDraft')).toHaveLength(1)
  })
  it('saves a copy of the builtin with a new ID and editable rules', async () => {
    const builtin = { ...environment(), builtin: true }
    const { page } = open({ environments: [builtin] })
    await button(page, '复制环境').trigger('click')
    await page.get('form.environment-editor').trigger('submit')
    const [copy, revision] = page.emitted('save')![0]! as [ManagedEnvironment['document'], null]
    expect(copy.id).not.toBe(builtin.document.id)
    expect(copy.rules).toEqual(builtin.document.rules)
    expect(copy.name).toBe(builtin.document.name + ' 副本')
    expect(revision).toBeNull()
    expect(builtin.document.name).toBe('好友环境')
  })
  it('edits reactive input without changing the source and preserves rules and compatibility requirements', async () => {
    const { page, draft } = open()
    await button(page, '编辑').trigger('click')
    const editor = page.get('form.environment-editor')
    await editor.findAll('input')[0]!.setValue('修改的名称')
    await editor.get('input[aria-label="版本范围"]').setValue('2.0.0')
    await editor.trigger('submit')
    const [saved, revision] = page.emitted('save')![0]! as [ManagedEnvironment['document'], string]
    expect(revision).toBe('draft-7')
    expect(saved.name).toBe('修改的名称')
    expect(saved.packages).toEqual({ '@test/ice': '2.0.0' })
    expect(saved.rules).toEqual(draft.document.rules)
    expect(saved.requires).toEqual(draft.document.requires)
    expect(saved.sources).toEqual(['@test/local'])
    expect(draft.document.name).toBe('好友环境')
    expect(draft.document.packages['@test/ice']).toBe('1.2.3')
  })

  it('creates a new environment and rejects duplicate or incomplete package rows before submission', async () => {
    const { page } = open()
    await button(page, '新建环境').trigger('click')
    await page.get('input[placeholder="friends"]').setValue('new-env')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('新环境')
    await button(page, '添加内容包').trigger('click')
    await page.get('form.environment-editor').trigger('submit')
    expect(page.emitted('save')).toBeUndefined()
    await vi.waitFor(() => expect(page.get('.name-field .el-form-item__error').text()).toBe('请填写包名'))
    await page.get('input[placeholder="@author/package"]').setValue('@test/ice')
    await page.get('input[aria-label="版本范围"]').setValue('1.0.0')
    await button(page, '添加内容包').trigger('click')
    await page.findAll('input[placeholder="@author/package"]')[1]!.setValue('@test/ice')
    await page.findAll('input[aria-label="版本范围"]')[1]!.setValue('2.0.0')
    await page.get('form.environment-editor').trigger('submit')
    expect(page.emitted('save')).toBeUndefined()
    await vi.waitFor(() => expect(page.get('.el-form-item__error').text()).toBe('包名重复'))
    await page.findAll('.package-row button')[1]!.trigger('click')
    await page.get('form.environment-editor').trigger('submit')
    expect(page.emitted('save')![0]![1]).toBeNull()
    expect((page.emitted('save')![0]![0] as ManagedEnvironment['document']).id).toBe('new-env')
  })

  it('keeps the base source when clearing optional sources in a new environment', async () => {
    const { page } = open()
    await button(page, '新建环境').trigger('click')
    const sourceList = page.getComponent({ name: 'EnvironmentIdList' })
    expect(sourceList.props('modelValue')).toEqual([])
    sourceList.vm.$emit('update:modelValue', ['@test/local'])
    await page.vm.$nextTick()
    sourceList.vm.$emit('update:modelValue', [])
    await page.vm.$nextTick()
    await page.get('form.environment-editor').trigger('submit')
    const saved = page.emitted('save')![0]![0] as ManagedEnvironment['document']
    expect(saved.sources).toEqual(['@arcadia-eternity/data-pack-base'])
  })

  it.each(['编辑', '复制环境'])('locks the pinned base package during %s', async action => {
    const draft = environment()
    const base = '@arcadia-eternity/data-pack-base'
    draft.document.packages[base] = '1.0.0'
    const { page } = open({ environments: [draft] })
    await button(page, action).trigger('click')
    const row = page.findAll('.package-row').find(item => item.find('input[readonly]').exists())!
    expect((row.get('input[readonly]').element as HTMLInputElement).value).toBe(base)
    expect(row.text()).toContain('环境必需')
    expect(row.find('button').exists()).toBe(false)
    await button(page, '移出环境').trigger('click')
    await page.get('form.environment-editor').trigger('submit')
    const saved = page.emitted('save')![0]![0] as ManagedEnvironment['document']
    expect(saved.packages).toEqual({ [base]: '1.0.0' })
  })

  it('disables edits, preparation and version use for a viewer, while keeping version details readable', async () => {
    const { page } = open({ canEdit: false, canPrepare: false, canDelete: false, canUse: false })
    for (const label of ['新建环境', '编辑']) {
      expect(button(page, label).attributes('disabled')).toBeDefined()
      await button(page, label).trigger('click')
    }
    expect(page.find('.environment-editor').exists()).toBe(false)
    expect(page.emitted('prepare')).toBeUndefined()
    expect(page.emitted('use')).toBeUndefined()
    expect(page.findAll('button').some(item => item.text() === '删除版本')).toBe(false)
    expect(button(page, '服务器使用').attributes('disabled')).toBeDefined()
    expect(page.text()).not.toContain('固定版本')
  })

  it('uses the current environment without a snapshot selector', async () => {
    const { page } = open()
    await button(page, '服务器使用').trigger('click')
    expect((page.emitted('use')![0]![0] as ManagedEnvironmentInstallation).installationId).toBe('version-1')
    expect(page.text()).not.toContain('固定版本')
    expect(page.text()).not.toContain('删除版本')
  })

  it('edits content and team rules without dropping unrelated rule fields', async () => {
    const { page } = open()
    await button(page, '编辑').trigger('click')
    await openTab(page, '基础规则')
    const numberField = (label: string) =>
      page
        .findAll('.el-form-item')
        .find(field => field.find('label').text() === label)!
        .get('input')
    await numberField('单项资质上限').setValue('50')
    await numberField('队伍最少数量').setValue('2')
    await numberField('队伍最多数量').setValue('4')
    await page.get('[aria-label="击破奖励换宠"] input[value="false"]').setValue()
    await page.get('[aria-label="队伍内精灵不重复"] input[value="true"]').setValue()
    await openTab(page, '内容限制')
    const denySpecies = limitField(page, '精灵', '禁止名单')
    denySpecies
      .getComponent({ name: 'ElInputTag' })
      .vm.$emit('update:modelValue', ['base:boss', 'base:boss', 'custom:pet'])
    await page.vm.$nextTick()
    await page.get('form.environment-editor').trigger('submit')
    const saved = page.emitted('save')![0]![0] as ManagedEnvironment['document']
    expect(saved.rules.mechanics).toEqual({ individualValues: { max: 50 }, allowFaintSwitch: false })
    expect(saved.rules.team).toEqual({ minSize: 2, maxSize: 4, uniqueSpecies: true })
    expect(saved.rules.deny?.species).toEqual(['base:boss', 'custom:pet'])
    expect(saved.rules.tier).toBe('standard')
  })
})

it('emits confirmed dependency removal without a removed-packages list', async () => {
  const draft = environment()
  const installation = {
    ...version(draft),
    members: [
      {
        name: '@test/dependency',
        version: '1.0.0',
        projectId: 'dependency',
        namespace: 'dependency',
        direct: false,
        dependencies: [],
        requiredBy: ['@test/ice'],
      },
    ],
  }
  const { page } = open({ environments: [draft], installations: [installation] })
  await button(page, '移出环境').trigger('click')
  expect(page.emitted('removePackage')).toBeUndefined()
  await button(page, '连同依赖它的包一起移出环境').trigger('click')
  expect(page.emitted('removePackage')![0]).toEqual([draft, '@test/dependency', true])
  expect(page.emitted('packageState')).toBeUndefined()
  expect(page.text()).not.toContain('已移出的内容包')
})

it('merges a selected build into unsaved dependencies and configuration without applying automatically', async () => {
  const { page, draft } = open()
  await button(page, '编辑').trigger('click')
  await page.get('form.environment-editor').findAll('input')[0]!.setValue('未保存的名字')
  await page.setProps({ pendingPackage: { id: 'build-2', name: '@test/ice', version: '2.0.0' } })
  expect(page.emitted('save')).toBeUndefined()
  expect(page.emitted('packageAccepted')).toHaveLength(1)
  await page.get('form.environment-editor').trigger('submit')
  const saved = page.emitted('save')![0]![0] as ManagedEnvironment['document']
  expect(saved.name).toBe('未保存的名字')
  expect(saved.packages).toEqual({ '@test/ice': '2.0.0' })
  expect(saved.rules).toEqual(draft.document.rules)
  expect(draft.document.packages).toEqual({ '@test/ice': '1.2.3' })
})

it('honors the build target and preserves another environment draft when switching is cancelled', async () => {
  const first = environment()
  const second = {
    ...environment(),
    revision: 'b',
    document: { ...environment().document, id: 'second', name: '另一个环境' },
  }
  const { page } = open({ environments: [first, second] })
  await button(page, '编辑').trigger('click')
  await page.get('form.environment-editor').findAll('input')[0]!.setValue('未保存')
  const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
  await page.setProps({
    packageEnvironmentId: 'second',
    pendingPackage: { id: 'build', name: 'new-package', version: '2.0.0' },
  })
  await flushPromises()
  expect(page.emitted('packageAccepted')).toBeUndefined()
  expect(page.get('form.environment-editor').findAll('input')[0]!.element.value).toBe('未保存')
  confirm.mockResolvedValueOnce(Object.assign('confirm' as const, { value: '', action: 'confirm' as const }))
  await page.setProps({ pendingPackage: { id: 'build', name: 'new-package', version: '2.0.0' } })
  await flushPromises()
  await page.get('form.environment-editor').trigger('submit')
  const [saved, revision] = page.emitted('save')![0]! as [ManagedEnvironment['document'], string]
  expect(saved.id).toBe('second')
  expect(saved.packages['new-package']).toBe('2.0.0')
  expect(revision).toBe('b')
})

it('previews group inheritance and a single exception and saves only explicit choices', async () => {
  const draft = environment()
  const group = 'base:max-hp-excess-baseline'
  const address = { skill: 'frost:ice-burst', useId: 'bonus', parameter: 'baseline' }
  const catalog = {
    groups: [{ id: group, name: '最大体力超额基准', unit: 'HP' }],
    profiles: [{ id: 'base:120', name: '120 资质', groups: { [group]: 576 } }],
    members: [address, { ...address, skill: 'skill_dongqipenshe' }].map(row => ({ ...row, group, base: 500 })),
  }
  const { page } = open({ installations: [{ ...version(draft), skillParameters: catalog }] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '对战机制')
  const section = page.get('.skill-parameters')
  const [profile, groups, targets] = section.findAllComponents(ElSelect)
  profile!.vm.$emit('update:modelValue', 'base:120')
  await flushPromises()
  expect(section.text()).toContain('500 → 576（数值方案）')
  targets!.vm.$emit('update:modelValue', skillParameterKey(address))
  await flushPromises()
  expect(section.get('[role="status"]').text()).toContain('当前 576 · 跟随 120 资质')
  expect(section.findAllComponents(ElInputNumber)).toHaveLength(1)
  groups!.vm.$emit('update:modelValue', group)
  section.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 580)
  await flushPromises()
  await button(page, '设置组值').trigger('click')
  expect(section.text()).toContain('500 → 580（参数组覆盖）')
  targets!.vm.$emit('update:modelValue', skillParameterKey(address))
  await flushPromises()
  expect(section.get('[role="status"]').text()).toContain('当前 580 · 跟随参数组「最大体力超额基准」')
  await button(page, '单独调整').trigger('click')
  expect(section.findAllComponents(ElInputNumber)[1]!.props('modelValue')).toBe(580)
  section.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 550)
  await flushPromises()
  await button(page, '固定此招').trigger('click')
  expect(section.get('[role="status"]').text()).toContain('当前 550 · 单招例外')
  expect(section.text()).toContain('500 → 550（单招例外）')
  expect(section.text()).toContain('500 → 580（参数组覆盖）')
  await button(page, '跟随方案').trigger('click')
  expect(section.text()).toContain('500 → 576（数值方案）')
  await button(page, '恢复跟随').trigger('click')
  expect(section.text()).not.toContain('500 → 550')
  expect(section.get('[role="status"]').text()).toContain('当前 576 · 跟随 120 资质')
  await page.get('form.environment-editor').trigger('submit')
  const [saved] = page.emitted('save')![0]! as [ManagedEnvironment['document']]
  expect(saved.rules.skillParameters).toEqual({ profile: 'base:120' })
  expect(draft.document.rules.skillParameters).toBeUndefined()
})

it('creates an independent environment without a rule-set picker', async () => {
  const { page } = open()
  await button(page, '新建环境').trigger('click')
  await openTab(page, '基础规则')
  expect(page.text()).not.toContain('引用规则集')
})

it('can lift a ban and uniqueness requirement as independent edits', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, deny: { species: ['cup:boss'] }, team: { uniqueSpecies: true } }
  const { page } = open({ environments: [draft] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '基础规则')
  const unique = page.get('[aria-label="队伍内精灵不重复"]')
  expect(unique.findAll('input')).toHaveLength(2)
  expect(unique.get<HTMLInputElement>('input[value="true"]').element.checked).toBe(true)
  await unique.get('input[value="false"]').setValue()
  await openTab(page, '内容限制')
  const denied = limitField(page, '精灵', '禁止名单')
  expect(denied.getComponent({ name: 'EnvironmentIdList' }).props('modelValue')).toEqual(['cup:boss'])
  await denied
    .findAll('button')
    .find(control => control.text() === '清除禁用')!
    .trigger('click')
  const form = page.get('form.environment-editor')
  await form.trigger('submit')
  const saved = (index: number) => (page.emitted('save')![index]![0] as ManagedEnvironment['document']).rules
  expect(saved(0).team?.uniqueSpecies).toBe(false)
  expect(saved(0).deny?.species).toEqual([])
  expect(saved(0)).not.toHaveProperty('include')
  expect(draft.document.rules.team?.uniqueSpecies).toBe(true)
})

it('scopes ID suggestions to the draft dependencies and keeps names separate from saved IDs', async () => {
  const draft = environment()
  const catalog = { species: [{ id: 'ice:wolf', name: '冰狼' }], skills: [{ id: 'ice:howl' }], marks: [], stages: [] }
  const { page } = open({
    environments: [draft],
    installations: [{ ...version(draft), contentCatalog: catalog }],
    availablePackages: [
      {
        id: 'fire',
        name: '@test/fire',
        version: '2.0.0',
        contentIds: { species: ['fire:fox'], skills: [], marks: [] },
      },
    ],
  })
  await button(page, '编辑').trigger('click')
  await openTab(page, '内容限制')
  const speciesField = limitField(page, '精灵', '允许名单').getComponent({ name: 'EnvironmentIdList' })
  expect(speciesField.props('options')).toEqual([{ value: 'ice:wolf', label: '冰狼 · ice:wolf' }])
  await page.setProps({ pendingPackage: { id: 'fire', name: '@test/fire', version: '2.0.0' } })
  expect(speciesField.props('options')).toEqual([{ value: 'fire:fox', label: 'fire:fox' }])
  expect(page.emitted('save')).toBeUndefined()
})

it('edits content lists and resets them to the environment defaults', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, allow: { species: ['cup:fox'] }, deny: { skills: ['cup:ice'] } }
  const { page } = open({ environments: [draft] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '内容限制')
  const field = limitField(page, '精灵', '允许名单')
  const list = field.getComponent({ name: 'EnvironmentIdList' })
  expect(list.props('modelValue')).toEqual(['cup:fox'])
  list.vm.$emit('update:modelValue', ['cup:fox', 'cup:wolf'])
  await page.vm.$nextTick()
  const form = page.get('form.environment-editor')
  await form.trigger('submit')
  const saved = (index: number) => (page.emitted('save')![index]![0] as ManagedEnvironment['document']).rules
  expect(saved(0).allow?.species).toEqual(['cup:fox', 'cup:wolf'])
  expect(saved(0).deny?.skills).toEqual(['cup:ice'])
  await field
    .findAll('button')
    .find(b => b.text() === '全部禁用')!
    .trigger('click')
  await form.trigger('submit')
  expect(saved(1).allow?.species).toEqual([])
  await field
    .findAll('button')
    .find(b => b.text() === '恢复默认')!
    .trigger('click')
  await form.trigger('submit')
  expect(saved(2).allow).toBeUndefined()
  expect(list.props('modelValue')).toBeUndefined()
})

it('shows the enhancement mode and preserves stage restrictions when changing mode', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, mechanics: { enhancement: { mode: 'active', stages: ['cup:divine'] } } }
  const { page } = open({ environments: [draft] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '对战机制')
  const group = page.get('[aria-label="神魔化规则"]')
  expect(group.get<HTMLInputElement>('input[value="active"]').element.checked).toBe(true)
  expect(group.findAll('input[type=radio]')).toHaveLength(2)
  await group.get('input[value="suppressed"]').setValue()
  expect(page.get('[aria-label="神魔化"]').text()).not.toContain('允许阶段 ID')
  const form = page.get('form.environment-editor')
  await form.trigger('submit')
  const saved = (index: number) => (page.emitted('save')![index]![0] as ManagedEnvironment['document']).rules
  expect(saved(0).mechanics?.enhancement).toEqual({ mode: 'suppressed', stages: ['cup:divine'] })
  expect(saved(0)).not.toHaveProperty('include')
})

it('makes the prepared profile, table and learning rules directly editable', async () => {
  const draft = environment()
  draft.document.rules = {
    schemaVersion: 2,
    team: { minSize: 2, maxSize: 4 },
    mechanics: { secondGenerationNatures: 'all', inheritance: { eligible: 'species' } },
    skillParameters: { profile: 'cup:boost' },
    matchups: { table: 'cup:ice' },
    learnsetAdjustments: [{ species: 'cup:wolf', skill: 'cup:howl', source: 'normal', action: 'add', level: 8 }],
  }
  const { page } = open({
    environments: [draft],
    installations: [
      {
        ...version(draft),
        skillParameters: {
          groups: [],
          members: [],
          profiles: [
            { id: 'cup:boost', groups: {} },
            { id: 'cup:other', groups: {} },
          ],
        },
        elementCatalog: {
          elements: [{ id: 'Ice' }],
          matchupTables: [
            { id: 'base:standard', cells: [] },
            { id: 'cup:ice', cells: [{ attack: 'Ice', defense: 'Ice', multiplier: 0 }] },
          ],
        },
      },
    ],
  })
  await button(page, '编辑').trigger('click')
  await openTab(page, '基础规则')
  const field = (label: string) =>
    page.findAllComponents({ name: 'ElFormItem' }).find(item => item.props('label') === label)!
  expect(field('队伍最少数量').get<HTMLInputElement>('input').element.value).toBe('2')
  expect(field('队伍最多数量').get<HTMLInputElement>('input').element.value).toBe('4')
  await openTab(page, '对战机制')
  const profile = field('数值方案').getComponent(ElSelect)
  const table = field('基础相克表').getComponent(ElSelect)
  expect(profile.props('modelValue')).toBe('cup:boost')
  expect(table.props('modelValue')).toBe('cup:ice')
  const select = async (label: string, value: string) => {
    field(label).getComponent(ElSelect).vm.$emit('update:modelValue', value)
    await flushPromises()
  }
  await select('攻击属性', 'Ice')
  await select('防守属性', 'Ice')
  expect(page.text()).toContain('倍率 0×')
  await select('数值方案', 'cup:other')
  table.vm.$emit('change', 'base:standard')
  await flushPromises()
  expect(page.text()).toContain('倍率 1×')
  await select('数值方案', '')
  table.vm.$emit('change', '')
  await flushPromises()
  expect(field('二代性格资格').getComponent(ElSelect).props('modelValue')).toBe('all')
  expect(field('遗传资格').getComponent(ElSelect).props('modelValue')).toBe('species')
  await page.get('form.environment-editor').trigger('submit')
  const [saved] = page.emitted('save')![0]! as [ManagedEnvironment['document']]
  expect(saved.rules.learnsetAdjustments).toEqual(draft.document.rules.learnsetAdjustments)
  expect(saved.rules.skillParameters?.profile).toBeUndefined()
  expect(saved.rules.matchups?.table).toBeUndefined()
})

it('only enforces category slot limits when declared and saves the numbers displayed by the editor', async () => {
  const { page } = open()
  await button(page, '编辑').trigger('click')
  await openTab(page, '对战机制')
  const slots = page.get('[aria-label="技能槽位"]')
  const form = page.get('form.environment-editor')
  expect(slots.text()).toContain('普通与必杀共用槽位')
  expect(slots.findAllComponents(ElInputNumber)).toHaveLength(0)
  await button(page, '设置分类限额').trigger('click')
  const [normal, climax] = slots.findAllComponents(ElInputNumber)
  normal!.vm.$emit('update:modelValue', 5)
  await flushPromises()
  await form.trigger('submit')
  expect(page.emitted('save')).toBeUndefined()
  expect(slots.get('[role="alert"]').text()).toContain('最多五个')
  climax!.vm.$emit('update:modelValue', 0)
  await flushPromises()
  await form.trigger('submit')
  const saved = (idx: number) => (page.emitted('save')![idx]![0] as ManagedEnvironment['document']).rules
  expect(saved(0).mechanics?.skillSlots).toEqual({ normalMax: 5, climaxMax: 0 })
  await button(page, '恢复默认槽位').trigger('click')
  await form.trigger('submit')
  expect(saved(1).mechanics?.skillSlots).toBeUndefined()
})

it('preserves named collection references when editing a constraint', async () => {
  const draft = environment()
  draft.document.rules = {
    schemaVersion: 2,
    collections: [{ id: 'cup:ice', kind: 'species', ids: ['cup:wolf'] }],
    constraints: [
      {
        id: 'cup:limit',
        kind: 'memberLimit',
        max: 1,
        allOf: [{ kind: 'species', ids: [], fromCollections: ['cup:ice'] }],
      },
    ],
  }
  const { page } = open({
    environments: [draft],
    installations: [
      {
        ...version(draft),
      },
    ],
  })
  await button(page, '编辑').trigger('click')
  await openTab(page, '内容限制')
  await button(page, 'cup:limit · 最多 1 只').trigger('click')
  const collection = page
    .findAllComponents({ name: 'ElFormItem' })
    .find(item => item.props('label') === '引用集合')!
    .getComponent(ElSelect)
  expect(collection.props('modelValue')).toEqual(['cup:ice'])
  await button(page, '应用组合规则').trigger('click')
  await page.get('form.environment-editor').trigger('submit')
  const [saved] = page.emitted('save')![0]! as [ManagedEnvironment['document']]
  expect(saved.rules.constraints?.[0]?.allOf).toEqual(draft.document.rules.constraints![0]!.allOf)
  expect(saved.rules.collections).toEqual(draft.document.rules.collections)
})

it('checks draft references against the captured content and clears the issue as soon as it is fixed', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, allow: { species: ['cup:missing'] } }
  const { page } = open({
    environments: [draft],
    installations: [
      { ...version(draft), contentCatalog: { species: [{ id: 'cup:wolf' }], skills: [], marks: [], stages: [] } },
    ],
  })
  await button(page, '编辑').trigger('click')
  await openTab(page, '内容限制')
  expect(page.get('.rule-preview-issue').text()).toContain('cup:missing')
  limitField(page, '精灵', '允许名单')
    .getComponent({ name: 'EnvironmentIdList' })
    .vm.$emit('update:modelValue', ['cup:wolf'])
  await flushPromises()
  expect(page.find('.rule-preview-issue').exists()).toBe(false)
})

it('saves battle clock and team selection as explicit environment controls', async () => {
  const { page, draft } = open()
  await button(page, '编辑').trigger('click')
  await openTab(page, '对战机制')
  await page.get('[aria-label="对战计时器"] input[value="true"]').setValue()
  await page.get('input[aria-label="每回合时间限制"]').setValue('18')
  await page.get('[aria-label="团队选择"] input[value="true"]').setValue()
  await page.get('input[aria-label="最多出战数量"]').setValue('2')
  await page.get('form.environment-editor').trigger('submit')
  const saved = page.emitted('save')![0]![0] as ManagedEnvironment['document']
  expect(saved.rules.schemaVersion).toBe(2)
  expect(saved.rules.mechanics).toMatchObject({
    timer: { enabled: true, turnTimeLimit: 18 },
    teamSelection: { enabled: true, maxTeamSize: 2 },
  })
  expect(draft.document.rules.mechanics).toBeUndefined()
  await page.get('[aria-label="对战计时器"] input[value="false"]').setValue()
  await page.get('[aria-label="团队选择"] input[value="false"]').setValue()
  await page.get('form.environment-editor').trigger('submit')
  const reset = page.emitted('save')![1]![0] as ManagedEnvironment['document']
  expect(reset.rules.mechanics?.timer?.enabled).toBe(false)
  expect(reset.rules.mechanics?.teamSelection?.enabled).toBe(false)
})
