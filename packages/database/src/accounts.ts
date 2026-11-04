import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { DurableStorage, openStorage, deactivateAccountRow, type DatabaseSession } from './storage'

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

/** Both drivers execute the same account/identity invariants. */
export class SQLAccountDirectory implements AccountDirectory {
  constructor(
    readonly storage: DurableStorage,
    readonly serverId: string,
  ) {
    if (!validText(serverId, 128)) throw new Error('serverId must be stable and nonempty')
  }
  private transaction<T>(action: (db: DatabaseSession) => Promise<T>): Promise<T> {
    return this.storage.sqlTransaction(db => action(this.storage.accountDatabase(db)))
  }
  private async lockAccount(db: DatabaseSession, accountId: string): Promise<AccountRow | null> {
    let q = db
      .selectFrom('accounts')
      .select(['account_id', 'status'])
      .where('server_id', '=', this.serverId)
      .where('account_id', '=', accountId)
    if (this.storage.driver === 'postgres') q = q.forUpdate()
    return (await q.executeTakeFirst()) ?? null
  }
  private identity(db: DatabaseSession, key: IdentityKey) {
    return db
      .selectFrom('external_identities')
      .select('account_id')
      .where('server_id', '=', this.serverId)
      .where('provider_id', '=', key.providerId)
      .where('issuer', '=', key.issuer)
      .where('subject', '=', key.subject)
  }
  private requireActive(account: AccountRow | null): AccountRecord {
    if (!account) throw new AccountDirectoryError('ACCOUNT_NOT_FOUND')
    if (account.status !== 'active') throw new AccountDirectoryError('ACCOUNT_DEACTIVATED')
    return asAccount(account)
  }
  private assertAccountId(accountId: string) {
    if (!validAccountId(accountId)) throw new AccountDirectoryError('ACCOUNT_NOT_FOUND')
  }
  async resolveOrCreate(identity: VerifiedIdentity): Promise<AccountRecord> {
    assertVerifiedIdentity(identity)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.transaction(async db => {
          const owner = await this.identity(db, identity).executeTakeFirst()
          if (owner) {
            const account = await this.lockAccount(db, owner.account_id)
            const current = await this.identity(db, identity).executeTakeFirst()
            if (!account || current?.account_id !== owner.account_id) throw new IdentityRace()
            return this.requireActive(account)
          }
          const accountId = randomUUID(),
            now = this.storage.encodeTime(Date.now())
          await db
            .insertInto('accounts')
            .values({
              server_id: this.serverId,
              account_id: accountId,
              status: 'active',
              created_at: now,
              deactivated_at: null,
            })
            .execute()
          const inserted = await db
            .insertInto('external_identities')
            .values({
              server_id: this.serverId,
              provider_id: identity.providerId,
              issuer: identity.issuer,
              subject: identity.subject,
              account_id: accountId,
              verified_at: this.storage.encodeTime(identity.verifiedAt),
              linked_at: now,
            })
            .onConflict(oc => oc.columns(['server_id', 'provider_id', 'issuer', 'subject']).doNothing())
            .returning('account_id')
            .executeTakeFirst()
          if (!inserted) throw new IdentityRace()
          return { accountId, status: 'active' }
        })
      } catch (error) {
        if (!(error instanceof IdentityRace)) throw error
      }
    }
    throw new Error('identity ownership changed repeatedly; retry login')
  }
  async link(accountId: string, identity: VerifiedIdentity): Promise<void> {
    assertVerifiedIdentity(identity)
    this.assertAccountId(accountId)
    await this.transaction(async db => {
      this.requireActive(await this.lockAccount(db, accountId))
      const inserted = await db
        .insertInto('external_identities')
        .values({
          server_id: this.serverId,
          provider_id: identity.providerId,
          issuer: identity.issuer,
          subject: identity.subject,
          account_id: accountId,
          verified_at: this.storage.encodeTime(identity.verifiedAt),
          linked_at: this.storage.encodeTime(Date.now()),
        })
        .onConflict(oc => oc.columns(['server_id', 'provider_id', 'issuer', 'subject']).doNothing())
        .returning('account_id')
        .executeTakeFirst()
      if (inserted) return
      if ((await this.identity(db, identity).executeTakeFirst())?.account_id === accountId) return
      throw new AccountDirectoryError('IDENTITY_CONFLICT')
    })
  }
  async list(accountId: string): Promise<VerifiedIdentity[]> {
    this.assertAccountId(accountId)
    return this.transaction(async db => {
      this.requireActive(await this.lockAccount(db, accountId))
      const rows = await db
        .selectFrom('external_identities')
        .select(['provider_id', 'issuer', 'subject', 'verified_at'])
        .where('server_id', '=', this.serverId)
        .where('account_id', '=', accountId)
        .orderBy('provider_id')
        .orderBy('issuer')
        .orderBy('subject')
        .execute()
      return rows.map(row => ({
        providerId: row.provider_id,
        issuer: row.issuer,
        subject: row.subject,
        verifiedAt: typeof row.verified_at === 'number' ? row.verified_at : new Date(row.verified_at).getTime(),
      }))
    })
  }
  async unlink(accountId: string, key: IdentityKey): Promise<void> {
    assertIdentity(key)
    this.assertAccountId(accountId)
    await this.transaction(async db => {
      this.requireActive(await this.lockAccount(db, accountId))
      const identities = await db
        .selectFrom('external_identities')
        .select(['provider_id', 'issuer', 'subject'])
        .where('server_id', '=', this.serverId)
        .where('account_id', '=', accountId)
        .execute()
      if (
        !identities.some(i => i.provider_id === key.providerId && i.issuer === key.issuer && i.subject === key.subject)
      )
        throw new AccountDirectoryError('IDENTITY_NOT_FOUND')
      if (identities.length <= 1) throw new AccountDirectoryError('LAST_RECOVERY_METHOD')
      await db
        .deleteFrom('external_identities')
        .where('server_id', '=', this.serverId)
        .where('account_id', '=', accountId)
        .where('provider_id', '=', key.providerId)
        .where('issuer', '=', key.issuer)
        .where('subject', '=', key.subject)
        .execute()
    })
  }
  async deactivate(accountId: string): Promise<void> {
    this.assertAccountId(accountId)
    await this.transaction(async db => {
      if (!(await deactivateAccountRow(db, this.storage.driver, this.serverId, accountId)))
        throw new AccountDirectoryError('ACCOUNT_NOT_FOUND')
    })
  }
  async getStatus(accountId: string): Promise<AccountStatus | null> {
    this.assertAccountId(accountId)
    return (
      (
        await this.storage
          .accountDatabase()
          .selectFrom('accounts')
          .select('status')
          .where('server_id', '=', this.serverId)
          .where('account_id', '=', accountId)
          .executeTakeFirst()
      )?.status ?? null
    )
  }
  /** Only in-process session issuance is allowed in action, never network I/O. */
  async withActiveAccount<T>(accountId: string, action: () => T | Promise<T>): Promise<T> {
    this.assertAccountId(accountId)
    return this.transaction(async db => {
      this.requireActive(await this.lockAccount(db, accountId))
      return action()
    })
  }
  async withActiveIdentity<T>(accountId: string, identity: IdentityKey, action: () => T | Promise<T>): Promise<T> {
    this.assertAccountId(accountId)
    assertIdentity(identity)
    return this.transaction(async db => {
      this.requireActive(await this.lockAccount(db, accountId))
      if ((await this.identity(db, identity).executeTakeFirst())?.account_id !== accountId)
        throw new AccountDirectoryError('IDENTITY_NOT_FOUND')
      return action()
    })
  }
}
/** Compatibility constructor; all business logic lives in SQLAccountDirectory. */
export class PgAccountDirectory extends SQLAccountDirectory {
  constructor(pool: Pool, serverId: string) {
    if (!validText(serverId, 128)) throw new Error('serverId must be stable and nonempty')
    super(openStorage({ driver: 'postgres', pool }), serverId)
  }
}
