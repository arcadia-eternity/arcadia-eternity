import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_SCHEMA_SQL, SQLAccountDirectory, collections, openStorage } from '../src/index'

const databaseUrl = process.env.TEST_DATABASE_URL
const sourceDatabase = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const isolatedDatabaseAllowed = Boolean(databaseUrl && /test/i.test(sourceDatabase))

async function withIsolatedPostgres<T>(action: (pool: Pool, connectionString: string) => Promise<T>): Promise<T> {
  if (!isolatedDatabaseAllowed) throw new Error('An explicit TEST_DATABASE_URL naming a test database is required')
  const databaseName = `arcadia_portability_${randomUUID().replaceAll('-', '')}`
  const admin = new Pool({ connectionString: databaseUrl, max: 1 })
  let isolated: Pool | undefined
  let created = false
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`)
    created = true
    const targetUrl = new URL(databaseUrl!)
    targetUrl.pathname = `/${databaseName}`
    isolated = new Pool({ connectionString: targetUrl.toString(), max: 12 })
    return await action(isolated, targetUrl.toString())
  } finally {
    await isolated?.end()
    if (created) await admin.query(`DROP DATABASE "${databaseName}"`)
    await admin.end()
  }
}

const email = (subject: string) => ({
  providerId: 'email',
  issuer: 'mailto',
  subject,
  verifiedAt: 1_793_808_123_456,
})

describe.skipIf(!isolatedDatabaseAllowed)('portable storage on isolated PostgreSQL', () => {
  it('uses the public management tables and migration ledger under a shadowing search_path', async () => {
    await withIsolatedPostgres(async (pool, connectionString) => {
      await pool.query('CREATE SCHEMA shadow')
      const shiftedPool = new Pool({ connectionString, max: 2, options: '-c search_path=shadow,pg_catalog,public' })
      const shifted = openStorage({ driver: 'postgres', pool: shiftedPool })
      const normal = openStorage({ driver: 'postgres', pool })
      try {
        await shifted.migrate()
        expect(await shifted.schemaStatus()).toBe('ready')
        await normal.checkSchema()
        expect((await pool.query("SELECT to_regclass('shadow.kysely_migration') AS name")).rows[0].name).toBeNull()
        expect((await pool.query("SELECT to_regclass('public.kysely_migration') AS name")).rows[0].name).not.toBeNull()
        const expected = await shifted.create('servers', {
          id: 'server',
          scope: 'workspace',
          value: { name: 'public server' },
        })
        expect(await normal.get('servers', 'server')).toEqual(expected)
        await pool.query(`
          CREATE TABLE shadow.arcadia_servers (LIKE public.arcadia_servers INCLUDING ALL);
          CREATE TABLE shadow.kysely_migration (LIKE public.kysely_migration INCLUDING ALL);
        `)
        await pool.query('INSERT INTO shadow.arcadia_servers (id, scope, revision, value) VALUES ($1, $2, $3, $4)', [
          'server',
          'workspace',
          99,
          JSON.stringify({ name: 'shadow server' }),
        ])
        await pool.query('INSERT INTO shadow.kysely_migration (name, timestamp) VALUES ($1, $2)', [
          '999_fake_future',
          new Date().toISOString(),
        ])
        await shifted.checkSchema()
        await shifted.migrate()
        expect(await shifted.schemaStatus()).toBe('ready')
        expect(await shifted.get('servers', 'server')).toEqual(expected)
        const updated = await shifted.replace('servers', 'server', expected.revision, { name: 'updated public' })
        expect(await normal.get('servers', 'server')).toEqual(updated)
        expect(
          (await pool.query('SELECT revision FROM shadow.arcadia_servers WHERE id = $1', ['server'])).rows[0].revision,
        ).toBe(99)
        expect((await pool.query('SELECT name FROM shadow.kysely_migration')).rows).toEqual([
          { name: '999_fake_future' },
        ])
      } finally {
        await Promise.all([shifted.close(), normal.close()])
        await shiftedPool.end()
      }
    })
  })

  it('round-trips SQLite → PostgreSQL → SQLite without changing accounts, time, records or revisions', async () => {
    await withIsolatedPostgres(async pool => {
      const directory = await mkdtemp(join(tmpdir(), 'arcadia-portability-'))
      const original = openStorage({ driver: 'sqlite', filename: join(directory, 'original.sqlite') })
      const postgres = openStorage({ driver: 'postgres', pool })
      const restored = openStorage({ driver: 'sqlite', filename: join(directory, 'restored.sqlite') })
      try {
        await original.migrate()
        await postgres.migrate()
        await restored.migrate()
        const accounts = new SQLAccountDirectory(original, 'stable-server')
        const activeIdentity = email('active@example.com')
        const active = await accounts.resolveOrCreate(activeIdentity)
        const linked = {
          providerId: 'github',
          issuer: 'https://github.com',
          subject: '12345',
          verifiedAt: activeIdentity.verifiedAt + 123,
        }
        await accounts.link(active.accountId, linked)
        const inactiveIdentity = email('inactive@example.com')
        const inactive = await accounts.resolveOrCreate(inactiveIdentity)
        await accounts.deactivate(inactive.accountId)
        const foreignAccount = await new SQLAccountDirectory(original, 'another-server').resolveOrCreate(activeIdentity)
        expect(foreignAccount.accountId).not.toBe(active.accountId)

        for (const collection of collections) {
          const created = await original.create(collection, {
            id: `${collection}-fixture`,
            scope: 'stable-server',
            value: { label: '迁移前', serverId: 'stable-server', accountId: active.accountId },
          })
          await original.replace(collection, created.id, created.revision, {
            label: '迁移后',
            serverId: 'stable-server',
            accountId: active.accountId,
            enabled: true,
            timestamp: 1_793_808_123_456,
            optional: null,
          })
        }
        const snapshot = await original.exportSnapshot()
        expect(snapshot.identities.every(identity => typeof identity.verified_at === 'number')).toBe(true)
        await postgres.importSnapshot(snapshot)
        expect(await postgres.exportSnapshot()).toEqual(snapshot)
        const postgresAccounts = new SQLAccountDirectory(postgres, 'stable-server')
        expect(await postgresAccounts.resolveOrCreate(activeIdentity)).toEqual(active)
        expect(await postgresAccounts.list(active.accountId)).toEqual([activeIdentity, linked])
        await expect(postgresAccounts.resolveOrCreate(inactiveIdentity)).rejects.toMatchObject({
          code: 'ACCOUNT_DEACTIVATED',
        })

        await restored.importSnapshot(await postgres.exportSnapshot())
        expect(await restored.exportSnapshot()).toEqual(snapshot)
        const restoredAccounts = new SQLAccountDirectory(restored, 'stable-server')
        expect(await restoredAccounts.resolveOrCreate(activeIdentity)).toEqual(active)
        expect(await restoredAccounts.list(active.accountId)).toEqual([activeIdentity, linked])
        expect(await restoredAccounts.getStatus(inactive.accountId)).toBe('deactivated')
        expect(await restoredAccounts.getStatus(foreignAccount.accountId)).toBeNull()
        await expect(restoredAccounts.resolveOrCreate(inactiveIdentity)).rejects.toMatchObject({
          code: 'ACCOUNT_DEACTIVATED',
        })
      } finally {
        await Promise.all([original.close(), postgres.close(), restored.close()])
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  it('baselines an existing G3 PostgreSQL schema without replacing identities or timestamps', async () => {
    await withIsolatedPostgres(async pool => {
      await pool.query(ACCOUNT_SCHEMA_SQL)
      const activeId = randomUUID()
      const inactiveId = randomUUID()
      const serverId = 'existing-server'
      const createdAt = new Date('2026-10-10T01:02:03.456Z')
      const verifiedAt = new Date('2026-10-10T04:05:06.789Z')
      const deactivatedAt = new Date('2026-10-11T10:11:12.345Z')
      await pool.query(
        `INSERT INTO arcadia_auth.accounts
          (server_id, account_id, status, created_at, deactivated_at)
          VALUES ($1, $2, 'active', $4, NULL), ($1, $3, 'deactivated', $4, $5)`,
        [serverId, activeId, inactiveId, createdAt, deactivatedAt],
      )
      await pool.query(
        `INSERT INTO arcadia_auth.external_identities
          (server_id, provider_id, issuer, subject, account_id, verified_at, linked_at)
          VALUES ($1, 'email', 'mailto', 'legacy-active@example.com', $2, $4, $5),
                 ($1, 'github', 'https://github.com', 'legacy-disabled', $3, $4, $5)`,
        [serverId, activeId, inactiveId, verifiedAt, createdAt],
      )
      const beforeAccounts = (await pool.query('SELECT * FROM arcadia_auth.accounts ORDER BY account_id')).rows
      const beforeIdentities = (await pool.query('SELECT * FROM arcadia_auth.external_identities ORDER BY account_id'))
        .rows
      const storage = openStorage({ driver: 'postgres', pool })
      try {
        expect(await storage.schemaStatus()).toBe('migration-required')
        await expect(storage.checkSchema()).rejects.toThrow('STORAGE_MIGRATION_REQUIRED')
        expect((await pool.query("SELECT to_regclass('public.kysely_migration') AS name")).rows[0].name).toBeNull()
        await storage.migrate()
        await storage.migrate()
        expect(await storage.schemaStatus()).toBe('ready')
        expect((await pool.query('SELECT * FROM arcadia_auth.accounts ORDER BY account_id')).rows).toEqual(
          beforeAccounts,
        )
        expect((await pool.query('SELECT * FROM arcadia_auth.external_identities ORDER BY account_id')).rows).toEqual(
          beforeIdentities,
        )
        const accounts = new SQLAccountDirectory(storage, serverId)
        const identity = { ...email('legacy-active@example.com'), verifiedAt: verifiedAt.getTime() }
        expect(await accounts.resolveOrCreate(identity)).toEqual({ accountId: activeId, status: 'active' })
        expect(await accounts.list(activeId)).toEqual([identity])
        expect(await accounts.getStatus(inactiveId)).toBe('deactivated')
        const snapshot = await storage.exportSnapshot()
        expect(snapshot.accounts.find(row => row.account_id === activeId)?.created_at).toBe(createdAt.getTime())
        expect(snapshot.accounts.find(row => row.account_id === inactiveId)?.deactivated_at).toBe(
          deactivatedAt.getTime(),
        )
        expect(snapshot.identities.every(row => row.verified_at === verifiedAt.getTime())).toBe(true)
      } finally {
        await storage.close()
      }
    })
  })
})
