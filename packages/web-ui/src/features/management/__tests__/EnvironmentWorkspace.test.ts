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
    expect(page.get('[role="alert"]').text()).toContain('填写名称和版本')
    await page.get('input[placeholder="@author/package"]').setValue('@test/ice')
    await page.get('input[aria-label="版本范围"]').setValue('1.0.0')
    await button(page, '添加内容包').trigger('click')
    await page.findAll('input[placeholder="@author/package"]')[1]!.setValue('@test/ice')
    await page.findAll('input[aria-label="版本范围"]')[1]!.setValue('2.0.0')
    await page.get('form.environment-editor').trigger('submit')
    expect(page.emitted('save')).toBeUndefined()
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
    const numberField = (label: string) =>
      page
        .findAll('.el-form-item')
        .find(field => field.find('label').text() === label)!
        .get('input')
    await numberField('单项资质上限').setValue('50')
    await numberField('队伍最少数量').setValue('2')
    await numberField('队伍最多数量').setValue('4')
    const checkbox = (text: string) =>
      page
        .findAll('label')
        .find(label => label.text() === text)!
        .get('input')
    await checkbox('击破奖励换宠').setValue(false)
    await checkbox('队伍内精灵不重复').setValue(true)
    const denySpecies = page.findAll('fieldset').find(fieldset => fieldset.find('legend').text() === '禁止内容')!
    await denySpecies.findAll('textarea')[0]!.setValue('base:boss\nbase:boss\ncustom:pet')
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
  const section = page.findAll('details').find(item => item.find('summary').text() === '技能数值')!
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
  const choice = page.findAllComponents({ name: 'ElFormItem' }).find(item => item.props('label') === '引用规则集')!
  choice.getComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', ['cup:other'])
  await page.vm.$nextTick()
  expect(page.text()).toContain('按已准备内容预览规则')
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
  const unique = page
    .findAll('label')
    .find(label => label.text() === '队伍内精灵不重复')!
    .get('input')
  expect(unique.element.checked).toBe(true)
  const denied = page.findAll('fieldset').find(field => field.find('legend').text() === '禁止内容')!
  expect(denied.get('textarea').attributes('placeholder')).toBe('cup:boss')
  await unique.setValue(false)
  await denied
    .findAll('button')
    .find(control => control.text() === '清除禁用')!
    .trigger('click')
  const form = page.get('form.environment-editor')
  await form.trigger('submit')
  const saved = (index: number) => (page.emitted('save')![index]![0] as ManagedEnvironment['document']).rules
  expect(saved(0).team?.uniqueSpecies).toBe(false)
  expect(saved(0).deny?.species).toEqual([])
  const restores = page.findAll('button').filter(control => control.text() === '恢复继承')
  for (const control of restores) await control.trigger('click')
  await form.trigger('submit')
  expect(saved(1).team?.uniqueSpecies).toBeUndefined()
  expect(saved(1).deny?.species).toBeUndefined()
  expect(unique.element.checked).toBe(true)
})
