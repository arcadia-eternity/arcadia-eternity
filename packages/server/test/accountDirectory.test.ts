import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Pool } from 'pg'
import { PgAccountDirectory } from '../src/standalone/accounts/directory'
import { ensureAccountSchema } from '../src/standalone/accounts/schema'

const email = (subject: string) => ({ providerId: 'email', issuer: 'mailto', subject, verifiedAt: Date.now() })
const oidc = (subject: string) => ({
  providerId: 'oidc',
  issuer: 'https://issuer.example',
  subject,
  verifiedAt: Date.now(),
})

describe('account directory input boundary', () => {
  const noDatabase = {} as Pool

  it('requires a stable, bounded server ID', () => {
    expect(() => new PgAccountDirectory(noDatabase, '')).toThrow()
    expect(() => new PgAccountDirectory(noDatabase, 's'.repeat(129))).toThrow()
  })

  it('rejects forged or malformed identity keys before touching the database', async () => {
    const directory = new PgAccountDirectory(noDatabase, 'test-server')
    await expect(directory.resolveOrCreate({ ...email(''), verifiedAt: Date.now() })).rejects.toMatchObject({
      code: 'INVALID_IDENTITY',
    })
    await expect(directory.resolveOrCreate({ ...email('a\n@example.com') })).rejects.toMatchObject({
      code: 'INVALID_IDENTITY',
    })
    await expect(directory.resolveOrCreate({ ...email('a@example.com'), verifiedAt: -1 })).rejects.toMatchObject({
      code: 'INVALID_IDENTITY',
    })
    await expect(
      directory.resolveOrCreate({ ...email('a@example.com'), verifiedAt: undefined as unknown as number }),
    ).rejects.toMatchObject({ code: 'INVALID_IDENTITY' })
    await expect(directory.getStatus('not-an-account-id')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' })
  })
})

const databaseUrl = process.env.TEST_DATABASE_URL

describe.skipIf(!databaseUrl)('account directory on PostgreSQL', () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 12 })
  const serverIds = new Set<string>()
  const directory = (serverId = `test-${randomUUID()}`) => {
    serverIds.add(serverId)
    return new PgAccountDirectory(pool, serverId)
  }

  beforeAll(async () => {
    await ensureAccountSchema(pool)
  })

  afterAll(async () => {
    try {
      for (const serverId of serverIds) {
        await pool.query('DELETE FROM arcadia_auth.external_identities WHERE server_id = $1', [serverId])
        await pool.query('DELETE FROM arcadia_auth.accounts WHERE server_id = $1', [serverId])
      }
    } finally {
      await pool.end()
    }
  })

  it('creates one durable account for concurrent first logins of one verified identity', async () => {
    const store = directory()
    const identity = email('first@example.com')
    const accounts = await Promise.all(Array.from({ length: 24 }, () => store.resolveOrCreate(identity)))
    expect(new Set(accounts.map(account => account.accountId)).size).toBe(1)
    expect(accounts.every(account => account.status === 'active')).toBe(true)
    expect(await store.resolveOrCreate(identity)).toEqual(accounts[0])

    const stored = await pool.query<{ account_count: string; identity_count: string }>(
      `SELECT
         (SELECT count(*) FROM arcadia_auth.accounts WHERE server_id = $1) AS account_count,
         (SELECT count(*) FROM arcadia_auth.external_identities WHERE server_id = $1) AS identity_count`,
      [store.serverId],
    )
    expect(stored.rows[0]).toMatchObject({ account_count: '1', identity_count: '1' })
  })

  it('scopes external identity ownership to a stable server ID', async () => {
    const first = directory()
    const second = directory()
    const identity = oidc('same-subject')
    const a = await first.resolveOrCreate(identity)
    const b = await second.resolveOrCreate(identity)
    expect(a.accountId).not.toBe(b.accountId)
    expect(await first.getStatus(b.accountId)).toBeNull()
    await expect(first.link(b.accountId, email('cannot-cross-server@example.com'))).rejects.toMatchObject({
      code: 'ACCOUNT_NOT_FOUND',
    })
  })

  it('binds verified identities explicitly, rejects conflicts, and keeps one recovery method', async () => {
    const store = directory()
    const first = await store.resolveOrCreate(email('owner@example.com'))
    const other = await store.resolveOrCreate(oidc('other'))
    const secondIdentity = oidc('owner')

    await store.link(first.accountId, secondIdentity)
    await store.link(first.accountId, secondIdentity) // Same account is idempotent.
    expect((await store.list(first.accountId)).map(identity => identity.providerId)).toEqual(['email', 'oidc'])
    await expect(store.link(other.accountId, secondIdentity)).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' })
    await expect(store.unlink(other.accountId, secondIdentity)).rejects.toMatchObject({ code: 'IDENTITY_NOT_FOUND' })

    await store.unlink(first.accountId, email('owner@example.com'))
    expect(await store.list(first.accountId)).toMatchObject([secondIdentity])
    await expect(store.unlink(first.accountId, secondIdentity)).rejects.toMatchObject({
      code: 'LAST_RECOVERY_METHOD',
    })
    expect(await store.resolveOrCreate(secondIdentity)).toEqual(first)
  })

  it('allows exactly one owner when two accounts bind the same identity concurrently', async () => {
    const store = directory()
    const first = await store.resolveOrCreate(email('first-owner@example.com'))
    const second = await store.resolveOrCreate(email('second-owner@example.com'))
    const shared = oidc('shared-subject')
    const results = await Promise.allSettled([
      store.link(first.accountId, shared),
      store.link(second.accountId, shared),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([
      { reason: { code: 'IDENTITY_CONFLICT' } },
    ])
    const owner = await store.resolveOrCreate(shared)
    expect([first.accountId, second.accountId]).toContain(owner.accountId)
    expect((await store.list(first.accountId)).length + (await store.list(second.accountId)).length).toBe(3)
  })

  it('cannot empty an account through simultaneous unlinks', async () => {
    const store = directory()
    const firstIdentity = email('race@example.com')
    const secondIdentity = oidc('race')
    const account = await store.resolveOrCreate(firstIdentity)
    await store.link(account.accountId, secondIdentity)

    const results = await Promise.allSettled([
      store.unlink(account.accountId, firstIdentity),
      store.unlink(account.accountId, secondIdentity),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await store.list(account.accountId)).toHaveLength(1)
  })

  it('does not issue a session if its resolved identity was unlinked or reassigned meanwhile', async () => {
    const store = directory()
    const loginIdentity = email('stale-login@example.com')
    const account = await store.resolveOrCreate(loginIdentity)
    await store.link(account.accountId, oidc('still-recoverable'))
    const resolved = await store.resolveOrCreate(loginIdentity)
    expect(resolved.accountId).toBe(account.accountId)

    await store.unlink(account.accountId, loginIdentity)
    const issue = vi.fn(() => 'session')
    await expect(store.withActiveIdentity(resolved.accountId, loginIdentity, issue)).rejects.toMatchObject({
      code: 'IDENTITY_NOT_FOUND',
    })
    expect(issue).not.toHaveBeenCalled()

    const other = await store.resolveOrCreate(oidc('other-owner'))
    await store.link(other.accountId, loginIdentity)
    await expect(store.withActiveIdentity(resolved.accountId, loginIdentity, issue)).rejects.toMatchObject({
      code: 'IDENTITY_NOT_FOUND',
    })
    expect(issue).not.toHaveBeenCalled()
    expect(await store.withActiveIdentity(other.accountId, loginIdentity, issue)).toBe('session')
    expect(issue).toHaveBeenCalledTimes(1)
  })

  it('retains deactivated identity ownership and refuses future login or changes', async () => {
    const store = directory()
    const identity = email('disabled@example.com')
    const account = await store.resolveOrCreate(identity)
    await store.deactivate(account.accountId)
    await store.deactivate(account.accountId) // Retry after a lost response is safe.

    expect(await store.getStatus(account.accountId)).toBe('deactivated')
    await expect(store.resolveOrCreate(identity)).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' })
    await expect(store.link(account.accountId, oidc('new'))).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' })
    await expect(store.list(account.accountId)).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' })
    await expect(store.withActiveAccount(account.accountId, () => 'session')).rejects.toMatchObject({
      code: 'ACCOUNT_DEACTIVATED',
    })
    const stored = await pool.query('SELECT account_id FROM arcadia_auth.external_identities WHERE server_id = $1', [
      store.serverId,
    ])
    expect(stored.rowCount).toBe(1)
  })

  it('serializes session issuance with deactivation', async () => {
    const store = directory()
    const account = await store.resolveOrCreate(email('fenced@example.com'))
    let release!: () => void
    let entered!: () => void
    const actionEntered = new Promise<void>(resolve => {
      entered = resolve
    })
    const actionReleased = new Promise<void>(resolve => {
      release = resolve
    })
    const session = store.withActiveAccount(account.accountId, async () => {
      entered()
      await actionReleased
      return 'issued'
    })
    await actionEntered
    const deactivation = store.deactivate(account.accountId)
    release()
    expect(await session).toBe('issued')
    await deactivation
    await expect(store.withActiveAccount(account.accountId, () => 'late')).rejects.toMatchObject({
      code: 'ACCOUNT_DEACTIVATED',
    })
  })
})
