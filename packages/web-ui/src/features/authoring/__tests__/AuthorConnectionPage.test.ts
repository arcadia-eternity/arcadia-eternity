import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import AuthorConnectionPage from '../AuthorConnectionPage.vue'

afterEach(() => vi.unstubAllGlobals())
it('builds the prompt for the open project and respects read-only access', async () => {
  const projects = [
    { id: 'first', name: '森林', directory: '/source/forest', readOnly: false },
    { id: 'base', name: '基础包', directory: '/source/base', readOnly: true },
  ]
  const author = vi.fn(async (input: { action: string; id?: string; execute?: boolean }) => {
    return {
      result: {
        mcpServers: {
          arcadia: {
            command: 'node',
            args: [input.id, ...(input.id === 'base' ? ['--read-only'] : input.execute ? ['--execute'] : [])],
            env: {},
          },
        },
      },
    }
  })
  vi.stubGlobal('arcadiaDesktop', { author })
  const page = mount(AuthorConnectionPage, { props: { project: projects[0]!, readOnly: false, contextError: '' } })
  try {
    await flushPromises()
    await page.get('input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(author).toHaveBeenCalledWith({ action: 'connection', id: 'first', execute: true })
    const client = page.get('select')
    await client.setValue('VS Code')
    const settings = () => page.get('pre').text()
    expect(JSON.parse(settings())).toEqual({
      servers: { arcadia: { type: 'stdio', command: 'node', args: ['first', '--execute'], env: {} } },
    })
    await client.setValue('Codex')
    expect(settings()).toContain('[mcp_servers.arcadia]')
    expect(settings()).toContain('args = ["first","--execute"]')
    await client.setValue('Claude Code')
    expect(page.get('.code-header code').text()).toBe('.mcp.json')
    await client.setValue('Cursor')
    expect(page.get('.code-header code').text()).toBe('.cursor/mcp.json')
    expect(JSON.parse(settings()).mcpServers.arcadia.args).toEqual(['first', '--execute'])
    const copyPrompt = async () => {
      await page
        .findAll('button')
        .find(button => button.text() === '复制连接提示词')!
        .trigger('click')
      await flushPromises()
      return page.get('textarea').element.value
    }
    expect(await copyPrompt()).toContain('gh 或 GitHub 连接')
    await page.setProps({ project: projects[1]!, readOnly: true })
    await flushPromises()
    expect(author).toHaveBeenCalledWith({ action: 'connection', id: 'base', execute: false })
    expect(page.text()).toContain('只读访问')
    expect(page.text()).not.toContain('允许运行测试')
    const readOnlyPrompt = await copyPrompt()
    expect(readOnlyPrompt).toContain('--read-only')
    expect(readOnlyPrompt).not.toContain('--execute')
    expect(readOnlyPrompt).not.toContain('GitHub 连接')
  } finally {
    page.unmount()
  }
})
