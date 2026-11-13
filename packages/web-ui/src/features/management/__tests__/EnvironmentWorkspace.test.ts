import { afterEach, describe, expect, it } from 'vitest'
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
    rules: { schemaVersion: 1, tier: 'casual', deny: { species: ['base:boss'] }, team: { maxSize: 3 } },
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
})

describe('shared environment workspace', () => {
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
    for (const label of ['新建环境', '编辑', '准备环境']) {
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
    const numbers = page.findAll('input[type="number"]')
    await numbers[0]!.setValue('2')
    await numbers[1]!.setValue('4')
    await page.get('input[type="checkbox"]').setValue(true)
    const denySpecies = page.findAll('fieldset').find(fieldset => fieldset.find('legend').text() === '禁止内容')!
    await denySpecies.findAll('textarea')[0]!.setValue('base:boss\nbase:boss\ncustom:pet')
    await page.get('form.environment-editor').trigger('submit')
    const saved = page.emitted('save')![0]![0] as ManagedEnvironment['document']
    expect(saved.rules.team).toEqual({ minSize: 2, maxSize: 4, uniqueSpecies: true })
    expect(saved.rules.deny?.species).toEqual(['base:boss', 'custom:pet'])
    expect(saved.rules.tier).toBe('casual')
  })
})
