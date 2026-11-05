import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ManagementConsole from '../ManagementConsole.vue'
import type { ManagementIpcRequest, ManagementIpcResponse } from '@/services/managementClient'
import type { ManagedAccount } from '@/types/management'

vi.mock('@/bootstrap/deployment', () => ({ getBackendOrigin: () => 'https://paired.example' }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ session: null, serverUrl: 'https://paired.example', isAccount: false }),
}))
const pages: VueWrapper[] = []
const button = (page: VueWrapper, text: string) => page.findAll('button').find(item => item.text() === text)!
const account = (id: string): ManagedAccount => ({ accountId: id, status: 'active', createdAt: 1793808000000 })
const accounts = [account('account-one'), account('account-two')]

function rows(path: string, { suffix = 'local', supported = true, authorized = true } = {}): unknown {
  if (path === '/session')
    return {
      principalId: 'owner',
      csrfToken: 'csrf-token',
      serverId: `server-${suffix}`,
      workspaceId: `workspace-${suffix}`,
    }
  if (path === '/capabilities')
    return {
      serverId: `server-${suffix}`,
      workspaceId: `workspace-${suffix}`,
      supportedFeatures: supported ? ['accounts'] : [],
      effectivePermissions: [
        {
          scope: { kind: 'server', id: `server-${suffix}` },
          actions: authorized ? ['read', 'accounts.manage'] : ['read'],
        },
      ],
      resourceRestrictions: [],
    }
  if (path === '/servers')
    return {
      servers: [
        {
          id: `server-${suffix}`,
          revision: 4,
          name: `服务器 ${suffix}`,
          workspaceId: `workspace-${suffix}`,
          draining: false,
          status: 'running',
        },
      ],
    }
  if (path.includes('/accounts?')) return { accounts, nextCursor: 'page-two/next' }
  return {}
}
async function open(handler: (request: ManagementIpcRequest) => Promise<ManagementIpcResponse>) {
  const bridge = vi.fn(handler)
  vi.stubGlobal('arcadiaDesktop', { managementRequest: bridge })
  const page = mount(ManagementConsole)
  pages.push(page)
  await flushPromises()
  return { page, bridge }
}
afterEach(() => {
  pages.splice(0).forEach(page => page.unmount())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('server account management', () => {
  it.each([
    { supported: false, authorized: true },
    { supported: true, authorized: false },
  ])('does not show or fetch accounts without capability and permission: %j', async options => {
    const { page, bridge } = await open(async input => ({ status: 200, body: rows(input.path, options) }))
    expect(page.findAll('button').some(item => item.text() === '用户管理')).toBe(false)
    expect(page.find('[aria-label="用户管理"]').exists()).toBe(false)
    expect(bridge.mock.calls.some(([input]) => input.path.includes('/accounts'))).toBe(false)
  })

  it('requires confirmation and deactivates the captured account even when the list is reordered', async () => {
    let order = accounts
    const { page, bridge } = await open(async input => ({
      status: 200,
      body: input.path.includes('/accounts?') ? { accounts: order } : rows(input.path),
    }))
    await button(page, '用户管理').trigger('click')
    await button(page, '停用账户').trigger('click')
    expect(bridge.mock.calls.every(([input]) => input.method === 'GET')).toBe(true)
    order = [accounts[1]!, accounts[0]!]
    await button(page, '刷新').trigger('click')
    await flushPromises()
    const confirmation = page.get('[aria-label="确认管理操作"]')
    expect(confirmation.text()).toContain('account-one')
    expect(button(page, '确认停用').attributes('disabled')).toBeUndefined()
    expect(confirmation.find('textarea, input').exists()).toBe(false)
    await confirmation.trigger('submit')
    await flushPromises()
    const posts = bridge.mock.calls.map(([input]) => input).filter(input => input.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.path).toBe('/servers/server-local/accounts/account-one/deactivate')
    expect(posts[0]!.body).toBeUndefined()
    expect(posts[0]!.headers?.['Idempotency-Key']).toBeTruthy()
  })

  it('cancels a deactivation without sending a mutation', async () => {
    const { page, bridge } = await open(async input => ({ status: 200, body: rows(input.path) }))
    await button(page, '用户管理').trigger('click')
    await button(page, '停用账户').trigger('click')
    await button(page, '取消').trigger('click')
    expect(page.findAll('button').some(item => item.text() === '确认停用')).toBe(false)
    expect(bridge.mock.calls.every(([input]) => input.method === 'GET')).toBe(true)
  })

  it('appends the next page once, deduplicates accounts and encodes the cursor', async () => {
    const { page, bridge } = await open(async input => ({
      status: 200,
      body: input.path.includes('&cursor=') ? { accounts: [accounts[0], account('account-three')] } : rows(input.path),
    }))
    await button(page, '用户管理').trigger('click')
    await button(page, '加载更多账户').trigger('click')
    await flushPromises()
    expect(
      bridge.mock.calls.some(
        ([input]) => input.path === '/servers/server-local/accounts?limit=50&cursor=page-two%2Fnext',
      ),
    ).toBe(true)
    expect(page.findAll('[aria-label="用户管理"] tbody tr td:first-child').map(item => item.text())).toEqual([
      'account-one',
      'account-two',
      'account-three',
    ])
    expect(page.findAll('button').some(item => item.text() === '加载更多账户')).toBe(false)
  })

  it('requires fresh confirmation after changing the target even if both servers use the same account ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string | URL | Request) =>
          new Response(
            JSON.stringify(
              rows(String(url).replace('https://paired.example/api/management/v1', ''), { suffix: 'remote' }),
            ),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    )
    const { page, bridge } = await open(async input => ({ status: 200, body: rows(input.path) }))
    await button(page, '用户管理').trigger('click')
    await button(page, '停用账户').trigger('click')
    await button(page, '当前部署服务器').trigger('click')
    await flushPromises()
    await button(page, '用户管理').trigger('click')
    expect(page.findAll('button').some(item => item.text() === '确认停用')).toBe(false)
    expect(bridge.mock.calls.every(([input]) => input.method === 'GET')).toBe(true)
  })

  it('refreshes the full loaded account window instead of discarding later pages', async () => {
    let refreshed = false
    const { page, bridge } = await open(async input => ({
      status: 200,
      body: input.path.includes('&cursor=')
        ? {
            accounts: [{ ...account('account-three'), status: refreshed ? 'deactivated' : 'active' }],
            nextCursor: refreshed ? 'page-three' : undefined,
          }
        : rows(input.path),
    }))
    await button(page, '用户管理').trigger('click')
    await button(page, '加载更多账户').trigger('click')
    await flushPromises()
    refreshed = true
    await button(page, '刷新').trigger('click')
    await flushPromises()
    expect(page.findAll('[aria-label="用户管理"] tbody tr td:first-child').map(item => item.text())).toEqual([
      'account-one',
      'account-two',
      'account-three',
    ])
    const third = page
      .findAll('[aria-label="用户管理"] tbody tr')
      .find(article => article.get('td').text() === 'account-three')!
    expect(third.text()).toContain('已停用')
    expect(bridge.mock.calls.filter(([input]) => input.path.includes('&cursor=page-two%2Fnext'))).toHaveLength(2)
    expect(button(page, '加载更多账户')).toBeDefined()
  })
})
