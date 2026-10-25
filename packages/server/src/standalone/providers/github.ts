import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { github } from 'better-auth/social-providers'
import { authorizationCodeRequest, getOAuth2Tokens } from 'better-auth/oauth2'
import { ProviderError, sameIntent, validIntent, type AuthIntent, type VerifiedIdentity } from './types.js'

export interface GithubAppVerifierOptions {
  clientId: string
  clientSecret: string
  /** Exact pre-registered GitHub App user-authorization callbacks. */
  redirectUris?: string[]
  /** @deprecated Use redirectUris. Kept only for a single-callback deployment. */
  redirectUri?: string
  challengeTtlMs?: number
  now?: () => number
  /** HTTP substitution for local tests; production endpoints are always GitHub's fixed HTTPS URLs. */
  fetch?: typeof fetch
}

interface PendingAuthorization {
  intent: AuthIntent
  browserDigest: Buffer
  codeVerifier: string
  redirectUri: string
  expiresAt: number
  attempts: number
}

const ISSUER = 'https://github.com'
const TOKEN_URL = `${ISSUER}/login/oauth/access_token`
const USER_URL = 'https://api.github.com/user'
const MAX_REDIRECT_URIS = 10
const MAX_PENDING = 10_000
const MAX_BROWSER_ATTEMPTS = 3
const REQUEST_TIMEOUT_MS = 10_000
const REVOKE_TIMEOUT_MS = 2_000
const DEFAULT_RATE_LIMIT_MS = 60_000
const MAX_RATE_LIMIT_MS = 60 * 60 * 1_000

/** Better Auth OAuth protocol with Arcadia's purpose-bound proof and bounded HTTP transport. */
export class GithubAppVerifier {
  readonly providerId = 'github'
  readonly issuer = ISSUER
  readonly callbackOrigins: readonly string[]
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly redirectUris: ReadonlySet<string>
  private readonly challengeTtlMs: number
  private readonly now: () => number
  private readonly http: typeof fetch
  private readonly provider: ReturnType<typeof github>
  private readonly pending = new Map<string, PendingAuthorization>()
  private rateLimitedUntil = 0

  constructor(options: GithubAppVerifierOptions) {
    if (
      !options.clientId ||
      options.clientId.length > 256 ||
      !options.clientSecret ||
      options.clientSecret.length > 1024
    )
      throw new Error('Invalid GitHub App configuration')
    if (options.redirectUri && options.redirectUris) throw new Error('Configure GitHub App callbacks only once')
    const configuredUris = options.redirectUris ?? (options.redirectUri ? [options.redirectUri] : [])
    if (!configuredUris.length || configuredUris.length > MAX_REDIRECT_URIS)
      throw new Error('Configure between one and ten GitHub App callbacks')
    const redirectUris = configuredUris.map(validateCallbackUri)
    if (new Set(redirectUris).size !== redirectUris.length) throw new Error('Duplicate GitHub App callback')
    const callbackOrigins = redirectUris.map(uri => new URL(uri).origin)
    if (new Set(callbackOrigins).size !== callbackOrigins.length)
      throw new Error('Duplicate GitHub App callback origin')
    this.clientId = options.clientId
    this.clientSecret = options.clientSecret
    this.redirectUris = new Set(redirectUris)
    this.callbackOrigins = Object.freeze(callbackOrigins)
    this.challengeTtlMs = options.challengeTtlMs ?? 10 * 60 * 1000
    this.now = options.now ?? Date.now
    this.http = options.fetch ?? globalThis.fetch
    this.provider = github({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      // GitHub Apps use registered permissions, not OAuth App scopes.
      disableDefaultScope: true,
    })
    if (!Number.isSafeInteger(this.challengeTtlMs) || this.challengeTtlMs <= 0)
      throw new Error('Invalid GitHub App challenge TTL')
  }

  async begin({ intent, redirectUri }: { intent: AuthIntent; redirectUri: string }): Promise<{
    authorizationUrl: string
    state: string
    browserSecret: string
    expiresAt: number
  }> {
    if (!validIntent(intent) || typeof redirectUri !== 'string') throw new ProviderError('INVALID_AUTH_REQUEST', 400)
    let selectedRedirectUri: string
    try {
      selectedRedirectUri = validateCallbackUri(redirectUri)
    } catch {
      throw new ProviderError('INVALID_AUTH_REQUEST', 400)
    }
    if (!this.redirectUris.has(selectedRedirectUri)) throw new ProviderError('INVALID_AUTH_REQUEST', 400)
    const now = this.now()
    if (now < this.rateLimitedUntil) throw new ProviderError('PROVIDER_UNAVAILABLE', 503)
    for (const [key, value] of this.pending) {
      if (value.expiresAt <= now) this.pending.delete(key)
    }
    if (this.pending.size >= MAX_PENDING) throw new ProviderError('AUTH_CAPACITY', 503)
    const state = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')
    const browserSecret = randomBytes(32).toString('base64url')
    const expiresAt = now + this.challengeTtlMs
    this.pending.set(state, {
      intent: structuredClone(intent),
      browserDigest: sha256(browserSecret),
      codeVerifier,
      redirectUri: selectedRedirectUri,
      expiresAt,
      attempts: 0,
    })
    const url = await this.provider.createAuthorizationURL({
      state,
      codeVerifier,
      redirectURI: selectedRedirectUri,
    })
    return { authorizationUrl: url.href, state, browserSecret, expiresAt }
  }

