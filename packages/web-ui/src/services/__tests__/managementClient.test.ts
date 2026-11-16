import { describe, expect, it, vi } from 'vitest'
import {
  createHttpManagementClient,
  createIpcManagementClient,
  createManagementTargetGate,
  ManagementError,
  type ManagementContext,
  type ManagementIpcRequest,
} from '../managementClient'

const httpContext = (): ManagementContext => ({
  transport: 'http',
  endpoint: 'https://server.example',
  label: '我的服务器',
  serverId: 'server-a',
})
const ipcContext = (): ManagementContext => ({ transport: 'ipc', endpoint: 'local', label: '本机工作区' })
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('management transport contexts', () => {
  it('captures its endpoint and scope rather than following a changed play target', async () => {
    const context = httpContext()
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response({ serverId: 'server-a' }))
    const api = createHttpManagementClient(context, fetchImpl)
    Object.assign(context, { endpoint: 'https://other.example', serverId: 'server-b' })
    await api.request('GET', '/capabilities')
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://server.example/api/management/v1/capabilities')
    expect(api.context.serverId).toBe('server-a')
    expect(Object.isFrozen(api.context)).toBe(true)
  })

  it('pins cookies and CSRF to a request without following redirects', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response({ id: 'job-1' }, 202))
    const api = createHttpManagementClient(httpContext(), fetchImpl)
    api.setCsrfToken('csrf-a')
    await api.request('POST', '/workspaces/my-workspace/environments/apply', {
      body: { version: 'v1' },
      revision: 2,
      idempotencyKey: 'attempt:1',
    })
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      credentials: 'include',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'X-CSRF-Token': 'csrf-a', 'If-Match': '"2"', 'Idempotency-Key': 'attempt:1' },
      body: JSON.stringify({ version: 'v1' }),
    })
  })

  it.each([
    '//evil.example/capabilities',
    'https://evil.example/capabilities',
    '/../sessions',
    '/%2e%2e/sessions',
    '/%252e%252e/sessions',
    '/foo%2f..%2fsessions',
    '/foo\\..\\sessions',
    '/foo#secret',
  ])('rejects a path that could escape the management API: %s', async path => {
    const fetchImpl = vi.fn()
    const api = createHttpManagementClient(httpContext(), fetchImpl)
    await expect(api.request('GET', path)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['https://user:secret@example.org', 'file:///tmp/secret', 'https://example.org?token=secret'])(
    'rejects unsafe endpoint %s',
    endpoint => {
      expect(() => createHttpManagementClient({ ...httpContext(), endpoint })).toThrow(ManagementError)
    },
  )

  it('never uses an IPC fallback when HTTP fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network unavailable')
    })
    const api = createHttpManagementClient(httpContext(), fetchImpl)
    await expect(api.request('GET', '/capabilities')).rejects.toMatchObject({
      code: 'CONNECTION_FAILED',
      retryable: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects changed server identity and clears its previous CSRF token', async () => {
    const requests: RequestInit[] = []
    const api = createHttpManagementClient(httpContext(), async (_url, init) => {
      requests.push(init!)
      return response({ serverId: 'server-b' })
    })
    api.setCsrfToken('old-token')
    await expect(api.request('GET', '/capabilities')).rejects.toMatchObject({ code: 'TARGET_CHANGED' })
    await api.request('POST', '/anything')
    expect(requests[1]!.headers).not.toHaveProperty('X-CSRF-Token')
  })

  it('does not accept redirects even from a fetch implementation ignoring redirect:error', async () => {
    const result = response({ ok: true })
    Object.defineProperty(result, 'redirected', { value: true })
    await expect(
      createHttpManagementClient(httpContext(), async () => result).request('GET', '/capabilities'),
    ).rejects.toMatchObject({ code: 'TARGET_CHANGED' })
  })
})

