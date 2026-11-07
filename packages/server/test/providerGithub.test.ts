import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GithubAppVerifier } from '../src/standalone/providers/github.js'
import type { AuthIntent } from '../src/standalone/providers/types.js'

const clientId = 'Iv1.arcadia-test'
const clientSecret = 'github-app-test-secret'
const redirectUri = 'https://arcadia.example/account'
const secondRedirectUri = 'https://staging.arcadia.example/account'
const login: AuthIntent = { kind: 'login' }

function verifier(
  http: typeof fetch,
  options: { now?: () => number; challengeTtlMs?: number; redirectUris?: string[] } = {},
) {
  const { redirectUris = [redirectUri], ...rest } = options
  return new GithubAppVerifier({ clientId, clientSecret, redirectUris, fetch: http, ...rest })
}

function authorization(provider: GithubAppVerifier, intent: AuthIntent = login, selectedRedirectUri = redirectUri) {
  return provider.begin({ intent, redirectUri: selectedRedirectUri })
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

describe('GitHub App user authorization', () => {
  it('uses the app web flow with S256 PKCE and identifies the immutable numeric GitHub user ID', async () => {
    let challenge = ''
    const http = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      expect(init?.redirect).toBe('error')
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      if (url === 'https://github.com/login/oauth/access_token') {
        expect(init?.method).toBe('POST')
        expect(new Headers(init?.headers).get('accept')).toBe('application/json')
        expect(init?.body).toBeInstanceOf(URLSearchParams)
        const form = init?.body as URLSearchParams
        expect(form.get('client_id')).toBe(clientId)
        expect(form.get('client_secret')).toBe(clientSecret)
        expect(form.get('grant_type')).toBe('authorization_code')
        expect(form.get('code')).toBe('one-time-code')
        expect(form.get('redirect_uri')).toBe(redirectUri)
        const verifier = form.get('code_verifier')!
        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge)
        return Response.json({ access_token: 'ghu_ephemeral-test-token', token_type: 'bearer', scope: '' })
      }
      if (url === `https://api.github.com/applications/${clientId}/token`) {
        expect(init?.method).toBe('DELETE')
        expect(init?.headers).toMatchObject({
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        })
        expect(typeof init?.body).toBe('string')
        expect(JSON.parse(init?.body as string)).toEqual({ access_token: 'ghu_ephemeral-test-token' })
        return new Response(null, { status: 204 })
      }
      expect(url).toBe('https://api.github.com/user')
      expect(init?.method).toBe('GET')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer ghu_ephemeral-test-token' })
      return Response.json({ id: 123456789, login: 'renameable-display-name', email: null })
    }) as typeof fetch
    const provider = verifier(http)
    const started = await authorization(provider)
    const url = new URL(started.authorizationUrl)
    expect(url.origin).toBe('https://github.com')
    expect(url.pathname).toBe('/login/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe(clientId)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri)
    expect(url.searchParams.get('state')).toBe(started.state)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.has('scope')).toBe(false)
    challenge = url.searchParams.get('code_challenge')!
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const proof = { state: started.state, code: 'one-time-code', browserSecret: started.browserSecret }
    await expect(provider.verify(proof, login)).resolves.toEqual({
      issuer: 'https://github.com',
      subject: '123456789',
      verifiedAt: expect.any(Number),
    })
    expect(http).toHaveBeenCalledTimes(3)
    await expect(provider.verify(proof, login)).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })
    expect(http).toHaveBeenCalledTimes(3)
  })

  it('binds state to the current account session and browser secret before exchanging', async () => {
    const http = vi.fn(async (input: string | URL | Request) => {
      if (requestUrl(input).endsWith('/access_token'))
        return Response.json({ access_token: 'ghu_test', token_type: 'bearer' })
      return requestUrl(input).endsWith('/token') ? new Response(null, { status: 204 }) : Response.json({ id: 42 })
    }) as typeof fetch
    const provider = verifier(http)
    const intent: AuthIntent = { kind: 'link', accountId: 'account-one', sessionId: 'session-one' }
    const started = await authorization(provider, intent)
    const proof = { state: started.state, code: 'one-time-code', browserSecret: started.browserSecret }

    await expect(provider.verify(proof, login)).rejects.toMatchObject({ code: 'AUTH_PROOF_MISMATCH' })
    await expect(
      provider.verify(proof, { kind: 'link', accountId: 'account-one', sessionId: 'session-two' }),
    ).rejects.toMatchObject({ code: 'AUTH_PROOF_MISMATCH' })
    await expect(provider.verify({ ...proof, browserSecret: 'A'.repeat(43) }, intent)).rejects.toMatchObject({
      code: 'AUTH_PROOF_MISMATCH',
    })
    expect(http).not.toHaveBeenCalled()
    await expect(provider.verify(proof, intent)).resolves.toMatchObject({ subject: '42' })
    expect(http).toHaveBeenCalledTimes(3)
  })

  it('selects only a configured callback and reuses the selected callback for the token exchange', async () => {
    const redirects: string[] = []
    const http = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = requestUrl(input)
      if (url.endsWith('/access_token')) {
        redirects.push((init?.body as URLSearchParams).get('redirect_uri') ?? '')
        return Response.json({ access_token: 'ghu_test', token_type: 'bearer' })
      }
      return url.endsWith('/token') ? new Response(null, { status: 204 }) : Response.json({ id: 42 })
    }) as typeof fetch
    const provider = verifier(http, { redirectUris: [redirectUri, secondRedirectUri] })
    const started = await authorization(provider, login, secondRedirectUri)
    expect(new URL(started.authorizationUrl).searchParams.get('redirect_uri')).toBe(secondRedirectUri)
    await expect(
      provider.verify({ state: started.state, code: 'code', browserSecret: started.browserSecret }, login),
    ).resolves.toMatchObject({ subject: '42' })
    expect(redirects).toEqual([secondRedirectUri])
    await expect(authorization(provider, login, 'https://attacker.example/account')).rejects.toMatchObject({
      code: 'INVALID_AUTH_REQUEST',
    })
  })

  it('expires a challenge and blocks repeat browser-secret guesses without calling GitHub', async () => {
    const http = vi.fn() as typeof fetch
    let now = 1000
    const provider = verifier(http, { now: () => now, challengeTtlMs: 500 })
    const expired = await authorization(provider)
    now = 1500
    await expect(
      provider.verify({ state: expired.state, code: 'code', browserSecret: expired.browserSecret }, login),
    ).rejects.toMatchObject({ code: 'AUTH_PROOF_EXPIRED' })

    const started = await authorization(provider)
    const proof = { state: started.state, code: 'code', browserSecret: 'A'.repeat(43) }
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(provider.verify(proof, login)).rejects.toMatchObject({ code: 'AUTH_PROOF_MISMATCH' })
    }
    await expect(provider.verify({ ...proof, browserSecret: started.browserSecret }, login)).rejects.toMatchObject({
      code: 'AUTH_PROOF_EXPIRED',
    })
    expect(http).not.toHaveBeenCalled()
  })

  it.each([
    [
      'rejected authorization code',
      () => Response.json({ error: 'bad_verification_code', error_description: 'secret' }),
    ],
    ['unauthorized token response', () => Response.json({ error: 'bad_verification_code' }, { status: 401 })],
    ['malformed token', () => Response.json({ access_token: '', token_type: 'bearer' })],
  ])('hides GitHub details for a %s', async (_label, tokenResponse) => {
    const http = vi.fn(async () => tokenResponse()) as typeof fetch
    const provider = verifier(http)
    const started = await authorization(provider)
    const proof = { state: started.state, code: 'bad-code', browserSecret: started.browserSecret }
    await expect(provider.verify(proof, login)).rejects.toMatchObject({
      message: 'AUTH_PROOF_INVALID',
      statusCode: 401,
    })
    expect(http).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed user IDs and reports upstream outages without leaking the token', async () => {
    const malformed = vi.fn(async (input: string | URL | Request) => {
      if (requestUrl(input).endsWith('/access_token'))
        return Response.json({ access_token: 'ghu_secret-value', token_type: 'bearer' })
      return requestUrl(input).endsWith('/token')
        ? new Response(null, { status: 204 })
        : Response.json({ id: 'renameable-login', login: 'renameable-login' })
    }) as typeof fetch
    const provider = verifier(malformed)
    const started = await authorization(provider)
    const proof = { state: started.state, code: 'code', browserSecret: started.browserSecret }
    await expect(provider.verify(proof, login)).rejects.toMatchObject({ code: 'AUTH_PROOF_INVALID' })
    expect(malformed).toHaveBeenCalledTimes(3)

    const unavailable = vi.fn(async () => Response.json({ error: 'secret-error' }, { status: 503 })) as typeof fetch
    const secondProvider = verifier(unavailable)
    const second = await authorization(secondProvider)
    const secondProof = { state: second.state, code: 'code', browserSecret: second.browserSecret }
    await expect(secondProvider.verify(secondProof, login)).rejects.toMatchObject({
      message: 'PROVIDER_UNAVAILABLE',
      statusCode: 503,
    })
    expect(unavailable).toHaveBeenCalledTimes(1)
  })

  it('classifies GitHub rate limits as outages and holds new authorizations until reset', async () => {
    let now = 1_000_000
    const http = vi.fn(async () =>
      Response.json({ message: 'rate limit exceeded' }, { status: 403, headers: { 'retry-after': '30' } }),
    ) as typeof fetch
    const provider = verifier(http, { now: () => now })
    const started = await authorization(provider)
    await expect(
      provider.verify({ state: started.state, code: 'code', browserSecret: started.browserSecret }, login),
    ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', statusCode: 503 })
    await expect(authorization(provider)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(http).toHaveBeenCalledTimes(1)
    now += 30_000
    await expect(authorization(provider)).resolves.toMatchObject({ state: expect.any(String) })
  })

  it('requires a confidential GitHub App client and an HTTPS callback outside loopback development', () => {
    expect(() => new GithubAppVerifier({ clientId, clientSecret: '', redirectUri })).toThrow()
    expect(
      () => new GithubAppVerifier({ clientId, clientSecret, redirectUri: 'http://arcadia.example/account' }),
    ).toThrow()
    expect(() => new GithubAppVerifier({ clientId, clientSecret, redirectUri: `${redirectUri}?query=1` })).toThrow()
    expect(
      () => new GithubAppVerifier({ clientId, clientSecret, redirectUri: 'http://127.0.0.1:8080/account' }),
    ).not.toThrow()
    expect(
      () => new GithubAppVerifier({ clientId, clientSecret, redirectUri: 'https://arcadia.example/other' }),
    ).toThrow()
    expect(
      () =>
        new GithubAppVerifier({
          clientId,
          clientSecret,
          redirectUris: Array.from({ length: 11 }, (_, index) => `https://app-${index}.example/account`),
        }),
    ).toThrow()
    expect(() => new GithubAppVerifier({ clientId, clientSecret, redirectUris: [redirectUri, redirectUri] })).toThrow()
  })
})
