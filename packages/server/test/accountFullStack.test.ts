import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import type { AccountIdentity, ServerSession } from '@arcadia-eternity/protocol'
import { createSingleProcessApp } from '../src/standalone/app'
import { PgAccountDirectory } from '../src/standalone/accounts/directory'
import { ensureAccountSchema } from '../src/standalone/accounts/schema'
import { EmailCodeVerifier } from '../src/standalone/providers/email'
import { OidcVerifier } from '../src/standalone/providers/oidc'

const databaseUrl = process.env.TEST_DATABASE_URL
const clientId = 'arcadia-full-stack-test'
const profile = { id: 'local-profile-is-not-proof', name: 'Alice' }

type Host = { app: ReturnType<typeof createSingleProcessApp>; url: string }
type Authorization = { challenge: string; nonce: string; subject: string }

describe.skipIf(!databaseUrl)('G3 full stack with PostgreSQL and signed OIDC', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', use: 'sig', kid: 'full-stack-key' }
  const authorizations = new Map<string, Authorization>()
  const pools: Pool[] = []
  const apps: Host[] = []
  const serverIds = new Set<string>()
  let issuer = ''

  function json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }

  function idToken(subject: string, nonce: string): string {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })).toString('base64url')
    const claims = Buffer.from(
      JSON.stringify({ iss: issuer, sub: subject, aud: clientId, iat: now, exp: now + 600, nonce }),
    ).toString('base64url')
    const input = `${header}.${claims}`
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`
  }

  async function handleOidc(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', issuer).pathname
    if (path === '/.well-known/openid-configuration') {
      json(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}token`,
        jwks_uri: `${issuer}jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      })
      return
    }
    if (path === '/jwks') {
      json(response, 200, { keys: [jwk] })
      return
    }
    if (path !== '/token' || request.method !== 'POST') {
      json(response, 404, { error: 'not_found' })
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    const form = new URLSearchParams(body)
    const authorization = authorizations.get(form.get('code') ?? '')
    authorizations.delete(form.get('code') ?? '')
    const challenge = createHash('sha256')
      .update(form.get('code_verifier') ?? '')
      .digest('base64url')
    if (
      !authorization ||
      challenge !== authorization.challenge ||
      form.get('grant_type') !== 'authorization_code' ||
      form.get('client_id') !== clientId ||
      form.get('redirect_uri') !== `${issuer}callback`
    ) {
      json(response, 400, { error: 'invalid_grant' })
      return
    }
    json(response, 200, {
      access_token: 'local-test-token',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: idToken(authorization.subject, authorization.nonce),
    })
  }

  const oidcServer = createServer((request, response) => {
    void handleOidc(request, response).catch(() => json(response, 500, { error: 'server_error' }))
  })

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      oidcServer.once('error', reject)
      oidcServer.listen(0, '127.0.0.1', () => {
        oidcServer.off('error', reject)
        resolve()
      })
    })
    const address = oidcServer.address()
    if (!address || typeof address === 'string') throw new Error('Expected OIDC loopback port')
    issuer = `http://127.0.0.1:${address.port}/`
  })

  afterEach(async () => {
    await Promise.all(apps.splice(0).map(({ app }) => app.stop()))
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
      if (oidcServer.listening) {
        oidcServer.closeAllConnections()
        await new Promise<void>((resolve, reject) => oidcServer.close(error => (error ? reject(error) : resolve())))
      }
    }
  })

  async function boot(serverId: string, codes: Map<string, string>): Promise<Host> {
    const pool = new Pool({ connectionString: databaseUrl })
    pools.push(pool)
    const directory = new PgAccountDirectory(pool, serverId)
    const email = new EmailCodeVerifier({ sendCode: async (address, code) => void codes.set(address, code) })
    const oidc = await OidcVerifier.create({ issuer, clientId, redirectUri: `${issuer}callback` })
    const app = createSingleProcessApp({
      port: 0,
      host: '127.0.0.1',
      serverId,
      corsOrigins: ['http://localhost:3000'],
      accounts: { directory, email, oidc, ready: () => ensureAccountSchema(pool) },
    })
    const host = { app, url: '' }
    apps.push(host)
    await app.start()
    host.url = `http://127.0.0.1:${app.address!.port}`
    return host
  }

  function request(host: Host, path: string, method = 'GET', body?: unknown, token?: string) {
    return fetch(`${host.url}/api/v1${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    return ((await completed.json()) as { session: ServerSession }).session
  }

  async function oidcComplete(
    host: Host,
    intent: 'login' | 'link',
    subject: string,
    token?: string,
  ): Promise<Response> {
    const begun = await request(host, '/auth/oidc/authorizations', 'POST', { intent }, token)
    expect(begun.status).toBe(201)
    const { authorizationUrl, state, browserSecret } = (await begun.json()) as {
      authorizationUrl: string
      state: string
      browserSecret: string
    }
    const url = new URL(authorizationUrl)
    const challenge = url.searchParams.get('code_challenge')
    const nonce = url.searchParams.get('nonce')
    expect(url.searchParams.get('state')).toBe(state)
    expect(challenge).toBeTruthy()
    expect(nonce).toBeTruthy()
    const code = randomUUID()
    authorizations.set(code, { challenge: challenge!, nonce: nonce!, subject })
    return request(
      host,
      '/auth/oidc/complete',
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

  it('keeps one account across process restart while replacing seats and revoking deactivated access', async () => {
    const serverId = `full-stack-${randomUUID()}`
    serverIds.add(serverId)
    const codes = new Map<string, string>()
    const first = await boot(serverId, codes)
    const alice = await emailLogin(first, codes, 'alice@example.test')
    expect(alice.principal.kind).toBe('account')
    if (alice.principal.kind !== 'account') throw new Error('Expected account principal')
    expect(alice.principal.accountId).not.toBe(profile.id)

    const linked = await oidcComplete(first, 'link', 'alice-oidc', alice.token)
    expect(linked.status).toBe(200)
    expect(((await linked.json()) as { identities: AccountIdentity[] }).identities).toMatchObject([
      { providerId: 'email', issuer: 'mailto', subject: 'alice@example.test' },
      { providerId: 'oidc', issuer, subject: 'alice-oidc' },
    ])

    const bob = await emailLogin(first, codes, 'bob@example.test')
    const conflict = await oidcComplete(first, 'link', 'alice-oidc', bob.token)
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
        providerId: 'oidc',
        issuer,
        subject: 'alice-oidc',
      },
      alice.token,
    )
    expect(last.status).toBe(409)
    expect(await last.json()).toEqual({ code: 'LAST_RECOVERY_METHOD' })

    await first.app.stop()
    const second = await boot(serverId, codes)
    expect((await request(second, '/session', 'GET', undefined, alice.token)).status).toBe(401)
    const recovered = await oidcComplete(second, 'login', 'alice-oidc')
    expect(recovered.status).toBe(201)
    const newSession = ((await recovered.json()) as { session: ServerSession }).session
    expect(newSession.principal).toEqual(alice.principal)
    expect(newSession.seatId).not.toBe(alice.seatId)
    expect(newSession.token).not.toBe(alice.token)
    expect(newSession.bootId).not.toBe(alice.bootId)

    const deactivated = await request(second, '/account', 'DELETE', undefined, newSession.token)
    expect(deactivated.status).toBe(204)
    expect((await request(second, '/session', 'GET', undefined, newSession.token)).status).toBe(401)
    const blocked = await oidcComplete(second, 'login', 'alice-oidc')
    expect(blocked.status).toBe(403)
    expect(await blocked.json()).toEqual({ code: 'ACCOUNT_DEACTIVATED' })
  })
})
