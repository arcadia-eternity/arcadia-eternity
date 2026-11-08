import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ManagementConsole from '../ManagementConsole.vue'
import type { ManagementIpcRequest } from '@/services/managementClient'
import type { ManagedEnvironment, ManagedEnvironmentVersion } from '@/types/management'

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
const version = (suffix = 'local'): ManagedEnvironmentVersion => ({
  versionId: `version-${suffix}`,
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
      supportedFeatures: ['workspace.environments', 'server.bindings', 'server.drain', 'operations', 'grants'],
      effectivePermissions: [
        {
          scope: { kind: 'workspace', id: `workspace-${suffix}` },
          actions: readonly
            ? ['read']
            : ['read', 'environment.use', 'edit', 'prepare', 'delete', 'export', 'grants.manage'],
        },
        {
          scope: { kind: 'server', id: `server-${suffix}` },
          actions: readonly
            ? ['read']
            : ['read', 'bindings.manage', 'publish', 'settings.manage', 'drain', 'grants.manage'],
        },
      ],
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
  if (path.endsWith('/environments')) return { environments: [draft(suffix)], versions: [version(suffix)] }
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
          desiredVersionId: `version-${suffix}`,
          effectiveVersionId: `version-${suffix}`,
          enabled: true,
          visibility: 'public',
          matchmakingEnabled: false,
          condition: 'available',
        },
      ],
    }
  if (path === '/operations') return { operations: [] }
  if (path === '/grants') return { grants: [] }
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
  const page = mount(ManagementConsole)
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
    const { page, request } = await open()
    expect(page.get('.management-context').text()).toContain('本机服务器')
    expect(page.text()).toContain('好友环境 local')
    await button(page, '编辑').trigger('click')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('修改的环境')
    await page.get('form.environment-editor').trigger('submit')
    await flushPromises()
    const save = request.mock.calls.map(([input]) => input).find(input => input.method === 'PATCH')!
    expect(save.path).toBe('/workspaces/workspace-local/environments/friends')
    expect(save.headers?.['If-Match']).toBe('"draft-4"')
    expect(save.headers?.['Idempotency-Key']).toBeTruthy()
    expect(save.body).toEqual({ document: { ...draft().document, name: '修改的环境' }, expectedRevision: 'draft-4' })
  })

  it('creates a draft with an explicit absent revision then prepares the existing revision', async () => {
    const { page, request } = await open()
    await button(page, '新建环境').trigger('click')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('新环境')
    await page.get('input[placeholder="friends"]').setValue('new-env')
    await page.get('form.environment-editor').trigger('submit')
    await flushPromises()
    const created = request.mock.calls
      .map(([input]) => input)
      .find(input => input.method === 'POST' && input.path.endsWith('/environments'))!
    expect(created.path).toBe('/workspaces/workspace-local/environments')
    expect(created.body).toMatchObject({
      document: { id: 'new-env', name: '新环境', schemaVersion: 2 },
      expectedRevision: null,
    })
    expect(created.headers?.['If-Match']).toBeUndefined()
    await button(page, '准备版本').trigger('click')
    await flushPromises()
    const prepared = request.mock.calls.map(([input]) => input).find(input => input.path.endsWith('/prepare'))!
    expect(prepared.path).toBe('/workspaces/workspace-local/environments/friends/prepare')
    expect(prepared.body).toEqual({ expectedRevision: 'draft-4' })
    expect(prepared.headers?.['If-Match']).toBe('"draft-4"')
    expect(page.find('[aria-label="管理任务"]').exists()).toBe(true)
  })

  it('uses the newly saved revision for the next edit instead of leaving the editor permanently stale', async () => {
    let current = draft()
    const savedRevisions: string[] = []
    const request = vi.fn(async (input: ManagementIpcRequest) => {
      if (input.path.endsWith('/environments/friends') && input.method === 'PATCH') {
        const body = input.body as { document: ManagedEnvironment['document']; expectedRevision: string }
        if (body.expectedRevision !== current.revision)
          return { status: 412, body: { error: { code: 'REVISION_CONFLICT', message: '资源已更新' } } }
        savedRevisions.push(body.expectedRevision)
        current = { document: body.document, revision: `draft-${4 + savedRevisions.length}` }
        return { status: 200, body: current }
      }
      if (input.path.endsWith('/environments'))
        return { status: 200, body: { environments: [current], versions: [version()] } }
      return { status: 200, body: response(input.path) }
    })
    const { page } = await open(request)
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
      input.method === 'PATCH'
        ? { status: 412, body: { error: { code: 'REVISION_CONFLICT', message: '资源已被另一管理员更新' } } }
        : { status: 200, body: response(input.path) },
    )
    const { page } = await open(request)
    await button(page, '编辑').trigger('click')
    await page.get('form.environment-editor').findAll('input')[0]!.setValue('尚未保存的内容')
    await page.get('form.environment-editor').trigger('submit')
    await flushPromises()
    expect(page.get('[role="alert"]').text()).toContain('另一管理员')
    expect(page.find('form.environment-editor').exists()).toBe(true)
    expect((page.get('form.environment-editor').findAll('input')[0]!.element as HTMLInputElement).value).toBe(
      '尚未保存的内容',
    )
    expect(request.mock.calls.filter(([input]) => input.method === 'PATCH')).toHaveLength(1)
  })

  it('publishes the selected fixed version with the binding revision rather than the server revision', async () => {
    const { page, request } = await open()
    await button(page, '运行环境').trigger('click')
    await button(page, '发布所选版本').trigger('click')
    await flushPromises()
    const published = request.mock.calls.map(([input]) => input).find(input => input.path.endsWith('/publish'))!
    expect(published.path).toBe('/servers/server-local/bindings/binding-main/publish')
    expect(published.headers?.['If-Match']).toBe('"6"')
    expect(published.body).toEqual({ versionId: 'version-local' })
  })

  it('keeps the server catalogue readable but makes no publishing request for a viewer', async () => {
    const { page, request } = await open(bridge(true))
    expect(button(page, '新建环境').attributes('disabled')).toBeDefined()
    await button(page, '运行环境').trigger('click')
    expect(page.text()).toContain('实际版本')
    expect(button(page, '发布所选版本').attributes('disabled')).toBeDefined()
    await button(page, '发布所选版本').trigger('click')
    expect(request.mock.calls.every(([input]) => input.method === 'GET')).toBe(true)
    expect(page.find('[aria-label="管理员授权"]').exists()).toBe(false)
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
    expect(page.text()).toContain('好友环境 remote')
    completeLocal({ status: 200, body: response('/environments') })
    await flushPromises()
    expect(page.text()).toContain('好友环境 remote')
    expect(page.text()).not.toContain('好友环境 local')
    expect(
      fetchMock.mock.calls.every(([url]) => String(url).startsWith('https://paired.example/api/management/v1/')),
    ).toBe(true)
  })
})
