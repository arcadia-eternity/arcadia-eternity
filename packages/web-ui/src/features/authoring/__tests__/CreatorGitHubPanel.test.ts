import { mount, flushPromises } from '@vue/test-utils'
import { it, expect, vi } from 'vitest'
import CreatorGitHubPanel from '../CreatorGitHubPanel.vue'
import { authorCall } from '../types'

vi.mock('../types', () => ({ authorCall: vi.fn() }))

it('offers a private personal repository for a fresh package and recovers a partial bind without creating twice', async () => {
  const actions = vi.mocked(authorCall)
  actions.mockImplementation(async input => {
    switch (input.operation) {
      case 'account':
        return {
          login: 'player',
          installationUrl: 'https://github.com/apps/arcadia-eternity-creator/installations/new',
        }
      case 'repositories':
        return []
      case 'create':
        return { repository: 'player/frost', bound: false, error: '请重试绑定' }
      case 'bind':
        return {}
      default:
        throw Error(String(input.operation))
    }
  })
  const wrapper = mount(CreatorGitHubPanel, { props: { mode: 'sync', project: 'pack', projectName: 'frost' } })
  try {
    await flushPromises()
    expect(wrapper.get('input[aria-label="仓库名称"]').element).toHaveProperty('value', 'frost')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(actions).toHaveBeenCalledWith({
      action: 'creator-github',
      id: 'pack',
      operation: 'create',
      name: 'frost',
      private: true,
    })
    expect(wrapper.text()).toContain('player/frost')
    expect(wrapper.find('form').exists()).toBe(false)
    await wrapper.get('select[aria-label="授权仓库"]').setValue('player/frost')
    await wrapper
      .findAll('button')
      .find(button => button.text() === '绑定所选仓库')!
      .trigger('click')
    await flushPromises()
    expect(wrapper.emitted('bound')).toHaveLength(1)
    await wrapper.setProps({ hasRemote: true })
    expect(
      wrapper
        .findAll('button')
        .find(button => button.text() === '推送分支')
        ?.attributes('disabled'),
    ).toBeDefined()
    await wrapper.setProps({ hasCommit: true })
    expect(
      wrapper
        .findAll('button')
        .find(button => button.text() === '推送分支')
        ?.attributes('disabled'),
    ).toBeUndefined()
  } finally {
    wrapper.unmount()
  }
})
