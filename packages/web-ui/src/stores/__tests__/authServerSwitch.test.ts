import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { localDataStorage } from '@/services/localStorage'
import type { ServerInfo, ServerSession } from '@arcadia-eternity/protocol'
import { useAuthStore } from '../auth'

const profile = { id: 'profile', name: 'Player' }
const info: ServerInfo = {
  serverId: 'shared-id',
  bootId: 'same-boot',
  protocolVersion: 1,
  authModes: ['guest', 'account'],
  accountProviders: ['github', 'email'],
}
const session = (label: string, account = false): ServerSession => ({
  serverId: info.serverId,
  bootId: info.bootId,
  sessionId: `session-${label}`,
  seatId: `seat-${label}`,
  token: `secret-${label}`,
  principal: account
    ? { kind: 'account', accountId: `account-${label}` }
    : { kind: 'guest', guestId: `guest-${label}` },
  profile,
  expiresAt: Date.now() + 60000,
})
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
const deferred = () => {
  let resolve!: (response: Response) => void
  let started!: () => void
  const wait = new Promise<void>(r => {
    started = r
  })
  const response = new Promise<Response>(r => {
    resolve = r
  })
  return { wait, response, started, resolve }
}

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('switching server session authority', () => {
  it('creates a session from a fresh tab using the default server', async () => {
    const request = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/server-info')) return json(info)
      if (url.endsWith('/sessions')) return json(session('default'))
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', request)
    const auth = useAuthStore()
    await auth.ensureSession(profile)
    expect(auth.getAccessToken()).toBe('secret-default')
  })
  it('creates a session with the production Pinia persistence plugin installed', async () => {
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localDataStorage }))
    createApp({}).use(pinia)
    setActivePinia(pinia)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async input => {
        const url = String(input)
        if (url.endsWith('/server-info')) return json(info)
        if (url.endsWith('/sessions')) return json(session('default'))
        throw new Error(`Unexpected request ${url}`)
      }),
    )
    const auth = useAuthStore()
    await auth.ensureSession(profile)
    expect(auth.getAccessToken()).toBe('secret-default')
  })
  it('shares one session client when Pinia devtools supplies a fresh proxy for each action', async () => {
    const pinia = createPinia()
    pinia.use(createPersistedState({ storage: localDataStorage }))
    createApp({}).use(pinia)
    setActivePinia(pinia)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async input => {
        const url = String(input)
        if (url.endsWith('/server-info')) return json(info)
        if (url.endsWith('/sessions')) return json(session('default'))
        throw new Error(`Unexpected request ${url}`)
      }),
    )
    const auth = useAuthStore()
    const actions = auth as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const name of ['ensureSession', 'withClient', 'initialize', 'setServerUrl']) {
      const action = actions[name]
      actions[name] = (...args: unknown[]) => Reflect.apply(action, new Proxy(auth, {}), args)
    }
    await auth.ensureSession(profile)
    expect(auth.getAccessToken()).toBe('secret-default')
    auth.setServerUrl('https://server-b.test')
    expect(auth.getAccessToken()).toBeNull()
    await auth.ensureSession(profile)
    expect(auth.getAccessToken()).toBe('secret-default')
  })
  it('never sends server A credentials to server B, even with matching server and boot ids', async () => {
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/server-info')) return json(info)
      if (url.endsWith('/sessions')) return json(session(url.includes('server-a') ? 'a' : 'b'))
      throw new Error(`Unexpected request ${url} ${init?.method}`)
    })
    vi.stubGlobal('fetch', request)
    const auth = useAuthStore()
    auth.setServerUrl('ws://server-a.test:8102/')
    await auth.ensureSession(profile)
    const generationA = auth.serverGeneration
    expect(auth.getAccessToken()).toBe('secret-a')
    auth.setServerUrl('https://server-b.test')
    expect(auth.getAccessToken()).toBeNull()
    expect(auth.getAccessToken(generationA)).toBeNull()
    expect(
      Object.keys(sessionStorage).some(key => key.includes(encodeURIComponent('http://server-a.test:8102/api/v1'))),
    ).toBe(false)
    await auth.ensureSession(profile)
    expect(auth.getAccessToken()).toBe('secret-b')
    const bCalls = request.mock.calls.filter(([url]) => String(url).startsWith('https://server-b.test/'))
    expect(bCalls).toHaveLength(2)
    expect(bCalls.every(([, init]) => !(init?.headers as Record<string, string>).Authorization)).toBe(true)
    const reloaded = useAuthStore(createPinia())
    expect(reloaded.serverUrl).toBe('https://server-b.test')
    expect(reloaded.hasSelectedServer).toBe(true)
  })

  for (const operation of ['guest', 'account', 'github'] as const)
    it(`drops a late ${operation} response, including storage, when the request ignores abort`, async () => {
      const pending = deferred()
      const request = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input)
        if (url.endsWith('/server-info')) return json(info)
        if (url.startsWith('https://server-b.test') && url.endsWith('/sessions')) return json(session('b'))
        if (
          url.startsWith('https://server-a.test') &&
          ((operation !== 'github' && url.endsWith('/sessions')) ||
            (operation === 'github' && url.endsWith('/auth/github/authorizations')))
        ) {
          pending.started()
          return pending.response
        }
        throw new Error(`Unexpected request ${url} ${init?.method}`)
      })
      vi.stubGlobal('fetch', request)
      const auth = useAuthStore()
      auth.setServerUrl('https://server-a.test')
      const old =
        operation === 'guest'
          ? auth.ensureSession(profile)
          : operation === 'account'
            ? auth.loginWithAccount(profile, { token: 'proof' })
            : auth.startGitHub('login')
      const caught = old.catch(error => error)
      await pending.wait
      auth.setServerUrl('https://server-b.test')
      await auth.ensureSession(profile)
      const response =
        operation === 'github'
          ? {
              state: 'state-a',
              browserSecret: 'secret',
              expiresAt: Date.now() + 60000,
              authorizationUrl: 'https://github.test',
            }
          : session('a', operation === 'account')
      pending.resolve(json(response))
      expect((await caught).message).toContain('会话操作已取消')
      expect(auth.session?.seatId).toBe('seat-b')
      expect(
        Object.keys(sessionStorage).some(key => key.includes(encodeURIComponent('https://server-a.test/api/v1'))),
      ).toBe(false)
      const bCalls = request.mock.calls.filter(([url]) => String(url).startsWith('https://server-b.test/'))
      expect(bCalls.every(([, init]) => !(init?.headers as Record<string, string>).Authorization)).toBe(true)
    })

  for (const operation of ['email-complete', 'github-callback', 'identities', 'logout'] as const)
    it(`cancels a late ${operation} after switching without changing B or reviving A credentials`, async () => {
      const pending = deferred()
      const request = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input)
        if (url.endsWith('/server-info')) return json(info)
        if (url.startsWith('https://server-b.test') && url.endsWith('/sessions')) return json(session('b'))
        if (url.endsWith('/auth/github/authorizations'))
          return json({
            state: 'state-a',
            browserSecret: 'secret',
            expiresAt: Date.now() + 60000,
            authorizationUrl: 'https://github.test',
          })
        if (
          (operation === 'email-complete' && url.endsWith('/auth/email/complete')) ||
          (operation === 'github-callback' && url.endsWith('/auth/github/complete')) ||
          (operation === 'identities' && url.endsWith('/account/identities')) ||
          (operation === 'logout' && url.endsWith('/session') && init?.method === 'DELETE')
        ) {
          pending.started()
          return pending.response
        }
        if (url.endsWith('/sessions')) return json(session('a', operation === 'identities'))
        if (url.endsWith('/session')) return json(session('a', operation === 'identities'))
        throw new Error(`Unexpected request ${url} ${init?.method}`)
      })
      vi.stubGlobal('fetch', request)
      const auth = useAuthStore()
      auth.setServerUrl('https://server-a.test')
      if (operation === 'identities' || operation === 'logout') await auth.ensureSession(profile)
      if (operation === 'github-callback') await auth.startGitHub('login')
      const old =
        operation === 'email-complete'
          ? auth.completeEmailCode('challenge', 'code', 'login', profile)
          : operation === 'github-callback'
            ? auth.completeGitHub('state-a', 'code', profile)
            : operation === 'identities'
              ? auth.refreshAccountContext()
              : auth.logout()
      const caught = old.catch(error => error)
      await pending.wait
      auth.setServerUrl('https://server-b.test')
      await auth.ensureSession(profile)
      pending.resolve(
        operation === 'logout'
          ? new Response(null, { status: 204 })
          : operation === 'identities'
            ? json({ identities: [{ providerId: 'github', subject: 'old' }] })
            : json({ session: session('a', true) }),
      )
      expect((await caught).message).toContain('会话操作已取消')
      expect(auth.session?.seatId).toBe('seat-b')
      expect(auth.identities).toEqual([])
      expect(
        Object.keys(sessionStorage).some(key => key.includes(encodeURIComponent('https://server-a.test/api/v1'))),
      ).toBe(false)
      const bCalls = request.mock.calls.filter(([url]) => String(url).startsWith('https://server-b.test/'))
      expect(bCalls.every(([, init]) => !(init?.headers as Record<string, string>).Authorization)).toBe(true)
    })

  it('keeps failed server selection credential-free and rejects unsafe addresses before changing state', async () => {
    const request = vi.fn<typeof fetch>(async input => {
      if (String(input).startsWith('https://server-b.test')) throw new TypeError('offline')
      return String(input).endsWith('/server-info') ? json(info) : json(session('a'))
    })
    vi.stubGlobal('fetch', request)
    const auth = useAuthStore()
    auth.setServerUrl('https://server-a.test')
    await auth.ensureSession(profile)
    for (const value of [
      'https://user:pass@server-b.test',
      'https://server-b.test/path',
      'https://server-b.test?token=x',
      'javascript:alert(1)',
    ])
      expect(() => auth.setServerUrl(value)).toThrow()
    expect(auth.getAccessToken()).toBe('secret-a')
    auth.setServerUrl('https://server-b.test')
    await expect(auth.ensureSession(profile)).rejects.toThrow('offline')
    expect(auth.serverUrl).toBe('https://server-b.test')
    expect(auth.session).toBeNull()
    expect(auth.serverInfo).toBeNull()
  })

  it('clears the in-memory token before a storage error can interrupt switching', async () => {
    const request = vi.fn<typeof fetch>(async input =>
      String(input).endsWith('/server-info') ? json(info) : json(session('a')),
    )
    vi.stubGlobal('fetch', request)
    const auth = useAuthStore()
    auth.setServerUrl('https://server-a.test')
    await auth.ensureSession(profile)
    const original = new Error('storage unavailable')
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw original
    })
    let failure: unknown
    try {
      auth.setServerUrl('https://server-b.test')
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('旧服务器连接已终止，但本地凭据清理失败')
    expect((failure as Error).cause).toBe(original)
    expect(auth.getAccessToken()).toBeNull()
    expect(auth.session).toBeNull()
    expect(auth.serverUrl).toBe('https://server-b.test')
    remove.mockRestore()
  })

  it('leaves the old endpoint and session untouched if the new selection cannot be saved', async () => {
    const request = vi.fn<typeof fetch>(async input =>
      String(input).endsWith('/server-info') ? json(info) : json(session('a')),
    )
    vi.stubGlobal('fetch', request)
    const auth = useAuthStore()
    auth.setServerUrl('https://server-a.test')
    await auth.ensureSession(profile)
    const generation = auth.serverGeneration
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full')
    })
    expect(() => auth.checkServerUrl('https://server-b.test')).toThrow('storage full')
    expect(() => auth.setServerUrl('https://server-b.test')).toThrow('storage full')
    expect(auth.serverUrl).toBe('https://server-a.test')
    expect(auth.serverGeneration).toBe(generation)
    expect(auth.getAccessToken()).toBe('secret-a')
    set.mockRestore()
  })

  it('does not save an old credential when switching while the response body is still pending', async () => {
    let finish!: (value: ServerSession) => void
    let started!: () => void
    const bodyStarted = new Promise<void>(resolve => {
      started = resolve
    })
    const body = new Promise<ServerSession>(resolve => {
      finish = resolve
    })
    const request = vi.fn<typeof fetch>(async input => {
      const url = String(input)
      if (url.endsWith('/server-info')) return json(info)
      if (url.startsWith('https://server-b.test')) return json(session('b'))
      started()
      return { ok: true, status: 200, json: () => body } as Response
    })
    vi.stubGlobal('fetch', request)
    const auth = useAuthStore()
    auth.setServerUrl('https://server-a.test')
    const old = auth.ensureSession(profile).catch(error => error)
    await bodyStarted
    auth.setServerUrl('https://server-b.test')
    await auth.ensureSession(profile)
    finish(session('a'))
    expect((await old).message).toContain('会话操作已取消')
    expect(auth.session?.seatId).toBe('seat-b')
    expect(
      Object.keys(sessionStorage).some(key => key.includes(encodeURIComponent('https://server-a.test/api/v1'))),
    ).toBe(false)
  })

  it('keeps a session when explicitly selecting the same endpoint while invalidating the old socket generation', async () => {
    const request = vi.fn<typeof fetch>(async input =>
      String(input).endsWith('/server-info') ? json(info) : json(session('default')),
    )
    vi.stubGlobal('fetch', request)
    const auth = useAuthStore()
    await auth.ensureSession(profile)
    const generation = auth.serverGeneration
    const before = auth.serverUrl
    auth.setServerUrl(before)
    expect(auth.getAccessToken()).toBe('secret-default')
    expect(auth.getAccessToken(generation)).toBeNull()
    auth.setServerUrl(before)
    expect(auth.serverGeneration).toBe(generation + 1)
  })
})