  async verify(
    { state, code, browserSecret }: { state: string; code: string; browserSecret: string },
    intent: AuthIntent,
  ): Promise<VerifiedIdentity> {
    if (
      !validIntent(intent) ||
      typeof state !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      typeof code !== 'string' ||
      code.length < 1 ||
      code.length > 2048 ||
      typeof browserSecret !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(browserSecret)
    )
      throw new ProviderError('INVALID_AUTH_PROOF', 400)
    const pending = this.pending.get(state)
    if (!pending || pending.expiresAt <= this.now()) {
      this.pending.delete(state)
      throw new ProviderError('AUTH_PROOF_EXPIRED', 401)
    }
    if (!sameIntent(pending.intent, intent)) throw new ProviderError('AUTH_PROOF_MISMATCH', 401)
    pending.attempts++
    if (!timingSafeEqual(pending.browserDigest, sha256(browserSecret))) {
      if (pending.attempts >= MAX_BROWSER_ATTEMPTS) this.pending.delete(state)
      throw new ProviderError('AUTH_PROOF_MISMATCH', 401)
    }
    if (this.now() < this.rateLimitedUntil) throw new ProviderError('PROVIDER_UNAVAILABLE', 503)
    // Consume before network I/O so a racing callback cannot replay this authorization.
    this.pending.delete(state)
    let token: string | undefined
    try {
      token = await this.exchangeCode(code, pending.codeVerifier, pending.redirectUri)
      const subject = await this.readUserId(token)
      return { issuer: ISSUER, subject, verifiedAt: this.now() }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      // Never expose upstream responses, the client secret, or the ephemeral user token.
      throw new ProviderError('PROVIDER_UNAVAILABLE', 503)
    } finally {
      // The token only proves identity here; attempt to revoke it after the identity read.
      if (token) await this.revokeToken(token).catch(() => {})
    }
  }

  private async exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<string> {
    // The stock GitHub provider has no per-instance HTTP seam. Keep redirect
    // rejection, deadlines, rate-limit backoff and redacted errors here while
    // Better Auth constructs the authorization-code grant and parses tokens.
    const request = await authorizationCodeRequest({
      code,
      codeVerifier,
      redirectURI: redirectUri,
      options: this.provider.options,
      tokenEndpoint: TOKEN_URL,
    })
    const response = await this.http(TOKEN_URL, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw this.upstreamError(response)
    const token = (await response.json()) as Record<string, unknown>
    if (
      token.error ||
      typeof token.access_token !== 'string' ||
      !token.access_token ||
      token.access_token.length > 4096 ||
      token.token_type !== 'bearer'
    )
      throw new ProviderError('AUTH_PROOF_INVALID', 401)
    return getOAuth2Tokens(token as Parameters<typeof getOAuth2Tokens>[0]).accessToken!
  }

  private async readUserId(token: string): Promise<string> {
    // A GitHub App numeric subject needs no email permission. Deliberately do
    // not run Better Auth's email-based signup/linking or request /user/emails.
    const response = await this.http(USER_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Arcadia-Eternity',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw this.upstreamError(response)
    const user = (await response.json()) as Record<string, unknown>
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0)
      throw new ProviderError('AUTH_PROOF_INVALID', 401)
    return String(user.id)
  }

  private async revokeToken(token: string): Promise<void> {
    await this.http(`https://api.github.com/applications/${encodeURIComponent(this.clientId)}/token`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Arcadia-Eternity',
        'X-GitHub-Api-Version': '2026-03-10',
      },
      body: JSON.stringify({ access_token: token }),
      redirect: 'error',
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
    })
  }

  private upstreamError(response: Response): ProviderError {
    if (response.status === 403 || response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'))
      const resetHeader = response.headers.get('x-ratelimit-reset')
      const resetAt = resetHeader === null ? NaN : Number(resetHeader) * 1_000
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1_000
          : response.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(resetAt) && resetAt > this.now()
            ? resetAt - this.now()
            : DEFAULT_RATE_LIMIT_MS
      this.rateLimitedUntil = Math.max(
        this.rateLimitedUntil,
        this.now() + Math.min(MAX_RATE_LIMIT_MS, Math.max(0, delay)),
      )
      return new ProviderError('PROVIDER_UNAVAILABLE', 503)
    }
    return response.status >= 500
      ? new ProviderError('PROVIDER_UNAVAILABLE', 503)
      : new ProviderError('AUTH_PROOF_INVALID', 401)
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

function secureOrLoopback(url: URL): boolean {
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
}

function validateCallbackUri(value: string): string {
  const redirect = new URL(value)
  if (
    !secureOrLoopback(redirect) ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash ||
    redirect.pathname !== '/account'
  )
    throw new Error('Invalid GitHub App callback')
  return redirect.href
}
