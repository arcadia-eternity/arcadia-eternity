import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AuthorWorkspacePage from '../AuthorWorkspacePage.vue'
import type { AuthorJob, AuthorSnapshot, SourceProject } from '../types'

const project: SourceProject = { id: 'source-project', name: '测试内容包', directory: '/test/project' }
const snapshot: AuthorSnapshot = {
  root: project.directory,
  name: project.name,
  project: { projectId: 'test-pack', namespace: 'test-pack', sdkApi: 2 },
  records: [],
  files: [],
  assets: [],
  locales: {},
  localeSources: [],
  diagnostics: [],
}
const pack: AuthorJob = {
  jobId: 'built-pack',
  kind: 'pack',
  state: 'succeeded',
  stale: false,
  sourceRevision: 'source-revision',
  output: '',
  diagnostics: [],
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  delete window.arcadiaDesktop
})

async function openWorkspace(receipts: AuthorJob[] = [pack], identity = snapshot.project) {
  let finishInstall!: (value: { result?: unknown; error?: { code: string; message: string } }) => void
  const install = new Promise<{ result?: unknown; error?: { code: string; message: string } }>(resolve => {
    finishInstall = resolve
  })
  const current = { ...snapshot, project: identity, arcadiaRange: '^4.6.0' }
  const author = vi.fn(async (input: Record<string, unknown>) => {
    switch (input.action) {
      case 'list':
        return { result: [project] }
      case 'snapshot':
        return { result: { ...current } }
      case 'save-arcadia-range':
        if (input.expectedRange !== current.arcadiaRange)
          return { error: { code: 'REVISION_CONFLICT', message: '外部修改' } }
        current.arcadiaRange = String(input.range)
        return { result: null }
      case 'jobs':
        return { result: receipts }
      case 'start':
        return { result: { ...pack, jobId: 'rebuilt', state: 'running' } }
      case 'install-built-author-pack':
        return install
      default:
        return { result: null }
    }
  })
  window.arcadiaDesktop = { author } as unknown as NonNullable<Window['arcadiaDesktop']>
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/creation', component: { template: '<div>创作</div>' } },
      { path: '/creation/edit/:projectId', name: 'AuthorWorkspace', component: AuthorWorkspacePage },
      { path: '/environments', component: { template: '<div>环境</div>' } },
    ],
  })
  await router.push(`/creation/edit/${project.id}`)
  const wrapper = mount(RouterView, { global: { plugins: [createPinia(), router] } })
  await flushPromises()
  await wrapper.get('a[href$="view=settings"]').trigger('click')
  const label = identity.kind === 'environment' ? '调试试玩' : '用于环境'
  await vi.waitFor(
    () =>
      expect(wrapper.get('[aria-label="项目设置"]').text()).toContain(
        identity.kind === 'environment' ? identity.id : label,
      ),
    { timeout: 2500 },
  )
  const button = wrapper.findAll('button').find(button => button.text().endsWith(label))!
  return { wrapper, router, button, author, finishInstall, current }
}

it('blocks leaving during installation, then opens environments with the installed package', async () => {
  const { wrapper, router, button, author, finishInstall } = await openWorkspace()
  try {
    await button.trigger('click')
    expect(author).toHaveBeenCalledWith({ action: 'install-built-author-pack', id: project.id, jobId: pack.jobId })
    await router.push('/creation')
    expect(router.currentRoute.value.path).toBe(`/creation/edit/${project.id}`)
    expect(button.attributes('disabled')).toBeDefined()
    finishInstall({ result: { packageId: 'installed-package' } })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/environments')
    expect(router.currentRoute.value.query).toEqual({ target: 'local', packageId: 'installed-package' })
  } finally {
    wrapper.unmount()
  }
})

it('keeps the editor available and shows the installation error when installation fails', async () => {
  const { wrapper, router, button, finishInstall } = await openWorkspace()
  try {
    await button.trigger('click')
    finishInstall({ error: { code: 'INSTALL_FAILED', message: '内容包安装失败' } })
    await flushPromises()
    expect(router.currentRoute.value.path).toBe(`/creation/edit/${project.id}`)
    expect(wrapper.get('[role="alert"]').text()).toBe('内容包安装失败')
    expect(button.attributes('disabled')).toBeUndefined()
    await router.push('/creation')
    expect(router.currentRoute.value.path).toBe('/creation')
  } finally {
    wrapper.unmount()
  }
})

