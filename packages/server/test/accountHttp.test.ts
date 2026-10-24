import { afterEach, describe, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import type { AccountIdentity, ServerInfo, ServerSession } from '@arcadia-eternity/protocol'
import { createSingleProcessApp, type G3AccountServices } from '../src/standalone/app'
import {
  AccountDirectoryError,
  type AccountDirectory,
  type VerifiedIdentity,
} from '../src/standalone/accounts/directory'
import { EmailCodeVerifier, ProviderError, type AuthIntent } from '../src/standalone/providers'

const apps: ReturnType<typeof createSingleProcessApp>[] = []
const sockets: Socket[] = []
const profile = { id: 'public-local-uid', name: 'Alice' }

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect()
  await Promise.all(apps.splice(0).map(app => app.stop()))
})

function key(identity: { providerId: string; issuer: string; subject: string }) {
  return JSON.stringify([identity.providerId, identity.issuer, identity.subject])
}

class MemoryDirectory implements AccountDirectory {
  private nextAccount = 0
  private readonly owners = new Map<string, string>()
  private readonly records = new Map<string, { status: 'active' | 'deactivated'; identities: VerifiedIdentity[] }>()
  failAfterIssue = false
  failDeactivate = false
  failAfterDeactivateCommit = false
  failStatusRead = false
  fail = false
  identityGate?: { entered: () => void; wait: Promise<void> }

  private active(accountId: string) {
    if (this.fail) throw new Error('database disconnected')
    const record = this.records.get(accountId)
    if (!record) throw new AccountDirectoryError('ACCOUNT_NOT_FOUND')
    if (record.status === 'deactivated') throw new AccountDirectoryError('ACCOUNT_DEACTIVATED')
    return record
  }

  async resolveOrCreate(identity: VerifiedIdentity) {
    if (this.fail) throw new Error('database disconnected')
    const existing = this.owners.get(key(identity))
    if (existing) {
      this.active(existing)
      return { accountId: existing, status: 'active' as const }
    }
    const accountId = `account-${++this.nextAccount}`
    this.records.set(accountId, { status: 'active', identities: [identity] })
    this.owners.set(key(identity), accountId)
    return { accountId, status: 'active' as const }
  }

  async link(accountId: string, identity: VerifiedIdentity) {
    const record = this.active(accountId)
    const owner = this.owners.get(key(identity))
    if (owner && owner !== accountId) throw new AccountDirectoryError('IDENTITY_CONFLICT')
    if (!owner) {
      record.identities.push(identity)
      this.owners.set(key(identity), accountId)
    }
  }

  async list(accountId: string) {
    return structuredClone(this.active(accountId).identities)
  }

  async unlink(accountId: string, identity: { providerId: string; issuer: string; subject: string }) {
    const record = this.active(accountId)
    const index = record.identities.findIndex(value => key(value) === key(identity))
    if (index < 0) throw new AccountDirectoryError('IDENTITY_NOT_FOUND')
    if (record.identities.length === 1) throw new AccountDirectoryError('LAST_RECOVERY_METHOD')
    record.identities.splice(index, 1)
    this.owners.delete(key(identity))
  }

  async deactivate(accountId: string) {
    if (this.failDeactivate) throw new Error('database commit failed before deactivation')
    this.active(accountId).status = 'deactivated'
    if (this.failAfterDeactivateCommit) throw new Error('database commit acknowledgement was lost')
  }

  async getStatus(accountId: string) {
    if (this.fail || this.failStatusRead) throw new Error('database disconnected')
    return this.records.get(accountId)?.status ?? null
  }

  async withActiveAccount<T>(accountId: string, action: () => T | Promise<T>) {
    this.active(accountId)
    const value = await action()
    if (this.failAfterIssue) throw new Error('commit failed after issuing in-memory token')
    return value
  }

  async withActiveIdentity<T>(accountId: string, identity: VerifiedIdentity, action: () => T | Promise<T>) {
    this.active(accountId)
    if (this.identityGate) {
      this.identityGate.entered()
      await this.identityGate.wait
    }
    if (this.owners.get(key(identity)) !== accountId) throw new AccountDirectoryError('IDENTITY_NOT_FOUND')
    const value = await action()
    if (this.failAfterIssue) throw new Error('commit failed after issuing in-memory token')
    return value
  }
}

