import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import EnvironmentTransfers from '../EnvironmentTransfers.vue'
import type { ManagedEnvironmentVersion, ManagementOperation } from '@/types/management'

const document = {
  schemaVersion: 2 as const,
  id: 'friends',
  name: '好友环境',
  packages: { '@test/ice': '1.2.3' },
  sources: [],
  rules: { schemaVersion: 1 as const },
  requires: {},
}
const bundle = () => ({
  format: 'arcadia.environment-export/1',
  document,
  contentRevision: 'content-123',
  files: [{ path: 'package.json', data: 'e30=' }],
})
const version: ManagedEnvironmentVersion = {
  versionId: 'version-1',
  environmentId: document.id,
  workspaceId: 'workspace-a',
  document,
  draftRevision: 'draft-1',
  contentRevision: 'content-123',
  packages: [],
  createdAt: 1793808000000,
  status: 'ready',
}
const exportTask = (expiresAt = Date.now() + 60000): ManagementOperation => ({
  id: 'a'.repeat(64),
  kind: 'environment.export',
  status: 'succeeded',
  result: {
    filename: 'environment-friends.json',
    bytes: 2048,
    expiresAt,
    downloadPath: `/api/management/v1/transfers/${'a'.repeat(64)}`,
  },
})
const pages: VueWrapper[] = []
const button = (page: VueWrapper, text: string) => page.findAll('button').find(item => item.text() === text)!
function open(overrides: Record<string, unknown> = {}) {
  const page = mount(EnvironmentTransfers, {
    props: { versions: [version], operations: [], busy: false, canImport: true, canExport: true, ...overrides },
  })
  pages.push(page)
  return page
}
async function choose(page: VueWrapper, content: unknown = bundle()) {
  const file = new File([typeof content === 'string' ? content : JSON.stringify(content)], 'friends.json', {
    type: 'application/json',
  })
  const input = page.get('input[type="file"]')
  Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
  await input.trigger('change')
  await vi.waitFor(() => expect(page.text()).not.toContain('正在读取环境文件…'))
  await flushPromises()
}
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.restoreAllMocks()
})

describe('environment transfers', () => {
  it('previews the captured file and waits for explicit confirmation, always creating a new draft', async () => {
    const page = open()
    await choose(page)
    expect(page.text()).toContain('好友环境（friends）')
    expect(page.text()).toContain('1 个额外内容包 · 1 个文件')
    expect(page.emitted('import')).toBeUndefined()
    await page.get('input[placeholder="friends"]').setValue('friends-copy')
    await page.get('form[aria-label="导入环境"]').trigger('submit')
    expect(page.emitted('import')).toEqual([
      [{ bundle: bundle(), environmentId: 'friends-copy', expectedRevision: null }],
    ])
    await button(page, '取消导入').trigger('click')
    expect(page.find('.import-preview').exists()).toBe(false)
  })

  it('rejects malformed JSON and unrelated JSON without retaining previous pending imports', async () => {
    const page = open()
    await choose(page)
    await choose(page, '{invalid')
    expect(page.get('[role="alert"]').text()).toContain('无法解析 JSON')
    expect(page.find('.import-preview').exists()).toBe(false)
    await page.get('form[aria-label="导入环境"]').trigger('submit')
    expect(page.emitted('import')).toBeUndefined()
    await choose(page, { format: 'some-other-format', document })
    expect(page.get('[role="alert"]').text()).toContain('不是支持的环境导出文件')
  })

  it('bounds input before reading and rejects invalid replacement identifiers', async () => {
    const page = open()
    const file = new File(['{}'], 'large.json')
    Object.defineProperty(file, 'size', { value: 128 * 1024 * 1024 + 1 })
    const input = page.get('input[type="file"]')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    const read = vi.spyOn(FileReader.prototype, 'readAsText')
    await input.trigger('change')
    expect(read).not.toHaveBeenCalled()
    expect(page.get('[role="alert"]').text()).toContain('超过 128 MiB')
    await choose(page)
    await page.get('input[placeholder="friends"]').setValue('../unsafe')
    await page.get('form[aria-label="导入环境"]').trigger('submit')
    expect(page.emitted('import')).toBeUndefined()
    expect(page.get('[role="alert"]').text()).toContain('环境标识须为')
  })

  it('uses the selected ready version and emits downloads only for valid unexpired results', async () => {
    const task = exportTask()
    const page = open({ operations: [task] })
    expect(button(page, '创建导出文件').attributes('disabled')).toBeDefined()
    await page.get('select').setValue('version-1')
    await page.get('form[aria-label="导出环境"]').trigger('submit')
    expect(page.emitted('export')).toEqual([[version]])
    await button(page, '下载导出文件').trigger('click')
    expect(page.emitted('download')).toEqual([[task]])
    await page.setProps({ operations: [exportTask(Date.now() - 1000)] })
    expect(button(page, '文件已过期').attributes('disabled')).toBeDefined()
    await page.setProps({
      operations: [{ ...task, result: { ...(task.result as object), downloadPath: 'https://other.example/file' } }],
    })
    expect(page.text()).toContain('没有可用的下载信息')
    expect(page.findAll('button').some(item => item.text() === '下载导出文件')).toBe(false)
  })

  it('hides unavailable materials from export selection and clears stale selections', async () => {
    const page = open()
    await page.get('select').setValue('version-1')
    await page.setProps({
      versions: [
        { versionId: 'missing', workspaceId: 'workspace-a', status: 'unavailable', reason: 'missing materials' },
      ],
    })
    expect(page.get('select').findAll('option')).toHaveLength(1)
    await page.get('form[aria-label="导出环境"]').trigger('submit')
    expect(page.emitted('export')).toBeUndefined()
    expect(button(page, '创建导出文件').attributes('disabled')).toBeDefined()
  })

  it('enforces permission and busy gates, and discards pending files when import access is revoked', async () => {
    const page = open({ operations: [exportTask()] })
    await choose(page)
    await page.setProps({ canImport: false, canExport: false })
    expect(page.find('.import-preview').exists()).toBe(false)
    expect(page.get('input[type="file"]').attributes('disabled')).toBeDefined()
    expect(button(page, '下载导出文件').attributes('disabled')).toBeDefined()
    await page.get('form[aria-label="导入环境"]').trigger('submit')
    await page.get('form[aria-label="导出环境"]').trigger('submit')
    expect(page.emitted('import')).toBeUndefined()
    expect(page.emitted('export')).toBeUndefined()
    await page.setProps({ canImport: true, canExport: true })
    await choose(page)
    await page.get('select').setValue('version-1')
    await page.setProps({ busy: true })
    await page.get('form[aria-label="导入环境"]').trigger('submit')
    await page.get('form[aria-label="导出环境"]').trigger('submit')
    expect(page.emitted('import')).toBeUndefined()
    expect(page.emitted('export')).toBeUndefined()
  })
})
