import { describe, expect, it, vi } from 'vitest'
import { DevelopmentWorkspaceClient, DevelopmentWorkspaceError, developmentServerOrigin } from '../developmentWorkspace'

const token = 'local-secret-'.repeat(3)
const revision = 'a'.repeat(64)
const nextRevision = 'b'.repeat(64)
const content = {
  data: { species: [{ id: 'pet', hiddenField: { keep: [1, 2] } }], skills: [], marks: [] },
  assets: [{ sha256: 'x' }],
}
const project = {
  projectId: 'my-project',
  namespace: 'my-pack',
  exports: [{ id: 'apply-slow', sourceKind: 'skill' }],
}
const snapshot = { revision, content, project }

describe('local development workspace client', () => {
  it('only permits explicit loopback HTTP origins, rejecting encoded or redirected targets', () => {
    expect(developmentServerOrigin('http://127.0.0.1:8102/')).toBe('http://127.0.0.1:8102')
    expect(developmentServerOrigin('https://localhost:443')).toBe('https://localhost')
    expect(developmentServerOrigin('http://[::1]:9000')).toBe('http://[::1]:9000')
    for (const address of [
      'http://127.1:8102',
      'http://2130706433:8102',
      'http://localhost.evil.test:8102',
      'http://127.0.0.1.evil.test:8102',
      'http://user@127.0.0.1:8102',
      'http://127.0.0.1:8102/other',
      'http://127.0.0.1:8102/?next=evil',
      'http://127.0.0.1:8102/#next',
      'file:///etc/passwd',
      '//127.0.0.1:8102',
      'http://127.0.0.1:65536',
    ])
      expect(() => developmentServerOrigin(address), address).toThrow(DevelopmentWorkspaceError)
  })

  it('reads and saves only the same local content file with explicit revision, omitting ambient credentials', async () => {
    const request = vi.fn<typeof fetch>()
    request.mockResolvedValueOnce(new Response(JSON.stringify(snapshot), { status: 200 }))
    request.mockResolvedValueOnce(
      new Response(JSON.stringify({ ...snapshot, revision: nextRevision }), { status: 200 }),
    )
    const client = new DevelopmentWorkspaceClient('http://127.0.0.1:8102', token, request)
    expect(await client.read()).toEqual(snapshot)
    expect(await client.save(revision, content)).toEqual({ ...snapshot, revision: nextRevision })
    expect(request).toHaveBeenCalledTimes(2)
    for (const [url, init] of request.mock.calls) {
      expect(url).toBe('http://127.0.0.1:8102/api/v1/development/content')
      expect(init).toMatchObject({
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        mode: 'cors',
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    const [, put] = request.mock.calls[1]
    expect(put?.method).toBe('PUT')
    expect(JSON.parse(String(put?.body))).toEqual({ revision, content })
  })

  it('calls browser fetch with its global receiver', async () => {
    const request: typeof fetch = async function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return new Response(JSON.stringify(snapshot), { status: 200 })
    }
    const client = new DevelopmentWorkspaceClient('http://127.0.0.1:8102', token, request)
    expect(await client.read()).toEqual(snapshot)
  })

  it.each([
    [404, {}, 'DEVELOPMENT_UNAVAILABLE'],
    [401, { code: 'DEVELOPMENT_UNAUTHORIZED' }, 'DEVELOPMENT_UNAUTHORIZED'],
    [409, { code: 'REVISION_CONFLICT' }, 'REVISION_CONFLICT'],
    [409, { code: 'DEVELOPMENT_CHANGED' }, 'DEVELOPMENT_CHANGED'],
    [409, { code: 'DEVELOPMENT_BUSY' }, 'DEVELOPMENT_BUSY'],
    [400, { code: 'DEVELOPMENT_PACKAGE' }, 'DEVELOPMENT_PACKAGE'],
    [413, {}, 'DEVELOPMENT_LIMIT'],
    [503, { code: '__proto__' }, 'SERVER_ERROR'],
  ])('maps HTTP %i safely without displaying server messages or the token', async (status, body, code) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...body, message: token }), { status }))
    const client = new DevelopmentWorkspaceClient('http://localhost:8102', token, request)
    const error = await client.read().catch(value => value)
    expect(error).toBeInstanceOf(DevelopmentWorkspaceError)
    expect(error.code).toBe(code)
    expect(String(error.message)).not.toContain(token)
  })

  it('rejects invalid tokens, responses, input revisions and network errors without disclosing credentials', async () => {
    expect(() => new DevelopmentWorkspaceClient('http://localhost', 'short')).toThrow('32')
    expect(() => new DevelopmentWorkspaceClient('http://localhost', `${'a'.repeat(32)}\n`)).toThrow('HTTP')
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error(`network leaked ${token}`))
    const client = new DevelopmentWorkspaceClient('http://localhost', token, request)
    const error = await client.read().catch(value => value)
    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.message).not.toContain(token)
    await expect(client.save('wrong', content)).rejects.toMatchObject({ code: 'DEVELOPMENT_CONTENT' })
    request.mockResolvedValue(new Response(JSON.stringify({ ...snapshot, revision: 'bad' }), { status: 200 }))
    await expect(client.read()).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
    request.mockResolvedValue(
      new Response(JSON.stringify({ ...snapshot, project: { ...project, exports: undefined } }), { status: 200 }),
    )
    expect((await client.read()).project.exports).toEqual([])
    request.mockResolvedValue(
      new Response(
        JSON.stringify({ ...snapshot, project: { ...project, exports: [{ id: '../bad', sourceKind: 'skill' }] } }),
        { status: 200 },
      ),
    )
    await expect(client.read()).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
    request.mockResolvedValue(
      new Response(JSON.stringify({ ...snapshot, project: { ...project, namespace: 'Upper' } }), { status: 200 }),
    )
    await expect(client.read()).rejects.toMatchObject({ code: 'RESPONSE_INVALID' })
  })

  it('cancels outstanding requests on dispose, even if a fetch implementation returns late', async () => {
    let resolveFetch!: (value: Response) => void
    const request = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve
        }),
    )
    const client = new DevelopmentWorkspaceClient('http://localhost', token, request)
    const reading = client.read()
    const sentSignal = request.mock.calls[0][1]?.signal
    client.dispose()
    expect(sentSignal?.aborted).toBe(true)
    resolveFetch(new Response(JSON.stringify(snapshot), { status: 200 }))
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    await expect(client.read()).rejects.toMatchObject({ code: 'CLIENT_DISPOSED' })
  })

  it('supports caller cancellation and never follows a server redirect', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error(token)))),
      )
    const client = new DevelopmentWorkspaceClient('http://localhost', token, request)
    const controller = new AbortController()
    const pending = client.read(controller.signal)
    expect(request.mock.calls[0][1]?.redirect).toBe('error')
    controller.abort()
    const error = await pending.catch(value => value)
    expect(error.name).toBe('AbortError')
    expect(error.message).not.toContain(token)
  })
})
