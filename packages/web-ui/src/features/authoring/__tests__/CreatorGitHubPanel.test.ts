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

it('shows the install link automatically once the archive is public and copies the versioned URL', async () => {
  vi.useFakeTimers()
  const target = { tag: 'v1.2.0', repository: 'player/frost', packageRepositoryMatches: true, tagged: true }
  const archive = 'https://github.com/player/frost/releases/download/v1.2.0/frost-1.2.0.tgz'
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  let release: { tag: string; archive: string; visibility: string } | undefined
  vi.mocked(authorCall).mockImplementation(async input =>
    input.operation === 'account' ? { login: 'player' } : { target, release },
  )
  const wrapper = mount(CreatorGitHubPanel, { props: { mode: 'release', project: 'pack' } })
  try {
    await flushPromises()
    expect(wrapper.find('[aria-label="安装链接"]').exists()).toBe(false)
    release = { tag: target.tag, archive, visibility: 'public' }
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(wrapper.get('[aria-label="发行结果"]').text()).toContain('v1.2.0 已发布')
    expect(wrapper.get('input[aria-label="安装链接"]').element).toHaveProperty('value', archive)
    await wrapper.get('.share-link button').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(archive)
    expect(wrapper.text()).toContain('已复制安装链接')

    release = { ...release, visibility: 'private' }
    await vi.advanceTimersByTimeAsync(20000)
    await flushPromises()
    expect(wrapper.find('[aria-label="安装链接"]').exists()).toBe(false)
    expect(wrapper.get('[aria-label="发行结果"]').text()).toContain('发送 .tgz 文件')
  } finally {
    wrapper.unmount()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  }
})
