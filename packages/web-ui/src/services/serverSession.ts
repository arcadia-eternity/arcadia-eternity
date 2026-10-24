import type { LocalProfile, ServerInfo, ServerSession } from '@arcadia-eternity/protocol'

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
  ) {
    super(message)
  }
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

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request.call(globalThis, `${this.baseUrl}${path}`, {
      ...init,
      cache: 'no-store',
      signal: init?.signal ?? AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
    if (!response.ok) throw new SessionRequestError(response.status, `服务器会话请求失败 (${response.status})`)
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

  private async resumeOrCreate(profile: LocalProfile, epoch: number): Promise<ServerSession> {
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
    if (!info.authModes.includes('guest')) throw new Error('此服务器需要登录账号')
    const created = await this.call<ServerSession>('/sessions', { method: 'POST', body: JSON.stringify({ profile }) })
    assertCurrent()
    return this.save(created)
  }

  async login(profile: LocalProfile, accountProof: unknown): Promise<ServerSession> {
    this.info = await this.call<ServerInfo>('/server-info')
    if (!this.info.authModes.includes('account')) throw new Error('此服务器未启用账号登录')
    const session = await this.call<ServerSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ profile, accountProof }),
    })
    // Switching identity never inherits the old seat. Provider UI must explicitly initiate this operation.
    await this.logout()
    return this.save(session)
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
