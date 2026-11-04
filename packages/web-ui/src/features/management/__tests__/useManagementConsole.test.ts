import { describe, expect, it, vi } from 'vitest'
import { useManagementConsole } from '../useManagementConsole'
import {
  ManagementError,
  type ManagementClient,
  type ManagementMethod,
  type ManagementRequestOptions,
} from '../../../services/managementClient'
import type { ManagementCapabilities, ManagedEnvironmentDocument } from '../../../types/management'

function deferred<T = unknown>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((success, failure) => {
    resolve = success
    reject = failure
  })
  return { promise, resolve, reject }
}

function capabilities(serverId: string, workspaceOnly = false): ManagementCapabilities {
  return {
    serverId,
    workspaceId: `workspace-${serverId}`,
    supportedFeatures: ['workspace.environments', 'server.bindings', 'server.drain', 'operations', 'grants'],
    effectivePermissions: [
      {
        scope: { kind: 'workspace', id: `workspace-${serverId}` },
        actions: workspaceOnly ? ['read', 'environment.use'] : ['*'],
      },
      ...(workspaceOnly ? [] : [{ scope: { kind: 'server' as const, id: serverId }, actions: ['*'] }]),
    ],
    resourceRestrictions: [],
  }
}

function document(serverId: string): ManagedEnvironmentDocument {
  return {
    schemaVersion: 2,
    id: `environment-${serverId}`,
    name: `环境 ${serverId}`,
    packages: {},
    sources: [],
    rules: { schemaVersion: 1 },
    requires: {},
  }
}

function rows(serverId: string, path: string) {
  if (path === '/capabilities') return capabilities(serverId)
  if (path === '/servers')
    return {
      servers: [
        {
          id: serverId,
          revision: 1,
          name: serverId,
          workspaceId: `workspace-${serverId}`,
          draining: false,
          status: 'available',
        },
      ],
    }
  if (path.endsWith('/environments'))
    return { environments: [{ document: document(serverId), revision: '1' }], versions: [] }
  if (path.endsWith('/bindings')) return { bindings: [] }
  if (path === '/operations')
    return { operations: [{ id: `operation-${serverId}`, kind: 'prepare', status: 'succeeded' }] }
  if (path === '/grants') return { grants: [] }
  return undefined
}

type Handler = (method: ManagementMethod, path: string, options?: ManagementRequestOptions) => Promise<unknown>
function stubClient(serverId: string, handler?: Handler) {
  const request = vi.fn<Handler>(handler ?? (async (_method, path) => rows(serverId, path)))
  const setCsrfToken = vi.fn()
  const client: ManagementClient = {
    context: { transport: 'http', endpoint: `https://${serverId}.example`, label: serverId, serverId },
    request: request as ManagementClient['request'],
    setCsrfToken,
  }
  return { client, request, setCsrfToken }
}

