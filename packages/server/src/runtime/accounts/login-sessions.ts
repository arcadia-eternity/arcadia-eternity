import { randomBytes } from 'node:crypto'
import { sha256Hex } from '@arcadia-eternity/const'
import type { DurableStorage, StorageTransaction } from '@arcadia-eternity/database'
import type { LocalProfile, ServerSession } from '@arcadia-eternity/protocol'
import { SessionRegistry, SessionError } from '../session'

interface AccountLogin {
  kind: 'player-account-login'
  accountId: string
  profile: LocalProfile
  expiresAt: number
  browserKey?: string
}

type BrowserLogin = Omit<AccountLogin, 'kind' | 'browserKey'> & { kind: 'player-browser-login' }
const browserLoginLifetime = 30 * 24 * 60 * 60 * 1000

/** Durable account authority only: room membership and seats are never persisted. */
export class AccountLoginSessions {
  constructor(
    private readonly storage: DurableStorage,
    private readonly sessions: SessionRegistry,
  ) {}

  private key(token: string) {
    return `player-login:${this.sessions.serverId}:${sha256Hex(token)}`
  }

  private browserKey(token: string) {
    return `player-browser:${this.sessions.serverId}:${sha256Hex(token)}`
  }

  private async storeLogin(tx: StorageTransaction, session: ServerSession, browserKey?: string) {
    if (session.principal.kind !== 'account') throw new SessionError('ACCOUNT_REQUIRED', 403)
    await tx.create<AccountLogin>('sessions', {
      id: this.key(session.token),
      scope: `player-login:${this.sessions.serverId}`,
      value: {
        kind: 'player-account-login',
        accountId: session.principal.accountId,
        profile: session.profile,
        expiresAt: session.expiresAt,
        ...(browserKey && { browserKey }),
      },
    })
  }

  private async storeBrowser(tx: StorageTransaction, login: Omit<BrowserLogin, 'kind'>) {
    const token = randomBytes(32).toString('base64url')
    await tx.create<BrowserLogin>('sessions', {
      id: this.browserKey(token),
      scope: `player-login:${this.sessions.serverId}`,
      value: { ...login, kind: 'player-browser-login' },
    })
    return { token, expiresAt: login.expiresAt }
  }

  async remember(session: ServerSession, browser?: { previous?: string }) {
    if (session.principal.kind !== 'account') return
    const accountId = session.principal.accountId
    return this.storage.transaction(async tx => {
      if ((await tx.accountStatus(this.sessions.serverId, accountId)) !== 'active')
        throw new SessionError('ACCOUNT_DEACTIVATED', 403)
      const previous = browser?.previous && this.browserKey(browser.previous)
      for (const old of await tx.list<AccountLogin | BrowserLogin>(
        'sessions',
        `player-login:${this.sessions.serverId}`,
      )) {
        if (old.value.expiresAt <= Date.now() || old.id === previous) await tx.delete('sessions', old.id, old.revision)
      }
      const device = browser
        ? await this.storeBrowser(tx, {
            accountId,
            profile: session.profile,
            expiresAt: Date.now() + browserLoginLifetime,
          })
        : undefined
      await this.storeLogin(tx, session, device && this.browserKey(device.token))
      return device
    })
  }

  /** Enroll a still-valid pre-upgrade tab once, within its original login lifetime. */
  async enrollExisting(token: string) {
    return this.storage.transaction(async tx => {
      const row = await tx.get<AccountLogin>('sessions', this.key(token))
      if (!row || row.value.browserKey || row.value.expiresAt <= Date.now()) return
      const { accountId, profile, expiresAt } = row.value
      if ((await tx.accountStatus(this.sessions.serverId, accountId)) !== 'active') return
      const device = await this.storeBrowser(tx, { accountId, profile, expiresAt })
      await tx.replace('sessions', row.id, row.revision, { ...row.value, browserKey: this.browserKey(device.token) })
      return device
    })
  }

  /** Every browser restore creates a separate tab credential and a separate room seat. */
  async restoreBrowser(token: string) {
    let issued: ServerSession | undefined
    try {
      return await this.storage.transaction(async tx => {
        const row = await tx.get<BrowserLogin>('sessions', this.browserKey(token))
        if (!row || row.value.kind !== 'player-browser-login' || row.value.expiresAt <= Date.now()) return
        if ((await tx.accountStatus(this.sessions.serverId, row.value.accountId)) !== 'active') return
        issued = this.sessions.issueVerifiedAccount(row.value.profile, row.value.accountId, row.value.expiresAt)
        await this.storeLogin(tx, issued, row.id)
        return issued
      })
    } catch (error) {
      if (issued) this.sessions.revoke(issued.token)
      throw error
    }
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

  async revoke(token: string, browserToken?: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false
    return this.storage.transaction(async tx => {
      const row = await tx.get<AccountLogin>('sessions', this.key(token))
      // A tab for an earlier account may sign out after another tab has switched accounts.
      const browserKey = browserToken && this.browserKey(browserToken)
      const forgetBrowser = !!browserKey && (!row || row.value.browserKey === browserKey)
      if (forgetBrowser) {
        const browser = await tx.get<BrowserLogin>('sessions', browserKey)
        if (browser) await tx.delete('sessions', browser.id, browser.revision)
      }
      if (row) await tx.delete('sessions', row.id, row.revision)
      this.sessions.revoke(token)
      return forgetBrowser
    })
  }

  async replaceProfile(token: string, profile: LocalProfile): Promise<void> {
    await this.storage.transaction(async tx => {
      const row = await tx.get<AccountLogin>('sessions', this.key(token))
      if (
        !row ||
        row.value.expiresAt <= Date.now() ||
        (await tx.accountStatus(this.sessions.serverId, row.value.accountId)) !== 'active'
      )
        throw new SessionError('INVALID_SESSION', 401)
      await tx.replace('sessions', row.id, row.revision, { ...row.value, profile })
    })
  }
}
