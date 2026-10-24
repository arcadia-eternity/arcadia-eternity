import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import * as oidc from 'openid-client'
import { ProviderError, sameIntent, validIntent, type AuthIntent, type VerifiedIdentity } from './types.js'

export interface OidcVerifierOptions {
  issuer: string
  clientId: string
  clientSecret?: string
  clientAuthMethod?: 'client_secret_post' | 'client_secret_basic' | 'none'
  redirectUri: string
  providerId?: string
  challengeTtlMs?: number
  now?: () => number
}

interface PendingAuthorization {
  intent: AuthIntent
  browserDigest: Buffer
  nonce: string
  codeVerifier: string
  expiresAt: number
  attempts: number
}

const MAX_PENDING = 10_000
const MAX_BROWSER_ATTEMPTS = 3

/** Authorization Code + PKCE, with OIDC ID Token signature and claim verification. */
export class OidcVerifier {
  readonly providerId: string
  readonly issuer: string
  private readonly clientId: string
  private readonly redirectUri: string
  private readonly config: oidc.Configuration
  private readonly challengeTtlMs: number
  private readonly now: () => number
  private readonly pending = new Map<string, PendingAuthorization>()

  private constructor(options: OidcVerifierOptions, config: oidc.Configuration) {
    const issuer = new URL(options.issuer)
    const redirect = new URL(options.redirectUri)
    if (!secureOrLoopback(issuer) || !secureOrLoopback(redirect))
      throw new Error('OIDC issuer and redirect URI must use HTTPS outside loopback development')
    const metadataIssuer = config.serverMetadata().issuer
    if (
      !options.clientId ||
      options.clientId.length > 256 ||
      !options.redirectUri ||
      new URL(metadataIssuer).href !== issuer.href
    )
      throw new Error('Invalid OIDC configuration')
    this.providerId = options.providerId ?? 'oidc'
    if (!this.providerId || this.providerId.length > 128) throw new Error('Invalid OIDC provider ID')
    // Preserve the issuer string exactly as published: a root issuer may omit its trailing slash.
    this.issuer = metadataIssuer
    this.clientId = options.clientId
    this.redirectUri = redirect.href
    this.config = config
    this.challengeTtlMs = options.challengeTtlMs ?? 10 * 60 * 1000
    this.now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.challengeTtlMs) || this.challengeTtlMs <= 0)
      throw new Error('Invalid OIDC challenge TTL')
    if (!config.serverMetadata().jwks_uri) throw new Error('OIDC provider must publish jwks_uri')
    // The library can rely on TLS for token-endpoint ID Tokens by default; this server also checks JWS signatures.
    oidc.enableNonRepudiationChecks(this.config)
  }

  static async create(options: OidcVerifierOptions): Promise<OidcVerifier> {
    const issuer = new URL(options.issuer)
    if (!secureOrLoopback(issuer)) throw new Error('OIDC issuer must use HTTPS outside loopback development')
    const method = options.clientAuthMethod ?? (options.clientSecret ? 'client_secret_post' : 'none')
    if (method !== 'none' && !options.clientSecret)
      throw new Error('OIDC client secret is required for client authentication')
    if (method === 'none' && options.clientSecret) throw new Error('OIDC public client cannot use a client secret')
    const executors = [oidc.enableNonRepudiationChecks]
    if (issuer.protocol === 'http:') executors.push(oidc.allowInsecureRequests)
    const config = await oidc.discovery(
      issuer,
      options.clientId,
      { token_endpoint_auth_method: method, ...(options.clientSecret ? { client_secret: options.clientSecret } : {}) },
      method === 'client_secret_basic'
        ? oidc.ClientSecretBasic(options.clientSecret)
        : method === 'client_secret_post'
          ? oidc.ClientSecretPost(options.clientSecret)
          : oidc.None(),
      { execute: executors },
    )
    const supported = config.serverMetadata().token_endpoint_auth_methods_supported
    if (supported && !supported.includes(method))
      throw new Error('OIDC provider does not support configured client authentication')
    return new OidcVerifier(options, config)
  }

  async begin({ intent }: { intent: AuthIntent }): Promise<{
    authorizationUrl: string
    state: string
    browserSecret: string
    expiresAt: number
  }> {
    if (!validIntent(intent)) throw new ProviderError('INVALID_AUTH_REQUEST', 400)
    const now = this.now()
    for (const [key, value] of this.pending) {
      if (value.expiresAt <= now) this.pending.delete(key)
    }
    if (this.pending.size >= MAX_PENDING) throw new ProviderError('AUTH_CAPACITY', 503)
    const state = oidc.randomState()
    const nonce = oidc.randomNonce()
    const codeVerifier = oidc.randomPKCECodeVerifier()
    const browserSecret = randomBytes(32).toString('base64url')
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier)
    const expiresAt = now + this.challengeTtlMs
    this.pending.set(state, {
      intent: structuredClone(intent),
      browserDigest: sha256(browserSecret),
      nonce,
      codeVerifier,
      expiresAt,
      attempts: 0,
    })
    const url = oidc.buildAuthorizationUrl(this.config, {
      redirect_uri: this.redirectUri,
      scope: 'openid',
      response_type: 'code',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
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
      state.length < 16 ||
      state.length > 256 ||
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
    // Consume before the token exchange: concurrent callbacks and retries cannot replay the state/code.
    this.pending.delete(state)
    const callback = new URL(this.redirectUri)
    callback.searchParams.set('state', state)
    callback.searchParams.set('code', code)
    try {
      const tokens = await oidc.authorizationCodeGrant(this.config, callback, {
        expectedState: state,
        expectedNonce: pending.nonce,
        pkceCodeVerifier: pending.codeVerifier,
        idTokenExpected: true,
      })
      const claims = tokens.claims()
      const audience = claims?.aud
      const correctAudience =
        typeof audience === 'string'
          ? audience === this.clientId
          : Array.isArray(audience) && audience.includes(this.clientId)
      if (
        !claims ||
        claims.iss !== this.issuer ||
        !correctAudience ||
        !claims.sub ||
        claims.nonce !== pending.nonce ||
        typeof claims.exp !== 'number' ||
        claims.exp <= Math.floor(this.now() / 1000)
      )
        throw new ProviderError('AUTH_PROOF_INVALID', 401)
      return { issuer: this.issuer, subject: claims.sub, verifiedAt: this.now() }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      // Do not expose token responses, JWTs, the client secret, or provider errors to clients/logs.
      if (providerUnavailable(error)) throw new ProviderError('PROVIDER_UNAVAILABLE', 503)
      throw new ProviderError('AUTH_PROOF_INVALID', 401)
    }
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

function providerUnavailable(error: unknown): boolean {
  if (error instanceof TypeError) return true // fetch/network failure after local inputs were validated
  if (error instanceof oidc.ClientError) {
    return ['OAUTH_TIMEOUT', 'OAUTH_ABORT', 'OAUTH_RESPONSE_IS_NOT_CONFORM', 'OAUTH_RESPONSE_IS_NOT_JSON'].includes(
      error.code ?? '',
    )
  }
  return false
}
