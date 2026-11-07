import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Sqlite from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SQLAccountDirectory, openStorage } from '../src/index'

type Store = Awaited<ReturnType<typeof openStorage>>

for (const driver of ['sqlite', 'postgres'] as const) {
  describe.skipIf(driver === 'postgres' && !process.env.TEST_DATABASE_URL)(`${driver} durable storage contract`, () => {
    let directory: string
    let store: Store
    let scope: string
    const owned: { collection: 'servers' | 'audit'; id: string }[] = []
    const accountScopes = new Set<string>()

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), 'arcadia-storage-contract-'))
      scope = `test-${randomUUID()}`
      store = await openStorage(
        driver === 'sqlite'
          ? { driver, filename: join(directory, 'store.sqlite') }
          : { driver, connectionString: process.env.TEST_DATABASE_URL! },
      )
      await store.migrate()
      await store.checkSchema()
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      if (store) {
        for (const { collection, id } of owned.splice(0)) {
          const value = await store.get(collection, id)
          if (value) await store.delete(collection, id, value.revision)
        }
        for (const serverId of accountScopes) {
          await store.sqlTransaction(async db => {
            const accounts = store.accountDatabase(db)
            await accounts.deleteFrom('external_identities').where('server_id', '=', serverId).execute()
            await accounts.deleteFrom('accounts').where('server_id', '=', serverId).execute()
          })
        }
        accountScopes.clear()
        await store.close()
      }
      if (directory) await rm(directory, { recursive: true, force: true })
    })

    function id(collection: 'servers' | 'audit' = 'servers') {
      const value = randomUUID()
      owned.push({ collection, id: value })
      return value
    }

    it('keeps scope listings separate and preserves JSON without driver-specific values', async () => {
      const firstId = id()
      const secondId = id()
      const value = { name: '社区服', enabled: true, createdAt: 1_793_808_123_000, nullable: null, nested: ['a', 4] }
      const first = await store.create('servers', { id: firstId, scope, value })
      await store.create('servers', { id: secondId, scope: `${scope}-other`, value: { name: 'other' } })
      expect(await store.get('servers', firstId)).toEqual(first)
      expect(first.value).toEqual(value)
      expect(Number.isInteger(first.revision)).toBe(true)
      expect((await store.list('servers', scope)).map(record => record.id)).toEqual([firstId])
      expect(await store.get('servers', randomUUID())).toBeNull()
    })

    it('rejects duplicate creation and stale updates instead of overwriting a newer decision', async () => {
      const serverId = id()
      const initial = await store.create('servers', { id: serverId, scope, value: { name: 'first' } })
      await expect(
        store.create('servers', { id: serverId, scope, value: { name: 'duplicate' } }),
      ).rejects.toMatchObject({
        code: 'ALREADY_EXISTS',
      })
      const next = await store.replace('servers', serverId, initial.revision, { name: 'second' })
      expect(next.revision).toBe(initial.revision + 1)
      expect(next.scope).toBe(scope)
      await expect(store.replace('servers', serverId, initial.revision, { name: 'stale' })).rejects.toMatchObject({
        code: 'REVISION_CONFLICT',
      })
      await expect(store.delete('servers', serverId, initial.revision)).rejects.toMatchObject({
        code: 'REVISION_CONFLICT',
      })
      expect(await store.get('servers', serverId)).toEqual(next)
    })

    it('allows exactly one of two concurrent updates from the same resource revision', async () => {
      const serverId = id()
      const initial = await store.create('servers', { id: serverId, scope, value: { name: 'initial' } })
      const results = await Promise.allSettled([
        store.replace('servers', serverId, initial.revision, { name: 'a' }),
        store.replace('servers', serverId, initial.revision, { name: 'b' }),
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toMatchObject([
        { reason: { code: 'REVISION_CONFLICT' } },
      ])
      expect((await store.get('servers', serverId))?.revision).toBe(initial.revision + 1)
    })

    it('commits configuration and audit together and rolls both back on a failed command', async () => {
      const serverId = id()
      const auditId = id('audit')
      const initial = await store.create('servers', { id: serverId, scope, value: { name: 'before' } })
      await expect(
        store.transaction(async tx => {
          await tx.replace('servers', serverId, initial.revision, { name: 'uncommitted' })
          await tx.create('audit', { id: auditId, scope, value: { action: 'rename', target: serverId } })
          throw new Error('injected command failure')
        }),
      ).rejects.toThrow('injected command failure')
      expect(await store.get('servers', serverId)).toEqual(initial)
      expect(await store.get('audit', auditId)).toBeNull()

      await store.transaction(async tx => {
        await tx.replace('servers', serverId, initial.revision, { name: 'after' })
        await tx.create('audit', { id: auditId, scope, value: { action: 'rename', target: serverId } })
      })
      expect((await store.get<{ name: string }>('servers', serverId))?.value.name).toBe('after')
      expect((await store.get('audit', auditId))?.value).toEqual({ action: 'rename', target: serverId })
    })

    it('paginates scoped accounts and atomically deactivates with audit without changing a retry timestamp', async () => {
      accountScopes.add(scope)
      accountScopes.add(`${scope}-other`)
      const accounts = new SQLAccountDirectory(store, scope)
      const identity = (subject: string) => ({ providerId: 'email', issuer: 'mailto', subject, verifiedAt: Date.now() })
      const created = await Promise.all([
        accounts.resolveOrCreate(identity('one@example.com')),
        accounts.resolveOrCreate(identity('two@example.com')),
        accounts.resolveOrCreate(identity('three@example.com')),
      ])
      const foreign = await new SQLAccountDirectory(store, `${scope}-other`).resolveOrCreate(
        identity('one@example.com'),
      )
      const first = await store.listAccounts(scope, { limit: 2 })
      expect(first).toHaveLength(2)
      const second = await store.listAccounts(scope, { limit: 2, cursor: first[1].accountId })
      expect(second).toHaveLength(1)
      expect([...first, ...second].map(account => account.accountId)).toEqual(
        created.map(account => account.accountId).sort(),
      )
      expect(await store.listAccounts(scope, { limit: 2, cursor: second[0].accountId })).toEqual([])
      expect(await store.accountDetails(scope, foreign.accountId)).toBeNull()
      expect(await store.deactivateAccount(scope, foreign.accountId)).toBe(false)
      expect(await store.accountDetails(scope, randomUUID())).toBeNull()
      await expect(store.listAccounts(scope, { limit: 0 })).rejects.toThrow('INVALID_ACCOUNT_PAGE')
      await expect(store.listAccounts(scope, { limit: 101 })).rejects.toThrow('INVALID_ACCOUNT_PAGE')
      await expect(store.listAccounts(scope, { limit: 1.5 })).rejects.toThrow('INVALID_ACCOUNT_PAGE')

      const account = first[0]
      const auditId = id('audit')
      await expect(
        store.transaction(async tx => {
          expect(await tx.deactivateAccount(scope, account.accountId)).toBe(true)
          await tx.create('audit', {
            id: auditId,
            scope,
            value: { action: 'deactivate', accountId: account.accountId },
          })
          throw new Error('audit transaction failed')
        }),
      ).rejects.toThrow('audit transaction failed')
      expect(await store.accountDetails(scope, account.accountId)).toEqual(account)
      expect(await store.get('audit', auditId)).toBeNull()
      await store.transaction(async tx => {
        expect(await tx.deactivateAccount(scope, account.accountId)).toBe(true)
        await tx.create('audit', { id: auditId, scope, value: { action: 'deactivate', accountId: account.accountId } })
      })
      const deactivated = await store.accountDetails(scope, account.accountId)
      expect(deactivated).toMatchObject({
        accountId: account.accountId,
        status: 'deactivated',
        createdAt: account.createdAt,
      })
      expect(Number.isSafeInteger(deactivated?.deactivatedAt)).toBe(true)
      expect(await store.get('audit', auditId)).not.toBeNull()
      vi.spyOn(Date, 'now').mockReturnValue(deactivated!.deactivatedAt! + 100_000)
      expect(await store.deactivateAccount(scope, account.accountId)).toBe(true)
      expect(await store.accountDetails(scope, account.accountId)).toEqual(deactivated)
    })
  })
}

