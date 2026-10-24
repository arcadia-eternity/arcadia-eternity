import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OidcVerifier, type OidcVerifierOptions } from '../src/standalone/providers/oidc.js'
import type { AuthIntent } from '../src/standalone/providers/types.js'

type Claims = {
  iss: string
  sub: string
  aud: string
  iat: number
  exp: number
  nonce: string
}

type Authorization = {
  codeChallenge: string
  claims: Claims
  signingKey: KeyObject
}

const clientId = 'arcadia-test-client'
const clientSecret = 'local-test-client-secret'
const login: AuthIntent = { kind: 'login' }
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', use: 'sig', kid: 'test-key' }
const authorizations = new Map<string, Authorization>()
let issuer = ''
let tokenRequests = 0
let tokenUnavailable = false
let tokenAuthMethod = ''

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

function jwt(claims: Claims, key: KeyObject): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const input = `${header}.${payload}`
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
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

  tokenRequests++
  if (tokenUnavailable) {
    json(response, 503, { error: 'temporarily_unavailable' })
    return
  }
  let body = ''
  for await (const chunk of request) body += chunk.toString()
  const form = new URLSearchParams(body)
  let basic = false
  if (request.headers.authorization?.startsWith('Basic ')) {
    const decoded = Buffer.from(request.headers.authorization.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator >= 0) {
      basic =
        decodeURIComponent(decoded.slice(0, separator)) === clientId &&
        decodeURIComponent(decoded.slice(separator + 1)) === clientSecret
    }
  }
  const post = form.get('client_id') === clientId && form.get('client_secret') === clientSecret
  const publicClient =
    !request.headers.authorization && form.get('client_id') === clientId && !form.has('client_secret')
  tokenAuthMethod = basic ? 'client_secret_basic' : post ? 'client_secret_post' : publicClient ? 'none' : ''
  const code = form.get('code') ?? ''
  const authorization = authorizations.get(code)
  authorizations.delete(code)
  const verifier = form.get('code_verifier') ?? ''
  const calculatedChallenge = createHash('sha256').update(verifier).digest('base64url')
  if (
    !authorization ||
    form.get('grant_type') !== 'authorization_code' ||
    !tokenAuthMethod ||
    form.get('redirect_uri') !== `${issuer}callback` ||
    calculatedChallenge !== authorization.codeChallenge
  ) {
    json(response, 400, { error: 'invalid_grant' })
    return
  }
  json(response, 200, {
    access_token: 'local-test-access-token',
    token_type: 'Bearer',
    expires_in: 3600,
    id_token: jwt(authorization.claims, authorization.signingKey),
  })
}

const server = createServer((request, response) => {
  void handle(request, response).catch(() => json(response, 500, { error: 'server_error' }))
})

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a loopback HTTP port')
  issuer = `http://127.0.0.1:${address.port}/`
})

afterAll(async () => {
  if (!server.listening) return
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
})

beforeEach(() => {
  authorizations.clear()
  tokenRequests = 0
  tokenUnavailable = false
  tokenAuthMethod = ''
})

async function verifier(options: Partial<OidcVerifierOptions> = {}): Promise<OidcVerifier> {
  return OidcVerifier.create({
    issuer,
    clientId,
    redirectUri: `${issuer}callback`,
    ...options,
  })
}

function grant(authorizationUrl: string, overrides: Partial<Claims> = {}, signingKey = privateKey): string {
  const url = new URL(authorizationUrl)
  const nonce = url.searchParams.get('nonce')
  const codeChallenge = url.searchParams.get('code_challenge')
  expect(url.origin).toBe(new URL(issuer).origin)
  expect(url.pathname).toBe('/authorize')
  expect(url.searchParams.get('scope')).toBe('openid')
  expect(url.searchParams.get('response_type')).toBe('code')
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(nonce).toBeTruthy()
  expect(codeChallenge).toBeTruthy()
  const now = Math.floor(Date.now() / 1000)
  const code = randomUUID()
  authorizations.set(code, {
    codeChallenge: codeChallenge!,
    signingKey,
    claims: {
      iss: issuer,
      sub: 'stable-provider-subject',
      aud: clientId,
      iat: now,
      exp: now + 600,
      nonce: nonce!,
      ...overrides,
    },
  })
  return code
}

