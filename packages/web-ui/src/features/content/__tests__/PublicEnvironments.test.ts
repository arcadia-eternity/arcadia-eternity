import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PublicEnvironments from '../PublicEnvironments.vue'
const { list, read, readBuiltin, readCatalog } = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  readBuiltin: vi.fn(),
  readCatalog: vi.fn(),
}))
vi.mock('@/bootstrap/deployment', () => ({ getBackendOrigin: () => 'https://paired.example' }))
vi.mock('@/services/serverEnvironment', () => ({ listServerEnvironments: list, readServerEnvironmentContent: read }))
vi.mock('@/services/preparedWebEnvironment', () => ({
  readBuiltinWebEnvironment: readBuiltin,
  readPreparedWebCatalog: readCatalog,
}))
let page: ReturnType<typeof mount> | undefined
afterEach(() => {
  page?.unmount()
  for (const mock of [list, read, readBuiltin, readCatalog]) mock.mockReset()
})
it('lists published environments and shows only the selected recipe packages', async () => {
  read.mockResolvedValue({ species: [], skills: [], marks: [] })
  list.mockResolvedValue([
    { id: 'a'.repeat(64), isDefault: true, packages: [{ name: '@test/base', version: '1.0', projectId: 'base' }] },
    {
      id: 'b'.repeat(64),
      executionPolicy: 'peer',
      packages: [{ name: '@test/custom', version: '2.0', projectId: 'custom' }],
    },
  ])
  page = mount(PublicEnvironments)
  await flushPromises()
  const detail = () => page!.get('[aria-label="公开环境详情"]')
  expect(detail().text()).toContain('@test/base')
  expect(detail().text()).not.toContain('@test/custom')
  await page.get('[aria-label="选择公开环境"]').findAll('button')[1]!.trigger('click')
  expect(detail().text()).toContain('@test/custom')
  expect(detail().text()).toContain('由玩家托管')
  expect(detail().text()).not.toContain('@test/base')
  expect(detail().text()).toContain('只读')
  expect(page.findAll('button').map(button => button.text())).toEqual(['默认环境', '环境 bbbbbbbb', '刷新'])
  expect(list).toHaveBeenCalledWith('https://paired.example', expect.any(Function), expect.any(AbortSignal))
})

it('shows the portable fingerprint and keeps the preview matched to the selected publication', async () => {
  const fingerprint = 'f'.repeat(64)
  const base = { name: '@test/base', version: '1.0', projectId: 'base', namespace: 'base' }
  const custom = { name: '@test/custom', version: '2.0', projectId: 'custom', namespace: 'custom' }
  list.mockResolvedValue([
    { id: 'a'.repeat(64), environmentVersion: fingerprint, packages: [base, custom] },
    { id: 'b'.repeat(64), packages: [custom] },
  ])
  let resolveOld!: (value: unknown) => void
  read
    .mockImplementationOnce(() => new Promise(resolve => (resolveOld = resolve)))
    .mockResolvedValueOnce({
      species: [{ id: 'base_pet' }, { id: 'custom:pet' }, { id: 'custom:pet2', name: '岩灵' }],
      skills: [{ id: 'custom:skill' }],
      marks: [{ id: 'unrelated:mark' }],
      locales: {
        defaultLocale: 'zh-CN',
        bundles: { 'zh-CN': { species: { 'custom:pet': { name: '冰灵' } } } },
      },
    })
  page = mount(PublicEnvironments)
  await flushPromises()
  const detail = () => page!.get('[aria-label="公开环境详情"]')
  expect(detail().get('.environment-fingerprint summary').text()).toBe('指纹 ' + fingerprint.slice(0, 8))
  expect(detail().get('.fingerprint-value code').text()).toBe(fingerprint)
  expect(detail().text()).toContain('正在读取内容预览')
  await page.get('[aria-label="选择公开环境"]').findAll('button')[1]!.trigger('click')
  await flushPromises()
  expect(read.mock.calls[0]![3].aborted).toBe(true)
  resolveOld({ species: [{ id: 'custom:old', name: '旧精灵' }], skills: [], marks: [] })
  await flushPromises()
  expect(detail().find('.environment-fingerprint').exists()).toBe(false)
  expect(detail().findAll('.package-entry')).toHaveLength(1)
  expect(detail().get('.package-preview summary').text()).toBe('2 只精灵 · 1 个技能 · 0 个印记')
  expect(detail().get('.package-preview dl').text()).toContain('冰灵、岩灵')
  expect(detail().text()).not.toContain('旧精灵')
})

it('uses bundled material for previews and keeps package versions when the preview is unavailable', async () => {
  const builtins = [
    {
      id: 'training',
      name: '训练环境',
      environmentVersion: 'f'.repeat(64),
      packages: [{ name: '@arcadia-eternity/data-pack-base', version: '4.0.0' }],
    },
  ]
  readCatalog.mockResolvedValue({ defaultEnvironment: 'training', builtins })
  readBuiltin.mockResolvedValueOnce({ content: { species: [{ id: 'pet', name: '精灵甲' }], skills: [], marks: [] } })
  page = mount(PublicEnvironments, { props: { bundled: true, selection: 'training' } })
  await flushPromises()
  expect(readBuiltin).toHaveBeenCalledWith('training')
  expect(read).not.toHaveBeenCalled()
  expect(page.get('.package-preview dl').text()).toContain('精灵甲')
  readBuiltin.mockRejectedValueOnce(new Error('offline'))
  await page
    .findAll('button')
    .find(button => button.text() === '刷新')!
    .trigger('click')
  await flushPromises()
  expect(page.get('[role="status"]').text()).toBe('无法读取内容预览')
  expect(page.get('.package-entry').text()).toContain('4.0.0')
  expect(page.find('.package-preview').exists()).toBe(false)
})
it('aborts obsolete public requests on refresh and unmount', async () => {
  const signals: AbortSignal[] = []
  const resolvers: ((value: unknown[]) => void)[] = []
  list.mockImplementation((_url, _fetch, signal) => {
    signals.push(signal)
    return new Promise(resolve => resolvers.push(resolve))
  })
  page = mount(PublicEnvironments)
  await page.get('button').trigger('click')
  expect(signals[0]!.aborted).toBe(true)
  resolvers[0]!([{ id: 'obsolete', packages: [] }])
  resolvers[1]!([])
  await flushPromises()
  expect(page.text()).not.toContain('obsolete')
  expect(page.text()).toContain('服务器暂无公开环境')
  page.unmount()
  page = undefined
  expect(signals[1]!.aborted).toBe(true)
})

it('does not substitute a new publication for a pinned selection', async () => {
  const entry = { environmentId: 'friends', environmentName: '好友环境', packages: [] }
  list.mockResolvedValueOnce([{ ...entry, id: 'a'.repeat(64) }])
  page = mount(PublicEnvironments, { props: { selection: 'publication/' + 'a'.repeat(64) } })
  await flushPromises()
  expect(page.get('article code').text()).toBe('a'.repeat(64))
  list.mockResolvedValueOnce([{ ...entry, id: 'b'.repeat(64), environmentName: '更新后的好友环境' }])
  await page.get('button').trigger('click')
  await flushPromises()
  expect(page.find('article').exists()).toBe(false)
  await page.setProps({ selection: 'publication/' + 'b'.repeat(64) })
  expect(page.get('article code').text()).toBe('b'.repeat(64))
  expect(page.get('article h3').text()).toBe('更新后的好友环境')
})