describe('SQLite persistence and portable snapshots', () => {
  const stores: Store[] = []
  const directories: string[] = []

  afterEach(async () => {
    for (const store of stores.splice(0)) await store.close()
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  async function database(filename?: string, migrate = true) {
    if (!filename) {
      const directory = await mkdtemp(join(tmpdir(), 'arcadia-storage-snapshot-'))
      directories.push(directory)
      filename = join(directory, 'store.sqlite')
    }
    const store = await openStorage({ driver: 'sqlite', filename })
    stores.push(store)
    if (migrate) await store.migrate()
    return { store, filename }
  }

  it('checks an empty schema without creating migration or application tables', async () => {
    const { store, filename } = await database(undefined, false)
    const inspect = new Sqlite(filename, { readonly: true })
    try {
      const before = inspect.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      expect(before).toEqual([])
      expect(await store.schemaStatus()).toBe('empty')
      await expect(store.checkSchema()).rejects.toThrow('STORAGE_MIGRATION_REQUIRED')
      expect(inspect.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all()).toEqual(
        before,
      )
      await store.migrate()
      expect(await store.schemaStatus()).toBe('ready')
      await expect(store.checkSchema()).resolves.toBeUndefined()
    } finally {
      inspect.close()
    }
  })

  it('rejects a database migrated by a newer application without modifying it', async () => {
    const { store, filename } = await database()
    const inspect = new Sqlite(filename)
    try {
      inspect
        .prepare('INSERT INTO kysely_migration (name, timestamp) VALUES (?, ?)')
        .run('999_future', new Date().toISOString())
      const before = inspect.prepare('SELECT * FROM kysely_migration ORDER BY name').all()
      expect(await store.schemaStatus()).toBe('migration-required')
      await expect(store.checkSchema()).rejects.toThrow('STORAGE_SCHEMA_TOO_NEW')
      expect(inspect.prepare('SELECT * FROM kysely_migration ORDER BY name').all()).toEqual(before)
    } finally {
      inspect.close()
    }
  })

  it('rejects a missing account table even when its migration row remains', async () => {
    const { store, filename } = await database()
    const inspect = new Sqlite(filename)
    try {
      inspect.pragma('foreign_keys = OFF')
      inspect.exec('DROP TABLE accounts')
      await expect(store.checkSchema()).rejects.toThrow('STORAGE_SCHEMA_INVALID')
      expect(inspect.prepare("SELECT name FROM sqlite_master WHERE name = 'accounts'").all()).toEqual([])
    } finally {
      inspect.close()
    }
  })

  it('rejects an identity table whose account foreign key was removed', async () => {
    const { store, filename } = await database()
    const inspect = new Sqlite(filename)
    try {
      inspect.exec(`
        DROP TABLE external_identities;
        CREATE TABLE external_identities (
          server_id TEXT NOT NULL,
          provider_id TEXT NOT NULL,
          issuer TEXT NOT NULL,
          subject TEXT NOT NULL,
          account_id TEXT NOT NULL,
          verified_at INTEGER NOT NULL,
          linked_at INTEGER NOT NULL,
          PRIMARY KEY (server_id, provider_id, issuer, subject)
        );
      `)
      await expect(store.checkSchema()).rejects.toThrow('STORAGE_SCHEMA_INVALID')
      expect(inspect.pragma('foreign_key_list(external_identities)')).toEqual([])
    } finally {
      inspect.close()
    }
  })

  it('preserves resource identity and revisions after closing and reopening the database', async () => {
    const first = await database()
    const initial = await first.store.create('servers', {
      id: 'stable-server',
      scope: 'workspace',
      value: { name: 'persistent' },
    })
    const updated = await first.store.replace('servers', initial.id, initial.revision, { name: 'renamed' })
    stores.splice(stores.indexOf(first.store), 1)
    await first.store.close()
    const reopened = await database(first.filename)
    expect(await reopened.store.get('servers', 'stable-server')).toEqual(updated)
  })

  it('round-trips a logical snapshot without changing IDs or revisions', async () => {
    const source = (await database()).store
    const target = (await database()).store
    const initial = await source.create('servers', { id: 'server', scope: 'workspace', value: { name: 'A' } })
    const final = await source.replace('servers', initial.id, initial.revision, { name: 'B' })
    const snapshot = await source.exportSnapshot()
    await target.importSnapshot(snapshot)
    expect(await target.get('servers', final.id)).toEqual(final)
    expect(await target.exportSnapshot()).toEqual(snapshot)
  })

  it('refuses to import over existing data and leaves both stores unchanged', async () => {
    const source = (await database()).store
    const target = (await database()).store
    await source.create('servers', { id: 'source', scope: 'workspace', value: { name: 'source' } })
    const original = await target.create('servers', { id: 'target', scope: 'workspace', value: { name: 'target' } })
    const sourceSnapshot = await source.exportSnapshot()
    await expect(target.importSnapshot(sourceSnapshot)).rejects.toThrow()
    expect(await target.get('servers', original.id)).toEqual(original)
    expect(await target.get('servers', 'source')).toBeNull()
    expect(await source.exportSnapshot()).toEqual(sourceSnapshot)
  })

  it('rolls back a partially processed malformed snapshot', async () => {
    const source = (await database()).store
    const target = (await database()).store
    await source.create('servers', { id: 'first', scope: 'workspace', value: { name: 'first' } })
    const snapshot = await source.exportSnapshot()
    snapshot.records.servers.push({ id: 'invalid', scope: 'workspace', revision: -1, value: {} })
    await expect(target.importSnapshot(snapshot)).rejects.toThrow('INVALID_STORAGE_SNAPSHOT')
    expect(await target.list('servers')).toEqual([])
  })

  it('rolls back records imported before an identity with a missing account', async () => {
    const source = (await database()).store
    const target = (await database()).store
    await source.create('servers', { id: 'first', scope: 'workspace', value: { name: 'first' } })
    const snapshot = await source.exportSnapshot()
    snapshot.identities.push({
      server_id: 'first',
      provider_id: 'email',
      issuer: 'mailto',
      subject: 'orphan@example.com',
      account_id: randomUUID(),
      verified_at: 1_793_808_123_000,
      linked_at: 1_793_808_123_000,
    })
    await expect(target.importSnapshot(snapshot)).rejects.toThrow()
    expect(await target.list('servers')).toEqual([])
    const actual = await target.exportSnapshot()
    expect(actual.accounts).toEqual([])
    expect(actual.identities).toEqual([])
  })

  it('rejects an invalid imported account status without leaving partial data', async () => {
    const source = (await database()).store
    const target = (await database()).store
    await source.create('servers', { id: 'first', scope: 'workspace', value: { name: 'first' } })
    const snapshot = await source.exportSnapshot()
    const account = {
      server_id: 'first',
      account_id: randomUUID(),
      status: 'active' as const,
      created_at: 1_793_808_123_000,
      deactivated_at: null,
    }
    Object.assign(account, { status: 'invalid' })
    snapshot.accounts.push(account)
    await expect(target.importSnapshot(snapshot)).rejects.toThrow()
    expect(await target.list('servers')).toEqual([])
    expect((await target.exportSnapshot()).accounts).toEqual([])
  })
})
