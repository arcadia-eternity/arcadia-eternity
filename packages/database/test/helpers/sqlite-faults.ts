import Sqlite from 'better-sqlite3'
import { sql } from 'kysely'
import { expect } from 'vitest'
import type { DurableStorage } from '@arcadia-eternity/database'

/** Exhaust SQLite's page limit, without filling the host disk or replacing repository methods. */
export async function exhaustSqlitePages(storage: DurableStorage) {
  await sql`CREATE TABLE fault_pressure (payload BLOB NOT NULL)`.execute(storage.database)
  // These conditions make SQLITE_FULL prove the preceding domain write happened in this transaction.
  await sql
    .raw(
      `CREATE TRIGGER fault_audit AFTER INSERT ON arcadia_audit
    WHEN (
      json_extract(NEW.value, '$.action') = 'account.deactivate' AND EXISTS (
        SELECT 1 FROM accounts WHERE account_id = json_extract(NEW.value, '$.target') AND status = 'deactivated'
      )
    ) OR (
      json_extract(NEW.value, '$.action') = 'grant.replace' AND EXISTS (
        SELECT 1 FROM arcadia_grants WHERE id = json_extract(NEW.value, '$.grantId')
          AND json_array_length(json_extract(value, '$.actions')) = 2
      )
    ) OR (
      json_extract(NEW.value, '$.action') = 'binding.update' AND EXISTS (
        SELECT 1 FROM arcadia_bindings WHERE id = json_extract(NEW.value, '$.target')
          AND json_extract(value, '$.visibility') = 'private'
      )
    ) BEGIN INSERT INTO fault_pressure VALUES (zeroblob(1048576)); END`,
    )
    .execute(storage.database)
  await sql
    .raw(
      `CREATE TRIGGER fault_identity AFTER INSERT ON external_identities
    WHEN NEW.subject = 'new@example.test' AND EXISTS (
      SELECT 1 FROM accounts WHERE server_id = NEW.server_id AND account_id = NEW.account_id
    ) BEGIN INSERT INTO fault_pressure VALUES (zeroblob(1048576)); END`,
    )
    .execute(storage.database)
  const original = (await sql<{ max_page_count: number }>`PRAGMA max_page_count`.execute(storage.database)).rows[0]
    .max_page_count
  const pages = (await sql<{ page_count: number }>`PRAGMA page_count`.execute(storage.database)).rows[0].page_count
  const limit = pages + 8
  const applied = await sql
    .raw<{ max_page_count: number }>(`PRAGMA max_page_count = ${limit}`)
    .execute(storage.database)
  expect(applied.rows[0].max_page_count).toBe(limit)
  return async () => {
    await sql.raw(`PRAGMA max_page_count = ${original}`).execute(storage.database)
    await sql`DROP TRIGGER fault_identity`.execute(storage.database)
    await sql`DROP TRIGGER fault_audit`.execute(storage.database)
    await sql`DROP TABLE fault_pressure`.execute(storage.database)
  }
}

export function holdSqliteWriter(filename: string) {
  const connection = new Sqlite(filename, { timeout: 0 })
  try {
    connection.exec('BEGIN IMMEDIATE')
  } catch (error) {
    connection.close()
    throw error
  }
  return () => {
    try {
      connection.exec('ROLLBACK')
    } finally {
      connection.close()
    }
  }
}
