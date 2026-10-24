import type { Pool, PoolClient } from 'pg'

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

interface ColumnRow {
  table_name: string
  column_name: string
  data_type: string
  is_not_null: boolean
}

interface ConstraintRow {
  table_name: string
  constraint_type: 'p' | 'u' | 'f' | 'c'
  columns: string[]
  referenced_schema: string | null
  referenced_table: string | null
  referenced_columns: string[] | null
  delete_action: string
  is_validated: boolean
  is_deferrable: boolean
  definition: string
}

const REQUIRED_COLUMNS = new Map<string, { type: string; notNull: boolean }>([
  ['accounts.server_id', { type: 'text', notNull: true }],
  ['accounts.account_id', { type: 'uuid', notNull: true }],
  ['accounts.status', { type: 'text', notNull: true }],
  ['accounts.created_at', { type: 'timestamp with time zone', notNull: true }],
  ['accounts.deactivated_at', { type: 'timestamp with time zone', notNull: false }],
  ['external_identities.server_id', { type: 'text', notNull: true }],
  ['external_identities.provider_id', { type: 'text', notNull: true }],
  ['external_identities.issuer', { type: 'text', notNull: true }],
  ['external_identities.subject', { type: 'text', notNull: true }],
  ['external_identities.account_id', { type: 'uuid', notNull: true }],
  ['external_identities.verified_at', { type: 'timestamp with time zone', notNull: true }],
  ['external_identities.linked_at', { type: 'timestamp with time zone', notNull: true }],
])

const REQUIRED_CHECKS = new Map<string, { label: string; definition: string }[]>([
  [
    'accounts',
    [
      { label: 'server_id length', definition: 'checklengthserver_id>=1andlengthserver_id<=128' },
      { label: 'status value', definition: "checkstatus=anyarray['active','deactivated']" },
    ],
  ],
  [
    'external_identities',
    [
      { label: 'provider_id length', definition: 'checklengthprovider_id>=1andlengthprovider_id<=64' },
      { label: 'issuer length', definition: 'checklengthissuer>=1andlengthissuer<=512' },
      { label: 'subject length', definition: 'checklengthsubject>=1andlengthsubject<=512' },
    ],
  ],
])

function incompatibleSchema(detail: string): Error {
  return new Error(`Incompatible arcadia_auth schema: ${detail}`)
}

function sameColumns(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((column, index) => column === expected[index])
}

function normalizeConstraintDefinition(definition: string): string {
  return definition
    .toLowerCase()
    .replaceAll('::text', '')
    .replace(/[\s()]/g, '')
}

function validateColumns(rows: ColumnRow[]): void {
  const actual = new Map(rows.map(row => [`${row.table_name}.${row.column_name}`, row]))
  for (const [name, expected] of REQUIRED_COLUMNS) {
    const column = actual.get(name)
    if (!column) throw incompatibleSchema(`required column ${name} is missing`)
    if (column.data_type !== expected.type) {
      throw incompatibleSchema(`${name} must be ${expected.type}, found ${column.data_type}`)
    }
    if (column.is_not_null !== expected.notNull) {
      throw incompatibleSchema(`${name} nullability does not match the account schema`)
    }
  }
}

