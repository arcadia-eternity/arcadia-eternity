import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PublicEnvironments from '../PublicEnvironments.vue'
const { list } = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/bootstrap/deployment', () => ({ getBackendOrigin: () => 'https://paired.example' }))
vi.mock('@/services/serverEnvironment', () => ({ listServerEnvironments: list }))
let page: ReturnType<typeof mount> | undefined
afterEach(() => {
  page?.unmount()
  vi.clearAllMocks()
})
it('lists published environments and shows only the selected recipe packages', async () => {
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
