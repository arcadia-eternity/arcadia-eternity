import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ContentProjectsPanel from '../ContentProjectsPanel.vue'
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
  const page = mount(ContentProjectsPanel)
  await flushPromises()
  expect(page.text()).toContain('森林')
  expect(page.text()).not.toContain('发行材料')
  await page.get('.project').trigger('click')
  expect(push).toHaveBeenCalledWith({ name: 'AuthorWorkspace', params: { projectId: 'source' } })
  await page
    .findAll('button')
    .find(button => button.text() === '从列表移除')!
    .trigger('click')
  await flushPromises()
  expect(author).toHaveBeenCalledWith({ action: 'forget', id: 'source' })
  expect(page.findAll('li')).toHaveLength(0)
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
  const page = mount(ContentProjectsPanel)
  expect(page.find('[aria-label="正在加载项目"]').exists()).toBe(true)
  expect(page.text()).not.toContain('暂无项目')
  resolve({ result: [] })
  await flushPromises()
  expect(page.find('[aria-label="正在加载项目"]').exists()).toBe(false)
  expect(page.text()).toContain('暂无项目')
  page.unmount()
})
