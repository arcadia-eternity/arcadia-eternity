import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import CreationPage from '../CreationPage.vue'
import CreationStart from '../CreationStart.vue'
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
  expect(push).toHaveBeenLastCalledWith({
    name: 'AuthorWorkspace',
    params: { projectId: 'source' },
    query: { view: 'editor' },
  })
  await page
    .findAll('button')
    .find(button => button.text() === '连接 AI 助手')!
    .trigger('click')
  expect(push).toHaveBeenLastCalledWith({
    name: 'AuthorWorkspace',
    params: { projectId: 'source' },
    query: { view: 'ai' },
  })
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
  expect(page.text()).not.toContain('本机还没有创作项目')
  resolve({ result: [] })
  await flushPromises()
  expect(page.find('p.list-note[role=status]').exists()).toBe(false)
  expect(page.text()).toContain('本机还没有创作项目')
  await page.get('input[type="search"]').setValue('森林')
  expect(page.text()).toContain('没有符合条件的内容包。')
  page.unmount()
})

it.each([
  {
    shell: 'posix',
    directory: "/Users/O'Brien $Tools & Co/bin/",
    prefix: "'/Users/O'\\''Brien $Tools & Co/bin/",
    suffix: '',
  },
  {
    shell: 'powershell',
    directory: "C:\\O'Brien $Tools & Co\\bin\\",
    prefix: "& 'C:\\O''Brien $Tools & Co\\bin\\",
    suffix: '.cmd',
  },
])(
  'shows absolute paths and copies runnable $shell commands before opening a project',
  async ({ shell, directory, prefix, suffix }) => {
    const commandPaths = {
      arcadia: directory + 'arcadia' + suffix,
      'arcadia-content': directory + 'arcadia-content' + suffix,
    }
    const author = vi.fn(async ({ action }: { action: string }) => ({
      result: action === 'list' ? [] : { commandPaths, shell },
    }))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    vi.stubGlobal('arcadiaDesktop', { author })
    const page = mount(CreationPage, { global: { stubs: { teleport: true } } })
    try {
      await flushPromises()
      await page.get('.copy-button').trigger('click')
      await flushPromises()
      const prompt = writeText.mock.lastCall?.[0]
      expect(prompt).toContain(prefix + 'arcadia-content' + suffix + "' commands --json")
      expect(prompt).toContain('init pack')
      expect(prompt).toContain('init environment')
      expect(prompt).toContain('workspace <项目目录> describe')
      await page
        .findAll('button')
        .find(button => button.text() === '终端命令')!
        .trigger('click')
      await flushPromises()
      expect(author.mock.calls.map(([input]) => input.action)).toEqual([
        'list',
        'terminal-command-paths',
        'terminal-command-paths',
      ])
      expect(page.findAll('.command-path').map(path => path.text())).toEqual(Object.values(commandPaths))
      for (const name of ['arcadia', 'arcadia-content']) {
        const expected = prefix + name + suffix + "' --help"
        const field = page.get<HTMLInputElement>('input[name="' + name + '"]')
        expect(field.element.value).toBe(expected)
        expect(field.element.readOnly).toBe(true)
        await page.get('button[aria-label="复制 ' + name + ' 命令"]').trigger('click')
        expect(writeText).toHaveBeenLastCalledWith(expected)
      }
      writeText.mockRejectedValueOnce(new Error('clipboard denied'))
      await page.get('button[aria-label="复制 arcadia 命令"]').trigger('click')
      await flushPromises()
      const fallback = page.get<HTMLInputElement>('input[name="arcadia"]').element
      expect(fallback.selectionStart).toBe(0)
      expect(fallback.selectionEnd).toBe(fallback.value.length)
      expect(page.text()).toContain('请手动复制所选命令')
      expect(page.text()).not.toContain('PATH')
    } finally {
      page.unmount()
    }
  },
)

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

it('shows creation errors inside the dialog and keeps the name for retry', async () => {
  let writable = false
  const author = vi.fn(async ({ action }: { action: string }) => {
    if (action === 'list') return { result: [] }
    return writable ? { result: { id: 'forest' } } : { error: { message: '目录不可写' } }
  })
  vi.stubGlobal('arcadiaDesktop', { author })
  const page = mount(CreationPage, { global: { stubs: { teleport: true } } })
  try {
    await flushPromises()
    await page
      .findAll('button')
      .find(button => button.text() === '新建内容包')!
      .trigger('click')
    await flushPromises()
    const dialog = page.get('[role="dialog"][aria-label="新建内容包"]')
    const name = dialog.get<HTMLInputElement>('input[aria-label="内容包名称"]')
    await name.setValue('森林')
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(dialog.get('[role="alert"]').text()).toContain('目录不可写')
    expect(name.element.value).toBe('森林')
    expect(dialog.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    writable = true
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(push).toHaveBeenLastCalledWith({
      name: 'AuthorWorkspace',
      params: { projectId: 'forest' },
      query: { view: 'editor' },
    })
  } finally {
    page.unmount()
  }
})

it('provides a web starter without a desktop bridge and selects the prompt when copying fails', async () => {
  const page = mount(CreationStart, { global: { stubs: { RouterLink: true } } })
  try {
    await page.get('.copy-button').trigger('click')
    await flushPromises()
    const field = page.get<HTMLTextAreaElement>('textarea').element
    expect(field.value).toContain('npm exec --package=@arcadia-eternity/content-sdk@' + getVersionInfo().version)
    expect(field.value).toContain('Node.js 24')
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(field.value.length)
  } finally {
    page.unmount()
  }
})
