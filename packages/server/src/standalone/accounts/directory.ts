import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'

export interface IdentityKey {
  providerId: string
  issuer: string
  subject: string
}

/** Constructed only after a configured verifier has checked the external proof. */
export interface VerifiedIdentity extends IdentityKey {
  verifiedAt: number
}

export type AccountStatus = 'active' | 'deactivated'

export interface AccountRecord {
  accountId: string
  status: AccountStatus
}

export type AccountDirectoryErrorCode =
  | 'INVALID_IDENTITY'
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_DEACTIVATED'
  | 'IDENTITY_CONFLICT'
  | 'IDENTITY_NOT_FOUND'
  | 'LAST_RECOVERY_METHOD'

export class AccountDirectoryError extends Error {
  constructor(public readonly code: AccountDirectoryErrorCode) {
    super(code)
    this.name = 'AccountDirectoryError'
  }
}

export interface AccountDirectory {
  resolveOrCreate(identity: VerifiedIdentity): Promise<AccountRecord>
  link(accountId: string, identity: VerifiedIdentity): Promise<void>
  list(accountId: string): Promise<VerifiedIdentity[]>
  unlink(accountId: string, key: IdentityKey): Promise<void>
  deactivate(accountId: string): Promise<void>
  getStatus(accountId: string): Promise<AccountStatus | null>
  withActiveAccount<T>(accountId: string, action: () => T | Promise<T>): Promise<T>
  withActiveIdentity<T>(accountId: string, identity: IdentityKey, action: () => T | Promise<T>): Promise<T>
}

interface AccountRow {
  account_id: string
  status: AccountStatus
}

interface IdentityRow {
  provider_id: string
  issuer: string
  subject: string
  verified_at: Date | string
}

class IdentityRace extends Error {}

function validText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim().length > 0 &&
    !/\p{Cc}/u.test(value)
  )
}

function assertIdentity(identity: IdentityKey): void {
  if (
    !identity ||
    !validText(identity.providerId, 64) ||
    !validText(identity.issuer, 512) ||
    !validText(identity.subject, 512)
  ) {
    throw new AccountDirectoryError('INVALID_IDENTITY')
  }
}

function assertVerifiedIdentity(identity: VerifiedIdentity): void {
  assertIdentity(identity)
  if (!Number.isSafeInteger(identity.verifiedAt) || identity.verifiedAt <= 0 || identity.verifiedAt > 8.64e15) {
    throw new AccountDirectoryError('INVALID_IDENTITY')
  }
}

function validAccountId(accountId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)
}

function asAccount(row: AccountRow): AccountRecord {
  return { accountId: row.account_id, status: row.status }
}

/** PostgreSQL owns identity uniqueness and account state; no local UID is accepted as proof. */
export class PgAccountDirectory implements AccountDirectory {
  constructor(
    private readonly pool: Pool,
    readonly serverId: string,
  ) {
    if (!validText(serverId, 128)) throw new Error('serverId must be stable and nonempty')
  }

