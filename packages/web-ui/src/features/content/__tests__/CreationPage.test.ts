import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CreationPage from '../CreationPage.vue'
import { getVersionInfo } from '@/utils/version'
vi.mock('@/stores/privateRoom', () => ({ usePrivateRoomStore: () => ({ currentRoom: null }) }))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => ({}) }))
vi.mock('@/stores/petStorage', () => ({ usePetStorageStore: () => ({ teams: [] }) }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => ({}) }))
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})
it('lists editable UGC projects and removes only project registration', async () => {
  const project = { id: 'source', name: '森林', readOnly: false, directory: '/source' }
  const readonly = { ...project, id: 'installed', name: '发行材料', readOnly: true }
  let rows = [project, readonly]
  const author = vi.fn(async (input: { action: string }) => {
    if (input.action === 'forget') rows = [readonly]
    return { result: input.action === 'list' ? rows : project }
  })
  const install = vi.fn()
  vi.stubGlobal('arcadiaDesktop', { author, listContentPackages: install })
  const page = mount(CreationPage)
  await flushPromises()
  expect(page.text()).toContain('森林')
  expect(page.text()).not.toContain('发行材料')
  await page
    .findAll('button')
    .find(button => button.text() === '编辑项目')!
    .trigger('click')
  expect(push).toHaveBeenCalledWith({ name: 'AuthorWorkspace', params: { projectId: 'source' } })
  await page
    .findAll('button')
    .find(button => button.text() === '从列表移除')!
    .trigger('click')
  await flushPromises()
  expect(author).toHaveBeenCalledWith({ action: 'forget', id: 'source' })
  expect(page.findAll('.package-row')).toHaveLength(0)
  expect(install).not.toHaveBeenCalled()
  page.unmount()
})
it('keeps the initial empty state hidden until projects finish loading', async () => {
  let resolve!: (value: unknown) => void
  vi.stubGlobal('arcadiaDesktop', {
    author: () =>
      new Promise(done => {
        resolve = done
      }),
  })
  const page = mount(CreationPage)
  expect(page.find('p.list-note[role=status]').exists()).toBe(true)
  expect(page.text()).not.toContain('没有符合条件的内容包。')
  resolve({ result: [] })
  await flushPromises()
  expect(page.find('p.list-note[role=status]').exists()).toBe(false)
  expect(page.text()).toContain('没有符合条件的内容包。')
  page.unmount()
})

it('can register the installed CLI before opening a project', async () => {
  vi.stubEnv('PROD', true)
  const author = vi.fn(async ({ action }: { action: string }) => ({
    result:
      action === 'list' ? [] : { commandPath: '/user/bin/arcadia-content', pathDirectory: '/user/bin', onPath: false },
  }))
  vi.stubGlobal('arcadiaDesktop', { author })
  const page = mount(CreationPage)
  try {
    await flushPromises()
    await page
      .findAll('button')
      .find(button => button.text() === '安装终端命令')!
      .trigger('click')
    await flushPromises()
    expect(author).toHaveBeenCalledWith({ action: 'install-terminal-command' })
    expect(page.text()).toContain('/user/bin/arcadia-content')
    expect(page.text()).toContain('/user/bin 加入 PATH')
  } finally {
    page.unmount()
    vi.unstubAllEnvs()
  }
})

it('prefills the host compatibility range and submits the author’s override', async () => {
  const author = vi.fn(async (input: { action: string }) => ({
    result: input.action === 'list' ? [] : { id: 'new-pack' },
  }))
  vi.stubGlobal('arcadiaDesktop', { author })
  const page = mount(CreationPage, { global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    await page
      .findAll('button')
      .find(button => button.text() === '新建内容包')!
      .trigger('click')
    await flushPromises()
    const range = page.get<HTMLInputElement>('input[aria-label="Arcadia 兼容范围"]')
    expect(range.element.value).toBe('^' + getVersionInfo().version)
    await page.get('input[aria-label="内容包名称"]').setValue('示例')
    await range.setValue('bad range')
    expect(page.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await range.setValue('>=4.5 <5')
    await page.get('form').trigger('submit')
    expect(author).toHaveBeenCalledWith({ action: 'create', name: '示例', arcadiaRange: '>=4.5 <5' })
  } finally {
    page.unmount()
  }
})
