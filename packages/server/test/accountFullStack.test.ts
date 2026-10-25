import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { io, type Socket } from 'socket.io-client'
import type { AccountIdentity, ServerSession } from '@arcadia-eternity/protocol'
import { createSingleProcessApp } from '../src/standalone/app'
import { PgAccountDirectory } from '../src/standalone/accounts/directory'
import { ensureAccountSchema } from '../src/standalone/accounts/schema'
import { EmailCodeVerifier } from '../src/standalone/providers/email'
import { GithubAppVerifier } from '../src/standalone/providers/github'

const databaseUrl = process.env.TEST_DATABASE_URL
const clientId = 'arcadia-full-stack-test'
const callbackOrigin = 'http://localhost:3000'
const profile = { id: 'local-profile-is-not-proof', name: 'Alice' }

type Host = { app: ReturnType<typeof createSingleProcessApp>; url: string }
type Authorization = { challenge: string; subject: number }
type RoomReply<T> = { status: 'SUCCESS'; data: T } | { status: 'ERROR'; code: string }

describe.skipIf(!databaseUrl)('G3 full stack with PostgreSQL and GitHub App OAuth', () => {
  const authorizations = new Map<string, Authorization>()
  const accessTokens = new Map<string, number>()
  const githubEmails = new Map<number, string>()
  const pools: Pool[] = []
  const apps: Host[] = []
  const sockets: Socket[] = []
  const serverIds = new Set<string>()
  let apiUrl = ''
  const issuer = 'https://github.com'

  function json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }

  async function handleGithubApi(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', apiUrl).pathname
    if (path === '/login/oauth/access_token' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const form = new URLSearchParams(body)
      const code = form.get('code') ?? ''
      const authorization = authorizations.get(code)
      authorizations.delete(code)
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url')
      if (
        !authorization ||
        challenge !== authorization.challenge ||
        form.get('client_id') !== clientId ||
        form.get('client_secret') !== 'test-client-secret' ||
        form.get('redirect_uri') !== `${callbackOrigin}/account`
      ) {
        json(response, 400, { error: 'invalid_grant' })
        return
      }
      const accessToken = `local-test-token-${randomUUID()}`
      accessTokens.set(accessToken, authorization.subject)
      json(response, 200, { access_token: accessToken, token_type: 'bearer' })
      return
    }
    if (path === '/user' && request.method === 'GET') {
      const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
      const subject = accessTokens.get(token)
      if (!subject) {
        json(response, 401, { message: 'Bad credentials' })
        return
      }
      json(response, 200, { id: subject, login: `user-${subject}`, email: githubEmails.get(subject) ?? null })
      return
    }
    if (path === `/applications/${clientId}/token` && request.method === 'DELETE') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const token = (JSON.parse(body) as { access_token?: string }).access_token
      const expectedAuthorization = `Basic ${Buffer.from(`${clientId}:test-client-secret`).toString('base64')}`
      if (!token || request.headers.authorization !== expectedAuthorization || !accessTokens.delete(token)) {
        json(response, 401, { message: 'Bad credentials' })
        return
      }
      response.writeHead(204)
      response.end()
      return
    }
    json(response, 404, { error: 'not_found' })
  }

  const githubApiServer = createServer((request, response) => {
    void handleGithubApi(request, response).catch(() => json(response, 500, { error: 'server_error' }))
  })

  const githubFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (
      (url.origin === 'https://github.com' && url.pathname === '/login/oauth/access_token') ||
      (url.origin === 'https://api.github.com' &&
        (url.pathname === '/user' || url.pathname === `/applications/${clientId}/token`))
    ) {
      const local = new URL(url.pathname, apiUrl)
      return fetch(local, init)
    }
    throw new Error(`Unexpected GitHub API request: ${url.origin}${url.pathname}`)
  }

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      githubApiServer.once('error', reject)
      githubApiServer.listen(0, '127.0.0.1', () => {
        githubApiServer.off('error', reject)
        resolve()
      })
    })
    const address = githubApiServer.address()
    if (!address || typeof address === 'string') throw new Error('Expected GitHub API loopback port')
    apiUrl = `http://127.0.0.1:${address.port}/`
  })

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect()
    await Promise.all(apps.splice(0).map(({ app }) => app.stop()))
    authorizations.clear()
    accessTokens.clear()
    githubEmails.clear()
  })

  afterAll(async () => {
    try {
      if (serverIds.size) {
        const cleanup = new Pool({ connectionString: databaseUrl })
        try {
          for (const serverId of serverIds) {
            await cleanup.query('DELETE FROM arcadia_auth.external_identities WHERE server_id = $1', [serverId])
            await cleanup.query('DELETE FROM arcadia_auth.accounts WHERE server_id = $1', [serverId])
          }
        } finally {
          await cleanup.end()
        }
      }
    } finally {
      await Promise.all(pools.map(pool => pool.end()))
      if (githubApiServer.listening) {
        githubApiServer.closeAllConnections()
        await new Promise<void>((resolve, reject) =>
          githubApiServer.close(error => (error ? reject(error) : resolve())),
        )
      }
    }
  })

  async function boot(serverId: string, codes: Map<string, string>): Promise<Host> {
    const pool = new Pool({ connectionString: databaseUrl })
    pools.push(pool)
    const directory = new PgAccountDirectory(pool, serverId)
    const email = new EmailCodeVerifier({ sendCode: async (address, code) => void codes.set(address, code) })
    const github = new GithubAppVerifier({
      clientId,
      clientSecret: 'test-client-secret',
      redirectUris: [`${callbackOrigin}/account`],
      fetch: githubFetch,
    })
    const app = createSingleProcessApp({
      port: 0,
      host: '127.0.0.1',
      serverId,
      corsOrigins: [callbackOrigin],
      accounts: { directory, email, github, ready: () => ensureAccountSchema(pool) },
    })
    const host = { app, url: '' }
    apps.push(host)
    await app.start()
    host.url = `http://127.0.0.1:${app.address!.port}`
    return host
  }

  function request(host: Host, path: string, method = 'GET', body?: unknown, token?: string, origin?: string) {
    return fetch(`${host.url}/api/v1${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async function emailLogin(host: Host, codes: Map<string, string>, address: string): Promise<ServerSession> {
    const begun = await request(host, '/auth/email/challenges', 'POST', { email: address, intent: 'login' })
    expect(begun.status).toBe(201)
    const { challengeId } = (await begun.json()) as { challengeId: string }
    const code = codes.get(address)
    expect(code).toMatch(/^\d{8}$/)
    const completed = await request(host, '/auth/email/complete', 'POST', {
      intent: 'login',
      challengeId,
      code,
      profile,
    })
    expect(completed.status).toBe(201)
    expect(completed.headers.get('set-cookie')).toBeNull()
    return ((await completed.json()) as { session: ServerSession }).session
  }

  async function identities(host: Host, session: ServerSession): Promise<AccountIdentity[]> {
    const response = await request(host, '/account/identities', 'GET', undefined, session.token)
    expect(response.status).toBe(200)
    return ((await response.json()) as { identities: AccountIdentity[] }).identities
  }

  async function emailLink(host: Host, codes: Map<string, string>, address: string, session: ServerSession) {
    const begun = await request(
      host,
      '/auth/email/challenges',
      'POST',
      { email: address, intent: 'link' },
      session.token,
    )
    expect(begun.status).toBe(201)
    const { challengeId } = (await begun.json()) as { challengeId: string }
    return request(
      host,
      '/auth/email/complete',
      'POST',
      { intent: 'link', challengeId, code: codes.get(address) },
      session.token,
    )
  }

  async function connect(host: Host, session: ServerSession): Promise<Socket> {
    const socket = io(host.url, {
      auth: { token: session.token },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    })
    sockets.push(socket)
    const connected = new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve())
      socket.once('connect_error', reject)
    })
    socket.connect()
    await connected
    return socket
  }

  function roomRequest<T>(socket: Socket, event: string, data?: unknown): Promise<RoomReply<T>> {
    return new Promise((resolve, reject) => {
      const reply = (error: Error | null, response: RoomReply<T>) => (error ? reject(error) : resolve(response))
      if (data === undefined) socket.timeout(5000).emit(event, reply)
      else socket.timeout(5000).emit(event, data, reply)
    })
  }

  async function githubComplete(
    host: Host,
    intent: 'login' | 'link',
    subject: number,
    token?: string,
  ): Promise<Response> {
    const begun = await request(host, '/auth/github/authorizations', 'POST', { intent }, token, callbackOrigin)
    expect(begun.status).toBe(201)
    const { authorizationUrl, state, browserSecret } = (await begun.json()) as {
      authorizationUrl: string
      state: string
      browserSecret: string
    }
    const url = new URL(authorizationUrl)
    const challenge = url.searchParams.get('code_challenge')
    expect(url.origin).toBe('https://github.com')
    expect(url.pathname).toBe('/login/oauth/authorize')
    expect(url.searchParams.get('state')).toBe(state)
    expect(url.searchParams.get('redirect_uri')).toBe(`${callbackOrigin}/account`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.has('scope')).toBe(false)
    expect(challenge).toBeTruthy()
    const code = randomUUID()
    authorizations.set(code, { challenge: challenge!, subject })
    return request(
      host,
      '/auth/github/complete',
      'POST',
      {
        intent,
        state,
        browserSecret,
        code,
        ...(intent === 'login' ? { profile } : {}),
      },
      token,
    )
  }

  it('recovers the same email account after restart without restoring its room or session', async () => {
    const serverId = `full-stack-${randomUUID()}`
    serverIds.add(serverId)
    const codes = new Map<string, string>()
    const first = await boot(serverId, codes)
    const original = await emailLogin(first, codes, 'recovery@example.test')
    expect(original.principal.kind).toBe('account')
    const oldSocket = await connect(first, original)
    const created = await roomRequest<{ roomCode: string }>(oldSocket, 'createPrivateRoom', {
      config: { battleMode: 'server' },
    })
    expect(created.status).toBe('SUCCESS')
    if (created.status !== 'SUCCESS') throw new Error(created.code)
    expect(first.app.rooms.size).toBe(1)

    await first.app.stop()
    const second = await boot(serverId, codes)
    expect(second.app.rooms.size).toBe(0)
    expect((await request(second, '/session', 'GET', undefined, original.token)).status).toBe(401)

    const recovered = await emailLogin(second, codes, 'recovery@example.test')
    expect(recovered.principal).toEqual(original.principal)
    expect(recovered.serverId).toBe(original.serverId)
    expect(recovered.bootId).not.toBe(original.bootId)
    expect(recovered.sessionId).not.toBe(original.sessionId)
    expect(recovered.seatId).not.toBe(original.seatId)
    expect(recovered.token).not.toBe(original.token)

    const newSocket = await connect(second, recovered)
    expect(await roomRequest(newSocket, 'getCurrentPrivateRoom')).toEqual({ status: 'SUCCESS', data: null })
    expect(await roomRequest(newSocket, 'joinPrivateRoom', { roomCode: created.data.roomCode })).toEqual({
      status: 'ERROR',
      code: 'ROOM_NOT_FOUND',
    })
  }, 20_000)

  it('does not recover or merge a GitHub account through its unbound profile email', async () => {
    const serverId = `full-stack-${randomUUID()}`
    serverIds.add(serverId)
    const codes = new Map<string, string>()
    const host = await boot(serverId, codes)
    const address = 'github-profile@example.test'
    githubEmails.set(2001, address)

    const signedIn = await githubComplete(host, 'login', 2001)
    expect(signedIn.status).toBe(201)
    expect(signedIn.headers.get('set-cookie')).toBeNull()
    const githubSession = ((await signedIn.json()) as { session: ServerSession }).session
    expect(await identities(host, githubSession)).toMatchObject([{ providerId: 'github', issuer, subject: '2001' }])

    const emailSession = await emailLogin(host, codes, address)
    expect(emailSession.principal.kind).toBe('account')
    expect(emailSession.principal).not.toEqual(githubSession.principal)
    expect(await identities(host, emailSession)).toMatchObject([
      { providerId: 'email', issuer: 'mailto', subject: address },
    ])
    const conflict = await emailLink(host, codes, address, githubSession)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ code: 'IDENTITY_CONFLICT' })
    expect(await identities(host, githubSession)).toHaveLength(1)

    const recovered = await githubComplete(host, 'login', 2001)
    expect(recovered.status).toBe(201)
    expect(((await recovered.json()) as { session: ServerSession }).session.principal).toEqual(githubSession.principal)
  })

  it('requires a fresh proof to bind each email and recovers the same account through multiple emails after restart', async () => {
    const serverId = `full-stack-${randomUUID()}`
    serverIds.add(serverId)
    const codes = new Map<string, string>()
    const first = await boot(serverId, codes)
    const primary = 'explicit-primary@example.test'
    const secondary = 'explicit-secondary@example.test'
    githubEmails.set(2002, primary)
    const signedIn = await githubComplete(first, 'login', 2002)
    expect(signedIn.status).toBe(201)
    const original = ((await signedIn.json()) as { session: ServerSession }).session

    const begun = await request(
      first,
      '/auth/email/challenges',
      'POST',
      { email: primary, intent: 'link' },
      original.token,
    )
    expect(begun.status).toBe(201)
    const { challengeId } = (await begun.json()) as { challengeId: string }
    const code = codes.get(primary)!
    expect(code).toMatch(/^\d{8}$/)
    expect(await identities(first, original)).toHaveLength(1)

    const wrongCode = `${code[0] === '0' ? '1' : '0'}${code.slice(1)}`
    const invalid = await request(
      first,
      '/auth/email/complete',
      'POST',
      { intent: 'link', challengeId, code: wrongCode },
      original.token,
    )
    expect(invalid.status).toBe(401)
    expect(await identities(first, original)).toHaveLength(1)

    const linked = await request(
      first,
      '/auth/email/complete',
      'POST',
      { intent: 'link', challengeId, code },
      original.token,
    )
    expect(linked.status).toBe(200)
    expect(linked.headers.get('set-cookie')).toBeNull()
    const replayed = await request(
      first,
      '/auth/email/complete',
      'POST',
      { intent: 'link', challengeId, code },
      original.token,
    )
    expect(replayed.status).toBe(401)
    expect(await identities(first, original)).toHaveLength(2)
    expect((await emailLink(first, codes, secondary, original)).status).toBe(200)
    expect(await identities(first, original)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'github', issuer, subject: '2002' }),
        expect.objectContaining({ providerId: 'email', issuer: 'mailto', subject: primary }),
        expect.objectContaining({ providerId: 'email', issuer: 'mailto', subject: secondary }),
      ]),
    )
    expect(await identities(first, original)).toHaveLength(3)
    expect((await emailLogin(first, codes, primary)).principal).toEqual(original.principal)
    expect((await emailLogin(first, codes, secondary)).principal).toEqual(original.principal)

    await first.app.stop()
    const second = await boot(serverId, codes)
    expect((await request(second, '/session', 'GET', undefined, original.token)).status).toBe(401)
    for (const address of [primary, secondary]) {
      const recovered = await emailLogin(second, codes, address)
      expect(recovered.principal).toEqual(original.principal)
      expect(recovered.bootId).not.toBe(original.bootId)
      expect(recovered.seatId).not.toBe(original.seatId)
    }
  })

  it('keeps Better Auth verification private and accepts no cookie in place of a game session token', async () => {
    const serverId = `full-stack-${randomUUID()}`
    serverIds.add(serverId)
    const host = await boot(serverId, new Map())
    for (const [method, path] of [
      ['POST', '/api/auth/sign-in/email-otp'],
      ['POST', '/api/auth/email-otp/verify-email'],
      ['GET', '/api/auth/get-session'],
    ]) {
      const response = await fetch(`${host.url}${path}`, {
        method,
        headers: { Cookie: 'better-auth.session_token=untrusted' },
      })
      expect(response.status).toBe(404)
      expect(response.headers.get('set-cookie')).toBeNull()
    }
    const protectedResponse = await fetch(`${host.url}/api/v1/account/identities`, {
      headers: { Cookie: 'better-auth.session_token=untrusted' },
    })
    expect(protectedResponse.status).toBe(401)
    expect(await protectedResponse.json()).toEqual({ code: 'INVALID_SESSION' })
    for (const path of ['/auth/email/challenges', '/auth/github/authorizations']) {
      const response = await fetch(`${host.url}/api/v1${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: callbackOrigin,
          Cookie: 'better-auth.session_token=untrusted',
        },
        body: JSON.stringify({ intent: 'link', email: 'cookie@example.test' }),
      })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ code: 'INVALID_SESSION' })
    }
  })

  it('keeps one account across process restart while replacing seats and revoking deactivated access', async () => {
    const serverId = `full-stack-${randomUUID()}`
    serverIds.add(serverId)
    const codes = new Map<string, string>()
    const first = await boot(serverId, codes)
    const alice = await emailLogin(first, codes, 'alice@example.test')
    expect(alice.principal.kind).toBe('account')
    if (alice.principal.kind !== 'account') throw new Error('Expected account principal')
    expect(alice.principal.accountId).not.toBe(profile.id)

    const linked = await githubComplete(first, 'link', 1001, alice.token)
    expect(linked.status).toBe(200)
    expect(accessTokens.size).toBe(0)
    expect(((await linked.json()) as { identities: AccountIdentity[] }).identities).toMatchObject([
      { providerId: 'email', issuer: 'mailto', subject: 'alice@example.test' },
      { providerId: 'github', issuer, subject: '1001' },
    ])

    const bob = await emailLogin(first, codes, 'bob@example.test')
    const conflict = await githubComplete(first, 'link', 1001, bob.token)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ code: 'IDENTITY_CONFLICT' })

    const removed = await request(
      first,
      '/account/identities',
      'DELETE',
      {
        providerId: 'email',
        issuer: 'mailto',
        subject: 'alice@example.test',
      },
      alice.token,
    )
    expect(removed.status).toBe(204)
    const last = await request(
      first,
      '/account/identities',
      'DELETE',
      {
        providerId: 'github',
        issuer,
        subject: '1001',
      },
      alice.token,
    )
    expect(last.status).toBe(409)
    expect(await last.json()).toEqual({ code: 'LAST_RECOVERY_METHOD' })

    await first.app.stop()
    const second = await boot(serverId, codes)
    expect((await request(second, '/session', 'GET', undefined, alice.token)).status).toBe(401)
    const recovered = await githubComplete(second, 'login', 1001)
    expect(recovered.status).toBe(201)
    const newSession = ((await recovered.json()) as { session: ServerSession }).session
    expect(newSession.principal).toEqual(alice.principal)
    expect(newSession.seatId).not.toBe(alice.seatId)
    expect(newSession.token).not.toBe(alice.token)
    expect(newSession.bootId).not.toBe(alice.bootId)

    const deactivated = await request(second, '/account', 'DELETE', undefined, newSession.token)
    expect(deactivated.status).toBe(204)
    expect((await request(second, '/session', 'GET', undefined, newSession.token)).status).toBe(401)
    const blocked = await githubComplete(second, 'login', 1001)
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toEqual({ code: 'ACCOUNT_DEACTIVATED' })
  })
})