it('rebuilds after a failed pack and installs only that new successful build', async () => {
  const receipts = [
    { ...pack, jobId: 'failed', state: 'failed' },
    { ...pack, stale: true },
  ]
  const { wrapper, button, author, finishInstall } = await openWorkspace(receipts)
  try {
    expect(button.text()).toBe('重新构建并用于环境')
    await button.trigger('click')
    expect(author).toHaveBeenCalledWith({ action: 'start', kind: 'pack', id: project.id })
    expect(author).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'install-built-author-pack' }))
    receipts.unshift({ ...pack, jobId: 'rebuilt' })
    await vi.waitFor(
      () =>
        expect(author).toHaveBeenCalledWith({ action: 'install-built-author-pack', id: project.id, jobId: 'rebuilt' }),
      { timeout: 2500 },
    )
    finishInstall({ result: { packageId: 'new-package' } })
    await flushPromises()
  } finally {
    wrapper.unmount()
  }
})

it('edits the opened project range, preserves conflicting input and supports clearing the requirement', async () => {
  const { wrapper, author, current } = await openWorkspace()
  try {
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Arcadia 兼容范围"]')
    const submit = wrapper.get('form button[type="submit"]')
    expect(input.element.value).toBe('^4.6.0')
    await input.setValue('abc')
    expect(submit.attributes('disabled')).toBeDefined()
    await input.setValue('~4.6.0')
    current.arcadiaRange = '^5.0.0'
    await submit.trigger('submit')
    await flushPromises()
    expect(input.element.value).toBe('~4.6.0')
    expect(wrapper.text()).toContain('文件中的范围已变为 ^5.0.0')
    expect(submit.text()).toBe('覆盖并保存范围')
    await submit.trigger('submit')
    await flushPromises()
    expect(author).toHaveBeenCalledWith({
      action: 'save-arcadia-range',
      id: project.id,
      range: '~4.6.0',
      expectedRange: '^5.0.0',
    })
    expect(submit.attributes('disabled')).toBeDefined()
    await input.setValue('')
    await submit.trigger('submit')
    await flushPromises()
    expect(current.arcadiaRange).toBe('')
  } finally {
    wrapper.unmount()
  }
})

it('opens a standalone environment source with its own debug action and AI connection', async () => {
  const { wrapper, router, button, author } = await openWorkspace([], { kind: 'environment', id: 'league' })
  try {
    await router.push({ query: { view: 'editor' } })
    await flushPromises()
    expect(wrapper.get('a[href$="view=settings"]').attributes('aria-current')).toBe('page')
    expect(wrapper.get('.project-metadata').text()).toContain('league')
    expect(wrapper.find('a[href$="view=editor"]').exists()).toBe(false)
    expect(wrapper.find('a[href$="view=release"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('构建内容包')
    await button.trigger('click')
    await flushPromises()
    expect(author).toHaveBeenCalledWith({ action: 'start', kind: 'preview', id: project.id })
    await wrapper.get('a[href$="view=ai"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('列出这个环境依赖的资料包')
    expect(author).toHaveBeenCalledWith({ action: 'connection', id: project.id, execute: false })
  } finally {
    wrapper.unmount()
  }
})

it('builds a standalone environment archive without installing it as a content pack', async () => {
  const { wrapper, author } = await openWorkspace([pack], { kind: 'environment', id: 'league' })
  try {
    expect(wrapper.text()).not.toContain('用于环境')
    await wrapper
      .findAll('button')
      .find(button => button.text() === '构建环境包')!
      .trigger('click')
    await flushPromises()
    expect(author).toHaveBeenCalledWith({ action: 'start', kind: 'pack', id: project.id })
    expect(author).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'install-built-author-pack' }))
  } finally {
    wrapper.unmount()
  }
})