describe('management console target isolation', () => {
  it('discards protected downloads and one-time credential responses after switching targets', async () => {
    const download = deferred(),
      credential = deferred()
    const a = stubClient('a', async (method, path) =>
      path.startsWith('/transfers/') ? download.promise : method === 'POST' ? credential.promise : rows('a', path),
    )
    const console = useManagementConsole()
    const receive = vi.fn()
    console.setClient(a.client)
    const oldDownload = console.read('/transfers/export-a')
    const oldCredential = console.mutate('POST', '/credentials', {}, undefined, receive)
    console.setClient(stubClient('b').client)
    download.resolve({ files: ['private-a'] })
    credential.resolve({ token: 'private-token-a' })
    expect(await oldDownload).toBeUndefined()
    expect(await oldCredential).toBe(false)
    expect(receive).not.toHaveBeenCalled()
  })

  it.each(['server', 'workspace'] as const)(
    'pins the observed %s identity even without a configured server ID',
    async changed => {
      let current = capabilities('a')
      const a = stubClient('a', async (_method, path) => (path === '/capabilities' ? current : rows('a', path)))
      const console = useManagementConsole()
      console.setClient({ ...a.client, context: { ...a.client.context, serverId: undefined } })
      await console.refresh()
      expect(console.environments.value).toHaveLength(1)
      const reads = a.request.mock.calls.length
      current =
        changed === 'server' ? capabilities('b') : { ...capabilities('a'), workspaceId: 'replacement-workspace' }
      await console.refresh()
      expect(console.error.value).toContain('身份已变化')
      expect(console.capabilities.value).toBeUndefined()
      expect(console.environments.value).toEqual([])
      expect(a.request.mock.calls.slice(reads).map(call => call[1])).toEqual(['/capabilities'])
    },
  )

  it('ignores a late capabilities response after switching targets', async () => {
    const capA = deferred()
    const a = stubClient('a', async (_method, path) => (path === '/capabilities' ? capA.promise : rows('a', path)))
    const b = stubClient('b')
    const console = useManagementConsole()
    console.setClient(a.client)
    const oldRefresh = console.refresh()
    console.setClient(b.client)
    await console.refresh()
    capA.resolve(capabilities('a'))
    await oldRefresh
    expect(console.capabilities.value?.serverId).toBe('b')
    expect(console.environments.value[0]?.document.id).toBe('environment-b')
    expect(a.request).toHaveBeenCalledTimes(1)
    expect(console.error.value).toBe('')
  })

  it('ignores a late resource-list response after switching targets', async () => {
    const envA = deferred()
    const a = stubClient('a', async (_method, path) =>
      path.endsWith('/environments') ? envA.promise : rows('a', path),
    )
    const console = useManagementConsole()
    console.setClient(a.client)
    const oldRefresh = console.refresh()
    await vi.waitFor(() => expect(a.request.mock.calls.some(call => call[1].endsWith('/environments'))).toBe(true))
    console.setClient(stubClient('b').client)
    await console.refresh()
    envA.resolve(rows('a', '/environments'))
    await oldRefresh
    expect(console.capabilities.value?.serverId).toBe('b')
    expect(console.environments.value[0]?.document.id).toBe('environment-b')
    expect(console.operations.value[0]?.id).toBe('operation-b')
    expect(console.loading.value).toBe(false)
  })

  it.each(['resolve', 'reject'] as const)(
    'a pending mutation cannot paint target B when it later %ss',
    async outcome => {
      const mutationA = deferred()
      const a = stubClient('a', async (method, path) => (method === 'POST' ? mutationA.promise : rows('a', path)))
      const console = useManagementConsole()
      console.setClient(a.client)
      const oldMutation = console.mutate('POST', '/servers/a/drain')
      console.setClient(stubClient('b').client)
      await console.refresh()
      if (outcome === 'resolve') mutationA.resolve({ operationId: 'a-job' })
      else mutationA.reject(new ManagementError('FORBIDDEN', 'A 的管理权限已撤销', 403))
      expect(await oldMutation).toBe(false)
      expect(console.capabilities.value?.serverId).toBe('b')
      expect(console.notice.value).toBe('')
      expect(console.error.value).toBe('')
      expect(console.busy.value).toBe(false)
    },
  )

  it('an old mutation finishing does not clear a new target mutation busy state', async () => {
    const mutationA = deferred(),
      mutationB = deferred()
    const a = stubClient('a', async (method, path) => (method === 'POST' ? mutationA.promise : rows('a', path)))
    const b = stubClient('b', async (method, path) => (method === 'POST' ? mutationB.promise : rows('b', path)))
    const console = useManagementConsole()
    console.setClient(a.client)
    const oldMutation = console.mutate('POST', '/servers/a/drain')
    console.setClient(b.client)
    const currentMutation = console.mutate('POST', '/servers/b/drain')
    mutationA.resolve({ operationId: 'a-job' })
    await oldMutation
    expect(console.busy.value).toBe(true)
    mutationB.resolve({ operationId: 'b-job' })
    expect(await currentMutation).toBe(true)
    expect(console.busy.value).toBe(false)
  })
})

