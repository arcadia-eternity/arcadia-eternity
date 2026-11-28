import { mount, flushPromises } from '@vue/test-utils'
import { it, expect, vi } from 'vitest'
import AuthorGitWorkspace from '../AuthorGitWorkspace.vue'
import { authorCall } from '../types'

vi.mock('../types', () => ({ authorCall: vi.fn(), jobStates: { succeeded: '已通过' } }))

it('asks for a lockfile before a release and generates it from the release view', async () => {
  const actions = vi.mocked(authorCall)
  actions.mockImplementation(async input =>
    input.action === 'git' ? { repository: true, branch: 'main', tags: [], files: [] } : undefined,
  )
  const props = {
    project: 'pack',
    projectName: 'Frost',
    message: '',
    releaseOpen: true,
    dirty: false,
    running: false,
    version: '0.1.0',
  }
  const wrapper = mount(AuthorGitWorkspace, {
    props: { ...props, hasLock: false },
    global: { stubs: { CreatorGitHubPanel: true } },
  })
  try {
    await flushPromises()
    expect(wrapper.text()).toContain('缺少 package-lock.json')
    const generate = wrapper.findAll('button').find(button => button.text() === '生成 npm 锁文件')!
    expect(generate.classes()).toContain('primary')
    expect(
      wrapper
        .findAll('button')
        .find(button => button.text() === '检查并生成发行包')!
        .classes(),
    ).not.toContain('primary')
    await generate.trigger('click')
    await flushPromises()
    expect(actions).toHaveBeenCalledWith({ action: 'update-author-lock', id: 'pack' })

    await wrapper.setProps({ hasLock: true })
    expect(wrapper.text()).not.toContain('缺少 package-lock.json')
    expect(wrapper.findAll('button').some(button => button.text() === '更新 npm 锁文件')).toBe(true)
  } finally {
    wrapper.unmount()
  }
})