function validateKeys(rows: ConstraintRow[]): void {
  const hasAccountPrimaryKey = rows.some(
    row =>
      row.table_name === 'accounts' &&
      row.constraint_type === 'p' &&
      sameColumns(row.columns, ['server_id', 'account_id']) &&
      !row.is_deferrable,
  )
  if (!hasAccountPrimaryKey) {
    throw incompatibleSchema('accounts must have primary key (server_id, account_id)')
  }

  const hasIdentityKey = rows.some(
    row =>
      row.table_name === 'external_identities' &&
      (row.constraint_type === 'p' || row.constraint_type === 'u') &&
      sameColumns(row.columns, ['server_id', 'provider_id', 'issuer', 'subject']) &&
      !row.is_deferrable,
  )
  if (!hasIdentityKey) {
    throw incompatibleSchema('external_identities must have a unique key on (server_id, provider_id, issuer, subject)')
  }

  const hasAccountForeignKey = rows.some(
    row =>
      row.table_name === 'external_identities' &&
      row.constraint_type === 'f' &&
      sameColumns(row.columns, ['server_id', 'account_id']) &&
      row.referenced_schema === 'arcadia_auth' &&
      row.referenced_table === 'accounts' &&
      row.referenced_columns !== null &&
      sameColumns(row.referenced_columns, ['server_id', 'account_id']) &&
      row.delete_action === 'r' &&
      row.is_validated,
  )
  if (!hasAccountForeignKey) {
    throw incompatibleSchema(
      'external_identities must reference accounts (server_id, account_id) with ON DELETE RESTRICT',
    )
  }

  for (const [table, requiredDefinitions] of REQUIRED_CHECKS) {
    const actualDefinitions = new Set(
      rows
        .filter(row => row.table_name === table && row.constraint_type === 'c' && row.is_validated)
        .map(row => normalizeConstraintDefinition(row.definition)),
    )
    for (const { label, definition } of requiredDefinitions) {
      if (!actualDefinitions.has(definition)) {
        throw incompatibleSchema(`${table} is missing required validated ${label} check constraint`)
      }
    }
  }
}

async function validateAccountSchema(client: PoolClient): Promise<void> {
  const columns = await client.query<ColumnRow>(`
    SELECT table_name,
           column_name,
           data_type,
           (is_nullable = 'NO') AS is_not_null
    FROM information_schema.columns
    WHERE table_schema = 'arcadia_auth'
      AND table_name IN ('accounts', 'external_identities')
  `)
  validateColumns(columns.rows)

  const constraints = await client.query<ConstraintRow>(`
    SELECT source.relname AS table_name,
           account_constraint.contype AS constraint_type,
           ARRAY(
             SELECT attribute.attname
             FROM unnest(account_constraint.conkey) WITH ORDINALITY AS column_key(attnum, position)
             JOIN pg_attribute AS attribute
               ON attribute.attrelid = account_constraint.conrelid
              AND attribute.attnum = column_key.attnum
             ORDER BY column_key.position
           ) AS columns,
           target_namespace.nspname AS referenced_schema,
           target.relname AS referenced_table,
           CASE WHEN account_constraint.confrelid = 0 THEN NULL ELSE ARRAY(
             SELECT attribute.attname
             FROM unnest(account_constraint.confkey) WITH ORDINALITY AS column_key(attnum, position)
             JOIN pg_attribute AS attribute
               ON attribute.attrelid = account_constraint.confrelid
              AND attribute.attnum = column_key.attnum
             ORDER BY column_key.position
           ) END AS referenced_columns,
           account_constraint.confdeltype AS delete_action,
           account_constraint.convalidated AS is_validated,
           account_constraint.condeferrable AS is_deferrable,
           pg_get_constraintdef(account_constraint.oid, true) AS definition
    FROM pg_constraint AS account_constraint
    JOIN pg_class AS source ON source.oid = account_constraint.conrelid
    JOIN pg_namespace AS namespace ON namespace.oid = source.relnamespace
    LEFT JOIN pg_class AS target ON target.oid = account_constraint.confrelid
    LEFT JOIN pg_namespace AS target_namespace ON target_namespace.oid = target.relnamespace
    WHERE namespace.nspname = 'arcadia_auth'
      AND source.relname IN ('accounts', 'external_identities')
  `)
  validateKeys(constraints.rows)
}

/** Run before accepting account traffic. The app's database role owns this private schema. */
export async function ensureAccountSchema(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Prevent two copies starting against an empty database from racing on DDL.
    await client.query('SELECT pg_advisory_xact_lock(1885568454, 4)')
    await client.query(ACCOUNT_SCHEMA_SQL)
    await validateAccountSchema(client)
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
