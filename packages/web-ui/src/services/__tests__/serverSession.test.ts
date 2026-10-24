import { describe, expect, it, vi } from 'vitest'
import {
  ServerSessionClient,
  captureOAuthCallbackAtBoot,
  consumeOAuthCallback,
  takeBootOAuthCallback,
  type SessionStorage,
  normalizeServerUrl,
} from '../serverSession'
import type { ServerInfo, ServerSession } from '@arcadia-eternity/protocol'

const profile = { id: 'shared-public-local-id', name: 'Player' }
const info: ServerInfo = {
  serverId: 'server-a',
  bootId: 'boot-1',
  authModes: ['guest', 'account'],
  accountProviders: ['email', 'github'],
  protocolVersion: 1,
}
const makeSession = (seatId: string, changes: Partial<ServerSession> = {}): ServerSession => ({
  ...info,
  sessionId: `session-${seatId}`,
  seatId,
  token: `secret-${seatId}`,
  principal: { kind: 'guest', guestId: `guest-${seatId}` },
  profile,
  expiresAt: Date.now() + 60_000,
  ...changes,
})
const storage = (): SessionStorage => {
  const entries = new Map<string, string>()
  return {
    getItem: k => entries.get(k) ?? null,
    setItem: (k, v) => {
      entries.set(k, v)
    },
    removeItem: k => {
      entries.delete(k)
    },
  }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const requester = () => vi.fn<typeof fetch>()

describe('server session identity boundaries', () => {
  it('clears GitHub authorization code and state from the visible URL before another operation can run', () => {
    let visibleUrl = 'https://game.example/account?code=one-time-code&state=state-1&tab=account#profile'
    const replaceState = vi.fn((_state: unknown, _unused: string, url: string | URL | null | undefined) => {
      visibleUrl = `https://game.example${url}`
    })
    const callback = consumeOAuthCallback({ href: visibleUrl }, { state: { route: 'account' }, replaceState })
    expect(callback).toEqual({ code: 'one-time-code', state: 'state-1', error: null })
    expect(visibleUrl).toBe('https://game.example/account#profile')
    expect(replaceState).toHaveBeenCalledOnce()
  })

  it('also removes provider error details and opaque callback fields from browser history', () => {
    let visibleUrl =
      'https://game.example/account?error=access_denied&error_description=private-detail&iss=https%3A%2F%2Fissuer.example&session_state=opaque&tab=account'
    const replaceState = vi.fn((_state: unknown, _unused: string, url: string | URL | null | undefined) => {
      visibleUrl = `https://game.example${url}`
    })
    const callback = consumeOAuthCallback({ href: visibleUrl }, { state: null, replaceState })
    expect(callback).toEqual({ code: null, state: null, error: 'access_denied' })
    expect(visibleUrl).toBe('https://game.example/account')
  })

  it('captures an account callback before bootstrap and delivers it only once', () => {
    let visibleUrl = 'https://game.example/account?code=one-time-code&state=state-1'
    const replaceState = vi.fn((_state: unknown, _unused: string, url: string | URL | null | undefined) => {
      visibleUrl = `https://game.example${url}`
    })
    captureOAuthCallbackAtBoot({ href: visibleUrl }, { state: null, replaceState })
    expect(visibleUrl).toBe('https://game.example/account')
    expect(takeBootOAuthCallback()).toEqual({ code: 'one-time-code', state: 'state-1', error: null })
    expect(takeBootOAuthCallback()).toBeNull()
  })

  it('normalizes origins and strips query credentials without collapsing server base paths', () => {
    expect(normalizeServerUrl('wss://EXAMPLE.com:443/game/api/v1/?token=unsafe#id')).toBe(
      'https://example.com/game/api/v1',
    )
  })

  it('restores the authorized seat after page refresh without posting a public UID to claim it', async () => {
    const store = storage()
    const request = requester()
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('seat-1')))
    await new ServerSessionClient('https://game.example/api/v1', store, request).ensure(profile)
    request.mockResolvedValueOnce(json(info)).mockResolvedValueOnce(json(makeSession('seat-1')))
    const restored = await new ServerSessionClient('https://game.example/api/v1', store, request).ensure(profile)
    expect(restored.seatId).toBe('seat-1')
    const [url, init] = request.mock.calls[3]
    expect(url).toBe('https://game.example/api/v1/session')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-seat-1' })
    expect(init?.body).toBeUndefined()
  })

  it('isolates two tabs even when they share the same local profile UID', async () => {
    const request = requester()
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('seat-1')))
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('seat-2')))
    const first = await new ServerSessionClient('https://game.example/api/v1', storage(), request).ensure(profile)
    const second = await new ServerSessionClient('https://game.example/api/v1', storage(), request).ensure(profile)
    expect(first.profile.id).toBe(second.profile.id)
    expect(first.seatId).not.toBe(second.seatId)
  })

  it('never sends credentials to another origin or API mount even if serverId is reused', async () => {
    const store = storage()
    const request = requester()
    for (const url of [
      'https://one.example/api/v1',
      'https://two.example/api/v1',
      'https://one.example/other/api/v1',
    ]) {
      request.mockResolvedValueOnce(json(info)).mockResolvedValueOnce(json(makeSession(url)))
      await new ServerSessionClient(url, store, request).ensure(profile)
    }
    expect(request.mock.calls.every(([, init]) => !(init?.headers as Record<string, string>).Authorization)).toBe(true)
  })

  it('invalidates rooms on boot change before acquiring an unrelated guest seat', async () => {
    const request = requester()
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('old')))
    const invalidated = vi.fn()
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request, invalidated)
    await client.ensure(profile)
    request.mockResolvedValueOnce(json({ ...info, bootId: 'boot-2' })).mockImplementationOnce(async () => {
      expect(invalidated).toHaveBeenCalledOnce()
      expect(client.session).toBeNull()
      return json(makeSession('new', { bootId: 'boot-2' }))
    })
    const current = await client.ensure(profile)
    expect(current.seatId).toBe('new')
    expect(profile.id).toBe('shared-public-local-id')
    expect(request.mock.calls[3][1]?.headers).not.toHaveProperty('Authorization')
  })

  it('invalid token cannot recover the old seat using a matching UID', async () => {
    const request = requester()
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('old')))
    const invalidated = vi.fn()
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request, invalidated)
    await client.ensure(profile)
    request
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json(makeSession('new')))
    expect((await client.ensure(profile)).seatId).toBe('new')
    expect(invalidated).toHaveBeenCalledOnce()
    expect(JSON.parse(request.mock.calls[4][1]?.body as string)).toEqual({ profile })
  })

  it('preserves an account session through network errors and server failures', async () => {
    const account = makeSession('account-seat', { principal: { kind: 'account', accountId: 'account-1' } })
    const request = requester().mockResolvedValueOnce(json(info)).mockResolvedValueOnce(json(account))
    const invalidated = vi.fn()
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request, invalidated)
    await client.ensure(profile)
    request.mockRejectedValueOnce(new TypeError('network offline'))
    await expect(client.ensure(profile)).rejects.toThrow('network offline')
    request.mockResolvedValueOnce(json(info)).mockResolvedValueOnce(json({}, 503))
    await expect(client.ensure(profile)).rejects.toThrow('503')
    expect(client.session).toEqual(account)
    expect(invalidated).not.toHaveBeenCalled()
  })

  it('requires confirmed server revocation before forgetting a credential', async () => {
    const request = requester()
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('old')))
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)
    await client.ensure(profile)
    request.mockRejectedValueOnce(new TypeError('offline'))
    await expect(client.logout()).rejects.toThrow('offline')
    expect(client.session?.seatId).toBe('old')
    request.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await client.logout()
    expect(client.session).toBeNull()
  })

  it('does not resurrect a session when logout races an in-flight resume', async () => {
    const request = requester()
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('old')))
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)
    await client.ensure(profile)
    let release!: (response: Response) => void
    let started!: () => void
    const resumed = new Promise<void>(resolve => {
      started = resolve
    })
    request
      .mockResolvedValueOnce(json(info))
      .mockImplementationOnce(() => {
        started()
        return new Promise<Response>(resolve => {
          release = resolve
        })
      })
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const pending = client.ensure(profile)
    await resumed
    await client.logout()
    release(json(makeSession('old')))
    await expect(pending).rejects.toThrow('会话操作已取消')
    expect(client.session).toBeNull()
  })

  it('discovers account-only servers without silently creating a guest', async () => {
    const request = requester().mockResolvedValueOnce(json({ ...info, authModes: ['account'] }))
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)
    expect((await client.refresh()).session).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
    expect(client.info?.accountProviders).toEqual(['email', 'github'])
  })

  it('does not expose unavailable account providers on a guest-only server', async () => {
    const request = requester()
      .mockResolvedValueOnce(json({ ...info, authModes: ['guest'], accountProviders: undefined }))
      .mockResolvedValueOnce(json({ ...info, authModes: ['guest'], accountProviders: undefined }))
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)
    await client.refresh()
    await expect(client.requestEmailCode('player@example.com', 'login')).rejects.toThrow('未启用邮箱登录')
    await expect(client.startGitHub('login')).rejects.toThrow('未启用 GitHub 登录')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('logs in with a verified email code and revokes the former guest seat', async () => {
    const request = requester()
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('guest')))
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)
    await client.ensure(profile)
    request
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('guest')))
      .mockResolvedValueOnce(json({ challengeId: 'challenge-1', expiresAt: Date.now() + 60_000 }))
    await client.requestEmailCode('player@example.com', 'login')
    const challengeCall = request.mock.calls.find(([url]) => String(url).endsWith('/auth/email/challenges'))!
    expect(JSON.parse(challengeCall[1]?.body as string)).toEqual({
      email: 'player@example.com',
      intent: 'login',
    })
    expect(challengeCall[1]?.headers).not.toHaveProperty('Authorization')

    const account = makeSession('account', { principal: { kind: 'account', accountId: 'account-1' } })
    request
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('guest')))
      .mockResolvedValueOnce(json({ session: account }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const result = await client.completeEmailCode('challenge-1', '123456', 'login', profile)
    expect(result).toEqual(account)
    expect(client.session?.seatId).toBe('account')
    expect(client.session?.profile.id).toBe(profile.id)
    const completeCall = request.mock.calls.find(([url]) => String(url).endsWith('/auth/email/complete'))!
    expect(JSON.parse(completeCall[1]?.body as string)).toEqual({
      challengeId: 'challenge-1',
      code: '123456',
      intent: 'login',
      profile,
    })
    const revocationCall = request.mock.calls.find(
      ([url, init]) => String(url).endsWith('/session') && init?.method === 'DELETE',
    )!
    expect(revocationCall[1]?.headers).toMatchObject({ Authorization: 'Bearer secret-guest' })
  })

  it('refreshes the server boot before issuing an email challenge so its completed account session can be adopted', async () => {
    let bootId = 'boot-1'
    const request = requester().mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/server-info')) return json({ ...info, bootId })
      if (url.endsWith('/auth/email/challenges'))
        return json({ challengeId: 'challenge-after-restart', expiresAt: Date.now() + 60_000 })
      if (url.endsWith('/auth/email/complete')) {
        return json({
          session: makeSession('account', {
            bootId,
            principal: { kind: 'account', accountId: 'account-1' },
          }),
        })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)

    await client.refresh()
    bootId = 'boot-2'

    await client.requestEmailCode('player@example.com', 'login')
    expect(request.mock.calls.map(([url]) => String(url)).slice(-2)).toEqual([
      'https://game.example/api/v1/server-info',
      'https://game.example/api/v1/auth/email/challenges',
    ])

    bootId = 'boot-3'
    await expect(
      client.completeEmailCode('challenge-after-restart', '123456', 'login', profile),
    ).resolves.toMatchObject({
      bootId: 'boot-3',
    })
    expect(client.info?.bootId).toBe('boot-3')
    expect(request.mock.calls.map(([url]) => String(url)).slice(-2)).toEqual([
      'https://game.example/api/v1/server-info',
      'https://game.example/api/v1/auth/email/complete',
    ])
  })

  it('refreshes once more when the server restarts while completing an email code', async () => {
    let bootId = 'boot-1'
    const request = requester().mockImplementation(async input => {
      const url = String(input)
      if (url.endsWith('/server-info')) return json({ ...info, bootId })
      if (url.endsWith('/auth/email/challenges'))
        return json({ challengeId: 'challenge-race', expiresAt: Date.now() + 60_000 })
      if (url.endsWith('/auth/email/complete')) {
        bootId = 'boot-4'
        return json({
          session: makeSession('account', {
            bootId,
            principal: { kind: 'account', accountId: 'account-1' },
          }),
        })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)

    await client.refresh()
    bootId = 'boot-2'
    await client.requestEmailCode('player@example.com', 'login')
    bootId = 'boot-3'

    await expect(client.completeEmailCode('challenge-race', '123456', 'login', profile)).resolves.toMatchObject({
      bootId: 'boot-4',
    })
    expect(client.info?.bootId).toBe('boot-4')
    expect(request.mock.calls.map(([url]) => String(url)).slice(-3)).toEqual([
      'https://game.example/api/v1/server-info',
      'https://game.example/api/v1/auth/email/complete',
      'https://game.example/api/v1/server-info',
    ])
  })

  it('links a second verified identity only to the authenticated account', async () => {
    const account = makeSession('account', { principal: { kind: 'account', accountId: 'account-1' } })
    const request = requester().mockResolvedValueOnce(json(info)).mockResolvedValueOnce(json(account))
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)
    await client.ensure(profile)
    request
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(account))
      .mockResolvedValueOnce(json({ challengeId: 'link-1', expiresAt: Date.now() + 60_000 }))
    await client.requestEmailCode('second@example.com', 'link')
    const challengeCall = request.mock.calls.find(([url]) => String(url).endsWith('/auth/email/challenges'))!
    expect(challengeCall[1]?.headers).toMatchObject({ Authorization: 'Bearer secret-account' })
    const identities = [{ providerId: 'email', issuer: 'email', subject: 'second@example.com' }]
    request
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(account))
      .mockResolvedValueOnce(json({ identities }))
    expect(await client.completeEmailCode('link-1', '654321', 'link', profile)).toEqual(identities)
    const completeCall = request.mock.calls.find(([url]) => String(url).endsWith('/auth/email/complete'))!
    expect(JSON.parse(completeCall[1]?.body as string)).toEqual({
      challengeId: 'link-1',
      code: '654321',
      intent: 'link',
    })
    expect(completeCall[1]?.headers).toMatchObject({ Authorization: 'Bearer secret-account' })
    expect(client.session).toEqual(account)
  })

  it('keeps GitHub state and browser secret in the initiating tab and rejects an unsolicited callback', async () => {
    const store = storage()
    const request = requester().mockResolvedValueOnce(json(info))
    const client = new ServerSessionClient('https://game.example/api/v1', store, request)
    await client.refresh()
    const authorizationUrl = 'https://github.com/login/oauth/authorize?state=state-1'
    request.mockResolvedValueOnce(
      json({ authorizationUrl, state: 'state-1', browserSecret: 'browser-only', expiresAt: Date.now() + 60_000 }),
    )
    expect(await client.startGitHub('login')).toBe(authorizationUrl)
    expect(request.mock.calls[1][0]).toBe('https://game.example/api/v1/auth/github/authorizations')
    expect(request.mock.calls[1][1]?.headers).not.toHaveProperty('Authorization')
    await expect(client.completeGitHub('attacker-state', 'code', profile)).rejects.toThrow('已失效')
    expect(request).toHaveBeenCalledTimes(2)

    const account = makeSession('github', { principal: { kind: 'account', accountId: 'account-2' } })
    request.mockResolvedValueOnce(json({ session: account }))
    expect(await client.completeGitHub('state-1', 'authorization-code', profile)).toEqual(account)
    expect(request.mock.calls[2][0]).toBe('https://game.example/api/v1/auth/github/complete')
    expect(JSON.parse(request.mock.calls[2][1]?.body as string)).toEqual({
      state: 'state-1',
      code: 'authorization-code',
      browserSecret: 'browser-only',
      intent: 'login',
      profile,
    })
    expect(authorizationUrl).not.toContain('browser-only')
    expect(store.getItem('server-github:https%3A%2F%2Fgame.example%2Fapi%2Fv1:server-a')).toBeNull()
  })

  it('binds GitHub only with the current account session and never sends the local UID for linking', async () => {
    const account = makeSession('account', { principal: { kind: 'account', accountId: 'account-1' } })
    const request = requester().mockResolvedValueOnce(json(info)).mockResolvedValueOnce(json(account))
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)
    await client.ensure(profile)
    request.mockResolvedValueOnce(
      json({
        authorizationUrl: 'https://github.com/login/oauth/authorize?state=link-state',
        state: 'link-state',
        browserSecret: 'tab-only',
        expiresAt: Date.now() + 60_000,
      }),
    )
    await client.startGitHub('link')
    expect(request.mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Bearer secret-account' })
    const identities = [{ providerId: 'github', issuer: 'https://github.com', subject: '123456' }]
    request.mockResolvedValueOnce(json({ identities }))
    expect(await client.completeGitHub('link-state', 'code-2', profile)).toEqual(identities)
    expect(request.mock.calls[3][1]?.headers).toMatchObject({ Authorization: 'Bearer secret-account' })
    expect(JSON.parse(request.mock.calls[3][1]?.body as string)).toEqual({
      state: 'link-state',
      code: 'code-2',
      browserSecret: 'tab-only',
      intent: 'link',
    })
    expect(client.session).toEqual(account)
  })

  it('keeps the last recovery path and session when unlink is refused, then revokes it on deactivation', async () => {
    const account = makeSession('account', { principal: { kind: 'account', accountId: 'account-1' } })
    const request = requester().mockResolvedValueOnce(json(info)).mockResolvedValueOnce(json(account))
    const invalidated = vi.fn()
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request, invalidated)
    await client.ensure(profile)
    request.mockResolvedValueOnce(json({ code: 'LAST_RECOVERY_PATH' }, 409))
    await expect(
      client.unlinkIdentity({ providerId: 'email', issuer: 'email', subject: 'player@example.com' }),
    ).rejects.toMatchObject({ status: 409, code: 'LAST_RECOVERY_PATH' })
    expect(client.session).toEqual(account)
    request.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await client.deactivateAccount()
    expect(client.session).toBeNull()
    expect(invalidated).toHaveBeenCalledWith(expect.stringContaining('账号已停用'))
    expect(request.mock.calls[3][1]?.headers).toMatchObject({ Authorization: 'Bearer secret-account' })
  })

  it('does not adopt a new account if the former seat could not be revoked', async () => {
    const request = requester()
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('guest')))
    const client = new ServerSessionClient('https://game.example/api/v1', storage(), request)
    await client.ensure(profile)
    const account = makeSession('account', { principal: { kind: 'account', accountId: 'account-1' } })
    request
      .mockResolvedValueOnce(json(info))
      .mockResolvedValueOnce(json(makeSession('guest')))
      .mockResolvedValueOnce(json({ session: account }))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(client.completeEmailCode('challenge', '123456', 'login', profile)).rejects.toThrow('offline')
    expect(client.session?.seatId).toBe('guest')
    const accountCleanupCall = request.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/session') &&
        init?.method === 'DELETE' &&
        (init.headers as Record<string, string> | undefined)?.Authorization === 'Bearer secret-account',
    )!
    expect(accountCleanupCall[1]?.headers).toMatchObject({ Authorization: 'Bearer secret-account' })
  })
})