describe('shared IPC/HTTP command contract', () => {
  it.each(['http', 'ipc'] as const)(
    'bounds ordinary %s command bytes while allowing only the exact import route a large envelope',
    async transport => {
      const request = vi.fn(async (_request: ManagementIpcRequest) => ({
        status: 202,
        body: { operationId: 'import-job' },
      }))
      const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
        response({ operationId: 'import-job' }, 202),
      )
      const api =
        transport === 'http'
          ? createHttpManagementClient(httpContext(), fetchImpl)
          : createIpcManagementClient(ipcContext(), request)
      const bundle = { notes: '界'.repeat(750_000) }
      await expect(
        api.request('POST', '/workspaces/workspace-a/environments', { body: { bundle } }),
      ).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' })
      await expect(
        api.request('POST', '/workspaces/workspace-a/import?unbounded=true', { body: { bundle } }),
      ).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' })
      await expect(api.request('PATCH', '/workspaces/workspace-a/import', { body: { bundle } })).rejects.toMatchObject({
        code: 'REQUEST_TOO_LARGE',
      })
      expect(request).not.toHaveBeenCalled()
      expect(fetchImpl).not.toHaveBeenCalled()
      await expect(api.request('POST', '/workspaces/workspace-a/import', { body: { bundle } })).resolves.toEqual({
        operationId: 'import-job',
      })
      expect(transport === 'http' ? fetchImpl : request).toHaveBeenCalledOnce()
    },
  )

  it.each(['http', 'ipc'] as const)('allows large %s downloads only on exact transfer paths', async transport => {
    const bundle = { data: 'x'.repeat(2 * 1024 * 1024) }
    const api =
      transport === 'http'
        ? createHttpManagementClient(httpContext(), async () => response(bundle))
        : createIpcManagementClient(ipcContext(), async () => ({ status: 200, body: bundle }))
    await expect(api.request('GET', '/operations')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(api.request('POST', `/transfers/${'a'.repeat(64)}`)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
    await expect(api.request('GET', '/transfers/not-a-transfer-id')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    await expect(api.request('GET', `/transfers/${'a'.repeat(64)}`)).resolves.toEqual(bundle)
  })

  it.each(['http', 'ipc'] as const)(
    'allows large %s server backups only on exact GET backup paths',
    async transport => {
      const archive = { data: 'x'.repeat(2 * 1024 * 1024) }
      const path = `/backups/${'b'.repeat(64)}`
      const api =
        transport === 'http'
          ? createHttpManagementClient(httpContext(), async () => response(archive))
          : createIpcManagementClient(ipcContext(), async () => ({ status: 200, body: archive }))
      for (const method of ['POST', 'PATCH', 'DELETE'] as const)
        await expect(api.request(method, path)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
      for (const invalidPath of ['/backups/invalid', `${path}/`, `${path}?unbounded=true`, '/servers/server-a/backup'])
        await expect(api.request('GET', invalidPath)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
      await expect(api.request('GET', path)).resolves.toEqual(archive)
    },
  )

  it('rejects an advertised backup above 512 MiB before reading it and keeps the smaller limits on other routes', async () => {
    const maximum = 512 * 1024 * 1024
    const oversized = new Response('{}', { headers: { 'content-length': String(maximum + 1) } })
    const getReader = vi.spyOn(oversized.body!, 'getReader')
    const cancel = vi.spyOn(oversized.body!, 'cancel')
    const api = createHttpManagementClient(httpContext(), async () => oversized)
    await expect(api.request('GET', `/backups/${'b'.repeat(64)}`)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(getReader).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()

    const atLimit = createHttpManagementClient(
      httpContext(),
      async () => new Response('{}', { headers: { 'content-length': String(maximum) } }),
    )
    await expect(atLimit.request('GET', `/backups/${'b'.repeat(64)}`)).resolves.toEqual({})
    await expect(atLimit.request('GET', `/transfers/${'b'.repeat(64)}`)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
    await expect(atLimit.request('GET', '/operations')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('still enforces received bytes when the content-length understates the response size', async () => {
    const api = createHttpManagementClient(
      httpContext(),
      async () =>
        new Response(JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) }), { headers: { 'content-length': '2' } }),
    )
    await expect(api.request('GET', '/operations')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('exchanges account proof only once at the captured HTTP account-login endpoint', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      response({ serverId: 'server-a', csrfToken: 'csrf-new' }),
    )
    const api = createHttpManagementClient(httpContext(), fetchImpl)
    await api.request('POST', '/session/account', { accountProof: 'player-proof' })
    await api.request('GET', '/capabilities')
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://server.example/api/management/v1/session/account')
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer player-proof' },
    })
    expect(fetchImpl.mock.calls[1]![1]?.headers).not.toHaveProperty('Authorization')
  })

  it.each([
    ['GET', '/session/account'],
    ['POST', '/session/account?forward=other'],
    ['POST', '/servers/server-a/drain'],
  ] as const)('refuses account proof on %s %s', async (method, path) => {
    const fetchImpl = vi.fn()
    const api = createHttpManagementClient(httpContext(), fetchImpl)
    await expect(api.request(method, path, { accountProof: 'player-proof' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not send player credentials through IPC or follow account-login redirects', async () => {
    const bridge = vi.fn()
    await expect(
      createIpcManagementClient(ipcContext(), bridge).request('POST', '/session/account', {
        accountProof: 'player-proof',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(bridge).not.toHaveBeenCalled()
    const result = response({ ok: true })
    Object.defineProperty(result, 'redirected', { value: true })
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => result)
    await expect(
      createHttpManagementClient(httpContext(), fetchImpl).request('POST', '/session/account', {
        accountProof: 'player-proof',
      }),
    ).rejects.toMatchObject({ code: 'TARGET_CHANGED' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe('error')
  })

  it('captures IPC input and sends only revision/idempotency headers to the trusted bridge', async () => {
    const requests: ManagementIpcRequest[] = []
    const bridge = vi.fn(async (request: ManagementIpcRequest) => {
      requests.push(request)
      return { status: 200, body: { ok: true } }
    })
    const a = createIpcManagementClient(ipcContext(), bridge)
    const b = createIpcManagementClient(ipcContext(), bridge)
    a.setCsrfToken('token-a')
    const body = { selection: { installationId: 'version-a' } }
    const pending = a.request('PATCH', '/servers/server-a', { body, revision: 7, idempotencyKey: 'retry-7' })
    body.selection.installationId = 'version-b'
    await pending
    await b.request('POST', '/session/bootstrap', { body: { code: 'one-time' } })
    expect(requests[0]!.body).toEqual({ selection: { installationId: 'version-a' } })
    expect(requests[0]!.headers).toEqual({ 'If-Match': '"7"', 'Idempotency-Key': 'retry-7' })
    expect(requests[1]!.headers).toEqual({})
  })

  it.each(['ipc', 'http'] as const)('normalizes version conflict details from %s', async transport => {
    const error = {
      error: { code: 'REVISION_CONFLICT', message: '版本已更新', retryable: false, operationId: 'job-3' },
    }
    const api =
      transport === 'ipc'
        ? createIpcManagementClient(ipcContext(), async () => ({ status: 412, body: error }))
        : createHttpManagementClient(httpContext(), async () => response(error, 412))
    await expect(api.request('PATCH', '/servers/server-a', { revision: 2 })).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      message: '版本已更新',
      retryable: false,
      operationId: 'job-3',
      status: 412,
    })
  })

  it('clears stale CSRF after authentication expires', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      response({ code: 'UNAUTHENTICATED' }, 401),
    )
    const api = createHttpManagementClient(httpContext(), fetchImpl)
    api.setCsrfToken('expired')
    await expect(api.request('POST', '/servers/a/drain')).rejects.toMatchObject({ status: 401 })
    await expect(api.request('POST', '/session/bootstrap')).rejects.toMatchObject({ status: 401 })
    expect(fetchImpl.mock.calls[0]![1]?.headers).toHaveProperty('X-CSRF-Token', 'expired')
    expect(fetchImpl.mock.calls[1]![1]?.headers).not.toHaveProperty('X-CSRF-Token')
  })

  it('keeps HTTP CSRF state separate for each management target', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response({ ok: true }))
    const a = createHttpManagementClient(httpContext(), fetchImpl)
    const b = createHttpManagementClient(
      { ...httpContext(), endpoint: 'https://b.example', serverId: 'server-b' },
      fetchImpl,
    )
    a.setCsrfToken('csrf-a')
    await a.request('POST', '/servers/server-a/drain')
    await b.request('POST', '/session/bootstrap', { body: { code: 'new-code' } })
    expect(fetchImpl.mock.calls[0]![1]?.headers).toHaveProperty('X-CSRF-Token', 'csrf-a')
    expect(fetchImpl.mock.calls[1]![1]?.headers).not.toHaveProperty('X-CSRF-Token')
  })

  it('does not dispatch an already cancelled operation', async () => {
    const bridge = vi.fn()
    const api = createIpcManagementClient(ipcContext(), bridge)
    const controller = new AbortController()
    controller.abort()
    await expect(api.request('POST', '/operations', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(bridge).not.toHaveBeenCalled()
  })

  it('stops waiting for IPC on view cancellation without pretending the remote operation was undone', async () => {
    let finish!: (value: { status: number; body: unknown }) => void
    const api = createIpcManagementClient(
      ipcContext(),
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    const controller = new AbortController()
    const pending = api.request('POST', '/operations', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    finish({ status: 202, body: { operationId: 'still-running' } })
  })

  it('rejects an oversized response and malformed JSON', async () => {
    const huge = createHttpManagementClient(httpContext(), async () => response('x'.repeat(4 * 1024 * 1024)))
    await expect(huge.request('GET', '/operations')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    const malformed = createHttpManagementClient(httpContext(), async () => new Response('<html>error</html>'))
    await expect(malformed.request('GET', '/operations')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('preserves unsupported-server status when an older server returns an HTML error', async () => {
    const api = createHttpManagementClient(
      httpContext(),
      async () => new Response('<html>Not Found</html>', { status: 404 }),
    )
    await expect(api.request('GET', '/capabilities')).rejects.toMatchObject({ code: 'HTTP_404', status: 404 })
  })

  it('invalidates late responses when management target changes', () => {
    const gate = createManagementTargetGate()
    const requestA = gate.capture()
    gate.invalidate()
    const requestB = gate.capture()
    expect(gate.isCurrent(requestA)).toBe(false)
    expect(gate.isCurrent(requestB)).toBe(true)
    gate.invalidate()
    expect(gate.isCurrent(requestB)).toBe(false)
  })
})
