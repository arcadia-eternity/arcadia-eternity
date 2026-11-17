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

async function openWorkspace() {
  let finishInstall!: (value: { result?: unknown; error?: { code: string; message: string } }) => void
  const install = new Promise<{ result?: unknown; error?: { code: string; message: string } }>(resolve => {
    finishInstall = resolve
  })
  const author = vi.fn(async (input: Record<string, unknown>) => {
    switch (input.action) {
      case 'list':
        return { result: [project] }
      case 'snapshot':
        return { result: snapshot }
      case 'jobs':
        return { result: [pack] }
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
  await wrapper.get('button.project-switch').trigger('click')
  await vi.waitFor(() => expect(wrapper.text()).toContain('用于环境'), { timeout: 2500 })
  const button = wrapper.findAll('button').find(button => button.text() === '用于环境')!
  return { wrapper, router, button, author, finishInstall }
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
