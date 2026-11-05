import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ManagementConsole from '../ManagementConsole.vue'
import type { ManagementIpcRequest } from '@/services/managementClient'
import type { ManagementCapabilities, ManagementOperation } from '@/types/management'

vi.mock('@/bootstrap/deployment', () => ({ getBackendOrigin: () => 'https://paired.example' }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ session: null, serverUrl: 'https://paired.example', isAccount: false }),
}))
const id = 'a'.repeat(64)
const completed = (): ManagementOperation => ({
  id,
  kind: 'server.backup',
  status: 'succeeded',
  result: {
    downloadPath: `/api/management/v1/backups/${id}`,
    filename: 'server-backup.json',
    bytes: 1234,
    expiresAt: Date.now() + 60000,
  },
})
const cap = (suffix = 'local'): ManagementCapabilities => ({
  serverId: `server-${suffix}`,
  workspaceId: `workspace-${suffix}`,
  supportedFeatures: ['server.backup', 'operations'],
  effectivePermissions: [
    { scope: { kind: 'server', id: `server-${suffix}` }, actions: ['read', 'backup'] },
    { scope: { kind: 'workspace', id: `workspace-${suffix}` }, actions: ['export'] },
  ],
  resourceRestrictions: [],
})
function rows(path: string, operations: ManagementOperation[], capabilities = cap()) {
  if (path === '/session') return { csrfToken: 'csrf' }
  if (path === '/capabilities') return capabilities
  if (path === '/servers')
    return {
      servers: [
        {
          id: capabilities.serverId,
          revision: 1,
          name: '测试服务器',
          workspaceId: capabilities.workspaceId,
          draining: false,
          status: 'available',
        },
      ],
    }
  if (path === '/operations') return { operations }
  return {}
}
const pages: VueWrapper[] = []
const button = (page: VueWrapper, name: string) =>
  page
    .findAll('button')
    .find(item => (name === '操作记录与备份' ? item.text().startsWith(name) : item.text() === name))!
const nativeURL = URL
const createObjectURL = vi.fn(() => 'blob:backup-download')
const revokeObjectURL = vi.fn()
beforeEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  vi.stubGlobal(
    'URL',
    class extends nativeURL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    },
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function open(request: (input: ManagementIpcRequest) => Promise<{ status: number; body: unknown }>) {
  vi.stubGlobal('arcadiaDesktop', { managementRequest: request })
  const page = mount(ManagementConsole)
  pages.push(page)
  await flushPromises()
  return page
}

describe('whole-server backup controls', () => {
  it('starts a durable task explicitly, downloads only on request, and revokes its object URL on unmount', async () => {
    let operations: ManagementOperation[] = []
    const request = vi.fn(async (input: ManagementIpcRequest) => {
      if (input.method === 'POST' && input.path === '/servers/server-local/backup') {
        operations = [
          {
            id,
            kind: 'server.backup',
            status: 'running',
            progress: { stage: 'snapshot', message: '正在创建一致性快照' },
          },
        ]
        return { status: 202, body: operations[0] }
      }
      return {
        status: 200,
        body: input.path === `/backups/${id}` ? { format: 'arcadia.server-backup/1' } : rows(input.path, operations),
      }
    })
    const page = await open(request)
    expect(request.mock.calls.every(([input]) => input.method === 'GET')).toBe(true)
    await button(page, '操作记录与备份').trigger('click')
    await button(page, '创建服务器备份').trigger('click')
    await flushPromises()
    expect(page.get('[aria-label="管理任务"]').text()).toContain('正在创建一致性快照')
    expect(button(page, '取消任务').exists()).toBe(true)
    const started = request.mock.calls.find(([input]) => input.method === 'POST')![0]
    expect(started.headers?.['Idempotency-Key']).toBeTruthy()
    expect(createObjectURL).not.toHaveBeenCalled()
    operations = [completed()]
    await button(page, '刷新').trigger('click')
    await flushPromises()
    expect(page.text()).toContain('server-backup.json')
    expect(createObjectURL).not.toHaveBeenCalled()
    await button(page, '下载服务器备份').trigger('click')
    await flushPromises()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    page.unmount()
    pages.splice(pages.indexOf(page), 1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup-download')
  })

  it.each(['feature', 'backup', 'export'])(
    'hides creation, download, retry and cancellation without %s',
    async missing => {
      const capabilities = cap()
      if (missing === 'feature') capabilities.supportedFeatures = ['operations']
      else capabilities.effectivePermissions[missing === 'backup' ? 0 : 1]!.actions = ['read']
      const operations = [
        completed(),
        { id: 'failed', kind: 'server.backup', status: 'failed' as const },
        { id: 'running', kind: 'server.backup', status: 'running' as const },
      ]
      const page = await open(async input => ({ status: 200, body: rows(input.path, operations, capabilities) }))
      await button(page, '操作记录与备份').trigger('click')
      expect(page.text()).not.toContain('创建服务器备份')
      await page
        .findAll('.tabs button')
        .find(item => item.text().startsWith('操作记录与备份'))!
        .trigger('click')
      expect(page.text()).not.toContain('下载服务器备份')
      expect(page.text()).not.toContain('重试任务')
      expect(page.text()).not.toContain('取消任务')
    },
  )

  it('shows failed downloads and re-enables the explicit download action', async () => {
    const page = await open(async input =>
      input.path.startsWith('/backups/')
        ? { status: 500, body: { error: { code: 'BACKUP_FAILED', message: '备份材料暂不可读取' } } }
        : { status: 200, body: rows(input.path, [completed()]) },
    )
    await button(page, '操作记录与备份').trigger('click')
    await button(page, '下载服务器备份').trigger('click')
    await flushPromises()
    expect(page.get('[role="alert"]').text()).toContain('备份材料暂不可读取')
    expect(button(page, '下载服务器备份').attributes('disabled')).toBeUndefined()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('discards a pending backup download when the administrator switches management targets', async () => {
    let finish!: (value: { status: number; body: unknown }) => void
    const pending = new Promise<{ status: number; body: unknown }>(resolve => {
      finish = resolve
    })
    const page = await open(async input =>
      input.path.startsWith('/backups/') ? pending : { status: 200, body: rows(input.path, [completed()]) },
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: string) =>
          new Response(
            JSON.stringify(rows(new URL(input).pathname.replace('/api/management/v1', ''), [], cap('paired'))),
            { status: 200 },
          ),
      ),
    )
    await button(page, '操作记录与备份').trigger('click')
    await button(page, '下载服务器备份').trigger('click')
    expect(button(page, '正在下载备份…').attributes('disabled')).toBeDefined()
    await button(page, '当前部署服务器').trigger('click')
    await flushPromises()
    finish({ status: 200, body: { private: 'old-server-archive' } })
    await flushPromises()
    expect(page.text()).toContain('server-paired')
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
