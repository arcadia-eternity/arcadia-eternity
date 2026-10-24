import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { ensureAccountSchema } from '../src/standalone/accounts/schema'

const databaseUrl = process.env.TEST_DATABASE_URL
const sourceDatabase = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const canCreateIsolatedDatabase = Boolean(databaseUrl && /test/i.test(sourceDatabase))

describe.skipIf(!canCreateIsolatedDatabase)('account schema validation on isolated PostgreSQL', () => {
  it('rejects a stale account table before committing bootstrap DDL', async () => {
    const databaseName = `arcadia_schema_${randomUUID().replaceAll('-', '')}`
    const admin = new Pool({ connectionString: databaseUrl, max: 1 })
    let isolated: Pool | undefined
    let databaseCreated = false
    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`)
      databaseCreated = true
      const isolatedUrl = new URL(databaseUrl!)
      isolatedUrl.pathname = `/${databaseName}`
      isolated = new Pool({ connectionString: isolatedUrl.toString(), max: 1 })
      await isolated.query(`
        CREATE SCHEMA arcadia_auth;
        CREATE TABLE arcadia_auth.accounts (
          server_id text NOT NULL,
          account_id uuid NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          deactivated_at timestamptz,
          PRIMARY KEY (server_id, account_id)
        );
      `)

      await expect(ensureAccountSchema(isolated)).rejects.toThrow(
        'Incompatible arcadia_auth schema: required column accounts.status is missing',
      )
      const rolledBack = await isolated.query<{ table_name: string | null }>(
        `SELECT to_regclass('arcadia_auth.external_identities')::text AS table_name`,
      )
      expect(rolledBack.rows[0]?.table_name).toBeNull()
    } finally {
      await isolated?.end()
      if (databaseCreated) await admin.query(`DROP DATABASE "${databaseName}"`)
      await admin.end()
    }
  })
})