  async resolveOrCreate(identity: VerifiedIdentity): Promise<AccountRecord> {
    assertVerifiedIdentity(identity)
    // An INSERT blocked on the unique key may lose to another first login. Roll
    // back its new account, then read the winner in a fresh READ COMMITTED tx.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.transaction(async client => {
          const existing = await this.findIdentityAccount(client, identity)
          if (existing) return this.requireActive(existing)

          const accountId = randomUUID()
          await client.query(`INSERT INTO arcadia_auth.accounts (server_id, account_id) VALUES ($1, $2)`, [
            this.serverId,
            accountId,
          ])
          const inserted = await client.query(
            `INSERT INTO arcadia_auth.external_identities
               (server_id, provider_id, issuer, subject, account_id, verified_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (server_id, provider_id, issuer, subject) DO NOTHING
             RETURNING account_id`,
            [
              this.serverId,
              identity.providerId,
              identity.issuer,
              identity.subject,
              accountId,
              new Date(identity.verifiedAt),
            ],
          )
          if (inserted.rowCount !== 1) throw new IdentityRace()
          return { accountId, status: 'active' }
        })
      } catch (error) {
        if (!(error instanceof IdentityRace)) throw error
      }
    }
    // Repeated link/unlink races are transient rather than an auth failure.
    throw new Error('identity ownership changed repeatedly; retry login')
  }

  async link(accountId: string, identity: VerifiedIdentity): Promise<void> {
    assertVerifiedIdentity(identity)
    this.assertAccountId(accountId)
    await this.transaction(async client => {
      this.requireActive(await this.lockAccount(client, accountId))
      const inserted = await client.query(
        `INSERT INTO arcadia_auth.external_identities
           (server_id, provider_id, issuer, subject, account_id, verified_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (server_id, provider_id, issuer, subject) DO NOTHING
         RETURNING account_id`,
        [
          this.serverId,
          identity.providerId,
          identity.issuer,
          identity.subject,
          accountId,
          new Date(identity.verifiedAt),
        ],
      )
      if (inserted.rowCount === 1) return
      const owner = await client.query<{ account_id: string }>(
        `SELECT account_id FROM arcadia_auth.external_identities
         WHERE server_id = $1 AND provider_id = $2 AND issuer = $3 AND subject = $4`,
        [this.serverId, identity.providerId, identity.issuer, identity.subject],
      )
      if (owner.rows[0]?.account_id === accountId) return
      throw new AccountDirectoryError('IDENTITY_CONFLICT')
    })
  }

  async list(accountId: string): Promise<VerifiedIdentity[]> {
    this.assertAccountId(accountId)
    return this.transaction(async client => {
      this.requireActive(await this.lockAccount(client, accountId))
      const identities = await client.query<IdentityRow>(
        `SELECT provider_id, issuer, subject, verified_at
         FROM arcadia_auth.external_identities
         WHERE server_id = $1 AND account_id = $2
         ORDER BY provider_id, issuer, subject`,
        [this.serverId, accountId],
      )
      return identities.rows.map(row => ({
        providerId: row.provider_id,
        issuer: row.issuer,
        subject: row.subject,
        verifiedAt: new Date(row.verified_at).getTime(),
      }))
    })
  }

  async unlink(accountId: string, key: IdentityKey): Promise<void> {
    assertIdentity(key)
    this.assertAccountId(accountId)
    await this.transaction(async client => {
      this.requireActive(await this.lockAccount(client, accountId))
      const identities = await client.query<IdentityRow>(
        `SELECT provider_id, issuer, subject, verified_at
         FROM arcadia_auth.external_identities
         WHERE server_id = $1 AND account_id = $2 FOR UPDATE`,
        [this.serverId, accountId],
      )
      const ownsIdentity = identities.rows.some(
        row => row.provider_id === key.providerId && row.issuer === key.issuer && row.subject === key.subject,
      )
      if (!ownsIdentity) throw new AccountDirectoryError('IDENTITY_NOT_FOUND')
      if (identities.rows.length <= 1) throw new AccountDirectoryError('LAST_RECOVERY_METHOD')
      await client.query(
        `DELETE FROM arcadia_auth.external_identities
         WHERE server_id = $1 AND account_id = $2
           AND provider_id = $3 AND issuer = $4 AND subject = $5`,
        [this.serverId, accountId, key.providerId, key.issuer, key.subject],
      )
    })
  }

  async deactivate(accountId: string): Promise<void> {
    this.assertAccountId(accountId)
    await this.transaction(async client => {
      const account = await this.lockAccount(client, accountId)
      if (!account) throw new AccountDirectoryError('ACCOUNT_NOT_FOUND')
      if (account.status === 'deactivated') return
      await client.query(
        `UPDATE arcadia_auth.accounts
         SET status = 'deactivated', deactivated_at = now()
         WHERE server_id = $1 AND account_id = $2`,
        [this.serverId, accountId],
      )
    })
  }

  async getStatus(accountId: string): Promise<AccountStatus | null> {
    this.assertAccountId(accountId)
    const result = await this.pool.query<{ status: AccountStatus }>(
      `SELECT status FROM arcadia_auth.accounts WHERE server_id = $1 AND account_id = $2`,
      [this.serverId, accountId],
    )
    return result.rows[0]?.status ?? null
  }

  /** Hold this lock only while issuing an in-process session, never during network I/O. */
  async withActiveAccount<T>(accountId: string, action: () => T | Promise<T>): Promise<T> {
    this.assertAccountId(accountId)
    return this.transaction(async client => {
      this.requireActive(await this.lockAccount(client, accountId))
      return action()
    })
  }

  /** Confirm the login proof still belongs to this account when its session is issued. */
  async withActiveIdentity<T>(accountId: string, identity: IdentityKey, action: () => T | Promise<T>): Promise<T> {
    this.assertAccountId(accountId)
    assertIdentity(identity)
    return this.transaction(async client => {
      this.requireActive(await this.lockAccount(client, accountId))
      const owner = await client.query<{ account_id: string }>(
        `SELECT account_id::text AS account_id FROM arcadia_auth.external_identities
         WHERE server_id = $1 AND provider_id = $2 AND issuer = $3 AND subject = $4`,
        [this.serverId, identity.providerId, identity.issuer, identity.subject],
      )
      if (owner.rows[0]?.account_id !== accountId) throw new AccountDirectoryError('IDENTITY_NOT_FOUND')
      return action()
    })
  }

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED')
      const result = await action(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original error.
      }
      throw error
    } finally {
      client.release()
    }
  }

  private async lockAccount(client: PoolClient, accountId: string): Promise<AccountRow | null> {
    const result = await client.query<AccountRow>(
      `SELECT account_id::text AS account_id, status
       FROM arcadia_auth.accounts
       WHERE server_id = $1 AND account_id = $2 FOR UPDATE`,
      [this.serverId, accountId],
    )
    return result.rows[0] ?? null
  }

  private async findIdentityAccount(client: PoolClient, key: IdentityKey): Promise<AccountRow | null> {
    const owner = await client.query<{ account_id: string }>(
      `SELECT account_id::text AS account_id FROM arcadia_auth.external_identities
       WHERE server_id = $1 AND provider_id = $2 AND issuer = $3 AND subject = $4`,
      [this.serverId, key.providerId, key.issuer, key.subject],
    )
    const ownerId = owner.rows[0]?.account_id
    if (!ownerId) return null
    // Every ownership change takes the account lock first. Recheck after taking
    // it because an unlink may have committed between the first read and lock.
    const account = await this.lockAccount(client, ownerId)
    const current = await client.query<{ account_id: string }>(
      `SELECT account_id::text AS account_id FROM arcadia_auth.external_identities
       WHERE server_id = $1 AND provider_id = $2 AND issuer = $3 AND subject = $4`,
      [this.serverId, key.providerId, key.issuer, key.subject],
    )
    if (!account || current.rows[0]?.account_id !== ownerId) throw new IdentityRace()
    return account
  }

  private requireActive(account: AccountRow | null): AccountRecord {
    if (!account) throw new AccountDirectoryError('ACCOUNT_NOT_FOUND')
    if (account.status !== 'active') throw new AccountDirectoryError('ACCOUNT_DEACTIVATED')
    return asAccount(account)
  }

  private assertAccountId(accountId: string): void {
    if (!validAccountId(accountId)) throw new AccountDirectoryError('ACCOUNT_NOT_FOUND')
  }
}
