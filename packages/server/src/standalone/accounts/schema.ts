import type { Pool } from 'pg'

/** Private, server-owned tables. The legacy public players table is deliberately untouched. */
export const ACCOUNT_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS arcadia_auth;

CREATE TABLE IF NOT EXISTS arcadia_auth.accounts (
  server_id text NOT NULL CHECK (length(server_id) BETWEEN 1 AND 128),
  account_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  PRIMARY KEY (server_id, account_id)
);

CREATE TABLE IF NOT EXISTS arcadia_auth.external_identities (
  server_id text NOT NULL,
  provider_id text NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 64),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 512),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  account_id uuid NOT NULL,
  verified_at timestamptz NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (server_id, provider_id, issuer, subject),
  FOREIGN KEY (server_id, account_id)
    REFERENCES arcadia_auth.accounts (server_id, account_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS arcadia_auth_identities_by_account
  ON arcadia_auth.external_identities (server_id, account_id);
`

/** Run before accepting account traffic. The app's database role owns this private schema. */
export async function ensureAccountSchema(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Prevent two copies starting against an empty database from racing on DDL.
    await client.query('SELECT pg_advisory_xact_lock(1885568454, 4)')
    await client.query(ACCOUNT_SCHEMA_SQL)
    await client.query('COMMIT')
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Preserve the original database error.
    }
    throw error
  } finally {
    client.release()
  }
}
