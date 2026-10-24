import { randomBytes } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { LocalProfile, ServerInfo, ServerPrincipal, ServerSession } from '@arcadia-eternity/protocol'

export interface VerifiedAccount {
  accountId: string
  displayName?: string
}

/** The optional provider verifies proof and resolves a server-scoped account. */
export interface AccountProvider {
  verify(proof: unknown): VerifiedAccount | null | undefined | Promise<VerifiedAccount | null | undefined>
}

export interface SessionRegistryOptions {
  serverId: string
  bootId?: string
  accountProvider?: AccountProvider
  ttlMs?: number
  maxSessions?: number
}

export class SessionError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(code)
    this.name = 'SessionError'
  }
}

function boundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim().length > 0 &&
    !/\p{Cc}/u.test(value)
  )
}

function readProfile(value: unknown): LocalProfile {
  if (typeof value !== 'object' || value === null) throw new SessionError('INVALID_PROFILE', 400)
  const profile = value as Record<string, unknown>
  if (!boundedString(profile.id, 128) || !boundedString(profile.name, 64))
    throw new SessionError('INVALID_PROFILE', 400)
  return { id: profile.id, name: profile.name.trim() }
}

/** In-memory capabilities. A profile ID, session ID or seat ID can never authenticate. */
export class SessionRegistry {
  readonly serverId: string
  readonly bootId: string
  private readonly sessions = new Map<string, ServerSession>()
  private readonly accountProvider?: AccountProvider
  private readonly ttlMs: number
  private readonly maxSessions: number
  private generation = 0

  constructor(options: SessionRegistryOptions) {
    if (!boundedString(options.serverId, 128))
      throw new Error('serverId must be a nonempty string of at most 128 characters')
    if (options.bootId !== undefined && !boundedString(options.bootId, 128))
      throw new Error('bootId must be a nonempty string of at most 128 characters')
    this.serverId = options.serverId
    this.bootId = options.bootId ?? nanoid()
    this.accountProvider = options.accountProvider
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000
    this.maxSessions = options.maxSessions ?? 10_000
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new Error('ttlMs must be a positive safe integer')
    if (!Number.isSafeInteger(this.maxSessions) || this.maxSessions <= 0)
      throw new Error('maxSessions must be a positive safe integer')
  }

  getServerInfo(): ServerInfo {
    return {
      serverId: this.serverId,
      bootId: this.bootId,
      authModes: this.accountProvider ? ['guest', 'account'] : ['guest'],
      protocolVersion: 1,
    }
  }

  async create(value: unknown, accountProof?: unknown): Promise<ServerSession> {
    const profile = readProfile(value)
    const generation = this.generation
    if (this.size >= this.maxSessions) throw new SessionError('SESSION_CAPACITY', 503)

    let principal: ServerPrincipal
    if (accountProof === undefined) {
      principal = { kind: 'guest', guestId: nanoid() }
    } else {
      if (!this.accountProvider) throw new SessionError('ACCOUNT_AUTH_UNAVAILABLE', 400)
      let account: VerifiedAccount | null | undefined
      try {
        account = await this.accountProvider.verify(accountProof)
      } catch {
        // Provider failures must not downgrade an unverified account request to a guest.
        throw new SessionError('ACCOUNT_AUTH_FAILED', 401)
      }
      if (!account || !boundedString(account.accountId, 256)) throw new SessionError('ACCOUNT_AUTH_FAILED', 401)
      if (account.displayName !== undefined) {
        if (!boundedString(account.displayName, 64)) throw new SessionError('ACCOUNT_AUTH_FAILED', 401)
        profile.name = account.displayName.trim()
      }
      principal = { kind: 'account', accountId: account.accountId }
    }

    // Account verification can suspend; shutdown and capacity may change while it runs.
    if (generation !== this.generation) throw new SessionError('SESSION_REGISTRY_RESET', 503)
    if (this.size >= this.maxSessions) throw new SessionError('SESSION_CAPACITY', 503)
    const session: ServerSession = {
      serverId: this.serverId,
      bootId: this.bootId,
      sessionId: nanoid(),
      seatId: nanoid(),
      token: randomBytes(32).toString('base64url'),
      principal,
      profile,
      expiresAt: Date.now() + this.ttlMs,
    }
    this.sessions.set(session.token, session)
    return structuredClone(session)
  }

  authenticate(token: unknown): ServerSession | undefined {
    if (typeof token !== 'string') return undefined
    const session = this.sessions.get(token)
    if (!session) return undefined
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token)
      return undefined
    }
    return structuredClone(session)
  }

  revoke(token: unknown): boolean {
    return typeof token === 'string' && this.sessions.delete(token)
  }

  clear(): void {
    this.generation++
    this.sessions.clear()
  }

  get size(): number {
    const now = Date.now()
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token)
    }
    return this.sessions.size
  }
}
