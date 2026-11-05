import { setTimeout as delay } from 'node:timers/promises'
import type { Pool } from 'pg'

/**
 * pg-pool can resolve end() before PostgreSQL has observed each client socket
 * closing. FORCE would then terminate closing clients and emit uncaught 57P01
 * errors. Wait for actual server-side disconnects; never hide leaked clients.
 * Callers must close every target pool/storage owner before invoking this.
 */
export async function dropTestDatabase(
  admin: Pick<Pool, 'query'>,
  database: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) throw new Error('INVALID_TEST_DATABASE_NAME')
  const timeoutMs = options.timeoutMs ?? 5000
  const pollIntervalMs = options.pollIntervalMs ?? 25
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 1)
    throw new Error('INVALID_TEST_DATABASE_CLEANUP_TIMEOUT')
  const deadline = performance.now() + timeoutMs
  for (;;) {
    const result = await admin.query<{ pid: number; state: string | null }>(
      'SELECT pid, state FROM pg_stat_activity WHERE datname = $1',
      [database],
    )
    if (!result.rows.length) break
    if (performance.now() >= deadline)
      throw new Error(`TEST_DATABASE_CONNECTIONS_REMAIN: ${database}: ${JSON.stringify(result.rows)}`)
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - performance.now())))
  }
  await admin.query(`DROP DATABASE "${database}"`)
}