describe('OIDC provider against a local signed issuer', () => {
  it('uses discovery, PKCE and signed ID Token verification to identify an account', async () => {
    const provider = await verifier()
    const started = await provider.begin({ intent: login })
    expect(new URL(started.authorizationUrl).searchParams.get('state')).toBe(started.state)
    const code = grant(started.authorizationUrl)

    await expect(
      provider.verify({ state: started.state, code, browserSecret: started.browserSecret }, login),
    ).resolves.toEqual({ issuer, subject: 'stable-provider-subject', verifiedAt: expect.any(Number) })
    expect(tokenRequests).toBe(1)
    expect(tokenAuthMethod).toBe('none')
    await expect(
      provider.verify({ state: started.state, code, browserSecret: started.browserSecret }, login),
    ).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
    expect(tokenRequests).toBe(1)
  })

  it.each(['client_secret_post', 'client_secret_basic'] as const)(
    'authenticates a confidential client with %s',
    async clientAuthMethod => {
      const provider = await verifier({ clientSecret, clientAuthMethod })
      const started = await provider.begin({ intent: login })
      const code = grant(started.authorizationUrl)
      await expect(
        provider.verify({ state: started.state, code, browserSecret: started.browserSecret }, login),
      ).resolves.toMatchObject({ issuer, subject: 'stable-provider-subject' })
      expect(tokenAuthMethod).toBe(clientAuthMethod)
    },
  )

  it('binds the browser secret and account-link intent before exchanging the code', async () => {
    const provider = await verifier()
    const intent: AuthIntent = { kind: 'link', accountId: 'account-one', sessionId: 'session-one' }
    const started = await provider.begin({ intent })
    const code = grant(started.authorizationUrl)
    const proof = { state: started.state, code, browserSecret: started.browserSecret }

    await expect(provider.verify(proof, login)).rejects.toMatchObject({ code: 'AUTH_PROOF_MISMATCH' })
    await expect(provider.verify({ ...proof, browserSecret: 'A'.repeat(43) }, intent)).rejects.toMatchObject({
      code: 'AUTH_PROOF_MISMATCH',
    })
    expect(tokenRequests).toBe(0)
    await expect(provider.verify(proof, intent)).resolves.toMatchObject({ issuer, subject: 'stable-provider-subject' })
    expect(tokenRequests).toBe(1)
  })

  it.each([
    ['issuer', () => ({ iss: 'https://other-issuer.example/' })],
    ['audience', () => ({ aud: 'other-client' })],
    ['nonce', () => ({ nonce: 'other-nonce' })],
    ['expiry', () => ({ exp: Math.floor(Date.now() / 1000) - 3600 })],
  ] as const)('rejects a signed ID Token with the wrong %s', async (_label, claims) => {
    const provider = await verifier()
    const started = await provider.begin({ intent: login })
    const code = grant(started.authorizationUrl, claims())
    await expect(
      provider.verify({ state: started.state, code, browserSecret: started.browserSecret }, login),
    ).rejects.toMatchObject({ code: 'AUTH_PROOF_INVALID' })
    expect(tokenRequests).toBe(1)
  })

  it('rejects an ID Token signed by a key absent from the published JWKS', async () => {
    const provider = await verifier()
    const started = await provider.begin({ intent: login })
    const code = grant(started.authorizationUrl, {}, otherKey)
    await expect(
      provider.verify({ state: started.state, code, browserSecret: started.browserSecret }, login),
    ).rejects.toMatchObject({ code: 'AUTH_PROOF_INVALID' })
  })

  it('reports a token endpoint outage as provider unavailable', async () => {
    const provider = await verifier()
    const started = await provider.begin({ intent: login })
    const code = grant(started.authorizationUrl)
    tokenUnavailable = true
    await expect(
      provider.verify({ state: started.state, code, browserSecret: started.browserSecret }, login),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', statusCode: 503 })
  })

  it('expires a pending authorization before any token request', async () => {
    let now = Date.now()
    const provider = await verifier({ now: () => now, challengeTtlMs: 1_000 })
    const started = await provider.begin({ intent: login })
    const code = grant(started.authorizationUrl)
    now += 1_000
    await expect(
      provider.verify({ state: started.state, code, browserSecret: started.browserSecret }, login),
    ).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
    expect(tokenRequests).toBe(0)
  })
})
