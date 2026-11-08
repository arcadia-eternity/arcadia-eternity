import { createHash } from 'node:crypto'
import type { DurableStorage } from '@arcadia-eternity/database'
import type { LocalProfile, ServerSession } from '@arcadia-eternity/protocol'
import { SessionRegistry, SessionError } from '../session'

interface AccountLogin {
  kind: 'player-account-login'
  accountId: string
  profile: LocalProfile
  expiresAt: number
}

/** Durable account authority only: room membership and seats are never persisted. */
export class AccountLoginSessions {
  constructor(
    private readonly storage: DurableStorage,
    private readonly sessions: SessionRegistry,
  ) {}

  private key(token: string) {
    return `player-login:${this.sessions.serverId}:${createHash('sha256').update(token).digest('hex')}`
  }

  async remember(session: ServerSession): Promise<void> {
    if (session.principal.kind !== 'account') return
    const accountId = session.principal.accountId
    await this.storage.transaction(async tx => {
      if ((await tx.accountStatus(this.sessions.serverId, accountId)) !== 'active')
        throw new SessionError('ACCOUNT_DEACTIVATED', 403)
      for (const old of await tx.list<AccountLogin>('sessions', `player-login:${this.sessions.serverId}`)) {
        if (old.value.expiresAt <= Date.now()) await tx.delete('sessions', old.id, old.revision)
      }
      await tx.create<AccountLogin>('sessions', {
        id: this.key(session.token),
        scope: `player-login:${this.sessions.serverId}`,
        value: { kind: 'player-account-login', accountId, profile: session.profile, expiresAt: session.expiresAt },
      })
    })
  }

  async resume(token: string): Promise<ServerSession | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined
    let issued: ServerSession | undefined
    try {
      return await this.storage.transaction(async tx => {
        const row = await tx.get<AccountLogin>('sessions', this.key(token))
        if (!row || row.value.kind !== 'player-account-login') return undefined
        const login = row.value
        if (
          login.expiresAt <= Date.now() ||
          (await tx.accountStatus(this.sessions.serverId, login.accountId)) !== 'active'
        ) {
          await tx.delete('sessions', row.id, row.revision)
          return undefined
        }
        // Concurrent reconnects reuse the current seat; a new process allocates a fresh one.
        const current = this.sessions.authenticate(token)
        if (current) return current
        issued = this.sessions.restoreVerifiedAccount(login.profile, login.accountId, token, login.expiresAt)
        return issued
      })
    } catch (error) {
      if (issued) this.sessions.revoke(issued.token)
      throw error
    }
  }

  async revoke(token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return
    await this.storage.transaction(async tx => {
      const row = await tx.get<AccountLogin>('sessions', this.key(token))
      if (row) await tx.delete('sessions', row.id, row.revision)
      this.sessions.revoke(token)
    })
  }
}
