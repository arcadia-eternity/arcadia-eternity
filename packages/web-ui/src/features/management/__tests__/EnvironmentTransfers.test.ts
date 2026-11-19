import { ElSelect, ElOption } from 'element-plus'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { dismissedExportRecords } from '../exportRecords'
import EnvironmentTransfers from '../EnvironmentTransfers.vue'
import type { ManagedEnvironmentInstallation, ManagementOperation } from '@/types/management'

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
  format: 'arcadia.environment-export/2',
  document,
  contentRevision: 'content-123',
  files: [{ path: 'package.json', data: 'e30=' }],
})
const version: ManagedEnvironmentInstallation = {
  installationId: 'version-1',
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
    props: { installations: [version], operations: [], busy: false, canImport: true, canExport: true, ...overrides },
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
  dismissedExportRecords.clear()
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

  it('accepts host-base exports and ignores base download prompts in old exports', async () => {
    const page = open()
    for (const input of [
      { ...bundle(), format: 'arcadia.environment-export/4', archives: [] },
      {
        ...bundle(),
        format: 'arcadia.environment-export/3',
        archives: [
          {
            location: 'node_modules/@arcadia-eternity/data-pack-base',
            external: {
              name: '@arcadia-eternity/data-pack-base',
              version: '0.0.1',
              integrity: 'sha512-old',
              manual: true,
            },
          },
        ],
      },
    ]) {
      await choose(page, input)
      expect(page.find('input[aria-label^="补充"]').exists()).toBe(false)
      expect(button(page, '确认导入新环境').attributes('disabled')).toBeUndefined()
      await page.get('form[aria-label="导入环境"]').trigger('submit')
      expect(page.emitted('import')?.at(-1)?.[0]).toMatchObject({ bundle: input })
    }
  })

  it('includes the selected private archive in the confirmed import and only downloads by explicit choice', async () => {
    const page = open()
    const input = {
      ...bundle(),
      format: 'arcadia.environment-export/3',
      archives: [
        { external: { name: '@author/private', version: '1.0.0', integrity: 'sha512-test', manual: true } },
        { external: { name: 'public', version: '1.0.0', integrity: 'sha512-public', manual: false } },
      ],
    }
    await choose(page, input)
    expect(page.text()).toContain('@author/private@1.0.0')
    const archive = page.get('input[aria-label="补充 @author/private"]')
    Object.defineProperty(archive.element, 'files', { configurable: true, value: [new File(['abc'], 'private.tgz')] })
    await archive.trigger('change')
    await vi.waitFor(() => expect(button(page, '确认导入新环境').attributes('disabled')).toBeUndefined())
    await page.get('form[aria-label="导入环境"]').trigger('submit')
    expect(page.emitted('import')?.[0]).toEqual([
      {
        bundle: { ...input, suppliedArchives: { 'sha512-test': 'YWJj' } },
        allowDownload: false,
        expectedRevision: null,
      },
    ])
  })

  it('only asks for missing archives on the selected receiving workspace', async () => {
    const archives = [false, true].map(manual => ({
      external: {
        name: manual ? 'saved' : 'needed',
        version: '1.0.0',
        integrity: manual ? 'saved' : 'missing',
        manual,
      },
    }))
    const lock = { path: 'package-lock.json', data: 'e30=' }
    const checkArchives = vi.fn().mockResolvedValue(['missing'])
    const page = open({ checkArchives })
    await choose(page, { ...bundle(), format: 'arcadia.environment-export/3', files: [lock], archives })
    expect(checkArchives).toHaveBeenCalledWith({ lock, archives })
    expect(page.find('input[aria-label="补充 saved"]').exists()).toBe(false)
    expect(page.text()).toContain('下载缺失的 1 个公共依赖')
    expect(button(page, '确认导入新环境').attributes('disabled')).toBeDefined()
    await page.get('input[type=checkbox]').setValue(true)
    await page.get('form[aria-label="导入环境"]').trigger('submit')
    expect(page.emitted('import')?.[0]?.[0]).toMatchObject({ allowDownload: true })
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
    await page.findComponent(ElSelect).setValue('version-1')
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
    await page.findComponent(ElSelect).setValue('version-1')
    await page.setProps({
      installations: [
        { installationId: 'missing', workspaceId: 'workspace-a', status: 'unavailable', reason: 'missing materials' },
      ],
    })
    expect(page.findComponent(ElSelect).findAllComponents(ElOption)).toHaveLength(1)
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
    await page.findComponent(ElSelect).setValue('version-1')
    await page.setProps({ busy: true })
    await page.get('form[aria-label="导入环境"]').trigger('submit')
    await page.get('form[aria-label="导出环境"]').trigger('submit')
    expect(page.emitted('import')).toBeUndefined()
    expect(page.emitted('export')).toBeUndefined()
  })
})

it('clears completed export records while keeping running exports', async () => {
  const completed = exportTask()
  const running = { ...exportTask(), id: 'running-export', status: 'running' as const, result: undefined }
  const page = open({ operations: [completed, running], mode: 'results' })
  await button(page, '清空已完成记录').trigger('click')
  expect(page.text()).not.toContain('environment-friends.json')
  expect(page.text()).toContain('导出中')
  const reopened = open({ operations: [completed, running], mode: 'results' })
  expect(reopened.text()).not.toContain('environment-friends.json')
  expect(reopened.text()).toContain('导出中')
  expect(button(page, '清空已完成记录').attributes('disabled')).toBeDefined()
  await page.setProps({ operations: [completed, { ...running, status: 'succeeded' }] })
  await page.get('[aria-label="移除导出记录"]').trigger('click')
  expect(page.find('[aria-label="导出任务"]').exists()).toBe(false)
})