function services(directory = new MemoryDirectory(), githubRedirectUris = ['http://localhost:3000/account']) {
  const codes = new Map<string, string>()
  const email = new EmailCodeVerifier({
    sendCode: async (address, code) => {
      codes.set(address, code)
    },
  })
  const pending = new Map<string, { intent: AuthIntent; browserSecret: string; redirectUri: string }>()
  let sequence = 0
  const github: G3AccountServices['github'] = {
    providerId: 'github',
    callbackOrigins: githubRedirectUris.map(uri => new URL(uri).origin),
    async begin({ intent, redirectUri }) {
      if (!githubRedirectUris.includes(redirectUri)) throw new ProviderError('INVALID_AUTH_REQUEST', 400)
      const state = `test-state-${++sequence}`
      const browserSecret = `test-secret-${sequence}`
      pending.set(state, { intent, browserSecret, redirectUri })
      return {
        authorizationUrl: `https://github.com/login/oauth/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`,
        state,
        browserSecret,
        expiresAt: Date.now() + 60_000,
      }
    },
    async verify({ state, code, browserSecret }, intent) {
      const value = pending.get(state)
      if (!value || value.browserSecret !== browserSecret || JSON.stringify(value.intent) !== JSON.stringify(intent))
        throw new ProviderError('AUTH_PROOF_MISMATCH', 401)
      pending.delete(state)
      if (!/^github-user:[1-9]\d*$/.test(code)) throw new ProviderError('AUTH_PROOF_INVALID', 401)
      const id = Number(code.slice('github-user:'.length))
      if (!Number.isSafeInteger(id)) throw new ProviderError('AUTH_PROOF_INVALID', 401)
      return { issuer: 'https://github.com', subject: String(id), verifiedAt: Date.now() }
    },
  }
  return { accounts: { directory, email, github }, codes, directory }
}

async function boot(accounts?: G3AccountServices, corsOrigins = ['http://localhost:3000']) {
  const app = createSingleProcessApp({
    port: 0,
    host: '127.0.0.1',
    serverId: 'g3-test-server',
    corsOrigins,
    accounts,
  })
  apps.push(app)
  await app.start()
  return { app, url: `http://127.0.0.1:${app.address!.port}` }
}

