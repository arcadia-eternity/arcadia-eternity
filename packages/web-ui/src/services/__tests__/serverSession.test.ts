import { describe, expect, it, vi } from 'vitest'
import { ServerSessionClient, type SessionStorage, normalizeServerUrl } from '../serverSession'
import type { ServerInfo, ServerSession } from '@arcadia-eternity/protocol'

const profile = { id: 'shared-public-local-id', name: 'Player' }
const info: ServerInfo = { serverId: 'server-a', bootId: 'boot-1', authModes: ['guest', 'account'], protocolVersion: 1 }
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
})