describe('management console authentication and mutations', () => {
  it('queries only supported feature endpoints even when the principal has broad permissions', async () => {
    const a = stubClient('a', async (_method, path) => {
      if (path === '/capabilities') return { ...capabilities('a'), supportedFeatures: ['server.drain'] }
      if (path === '/servers') return rows('a', path)
      throw new ManagementError('UNSUPPORTED_FEATURE', '此服务器不支持该功能', 404)
    })
    const console = useManagementConsole()
    console.setClient(a.client)
    await console.refresh()
    expect(console.error.value).toBe('')
    expect(console.capabilities.value?.serverId).toBe('a')
    expect(console.servers.value).toHaveLength(1)
    expect(console.environments.value).toEqual([])
    expect(console.operations.value).toEqual([])
    expect(a.request.mock.calls.map(call => call[1])).toEqual(['/capabilities', '/servers'])
  })

  it('uses a one-call player proof exchange for account login and then refreshes with the returned CSRF session', async () => {
    const a = stubClient('a', async (method, path) => {
      if (method === 'POST' && path === '/session/account') return { csrfToken: 'management-csrf' }
      return rows('a', path)
    })
    const console = useManagementConsole()
    console.setClient(a.client)
    await console.loginAccount('verified-player-proof')
    expect(a.request.mock.calls[0]).toEqual(['POST', '/session/account', { accountProof: 'verified-player-proof' }])
    expect(a.setCsrfToken).toHaveBeenCalledWith('management-csrf')
    expect(a.request.mock.calls.slice(1).every(call => call[2]?.accountProof === undefined)).toBe(true)
    expect(console.capabilities.value?.serverId).toBe('a')
  })

  it('ignores an old account-login exchange after changing management target', async () => {
    const sessionA = deferred()
    const a = stubClient('a', async (method, path) => (method === 'POST' ? sessionA.promise : rows('a', path)))
    const b = stubClient('b')
    const console = useManagementConsole()
    console.setClient(a.client)
    const login = console.loginAccount('old-proof')
    console.setClient(b.client)
    await console.refresh()
    sessionA.resolve({ csrfToken: 'old-csrf' })
    await login
    expect(a.setCsrfToken).not.toHaveBeenCalled()
    expect(b.setCsrfToken).not.toHaveBeenCalled()
    expect(console.capabilities.value?.serverId).toBe('b')
    expect(console.error.value).toBe('')
  })

  it('retries an uncertain rejected mutation with the same key, then uses a new key after success', async () => {
    let attempts = 0
    const a = stubClient('a', async (method, path) => {
      if (method === 'POST' && ++attempts === 1) throw new ManagementError('CONNECTION_FAILED', '连接中断', 0, true)
      return method === 'GET' ? rows('a', path) : { operationId: 'job-1' }
    })
    const console = useManagementConsole()
    console.setClient(a.client)
    const body = { versionId: 'version-a' }
    expect(await console.mutate('POST', '/servers/a/bindings/default/publish', body, 2)).toBe(false)
    expect(await console.mutate('POST', '/servers/a/bindings/default/publish', body, 2)).toBe(true)
    expect(await console.mutate('POST', '/servers/a/bindings/default/publish', body, 2)).toBe(true)
    const mutations = a.request.mock.calls.filter(call => call[0] === 'POST')
    expect(mutations).toHaveLength(3)
    expect(mutations[0]![2]?.idempotencyKey).toBeTruthy()
    expect(mutations[1]![2]?.idempotencyKey).toBe(mutations[0]![2]?.idempotencyKey)
    expect(mutations[2]![2]?.idempotencyKey).not.toBe(mutations[1]![2]?.idempotencyKey)
  })

  it('loads workspace resources without requiring server-read permission', async () => {
    const a = stubClient('a', async (_method, path) => {
      if (path === '/capabilities') return capabilities('a', true)
      if (path === '/servers' || path.endsWith('/bindings') || path === '/grants')
        throw new ManagementError('FORBIDDEN', '没有服务器管理权限', 403)
      return rows('a', path)
    })
    const console = useManagementConsole()
    console.setClient(a.client)
    await console.refresh()
    expect(console.error.value).toBe('')
    expect(console.environments.value[0]?.document.id).toBe('environment-a')
    expect(console.servers.value).toEqual([])
    expect(console.can('workspace', 'read')).toBe(true)
    expect(console.can('server', 'read')).toBe(false)
    expect(a.request.mock.calls.some(call => call[1] === '/servers')).toBe(false)
  })

  it('clears all target resources after authentication expires', async () => {
    let expired = false
    const a = stubClient('a', async (_method, path) => {
      if (expired) throw new ManagementError('UNAUTHENTICATED', '管理会话已过期', 401)
      return rows('a', path)
    })
    const console = useManagementConsole()
    console.setClient(a.client)
    await console.refresh()
    expect(console.environments.value).toHaveLength(1)
    expect(console.operations.value).toHaveLength(1)
    expired = true
    await console.refresh()
    expect(console.loginRequired.value).toBe(true)
    expect(console.capabilities.value).toBeUndefined()
    for (const values of [
      console.servers,
      console.environments,
      console.versions,
      console.bindings,
      console.operations,
      console.grants,
    ])
      expect(values.value).toEqual([])
    expect(console.error.value).toBe('管理会话已过期')
  })

  it('does not restore resources from a refresh that completed after logout', async () => {
    const pendingEnvironments = deferred()
    const a = stubClient('a', async (method, path) => {
      if (method === 'POST') return undefined
      return path.endsWith('/environments') ? pendingEnvironments.promise : rows('a', path)
    })
    const console = useManagementConsole()
    console.setClient(a.client)
    const refresh = console.refresh()
    await vi.waitFor(() => expect(a.request.mock.calls.some(call => call[1].endsWith('/environments'))).toBe(true))
    await console.logout()
    pendingEnvironments.resolve(rows('a', '/environments'))
    await refresh
    expect(console.loginRequired.value).toBe(true)
    expect(console.capabilities.value).toBeUndefined()
    expect(console.environments.value).toEqual([])
  })
})