function request(url: string, path: string, method = 'GET', body?: unknown, token?: string, origin?: string) {
  return fetch(`${url}/api/v1${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function emailLogin(host: Awaited<ReturnType<typeof boot>>, codes: Map<string, string>, address: string) {
  const begun = await request(host.url, '/auth/email/challenges', 'POST', { email: address, intent: 'login' })
  expect(begun.status).toBe(201)
  const { challengeId } = (await begun.json()) as { challengeId: string }
  const code = codes.get(address)!
  const completed = await request(host.url, '/auth/email/complete', 'POST', {
    intent: 'login',
    challengeId,
    code,
    profile,
  })
  expect(completed.status).toBe(201)
  return ((await completed.json()) as { session: ServerSession }).session
}

async function githubFlow(
  host: Awaited<ReturnType<typeof boot>>,
  intent: 'login' | 'link',
  token?: string,
  origin = 'http://localhost:3000',
) {
  const begun = await request(host.url, '/auth/github/authorizations', 'POST', { intent }, token, origin)
  expect(begun.status).toBe(201)
  const auth = (await begun.json()) as { state: string; browserSecret: string; authorizationUrl: string }
  expect(auth.authorizationUrl).toContain(auth.state)
  return auth
}

function onDisconnect(socket: Socket) {
  return new Promise<void>(resolve => socket.once('disconnect', () => resolve()))
}

describe('G3 account HTTP integration', () => {
  it('retains guest-only defaults and requires explicit stable server configuration', async () => {
    const guest = await boot()
    const info = await request(guest.url, '/server-info')
    expect(((await info.json()) as ServerInfo).authModes).toEqual(['guest'])
    expect(
      (await request(guest.url, '/auth/email/challenges', 'POST', { email: 'a@example.test', intent: 'login' })).status,
    ).toBe(404)
    const { accounts } = services()
    expect(() => createSingleProcessApp({ accounts })).toThrow('explicit stable serverId')
  })

  it('selects the registered GitHub callback from the allowed request origin and rejects missing or foreign origins', async () => {
    const callbacks = ['https://battle.yuuinih.com/account', 'https://test-battle.netlify.app/account']
    const fixture = services(undefined, callbacks)
    const host = await boot(fixture.accounts, ['https://battle.yuuinih.com', 'https://test-battle.netlify.app'])
    const missingOrigin = await request(host.url, '/auth/github/authorizations', 'POST', { intent: 'login' })
    expect(missingOrigin.status).toBe(400)
    const foreignOrigin = await request(
      host.url,
      '/auth/github/authorizations',
      'POST',
      { intent: 'login' },
      undefined,
      'https://attacker.example',
    )
    expect(foreignOrigin.status).toBe(400)
    const unregisteredOrigin = await request(
      host.url,
      '/auth/github/authorizations',
      'POST',
      { intent: 'login' },
      undefined,
      'https://configured-but-unregistered.example',
    )
    expect(unregisteredOrigin.status).toBe(400)

    const production = await githubFlow(host, 'login', undefined, 'https://battle.yuuinih.com')
    const staging = await githubFlow(host, 'login', undefined, 'https://test-battle.netlify.app')
    expect(production.state).toBe('test-state-1')
    expect(new URL(production.authorizationUrl).searchParams.get('redirect_uri')).toBe(
      'https://battle.yuuinih.com/account',
    )
    expect(new URL(staging.authorizationUrl).searchParams.get('redirect_uri')).toBe(
      'https://test-battle.netlify.app/account',
    )
  })

  it('rejects a G3 server configuration whose GitHub callbacks and CORS origins differ', () => {
    const fixture = services(undefined, ['https://battle.yuuinih.com/account'])
    expect(() =>
      createSingleProcessApp({
        serverId: 'g3-test-server',
        corsOrigins: ['https://battle.yuuinih.com', 'https://test-battle.netlify.app'],
        accounts: fixture.accounts,
      }),
    ).toThrow('GitHub App callbacks must exactly match CORS origins')
  })

  it('creates an account directly from a GitHub user ID and recovers it after restart', async () => {
    const fixture = services()
    const first = await boot(fixture.accounts)
    const begun = await githubFlow(first, 'login')
    const created = await request(first.url, '/auth/github/complete', 'POST', {
      intent: 'login',
      state: begun.state,
      browserSecret: begun.browserSecret,
      code: 'github-user:2001',
      profile,
    })
    expect(created.status).toBe(201)
    const session = ((await created.json()) as { session: ServerSession }).session
    expect(session.principal.kind).toBe('account')
    const identities = await request(first.url, '/account/identities', 'GET', undefined, session.token)
    expect(((await identities.json()) as { identities: AccountIdentity[] }).identities).toMatchObject([
      { providerId: 'github', issuer: 'https://github.com', subject: '2001' },
    ])

    await first.app.stop()
    const second = await boot(fixture.accounts)
    const repeat = await githubFlow(second, 'login')
    const recovered = await request(second.url, '/auth/github/complete', 'POST', {
      intent: 'login',
      state: repeat.state,
      browserSecret: repeat.browserSecret,
      code: 'github-user:2001',
      profile: { id: 'another-local-uid', name: 'Renamed GitHub user' },
    })
    expect(recovered.status).toBe(201)
    expect(((await recovered.json()) as { session: ServerSession }).session.principal).toEqual(session.principal)
  })

  it('restores an account across restart, binds another proof explicitly, handles conflicts, and never trusts a UID', async () => {
    const fixture = services()
    const first = await boot(fixture.accounts)
    const info = await request(first.url, '/server-info')
    expect(((await info.json()) as ServerInfo).accountProviders).toEqual(['email', 'github'])
    const alice = await emailLogin(first, fixture.codes, 'alice@example.test')
    expect(alice.principal.kind).toBe('account')
    const accountId = (alice.principal as { kind: 'account'; accountId: string }).accountId
    expect(accountId).not.toBe(profile.id)

    const forged = await request(first.url, '/sessions', 'POST', {
      profile: { id: accountId, name: 'Impostor' },
      accountProof: { accountId },
    })
    expect(forged.status).toBe(400)
    const guest = await request(first.url, '/sessions', 'POST', { profile: { id: accountId, name: 'Impostor' } })
    expect(((await guest.json()) as ServerSession).principal.kind).toBe('guest')

    const link = await githubFlow(first, 'link', alice.token)
    const linked = await request(
      first.url,
      '/auth/github/complete',
      'POST',
      {
        intent: 'link',
        state: link.state,
        browserSecret: link.browserSecret,
        code: 'github-user:1001',
      },
      alice.token,
    )
    expect(linked.status).toBe(200)
    expect(((await linked.json()) as { identities: AccountIdentity[] }).identities).toHaveLength(2)

    const githubLogin = await githubFlow(first, 'login')
    const sameAccount = await request(first.url, '/auth/github/complete', 'POST', {
      intent: 'login',
      state: githubLogin.state,
      browserSecret: githubLogin.browserSecret,
      code: 'github-user:1001',
      profile: { id: 'different-uid', name: 'Alice' },
    })
    expect(sameAccount.status).toBe(201)
    expect(((await sameAccount.json()) as { session: ServerSession }).session.principal).toEqual(alice.principal)

    const bob = await emailLogin(first, fixture.codes, 'bob@example.test')
    const conflict = await githubFlow(first, 'link', bob.token)
    const conflictResponse = await request(
      first.url,
      '/auth/github/complete',
      'POST',
      {
        intent: 'link',
        state: conflict.state,
        browserSecret: conflict.browserSecret,
        code: 'github-user:1001',
      },
      bob.token,
    )
    expect(conflictResponse.status).toBe(409)
    expect(await conflictResponse.json()).toEqual({ code: 'IDENTITY_CONFLICT' })

    const removeEmail = await request(
      first.url,
      '/account/identities',
      'DELETE',
      {
        providerId: 'email',
        issuer: 'mailto',
        subject: 'alice@example.test',
      },
      alice.token,
    )
    expect(removeEmail.status).toBe(204)
    const last = await request(
      first.url,
      '/account/identities',
      'DELETE',
      {
        providerId: 'github',
        issuer: 'https://github.com',
        subject: '1001',
      },
      alice.token,
    )
    expect(last.status).toBe(409)
    expect(await last.json()).toEqual({ code: 'LAST_RECOVERY_METHOD' })

    const oldToken = alice.token
    await first.app.stop()
    const second = await boot(fixture.accounts)
    expect((await request(second.url, '/session', 'GET', undefined, oldToken)).status).toBe(401)
    const restored = await githubFlow(second, 'login')
    const recovered = await request(second.url, '/auth/github/complete', 'POST', {
      intent: 'login',
      state: restored.state,
      browserSecret: restored.browserSecret,
      code: 'github-user:1001',
      profile,
    })
    expect(recovered.status).toBe(201)
    expect(((await recovered.json()) as { session: ServerSession }).session.principal).toEqual(alice.principal)
  })

  it('rejects stale link sessions, revokes every account seat on deactivation, and fails closed on store errors', async () => {
    const fixture = services()
    const host = await boot(fixture.accounts)
    const alice = await emailLogin(host, fixture.codes, 'alice@example.test')
    const again = await emailLogin(host, fixture.codes, 'alice@example.test')
    const pendingLink = await githubFlow(host, 'link', alice.token)
    expect((await request(host.url, '/session', 'DELETE', undefined, alice.token)).status).toBe(204)
    const stale = await request(
      host.url,
      '/auth/github/complete',
      'POST',
      {
        intent: 'link',
        state: pendingLink.state,
        browserSecret: pendingLink.browserSecret,
        code: 'github-user:1002',
      },
      alice.token,
    )
    expect(stale.status).toBe(401)

    const third = await emailLogin(host, fixture.codes, 'alice@example.test')
    const socket = io(host.url, { auth: { token: third.token }, transports: ['websocket'], reconnection: false })
    sockets.push(socket)
    await new Promise<void>(resolve => socket.once('connect', () => resolve()))
    await new Promise<void>((resolve, reject) => {
      socket.emit('createPrivateRoom', { config: {} }, (response: { status: string }) => {
        if (response.status === 'SUCCESS') resolve()
        else reject(new Error(`Room creation failed: ${response.status}`))
      })
    })
    expect(host.app.rooms.playersInRooms).toBe(1)
    const disconnected = onDisconnect(socket)
    const deactivated = await request(host.url, '/account', 'DELETE', undefined, again.token)
    expect(deactivated.status).toBe(204)
    await disconnected
    expect(host.app.rooms.playersInRooms).toBe(0)
    expect(host.app.sessions.size).toBe(0)
    expect((await request(host.url, '/session', 'GET', undefined, third.token)).status).toBe(401)
    await host.app.stop()
    const restarted = services(fixture.directory)
    const retryHost = await boot(restarted.accounts)
    const challenge = await request(retryHost.url, '/auth/email/challenges', 'POST', {
      email: 'alice@example.test',
      intent: 'login',
    })
    expect(challenge.status).toBe(201)
    const { challengeId } = (await challenge.json()) as { challengeId: string }
    const relogin = await request(retryHost.url, '/auth/email/complete', 'POST', {
      intent: 'login',
      challengeId,
      code: restarted.codes.get('alice@example.test'),
      profile,
    })
    expect(relogin.status).toBe(403)
    expect(await relogin.json()).toEqual({ code: 'ACCOUNT_DEACTIVATED' })

    const failing = services()
    failing.directory.failAfterIssue = true
    const other = await boot(failing.accounts)
    const failBegin = await request(other.url, '/auth/email/challenges', 'POST', {
      email: 'failed@example.test',
      intent: 'login',
    })
    const failedId = ((await failBegin.json()) as { challengeId: string }).challengeId
    const failure = await request(other.url, '/auth/email/complete', 'POST', {
      intent: 'login',
      challengeId: failedId,
      code: failing.codes.get('failed@example.test'),
      profile,
    })
    expect(failure.status).toBe(503)
    expect(await failure.json()).toEqual({ code: 'ACCOUNT_STORE_UNAVAILABLE' })
    expect(other.app.sessions.size).toBe(0)
  })

  it('keeps live sessions and rooms when deactivation definitely did not commit', async () => {
    const fixture = services()
    const host = await boot(fixture.accounts)
    const account = await emailLogin(host, fixture.codes, 'kept@example.test')
    const socket = io(host.url, { auth: { token: account.token }, transports: ['websocket'], reconnection: false })
    sockets.push(socket)
    await new Promise<void>(resolve => socket.once('connect', () => resolve()))
    await new Promise<void>((resolve, reject) => {
      socket.emit('createPrivateRoom', { config: {} }, (response: { status: string }) => {
        if (response.status === 'SUCCESS') resolve()
        else reject(new Error(`Room creation failed: ${response.status}`))
      })
    })
    fixture.directory.failDeactivate = true
    const failed = await request(host.url, '/account', 'DELETE', undefined, account.token)
    expect(failed.status).toBe(503)
    expect(await failed.json()).toEqual({ code: 'ACCOUNT_STORE_UNAVAILABLE' })
    expect((await request(host.url, '/session', 'GET', undefined, account.token)).status).toBe(200)
    expect(socket.connected).toBe(true)
    expect(host.app.rooms.playersInRooms).toBe(1)
    const room = await new Promise<{ status: string }>(resolve => socket.emit('getCurrentPrivateRoom', resolve))
    expect(room.status).toBe('SUCCESS')
  })

  it('reconciles an acknowledged-lost deactivation commit and fails closed if status is unknown', async () => {
    const committed = services()
    const first = await boot(committed.accounts)
    const firstSession = await emailLogin(first, committed.codes, 'committed@example.test')
    committed.directory.failAfterDeactivateCommit = true
    const reconciled = await request(first.url, '/account', 'DELETE', undefined, firstSession.token)
    expect(reconciled.status).toBe(204)
    expect((await request(first.url, '/session', 'GET', undefined, firstSession.token)).status).toBe(401)

    const unknown = services()
    const second = await boot(unknown.accounts)
    const secondSession = await emailLogin(second, unknown.codes, 'unknown@example.test')
    unknown.directory.failDeactivate = true
    unknown.directory.failStatusRead = true
    const unresolved = await request(second.url, '/account', 'DELETE', undefined, secondSession.token)
    expect(unresolved.status).toBe(503)
    expect((await request(second.url, '/session', 'GET', undefined, secondSession.token)).status).toBe(401)
  })

  it('does not issue a session when the verified identity is unlinked before the issuance lock', async () => {
    const fixture = services()
    const host = await boot(fixture.accounts)
    const original = await emailLogin(host, fixture.codes, 'unlinked@example.test')
    const accountId = (original.principal as { kind: 'account'; accountId: string }).accountId
    const github = await githubFlow(host, 'link', original.token)
    const link = await request(
      host.url,
      '/auth/github/complete',
      'POST',
      {
        intent: 'link',
        state: github.state,
        browserSecret: github.browserSecret,
        code: 'github-user:1003',
      },
      original.token,
    )
    expect(link.status).toBe(200)

    const begun = await request(host.url, '/auth/email/challenges', 'POST', {
      email: 'unlinked@example.test',
      intent: 'login',
    })
    const { challengeId } = (await begun.json()) as { challengeId: string }
    let entered!: () => void
    let release!: () => void
    const enteredLock = new Promise<void>(resolve => {
      entered = resolve
    })
    const wait = new Promise<void>(resolve => {
      release = resolve
    })
    fixture.directory.identityGate = { entered, wait }
    const completing = request(host.url, '/auth/email/complete', 'POST', {
      intent: 'login',
      challengeId,
      code: fixture.codes.get('unlinked@example.test'),
      profile,
    })
    await enteredLock
    await fixture.directory.unlink(accountId, {
      providerId: 'email',
      issuer: 'mailto',
      subject: 'unlinked@example.test',
    })
    release()
    const rejected = await completing
    expect(rejected.status).toBe(404)
    expect(await rejected.json()).toEqual({ code: 'IDENTITY_NOT_FOUND' })
    expect(host.app.sessions.size).toBe(1)
  })
})
