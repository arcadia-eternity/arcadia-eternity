import type {
  AccountChallengeResponse,
  AccountIdentity,
  AccountIdentityListResponse,
  AccountIntent,
  AccountSessionResponse,
  LocalProfile,
  OidcAuthorizationResponse,
  ServerInfo,
  ServerSession,
} from '@arcadia-eternity/protocol'

export interface SessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function normalizeServerUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol === 'ws:') url.protocol = 'http:'
  if (url.protocol === 'wss:') url.protocol = 'https:'
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

export class SessionRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
  }
}

interface PendingOidcAuthorization {
  state: string
  browserSecret: string
  intent: AccountIntent
  expiresAt: number
}

/** Remove one-time authorization values synchronously before any network call or telemetry. */
export function consumeOidcCallback(
  location: Pick<Location, 'href'>,
  history: Pick<History, 'state' | 'replaceState'>,
) {
  const url = new URL(location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  if (code !== null || state !== null || error !== null) {
    // Providers may append error_description, iss, session_state or custom values.
    // The account route does not need query parameters after consuming a callback.
    url.search = ''
    history.replaceState(history.state, '', `${url.pathname}${url.hash}`)
  }
  return { code, state, error }
}

let bootOidcCallback: ReturnType<typeof consumeOidcCallback> | null = null

/** Capture a redirect before bootstrap waits for unrelated game assets. */
export function captureOidcCallbackAtBoot(
  location: Pick<Location, 'href'>,
  history: Pick<History, 'state' | 'replaceState'>,
): void {
  const path = new URL(location.href).pathname.replace(/\/+$/, '')
  if (!path.endsWith('/account')) return
  const callback = consumeOidcCallback(location, history)
  if (callback.code !== null || callback.state !== null || callback.error !== null) bootOidcCallback = callback
}

/** Return a one-time callback to the account page, then forget its authorization code. */
export function takeBootOidcCallback(): ReturnType<typeof consumeOidcCallback> | null {
  const callback = bootOidcCallback
  bootOidcCallback = null
  return callback
}

/** Credentials are scoped to the exact API endpoint and server ID, and stored per tab. */
export class ServerSessionClient {
  readonly baseUrl: string
  info: ServerInfo | null = null
  session: ServerSession | null = null
  private pending: Promise<ServerSession> | null = null
  private identityEpoch = 0
  constructor(
    baseUrl: string,
    private readonly storage: SessionStorage,
    private readonly request: typeof fetch = fetch,
    private readonly onInvalidated: (reason: string) => void = () => {},
  ) {
    this.baseUrl = normalizeServerUrl(baseUrl)
  }

  private key(serverId: string): string {
    return `server-session:${encodeURIComponent(this.baseUrl)}:${encodeURIComponent(serverId)}`
  }

  private oidcKey(serverId: string): string {
    return `server-oidc:${encodeURIComponent(this.baseUrl)}:${encodeURIComponent(serverId)}`
  }

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request.call(globalThis, `${this.baseUrl}${path}`, {
      ...init,
      cache: 'no-store',
      signal: init?.signal ?? AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      const code =
        body && typeof body === 'object' && 'code' in body && typeof body.code === 'string' ? body.code : undefined
      throw new SessionRequestError(
        response.status,
        `服务器账号请求失败 (${response.status}${code ? `: ${code}` : ''})`,
        code,
      )
    }
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  private save(session: ServerSession): ServerSession {
    if (
      !this.info ||
      session.serverId !== this.info.serverId ||
      session.bootId !== this.info.bootId ||
      !session.token ||
      !session.seatId
    ) {
      throw new Error('服务器返回了不匹配的会话')
    }
    this.session = session
    this.storage.setItem(this.key(session.serverId), JSON.stringify(session))
    return session
  }

  private invalidate(reason: string): void {
    if (this.session) this.storage.removeItem(this.key(this.session.serverId))
    this.session = null
    this.onInvalidated(reason)
  }

  ensure(profile: LocalProfile): Promise<ServerSession> {
    if (this.pending) return this.pending
    this.pending = this.resumeOrCreate(profile, this.identityEpoch).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  /** Fetch capabilities and restore an existing credential without creating a guest seat. */
  async refresh(): Promise<{ info: ServerInfo; session: ServerSession | null }> {
    const epoch = this.identityEpoch
    const session = await this.resumeIfPresent(epoch)
    return { info: this.info!, session }
  }

  private async resumeIfPresent(epoch: number): Promise<ServerSession | null> {
    const assertCurrent = () => {
      if (epoch !== this.identityEpoch) throw new Error('会话操作已取消')
    }
    // Network failures propagate without discarding any existing identity.
    const info = await this.call<ServerInfo>('/server-info')
    assertCurrent()
    if (info.protocolVersion !== 1) throw new Error('服务器协议版本不兼容')
    if (this.info && this.info.serverId !== info.serverId) this.invalidate('服务器身份已更换，原房间已失效')
    this.info = info
    if (!this.session) {
      try {
        const saved = JSON.parse(this.storage.getItem(this.key(info.serverId)) || 'null') as ServerSession | null
        if (saved?.serverId === info.serverId && saved.token && saved.seatId) this.session = saved
      } catch {
        this.storage.removeItem(this.key(info.serverId))
      }
    }
    if (this.session?.bootId !== info.bootId && this.session) {
      this.invalidate('服务器已重启，原房间已失效，请重新创建或加入房间')
    }
    if (this.session) {
      try {
        const resumed = await this.call<ServerSession>('/session', {
          headers: { Authorization: `Bearer ${this.session.token}` },
        })
        assertCurrent()
        return this.save(resumed)
      } catch (error) {
        assertCurrent()
        if (!(error instanceof SessionRequestError) || ![401, 403, 410].includes(error.status)) throw error
        this.invalidate('原会话已失效，无法继续原席位，请重新创建或加入房间')
      }
    }
    return null
  }

  private async resumeOrCreate(profile: LocalProfile, epoch: number): Promise<ServerSession> {
    const resumed = await this.resumeIfPresent(epoch)
    if (resumed) return resumed
    const info = this.info!
    if (!info.authModes.includes('guest')) throw new Error('此服务器需要登录账号')
    const created = await this.call<ServerSession>('/sessions', { method: 'POST', body: JSON.stringify({ profile }) })
    if (epoch !== this.identityEpoch) throw new Error('会话操作已取消')
    return this.save(created)
  }

  private accountHeaders(): HeadersInit {
    if (this.session?.principal.kind !== 'account') throw new Error('请先登录服务器账号')
    return { Authorization: `Bearer ${this.session.token}` }
  }

  private async adoptAccountSession(next: ServerSession): Promise<ServerSession> {
    if (next.principal.kind !== 'account') throw new Error('服务器未返回账号会话')
    if (!this.info || next.serverId !== this.info.serverId || next.bootId !== this.info.bootId) {
      throw new Error('服务器返回了不匹配的账号会话')
    }
    this.identityEpoch += 1
    const previous = this.session
    if (previous) {
      try {
        await this.call<void>('/session', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${previous.token}` },
        })
      } catch (error) {
        if (!(error instanceof SessionRequestError) || ![401, 403, 410].includes(error.status)) {
          // Do not silently leave a new credential behind when the old seat cannot be revoked.
          await this.call<void>('/session', {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${next.token}` },
          }).catch(() => {})
          throw error
        }
      }
      this.invalidate('已切换服务器身份，原房间席位已撤销')
    }
    return this.save(next)
  }

  async login(profile: LocalProfile, accountProof: unknown): Promise<ServerSession> {
    const { info } = await this.refresh()
    if (!info.authModes.includes('account')) throw new Error('此服务器未启用账号登录')
    const session = await this.call<ServerSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ profile, accountProof }),
    })
    return this.adoptAccountSession(session)
  }

  async requestEmailCode(email: string, intent: AccountIntent): Promise<AccountChallengeResponse> {
    if (!this.info) await this.refresh()
    if (!this.info!.accountProviders?.includes('email')) throw new Error('此服务器未启用邮箱登录')
    return this.call<AccountChallengeResponse>('/auth/email/challenges', {
      method: 'POST',
      headers: intent === 'link' ? this.accountHeaders() : undefined,
      body: JSON.stringify({ email, intent }),
    })
  }

  async completeEmailCode(
    challengeId: string,
    code: string,
    intent: AccountIntent,
    profile: LocalProfile,
  ): Promise<AccountIdentity[] | ServerSession> {
    const result = await this.call<AccountIdentityListResponse | AccountSessionResponse>('/auth/email/complete', {
      method: 'POST',
      headers: intent === 'link' ? this.accountHeaders() : undefined,
      body: JSON.stringify(intent === 'login' ? { challengeId, code, intent, profile } : { challengeId, code, intent }),
    })
    if (intent === 'link') return (result as AccountIdentityListResponse).identities
    return this.adoptAccountSession((result as AccountSessionResponse).session)
  }

  async startOidc(intent: AccountIntent): Promise<string> {
    if (!this.info) await this.refresh()
    if (!this.info!.accountProviders?.includes('oidc')) throw new Error('此服务器未启用 OpenID Connect 登录')
    const result = await this.call<OidcAuthorizationResponse>('/auth/oidc/authorizations', {
      method: 'POST',
      headers: intent === 'link' ? this.accountHeaders() : undefined,
      body: JSON.stringify({ intent }),
    })
    const pending: PendingOidcAuthorization = {
      state: result.state,
      browserSecret: result.browserSecret,
      intent,
      expiresAt: result.expiresAt,
    }
    this.storage.setItem(this.oidcKey(this.info!.serverId), JSON.stringify(pending))
    return result.authorizationUrl
  }

  async completeOidc(state: string, code: string, profile: LocalProfile): Promise<AccountIdentity[] | ServerSession> {
    if (!this.info) await this.refresh()
    const key = this.oidcKey(this.info!.serverId)
    let pending: PendingOidcAuthorization | null = null
    try {
      pending = JSON.parse(this.storage.getItem(key) || 'null') as PendingOidcAuthorization | null
    } catch {
      this.storage.removeItem(key)
    }
    if (!pending || pending.state !== state || !pending.browserSecret || pending.expiresAt <= Date.now()) {
      throw new Error('登录请求已失效，请从本页重新发起')
    }
    const { intent, browserSecret } = pending
    let result: AccountIdentityListResponse | AccountSessionResponse
    try {
      result = await this.call<AccountIdentityListResponse | AccountSessionResponse>('/auth/oidc/complete', {
        method: 'POST',
        headers: intent === 'link' ? this.accountHeaders() : undefined,
        body: JSON.stringify(
          intent === 'login' ? { state, code, browserSecret, intent, profile } : { state, code, browserSecret, intent },
        ),
      })
    } catch (error) {
      // A rejected or consumed authorization is not reusable. Preserve only transient retries.
      if (error instanceof SessionRequestError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        this.storage.removeItem(key)
      }
      throw error
    }
    this.storage.removeItem(key)
    if (intent === 'link') return (result as AccountIdentityListResponse).identities
    return this.adoptAccountSession((result as AccountSessionResponse).session)
  }

  async listIdentities(): Promise<AccountIdentity[]> {
    const response = await this.call<AccountIdentityListResponse>('/account/identities', {
      headers: this.accountHeaders(),
    })
    return response.identities
  }

  async unlinkIdentity(identity: AccountIdentity): Promise<void> {
    await this.call<void>('/account/identities', {
      method: 'DELETE',
      headers: this.accountHeaders(),
      body: JSON.stringify({ providerId: identity.providerId, issuer: identity.issuer, subject: identity.subject }),
    })
  }

  async deactivateAccount(): Promise<void> {
    await this.call<void>('/account', { method: 'DELETE', headers: this.accountHeaders() })
    this.identityEpoch += 1
    this.invalidate('账号已停用，所有服务器会话和房间席位已撤销')
  }

  async logout(): Promise<void> {
    this.identityEpoch += 1
    if (!this.session) return
    // Only drop local credentials after the server confirms revocation (or they are already invalid).
    try {
      await this.call<void>('/session', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.session.token}` },
      })
    } catch (error) {
      if (!(error instanceof SessionRequestError) || ![401, 403, 410].includes(error.status)) throw error
    }
    this.invalidate('已退出服务器会话，原席位权限已撤销')
  }
}
