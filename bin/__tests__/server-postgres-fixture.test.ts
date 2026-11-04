import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Pool, type PoolClient } from 'pg'
import { describe, expect, it } from 'vitest'
import { dropTestDatabase } from './helpers/postgres'

const databaseUrl = process.env.TEST_DATABASE_URL

async function connectedFixture(
  work: (fixture: {
    admin: Pool
    client: PoolClient
    database: string
    closePool(): Promise<void>
    releaseClient(): void
  }) => Promise<void>,
) {
  const database = `arcadia_cleanup_${randomUUID().replaceAll('-', '')}`
  const admin = new Pool({ connectionString: databaseUrl, max: 1 })
  let target: Pool | undefined
  let client: PoolClient | undefined
  let closing: Promise<void> | undefined
  let created = false
  let released = false
  const releaseClient = () => {
    if (client && !released) {
      released = true
      client.release()
    }
  }
  const closePool = () => (closing ??= target!.end())
  try {
    await admin.query(`CREATE DATABASE "${database}"`)
    created = true
    const url = new URL(databaseUrl!)
    url.pathname = '/' + database
    target = new Pool({ connectionString: url.href, max: 1 })
    client = await target.connect()
    await work({ admin, client, database, closePool, releaseClient })
  } finally {
    try {
      releaseClient()
      if (target) await closePool()
      if (created) {
        const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])
        if (exists.rowCount) await dropTestDatabase(admin, database)
      }
    } finally {
      await admin.end()
    }
  }
}

describe.skipIf(!databaseUrl)('graceful isolated PostgreSQL fixture cleanup', () => {
  it('waits for a delayed pool close without terminating its live connection', async () => {
    await connectedFixture(async ({ admin, client, database, closePool, releaseClient }) => {
      const closing = closePool()
      let dropped = false
      const dropping = dropTestDatabase(admin, database).then(() => {
        dropped = true
      })
      try {
        // The checked-out client keeps the closing pool alive. Cleanup must wait.
        await delay(50)
        expect(dropped).toBe(false)
        expect((await client.query('SELECT 1 AS alive')).rows[0].alive).toBe(1)
      } finally {
        releaseClient()
        await closing
        await dropping
      }
      expect((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])).rowCount).toBe(0)
    })
  })

  it('reports a leaked connection and leaves it usable instead of force-dropping the database', async () => {
    await connectedFixture(async ({ admin, client, database }) => {
      await expect(dropTestDatabase(admin, database, { timeoutMs: 75, pollIntervalMs: 10 })).rejects.toThrow(
        `TEST_DATABASE_CONNECTIONS_REMAIN: ${database}`,
      )
      expect((await client.query('SELECT 1 AS alive')).rows[0].alive).toBe(1)
      expect((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database])).rowCount).toBe(1)
    })
  })
})
