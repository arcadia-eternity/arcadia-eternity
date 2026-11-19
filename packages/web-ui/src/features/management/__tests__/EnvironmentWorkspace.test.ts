import { skillParameterKey } from '@arcadia-eternity/const'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElInputNumber, ElMessageBox, ElSelect } from 'element-plus'
import { mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import EnvironmentWorkspace from '../EnvironmentWorkspace.vue'
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
const version = (draft: ManagedEnvironment, id = 'version-1'): ManagedEnvironmentInstallation => ({
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
  it('hides deletion for builtin environments but allows deleting user environments', async () => {
    const builtin = { ...environment(), builtin: true }
    const { page } = open({ environments: [builtin] })
    expect(page.findAll('button').some(item => item.text() === '删除环境')).toBe(false)
    expect(button(page, '复制环境').exists()).toBe(true)
    await page.setProps({ environments: [environment()] })
    await button(page, '删除环境').trigger('click')
    await button(page, '确认删除环境').trigger('click')
    expect(page.emitted('deleteDraft')).toHaveLength(1)
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

it('edits reusable rule references while keeping the loaded values and their origins read-only', async () => {
  const draft = environment()
  const loaded = {
    rules: { schemaVersion: 2, mechanics: { individualValues: { max: 50 } } },
    ruleSets: [
      { id: 'cup:other', name: '社区测试', rules: { schemaVersion: 2, mechanics: { individualValues: { max: 50 } } } },
    ],
    fields: [
      {
        path: ['mechanics', 'individualValues'],
        value: { max: 50 },
        sources: ['cup:classic', '$environment'],
        effectiveSources: ['$environment'],
      },
    ],
  }
  draft.document.rules = { schemaVersion: 2 }
  const { page } = open({ environments: [draft], installations: [{ ...version(draft), ruleComposition: loaded }] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '基础规则')
  const choice = page.findAllComponents({ name: 'ElFormItem' }).find(item => item.props('label') === '引用规则集')!
  choice.getComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', ['cup:other'])
  await page.vm.$nextTick()
  expect(page.text()).toContain('规则预览')
  expect(page.text()).toContain('individualValues')
  await page.get('form.environment-editor').trigger('submit')
  const [saved] = page.emitted('save')![0]! as [ManagedEnvironment['document']]
  expect(saved.rules.include).toEqual(['cup:other'])
  expect(saved.rules.mechanics).toBeUndefined()
  expect(saved.rules).not.toHaveProperty('fields')
})

it('can lift an inherited ban and uniqueness requirement and then restore inheritance', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, include: ['cup:classic'] }
  const rules = { schemaVersion: 2, deny: { species: ['cup:boss'] }, team: { uniqueSpecies: true } }
  const ruleComposition = { rules, fields: [], ruleSets: [{ id: 'cup:classic', name: '联赛', rules }] }
  const { page } = open({ environments: [draft], installations: [{ ...version(draft), ruleComposition }] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '基础规则')
  const unique = page.get('[aria-label="队伍内精灵不重复"]')
  expect(unique.text()).toContain('继承（开）')
  expect(unique.get<HTMLInputElement>('input[value="inherit"]').element.checked).toBe(true)
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
  await unique.get('input[value="inherit"]').setValue()
  const restores = page.findAll('button').filter(control => control.text() === '恢复继承')
  for (const control of restores) await control.trigger('click')
  await form.trigger('submit')
  expect(saved(1).team?.uniqueSpecies).toBeUndefined()
  expect(saved(1).deny?.species).toBeUndefined()
  expect(unique.get<HTMLInputElement>('input[value="inherit"]').element.checked).toBe(true)
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

it('extends an inherited content list from its visible entries and restores it without changing the rule set', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, include: ['cup:classic'] }
  const rules = { schemaVersion: 2, allow: { species: ['cup:fox'] }, deny: { skills: ['cup:ice'] } }
  const ruleComposition = { rules, fields: [], ruleSets: [{ id: 'cup:classic', name: '联赛', rules }] }
  const { page } = open({ environments: [draft], installations: [{ ...version(draft), ruleComposition }] })
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
  expect(saved(0).deny).toBeUndefined()
  await field
    .findAll('button')
    .find(b => b.text() === '全部禁用')!
    .trigger('click')
  await form.trigger('submit')
  expect(saved(1).allow?.species).toEqual([])
  await field
    .findAll('button')
    .find(b => b.text() === '恢复继承')!
    .trigger('click')
  await form.trigger('submit')
  expect(saved(2).allow).toBeUndefined()
  expect(list.props('modelValue')).toEqual(['cup:fox'])
})

it('shows the inherited enhancement mode and preserves stage restrictions when changing mode', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, include: ['cup:classic'] }
  const rules = { schemaVersion: 2, mechanics: { enhancement: { mode: 'active', stages: ['cup:divine'] } } }
  const ruleComposition = { rules, fields: [], ruleSets: [{ id: 'cup:classic', name: '联赛', rules }] }
  const { page } = open({ environments: [draft], installations: [{ ...version(draft), ruleComposition }] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '对战机制')
  const group = page.get('[aria-label="神魔化规则"]')
  expect(group.text()).toContain('继承（启用阶段加成）')
  await group.get('input[value="suppressed"]').setValue()
  const form = page.get('form.environment-editor')
  await form.trigger('submit')
  const saved = (index: number) => (page.emitted('save')![index]![0] as ManagedEnvironment['document']).rules
  expect(saved(0).mechanics?.enhancement).toEqual({ mode: 'suppressed', stages: ['cup:divine'] })
  await group.get('input[value="inherit"]').setValue()
  await form.trigger('submit')
  expect(saved(1).mechanics?.enhancement).toBeUndefined()
})

it('shows one notice for an unavailable list preview and keeps untouched lists inherited', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, include: ['cup:classic'] }
  const { page } = open({ environments: [draft], installations: [] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '内容限制')
  expect(page.findAll('.rule-preview-issue')).toHaveLength(1)
  const field = limitField(page, '精灵', '允许名单')
  expect(field.get('input').attributes('placeholder')).toBe('输入 ID')
  expect(page.get('.rule-preview-issue').text()).toContain('所选内容包中找不到规则集：cup:classic')
  await page.get('form.environment-editor').trigger('submit')
  expect((page.emitted('save')![0]![0] as ManagedEnvironment['document']).rules).toEqual(draft.document.rules)
})

it('shows resolved lists when a local mechanic settles a conflict between rule sets', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, include: ['cup:a', 'cup:b'], mechanics: { allowFaintSwitch: true } }
  const ruleSets = [true, false].map((allowFaintSwitch, index) => ({
    id: index ? 'cup:b' : 'cup:a',
    name: '规则集',
    rules: { schemaVersion: 2, mechanics: { allowFaintSwitch }, deny: { species: [index ? 'cup:fox' : 'cup:wolf'] } },
  }))
  const { page } = open({
    environments: [draft],
    installations: [{ ...version(draft), ruleComposition: { rules: draft.document.rules, fields: [], ruleSets } }],
  })
  await button(page, '编辑').trigger('click')
  await openTab(page, '内容限制')
  expect(limitField(page, '精灵', '禁止名单').getComponent({ name: 'EnvironmentIdList' }).props('modelValue')).toEqual([
    'cup:fox',
    'cup:wolf',
  ])
  expect(page.findAll('.rule-preview-issue')).toHaveLength(0)
})

it('keeps inherited lists visible for an archive-backed package when another dependency is added', async () => {
  const draft = environment()
  draft.document.packages = { '@test/ice': 'file:candidates/content-0.tgz' }
  draft.document.rules = { schemaVersion: 2, include: ['ice:cup'] }
  const rules = { schemaVersion: 2, deny: { species: ['ice:wolf'] } }
  const installed = {
    ...version(draft),
    document: { ...draft.document, packages: { '@test/ice': '1.2.3' } },
    members: [
      {
        name: '@test/ice',
        version: '1.2.3',
        namespace: 'ice',
        projectId: 'ice',
        direct: true,
        dependencies: [],
        requiredBy: [],
      },
    ],
    contentCatalog: { species: [{ id: 'ice:wolf', name: '冰狼' }], skills: [], marks: [], stages: [] },
    ruleComposition: { rules, fields: [], ruleSets: [{ id: 'ice:cup', name: '冰系联赛', rules }] },
  }
  const { page } = open({ environments: [draft], installations: [installed] })
  await button(page, '编辑').trigger('click')
  await openTab(page, '内容限制')
  const list = limitField(page, '精灵', '禁止名单').getComponent({ name: 'EnvironmentIdList' })
  expect(list.props('modelValue')).toEqual(['ice:wolf'])
  await page.setProps({ pendingPackage: { id: 'fire', name: '@test/fire', version: '1.0.0' } })
  expect(list.props('modelValue')).toEqual(['ice:wolf'])
  expect(list.props('options')).toEqual([{ value: 'ice:wolf', label: '冰狼 · ice:wolf' }])
  expect(page.emitted('save')).toBeUndefined()
})

it('resolves a new draft from installed materials and recomputes nested includes as package versions change', async () => {
  const material = (version: string, species: string) => ({
    id: version,
    name: '@test/cup',
    version,
    contentIds: { species: [species], skills: [], marks: [] },
    ruleCatalog: {
      members: [
        {
          name: '@test/cup',
          version,
          namespace: 'cup',
          projectId: 'cup',
          direct: true,
          dependencies: [],
          requiredBy: [],
        },
      ],
      ruleSets: [
        { id: 'cup:classic', name: '联赛', rules: { schemaVersion: 2, include: ['cup:limits'] } },
        { id: 'cup:limits', name: '禁用名单', rules: { schemaVersion: 2, deny: { species: [species] } } },
      ],
    },
  })
  const { page } = open({
    installations: [],
    availablePackages: [material('1.0.0', 'cup:wolf'), material('2.0.0', 'cup:fox')],
  })
  await button(page, '新建环境').trigger('click')
  await page.setProps({ pendingPackage: { id: 'cup', name: '@test/cup', version: '^1.0.0' } })
  await openTab(page, '基础规则')
  const choice = page.findAllComponents({ name: 'ElFormItem' }).find(item => item.props('label') === '引用规则集')!
  choice.getComponent(ElSelect).vm.$emit('update:modelValue', ['cup:classic'])
  await openTab(page, '内容限制')
  const list = limitField(page, '精灵', '禁止名单').getComponent({ name: 'EnvironmentIdList' })
  expect(list.props('modelValue')).toEqual(['cup:wolf'])
  expect(list.props('options')).toEqual([{ value: 'cup:wolf', label: 'cup:wolf' }])
  await page.setProps({ pendingPackage: { id: 'cup2', name: '@test/cup', version: '2.0.0' } })
  expect(list.props('modelValue')).toEqual(['cup:fox'])
  expect(list.props('options')).toEqual([{ value: 'cup:fox', label: 'cup:fox' }])
  await page.setProps({ pendingPackage: { id: 'unavailable', name: '@test/cup', version: '3.0.0' } })
  expect(list.props('modelValue')).toBeUndefined()
  expect(page.get('.rule-preview-issue').text()).toContain('所选内容包中找不到规则集：cup:classic')
  expect(page.emitted('save')).toBeUndefined()
})

it('shows the prepared profile, table and learning rules and returns to them after clearing an override', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, include: ['cup:classic'] }
  const inherited = {
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
        ruleComposition: {
          fields: [],
          rules: inherited,
          ruleSets: [{ id: 'cup:classic', name: '杯赛', rules: inherited }],
        },
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
  expect(field('队伍最少数量').get('input').attributes('placeholder')).toBe('2')
  expect(field('队伍最多数量').get('input').attributes('placeholder')).toBe('4')
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
  expect(profile.props('modelValue')).toBe('cup:boost')
  expect(table.props('modelValue')).toBe('cup:ice')
  expect(field('二代性格资格').getComponent(ElSelect).props('modelValue')).toBe('all')
  expect(field('遗传资格').getComponent(ElSelect).props('modelValue')).toBe('species')
  expect(page.get('[aria-label="继承的技能调整"]').text()).toContain('cup:howl')
  await page.get('form.environment-editor').trigger('submit')
  const [saved] = page.emitted('save')![0]! as [ManagedEnvironment['document']]
  expect(saved.rules.learnsetAdjustments).toBeUndefined()
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
  await button(page, '恢复继承槽位').trigger('click')
  await form.trigger('submit')
  expect(saved(1).mechanics?.skillSlots).toBeUndefined()
})

it('preserves named collection references when editing an inherited constraint', async () => {
  const draft = environment()
  draft.document.rules = { schemaVersion: 2, include: ['cup:limits'] }
  const inherited = {
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
        ruleComposition: {
          fields: [],
          rules: { schemaVersion: 2 },
          ruleSets: [{ id: 'cup:limits', name: '联赛', rules: inherited }],
        },
      },
    ],
  })
  await button(page, '编辑').trigger('click')
  await openTab(page, '内容限制')
  await button(page, '替换规则及豁免').trigger('click')
  const collection = page
    .findAllComponents({ name: 'ElFormItem' })
    .find(item => item.props('label') === '引用集合')!
    .getComponent(ElSelect)
  expect(collection.props('modelValue')).toEqual(['cup:ice'])
  await button(page, '应用组合规则').trigger('click')
  await page.get('form.environment-editor').trigger('submit')
  const [saved] = page.emitted('save')![0]! as [ManagedEnvironment['document']]
  expect(saved.rules.constraintEdits?.replace?.[0]?.allOf).toEqual(inherited.constraints[0]!.allOf)
  expect(saved.rules.collections).toBeUndefined()
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
