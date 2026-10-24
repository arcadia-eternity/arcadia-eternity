import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionRegistry } from '../src/standalone/session'

const profile = { id: 'local-profile', name: 'Player' }

afterEach(() => vi.useRealTimers())

describe('standalone session identity', () => {
  it('gives the same self-reported profile independent credentials, principals and seats', async () => {
    const registry = new SessionRegistry({ serverId: 'official' })
    const a = await registry.create(profile)
    const b = await registry.create(profile)
    expect(a.profile).toEqual(b.profile)
    expect(a.principal).not.toEqual(b.principal)
    for (const field of ['token', 'sessionId', 'seatId'] as const) expect(a[field]).not.toEqual(b[field])
    expect(a.seatId).toMatch(/^[A-Za-z0-9_-]{21}$/)
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(registry.authenticate(a.token)).toEqual(a)
    for (const publicId of [profile.id, a.sessionId, a.seatId]) expect(registry.authenticate(publicId)).toBeUndefined()
  })

  it('rejects altered credentials and does not let response mutations alter stored authority', async () => {
    const registry = new SessionRegistry({ serverId: 'official' })
    const session = await registry.create(profile)
    const token = session.token
    const original = structuredClone(session)
    session.principal = { kind: 'account', accountId: 'admin' }
    session.seatId = 'stolen-seat'
    session.profile.name = 'edited'
    expect(registry.authenticate(token)).toEqual(original)
    const read = registry.authenticate(token)!
    read.profile.id = 'another-profile'
    expect(registry.authenticate(token)).toEqual(original)
    expect(registry.authenticate(`${token.slice(0, -1)}!`)).toBeUndefined()
    expect(registry.authenticate({ token })).toBeUndefined()
  })

  it('invalidates credentials on restart even with the same stable server ID', async () => {
    const before = new SessionRegistry({ serverId: 'official' })
    const session = await before.create(profile)
    const after = new SessionRegistry({ serverId: 'official' })
    expect(before.serverId).toBe(after.serverId)
    expect(before.bootId).not.toBe(after.bootId)
    expect(after.authenticate(session.token)).toBeUndefined()
    expect(new SessionRegistry({ serverId: 'other' }).authenticate(session.token)).toBeUndefined()
    before.clear()
    expect(before.authenticate(session.token)).toBeUndefined()
  })

  it('expires and revokes capabilities independently of the local profile', async () => {
    vi.useFakeTimers()
    const registry = new SessionRegistry({ serverId: 'official', ttlMs: 1_000, maxSessions: 1 })
    const first = await registry.create(profile)
    await expect(registry.create(profile)).rejects.toMatchObject({ code: 'SESSION_CAPACITY' })
    vi.advanceTimersByTime(999)
    expect(registry.authenticate(first.token)).toBeDefined()
    vi.advanceTimersByTime(1)
    expect(registry.authenticate(first.token)).toBeUndefined()
    expect(registry.size).toBe(0)
    const second = await registry.create(profile)
    expect(second.seatId).not.toBe(first.seatId)
    expect(registry.revoke(second.token)).toBe(true)
    expect(registry.authenticate(second.token)).toBeUndefined()
    expect(registry.revoke(second.token)).toBe(false)
  })

  it('only accepts verified accounts and never merges sessions or seats by profile or account', async () => {
    const verify = vi
      .fn()
      .mockImplementation((proof: unknown) =>
        proof === 'verified-proof' ? { accountId: 'account-1', displayName: 'Verified name' } : null,
      )
    const registry = new SessionRegistry({ serverId: 'official', accountProvider: { verify } })
    const guest = await registry.create(profile)
    const account = await registry.create(profile, 'verified-proof')
    const anotherLogin = await registry.create({ id: 'other-profile', name: 'Other' }, 'verified-proof')
    expect(guest.principal.kind).toBe('guest')
    expect(account.principal).toEqual({ kind: 'account', accountId: 'account-1' })
    expect(account.profile).toEqual({ ...profile, name: 'Verified name' })
    expect(account.principal).toEqual(anotherLogin.principal)
    expect(account.seatId).not.toBe(guest.seatId)
    expect(account.seatId).not.toBe(anotherLogin.seatId)
    await expect(registry.create(profile, 'account-1')).rejects.toMatchObject({ code: 'ACCOUNT_AUTH_FAILED' })
    expect(registry.size).toBe(3)
    expect(registry.getServerInfo().authModes).toEqual(['guest', 'account'])
  })

  it('fails closed when account authentication is unsupported or fails', async () => {
    const registry = new SessionRegistry({ serverId: 'official' })
    expect(registry.getServerInfo().authModes).toEqual(['guest'])
    await expect(registry.create(profile, { accountId: 'admin' })).rejects.toMatchObject({
      code: 'ACCOUNT_AUTH_UNAVAILABLE',
    })
    const failing = new SessionRegistry({
      serverId: 'official',
      accountProvider: { verify: () => Promise.reject(new Error('provider secret')) },
    })
    await expect(failing.create(profile, 'proof')).rejects.toThrow('ACCOUNT_AUTH_FAILED')
    expect(failing.size).toBe(0)
  })

  it.each([
    null,
    {},
    { ...profile, id: '' },
    { ...profile, id: 'a'.repeat(129) },
    { ...profile, name: ' ' },
    { ...profile, name: 'a'.repeat(65) },
    { ...profile, name: 'line\nname' },
  ])('rejects invalid profile %j', async value => {
    const registry = new SessionRegistry({ serverId: 'official' })
    await expect(registry.create(value)).rejects.toMatchObject({ code: 'INVALID_PROFILE' })
    expect(registry.size).toBe(0)
  })

  it('does not resurrect an in-flight login after the registry is cleared', async () => {
    let finish!: (account: { accountId: string }) => void
    const registry = new SessionRegistry({
      serverId: 'official',
      accountProvider: {
        verify: () =>
          new Promise(resolve => {
            finish = resolve
          }),
      },
    })
    const pending = registry.create(profile, 'proof')
    registry.clear()
    finish({ accountId: 'account-1' })
    await expect(pending).rejects.toMatchObject({ code: 'SESSION_REGISTRY_RESET' })
    expect(registry.size).toBe(0)
  })

  it('enforces capacity after concurrent account verification', async () => {
    const completions: ((account: { accountId: string }) => void)[] = []
    const registry = new SessionRegistry({
      serverId: 'official',
      maxSessions: 1,
      accountProvider: { verify: () => new Promise(resolve => completions.push(resolve)) },
    })
    const first = registry.create(profile, 'proof-1')
    const second = registry.create(profile, 'proof-2')
    completions[0]({ accountId: 'account-1' })
    await first
    completions[1]({ accountId: 'account-2' })
    await expect(second).rejects.toMatchObject({ code: 'SESSION_CAPACITY' })
    expect(registry.size).toBe(1)
  })
})
