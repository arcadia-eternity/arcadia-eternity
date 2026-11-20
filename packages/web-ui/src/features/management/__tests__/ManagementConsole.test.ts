import { ElMessageBox } from 'element-plus'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import LocalEnvironmentPage from '@/features/content/LocalEnvironmentPage.vue'
import { useLocalServerStore } from '@/stores/localServer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils'
import ManagementEnvironments from '../ManagementEnvironments.vue'
import ManagementPermissions from '../ManagementPermissions.vue'
import ServerEnvironmentPanel from '@/features/content/ServerEnvironmentPanel.vue'
import ManagementConsole from '../ManagementConsole.vue'
import type { ManagementIpcRequest } from '@/services/managementClient'
import type { ManagedEnvironment, ManagedEnvironmentInstallation } from '@/types/management'

vi.mock('@/bootstrap/deployment', () => ({ getBackendOrigin: () => 'https://paired.example' }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ session: null, serverUrl: 'https://paired.example', isAccount: false }),
}))

const pages: VueWrapper[] = []
const button = (page: VueWrapper, text: string) =>
  page.findAll('button, [role="menuitem"]').find(item => item.text() === text)!
const draft = (suffix = 'local'): ManagedEnvironment => ({
  revision: 'draft-4',
  document: {
    schemaVersion: 2,
    id: 'friends',
    name: `好友环境 ${suffix}`,
    packages: { '@test/ice': '1.0.0' },
    sources: [],
    rules: { schemaVersion: 1 },
    requires: {},
  },
})
const version = (suffix = 'local'): ManagedEnvironmentInstallation => ({
  installationId: `version-${suffix}`,
  environmentId: 'friends',
  workspaceId: `workspace-${suffix}`,
  document: draft(suffix).document,
  draftRevision: 'draft-4',
  contentRevision: 'content-1',
  packages: [],
  createdAt: 1793808000000,
  status: 'ready',
})
function response(path: string, suffix = 'local', readonly = false): unknown {
  if (path === '/session')
    return {
      principalId: 'admin',
      csrfToken: 'csrf-proof',
      serverId: `server-${suffix}`,
      workspaceId: `workspace-${suffix}`,
    }
  if (path === '/capabilities')
    return {
      serverId: `server-${suffix}`,
      workspaceId: `workspace-${suffix}`,
      supportedFeatures: ['workspace.environments', 'server.bindings', 'server.drain', 'operations', 'administrators'],
      isAdministrator: !readonly,
      resourceRestrictions: [],
    }
  if (path === '/servers')
    return {
      servers: [
        {
          id: `server-${suffix}`,
          revision: 9,
          name: `服务器 ${suffix}`,
          workspaceId: `workspace-${suffix}`,
          defaultBindingId: 'binding-main',
          draining: false,
          status: 'running',
        },
      ],
    }
  if (path.endsWith('/environments')) return { environments: [draft(suffix)], installations: [version(suffix)] }
  if (path.endsWith('/bindings'))
    return {
      bindings: [
        {
          id: 'binding-main',
          revision: 6,
          serverId: `server-${suffix}`,
          workspaceId: `workspace-${suffix}`,
          environmentId: 'friends',
          selection: 'pinned',
          enabled: true,
          visibility: 'public',
          matchmakingEnabled: false,
          condition: 'available',
        },
      ],
    }
  if (path === '/operations') return { operations: [] }
  if (path === '/administrators')
    return { revision: 7, administrators: [{ principalId: 'admin', displayName: 'Owner' }] }
  return {}
}
function bridge(readonly = false) {
  return vi.fn(async (request: ManagementIpcRequest) => ({
    status: 200,
    body:
      request.method === 'GET' ? response(request.path, 'local', readonly) : { id: 'operation-1', status: 'queued' },
  }))
}
async function open(request = bridge()) {
  vi.stubGlobal('arcadiaDesktop', { managementRequest: request })
  const page = mount(ManagementConsole, { global: { stubs: { RouterLink: RouterLinkStub } } })
  pages.push(page)
  await flushPromises()
  return { page, request }
}
async function openEnvironment(request = bridge()) {
  vi.stubGlobal('arcadiaDesktop', { managementRequest: request })
  const page = mount(ServerEnvironmentPanel, {
    props: { target: 'local' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  pages.push(page)
  await flushPromises()
  return { page, request }
}
beforeEach(() => vi.stubGlobal('arcadiaDesktop', undefined))
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.unstubAllGlobals()
})

describe('shared management console', () => {
  it.each([true, false])(
    'shares a single editor per workspace and saves at its captured revision (shared = %s)',
    async shared => {
      const builtin = { ...draft(), builtin: true, document: { ...draft().document, id: 'builtin', name: '默认环境' } }
      const extended = {
        ...builtin,
        document: { ...builtin.document, id: 'extended', name: '120 资质 · 神魔化与二代' },
      }
      const personal = draft('个人')
      const managed = shared ? personal : { ...draft('开服'), revision: 'host-revision' }
      const request = vi.fn(async (input: ManagementIpcRequest) => ({
        status: 200,
        body: input.path.endsWith('/environments')
          ? { environments: [builtin, extended, managed], installations: [version()] }
          : response(input.path),
      }))
      const localEnvironment = vi.fn(async (_input: Record<string, unknown>) => ({
        result: {
          workspaceId: shared ? 'workspace-local' : 'personal',
          selectedEnvironmentId: 'builtin',
          environments: [builtin, extended, personal],
          installations: [],
          operations: [],
        },
      }))
      vi.stubGlobal('arcadiaDesktop', {
        localEnvironment,
        managementRequest: request,
        localServer: async () => ({ host: { status: 'running' }, phase: 'running', configured: true }),
      })
      const pinia = createPinia()
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/environments', component: LocalEnvironmentPage }],
      })
      await router.push('/environments')
      const page = mount(LocalEnvironmentPage, {
        global: { plugins: [router, pinia], stubs: { RouterLink: RouterLinkStub } },
      })
      pages.push(page)
      await flushPromises()
      expect(request).not.toHaveBeenCalled()
      await useLocalServerStore(pinia).refresh()
      await flushPromises()
      const list = page.get('nav[aria-label="选择环境"]')
      expect(list.findAll('button').map(row => row.get('strong').text())).toEqual([
        '默认环境',
        '120 资质 · 神魔化与二代',
        '好友环境 个人',
      ])
      expect(page.find('[aria-label="服务器使用"]').exists()).toBe(true)
      await list.findAll('button')[2]!.trigger('click')
      expect(page.get('[aria-label="服务器使用"]').text()).toContain(managed.document.name)
      expect(page.find('[aria-label="环境来源"]').exists()).toBe(false)
      await button(page, '编辑').trigger('click')
      const form = () => page.get('form.environment-editor')
      await form().findAll('input')[0]!.setValue('个人修改')
      if (shared) {
        expect(button(page, '编辑本机服务器副本')).toBeUndefined()
        await form().trigger('submit')
        await flushPromises()
        expect(localEnvironment.mock.calls.filter(([input]) => input.action === 'apply')).toHaveLength(1)
        expect(request.mock.calls.some(([input]) => input.method === 'POST')).toBe(false)
        return
      }
      const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel')
      try {
        await button(page, '编辑本机服务器副本').trigger('click')
        await flushPromises()
        expect(confirm).toHaveBeenCalledOnce()
        expect((form().findAll('input')[0]!.element as HTMLInputElement).value).toBe('个人修改')
        await form().trigger('submit')
        await flushPromises()
        expect(localEnvironment).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'apply',
            expectedRevision: personal.revision,
            document: { ...personal.document, name: '个人修改' },
          }),
        )
        expect(request.mock.calls.some(([input]) => input.method === 'POST')).toBe(false)
      } finally {
        confirm.mockRestore()
      }
      await button(page, '编辑本机服务器副本').trigger('click')
      await flushPromises()
      expect((form().findAll('input')[0]!.element as HTMLInputElement).value).toBe('好友环境 开服')
      await form().findAll('input')[0]!.setValue('开服修改')
      await form().trigger('submit')
      await flushPromises()
      expect(
        request.mock.calls.map(([input]) => input).find(input => input.path.endsWith('/environments/apply'))?.body,
      ).toEqual({ document: { ...managed.document, name: '开服修改' }, expectedRevision: managed.revision })
      expect(localEnvironment.mock.calls.filter(([input]) => input.action === 'apply')).toHaveLength(1)
      expect(page.findAll('nav[aria-label="选择环境"]')).toHaveLength(1)
    },
  )
  it.each(['packageId', 'projectId'])('adds the selected %s to an editable personal environment', async key => {
    const builtin = { ...draft(), builtin: true, document: { ...draft().document, id: 'default' } }
    const localEnvironment = vi.fn(async (input: { action: string }) => ({
      result:
        input.action === 'snapshot'
          ? {
              selectedEnvironmentId: 'default',
              workspaceId: 'local',
              environments: [builtin, draft()],
              installations: [],
              operations: [],
            }
          : { operationId: 'apply-1' },
    }))
    const author = vi.fn(async ({ action }: { action: string }) => {
      if (action === 'list') return { result: [{ id: 'source', name: '寒霜' }] }
      if (action === 'jobs') return { result: [] }
      if (action === 'start') return { result: { kind: 'pack', jobId: 'pack', state: 'succeeded' } }
      if (action === 'install-built-author-pack') return { result: { packageId: 'installed' } }
      throw Error(action)
    })
    vi.stubGlobal('arcadiaDesktop', {
      author,
      localEnvironment,
      contentPackageAction: vi.fn(),
      listContentPackages: async () => ({ packages: [{ id: 'installed', name: '@test/ice', version: '2.0.0' }] }),
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/environments', component: LocalEnvironmentPage }],
    })
    await router.push({
      path: '/environments',
      query: { target: 'local', [key]: key === 'projectId' ? 'source' : 'installed' },
    })
    const page = mount(LocalEnvironmentPage, {
      global: { plugins: [router, createPinia()], stubs: { EnvironmentWorkspace: true } },
    })
    pages.push(page)
    await flushPromises()
    await page.get('form[aria-label="选择目标环境"]').trigger('submit')
    await flushPromises()
    expect(localEnvironment).toHaveBeenCalledWith({
      action: 'add-package',
      environmentId: 'friends',
      expectedRevision: 'draft-4',
      name: '@test/ice',
      version: '2.0.0',
      allowDownload: false,
    })
    expect(author.mock.calls.map(([input]) => input.action)).toEqual(
      key === 'projectId' ? ['list', 'jobs', 'start', 'install-built-author-pack'] : [],
    )
  })
  it('updates usage for the selected environment without adding it twice', async () => {
    let used = false
    const request = vi.fn(async (input: ManagementIpcRequest) => {
      if (input.method === 'POST' && input.path.endsWith('/bindings')) used = true
      if (input.method === 'DELETE' && input.path.endsWith('/bindings/binding-main')) used = false
      const body = response(input.path)
      if (input.path === '/servers')
        (body as { servers: { defaultBindingId?: string }[] }).servers[0].defaultBindingId = undefined
      if (input.path.endsWith('/bindings') && !used) return { status: 200, body: { bindings: [] } }
      return { status: 200, body }
    })
    const { page } = await openEnvironment(request)
    await flushPromises()
    const usage = () => page.get('[aria-label="服务器使用"]')
    expect(usage().text()).toContain('未使用')
    await button(page, '添加到本服').trigger('click')
    await flushPromises()
    expect(usage().text()).toContain('好友环境 local')
    expect(button(page, '添加到本服')).toBeUndefined()
    const controller = page.findComponent(ManagementEnvironments).props('controller')
    await Promise.all([controller.useEnvironment(version()), controller.useEnvironment(version())])
    expect(
      request.mock.calls.filter(([input]) => input.method === 'POST' && input.path.endsWith('/bindings')),
    ).toHaveLength(1)
    expect(page.text()).not.toContain('P2P 使用')
    await button(page, '停止使用').trigger('click')
    await button(page, '确认移除').trigger('click')
    await flushPromises()
    expect(usage().text()).toContain('未使用')
    expect(button(page, '添加到本服')).toBeDefined()
  })
  it('shows and updates server usage only for the selected environment', async () => {
    const second = { ...draft(), document: { ...draft().document, id: 'second', name: '第二环境' } }
    const request = vi.fn(async (input: ManagementIpcRequest) => {
      if (input.path.endsWith('/environments'))
        return {
          status: 200,
          body: {
            environments: [draft(), second],
            installations: [
              version(),
              { ...version(), installationId: 'version-second', environmentId: 'second', document: second.document },
            ],
          },
        }
      return { status: 200, body: response(input.path) }
    })
    const { page } = await openEnvironment(request)
    expect(page.get('[aria-label="服务器使用"]').text()).toContain('好友环境 local')
    await page.get('[aria-label="选择环境"]').findAll('button')[1]!.trigger('click')
    expect(page.get('[aria-label="服务器使用"]').text()).toContain('未使用')
    expect(page.get('[aria-label="服务器使用"]').text()).not.toContain('好友环境 local')
    await button(page, '添加到本服').trigger('click')
    await flushPromises()
    const write = request.mock.calls
      .map(([input]) => input)
      .find(input => input.method === 'POST' && input.path.endsWith('/bindings'))
    expect(write?.body).toMatchObject({ environmentId: 'second' })
  })
  it('adds and removes administrators with one revision-checked request each', async () => {
    const { page, request } = await open()
    await page.setProps({ initialTab: 'permissions' })
    await flushPromises()
    const controller = page.findComponent(ManagementPermissions).props('controller')
    await controller.addAdministrator('account-1')
    await controller.removeAdministrator('member-1')
    const writes = request.mock.calls.map(([input]) => input).filter(input => input.method !== 'GET')
    expect(writes).toHaveLength(2)
    expect(writes[0]).toMatchObject({
      path: '/administrators',
      method: 'POST',
      body: { accountId: 'account-1' },
      headers: { 'If-Match': '"7"' },
    })
    expect(writes[1]).toMatchObject({
      path: '/administrators/member-1',
      method: 'DELETE',
      headers: { 'If-Match': '"7"' },
    })
    expect(page.text()).not.toContain('管理主体标识')
    expect(page.text()).not.toContain('工作区管理员')
    expect(page.text()).not.toContain('角色')
  })
  it('navigates without discarding the console and follows a restored tab', async () => {
    const { page, request } = await open()
    const reads = request.mock.calls.length
    await button(page, '网络与容量').trigger('click')
    expect(page.emitted('navigate')?.at(-1)).toEqual([{ target: 'local', tab: 'network' }])
    await page.setProps({ initialTab: 'server' })
    expect(button(page, '概览').attributes('aria-current')).toBe('page')
    expect(request.mock.calls.length).toBe(reads)
  })

  it('keeps the settings draft and original revision when a server settings save conflicts', async () => {
    const settings = {
      host: '127.0.0.1',
      port: 8102,
      corsOrigins: [],
      battleCapacity: { maxConcurrentBattles: 32, maxIdleWorkers: 4, maxQueuedBattles: 64, battleQueueTimeoutMs: 5000 },
    }
    let revision = 9
    const request = vi.fn(async (input: ManagementIpcRequest) => {
      if (input.method === 'PATCH')
        return { status: 412, body: { error: { code: 'REVISION_CONFLICT', message: '服务器设置已被另一管理员更新' } } }
      if (input.path === '/servers')
        return {
          status: 200,
          body: {
            servers: [
              {
                id: 'server-local',
                revision,
                name: '本机服务器',
                workspaceId: 'workspace-local',
                draining: false,
                status: 'running',
                settings,
                runtimeSettings: settings,
              },
            ],
          },
        }
      return { status: 200, body: response(input.path) }
    })
    const { page } = await open(request)
    await button(page, '网络与容量').trigger('click')
    await button(page, '编辑设置').trigger('click')
    const form = page.get('[aria-label="网络与容量设置"] form')
    await form.get('input[name=port]').setValue('9100')
    revision = 10
    await button(page, '刷新').trigger('click')
    await flushPromises()
    await form.trigger('submit')
    await flushPromises()
    const save = request.mock.calls.map(([input]) => input).find(input => input.method === 'PATCH')!
    expect(save.headers?.['If-Match']).toBe('"9"')
    expect(save.body).toMatchObject({ settings: { port: 9100 } })
    expect(page.get('[role="alert"]').text()).toContain('另一管理员')
    expect((page.get('[aria-label="网络与容量设置"] input[name=port]').element as HTMLInputElement).value).toBe('9100')
  })

  it('loads real-shaped IPC data and saves an edited draft with its captured revision', async () => {
    const { page, request } = await openEnvironment()
    expect(page.text()).toContain('好友环境 local')
    await button(page, '编辑').trigger('click')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('修改的环境')
    await page.get('form.environment-editor').trigger('submit')
    await flushPromises()
    const save = request.mock.calls.map(([input]) => input).find(input => input.path.endsWith('/environments/apply'))!
    expect(save.path).toBe('/workspaces/workspace-local/environments/apply')
    expect(save.headers?.['If-Match']).toBeUndefined()
    expect(save.headers?.['Idempotency-Key']).toBeTruthy()
    expect(save.body).toEqual({ document: { ...draft().document, name: '修改的环境' }, expectedRevision: 'draft-4' })
  })

  it('creates a draft with an explicit absent revision then prepares the existing revision', async () => {
    const { page, request } = await openEnvironment()
    await button(page, '新建环境').trigger('click')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('新环境')
    await page.get('input[placeholder="friends"]').setValue('new-env')
    await page.get('form.environment-editor').trigger('submit')
    await flushPromises()
    const created = request.mock.calls
      .map(([input]) => input)
      .find(input => input.method === 'POST' && input.path.endsWith('/environments/apply'))!
    expect(created.path).toBe('/workspaces/workspace-local/environments/apply')
    expect(created.body).toMatchObject({
      document: { id: 'new-env', name: '新环境', schemaVersion: 2 },
      expectedRevision: null,
    })
    expect(created.headers?.['If-Match']).toBeUndefined()
    expect(page.text()).not.toContain('准备环境')
  })

  it('uses the newly saved revision for the next edit instead of leaving the editor permanently stale', async () => {
    let current = draft()
    const savedRevisions: string[] = []
    const request = vi.fn(async (input: ManagementIpcRequest) => {
      if (input.path.endsWith('/environments/apply') && input.method === 'POST') {
        const body = input.body as { document: ManagedEnvironment['document']; expectedRevision: string }
        if (body.expectedRevision !== current.revision)
          return { status: 412, body: { error: { code: 'REVISION_CONFLICT', message: '资源已更新' } } }
        savedRevisions.push(body.expectedRevision)
        current = { document: body.document, revision: `draft-${4 + savedRevisions.length}` }
        return { status: 200, body: current }
      }
      if (input.path.endsWith('/environments'))
        return { status: 200, body: { environments: [current], installations: [version()] } }
      return { status: 200, body: response(input.path) }
    })
    const { page } = await openEnvironment(request)
    await button(page, '编辑').trigger('click')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('第一次修改')
    await page.get('form.environment-editor').trigger('submit')
    await flushPromises()
    if (!page.find('form.environment-editor').exists()) await button(page, '编辑').trigger('click')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('第二次修改')
    await page.get('form.environment-editor').trigger('submit')
    await flushPromises()
    expect(savedRevisions).toEqual(['draft-4', 'draft-5'])
    expect(current.document.name).toBe('第二次修改')
    expect(page.find('.el-alert--error').exists()).toBe(false)
  })

  it('keeps unsaved edits visible when another administrator changed the draft', async () => {
    const request = vi.fn(async (input: ManagementIpcRequest) =>
      input.path.endsWith('/environments/apply')
        ? { status: 412, body: { error: { code: 'REVISION_CONFLICT', message: '资源已被另一管理员更新' } } }
        : { status: 200, body: response(input.path) },
    )
    const { page } = await openEnvironment(request)
    await button(page, '编辑').trigger('click')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('尚未保存的内容')
    await page.get('form.environment-editor').trigger('submit')
    await flushPromises()
    expect(page.get('[role="alert"]').text()).toContain('另一管理员')
    expect(page.find('form.environment-editor').exists()).toBe(true)
    expect((page.get('form.environment-editor').findAll('input')[0]!.element as HTMLInputElement).value).toBe(
      '尚未保存的内容',
    )
    expect(request.mock.calls.filter(([input]) => input.path.endsWith('/environments/apply'))).toHaveLength(1)
  })

  it('publishes the selected fixed version with the binding revision rather than the server revision', async () => {
    const { page, request } = await openEnvironment()
    await button(page, '重新加载').trigger('click')
    await flushPromises()
    const published = request.mock.calls.map(([input]) => input).find(input => input.path.endsWith('/reload'))!
    expect(published.path).toBe('/servers/server-local/bindings/binding-main/reload')
    expect(published.headers?.['If-Match']).toBe('"6"')
    expect(published.body).toEqual({})
  })

  it('does not expose management resources or mutations to non-administrators', async () => {
    const { page, request } = await open(bridge(true))
    expect(button(page, '新建环境')).toBeUndefined()
    expect(button(page, '重新加载')).toBeUndefined()
    expect(request.mock.calls.every(([input]) => input.method === 'GET')).toBe(true)
    expect(page.find('[aria-label="管理员"]').exists()).toBe(false)
  })

  it('uses the paired HTTP endpoint after a target switch and never paints a late local refresh into it', async () => {
    let completeLocal!: (value: { status: number; body: unknown }) => void
    const localEnvironments = new Promise<{ status: number; body: unknown }>(resolve => {
      completeLocal = resolve
    })
    const request = vi.fn(async (input: ManagementIpcRequest) =>
      input.path.endsWith('/environments') ? localEnvironments : { status: 200, body: response(input.path) },
    )
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = String(url).replace('https://paired.example/api/management/v1', '')
      return new Response(JSON.stringify(response(path, 'remote')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { page } = await open(request)
    await button(page, '当前部署服务器').trigger('click')
    await flushPromises()
    expect(page.text()).toContain('服务器 remote')
    completeLocal({ status: 200, body: response('/environments') })
    await flushPromises()
    expect(page.text()).toContain('服务器 remote')
    expect(page.text()).not.toContain('服务器 local')
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://paired.example/api/management/v1/')),
    ).toBe(true)
  })
  it('returns to public browsing after remote authority expires without touching the desktop bridge', async () => {
    let expired = false
    const local = bridge()
    vi.stubGlobal('arcadiaDesktop', { managementRequest: local })
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const path = String(url).replace('https://paired.example/api/management/v1', '')
      if (expired)
        return new Response(JSON.stringify({ error: { code: 'MANAGEMENT_UNAUTHENTICATED', message: '登录已过期' } }), {
          status: 401,
        })
      return new Response(JSON.stringify(response(path, 'remote')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const page = mount(ServerEnvironmentPanel, {
      props: { target: 'server' },
      global: { stubs: { RouterLink: RouterLinkStub, PublicEnvironments: { template: '<div>公开环境</div>' } } },
    })
    pages.push(page)
    await flushPromises()
    expect(page.text()).toContain('好友环境 remote')
    expect(button(page, '编辑')).toBeDefined()
    expired = true
    await button(page, '刷新').trigger('click')
    await flushPromises()
    expect(button(page, '编辑')).toBeUndefined()
    expect(page.text()).toContain('公开环境')
    expect(button(page, '管理员登录')).toBeDefined()
    expect(local).not.toHaveBeenCalled()
  })
})
