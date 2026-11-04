import Sqlite from 'better-sqlite3'
import { Kysely, Migrator, PostgresDialect, SqliteDialect, sql, type Transaction } from 'kysely'
import pg, { type Pool } from 'pg'
import { ensureAccountSchema, validateAccountSchema } from './legacy-account-schema'

export const collections = [
  'servers',
  'bindings',
  'principals',
  'grants',
  'credentials',
  'operations',
  'audit',
  'retentions',
  'environmentVersions',
  'sessions',
] as const
export type Collection = (typeof collections)[number]
const tables = Object.fromEntries(
  collections.map(name => [name, `arcadia_${name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)}`]),
) as Record<Collection, string>
export interface StoredRecord<T = unknown> {
  id: string
  scope: string
  revision: number
  value: T
}
export class StorageConflictError extends Error {
  constructor(readonly code: 'ALREADY_EXISTS' | 'REVISION_CONFLICT' | 'NOT_FOUND') {
    super(code)
    this.name = 'StorageConflictError'
  }
}
export interface AccountSummary {
  accountId: string
  status: 'active' | 'deactivated'
  createdAt: number
  deactivatedAt: number | null
}
export interface StorageTransaction {
  listAccounts(serverId: string, options: { limit: number; cursor?: string }): Promise<AccountSummary[]>
  accountDetails(serverId: string, accountId: string): Promise<AccountSummary | null>
  deactivateAccount(serverId: string, accountId: string): Promise<boolean>
  accountStatus(serverId: string, accountId: string): Promise<'active' | 'deactivated' | null>
  get<T>(collection: Collection, id: string): Promise<StoredRecord<T> | null>
  list<T>(collection: Collection, scope?: string): Promise<StoredRecord<T>[]>
  create<T>(collection: Collection, record: { id: string; scope: string; value: T }): Promise<StoredRecord<T>>
  replace<T>(collection: Collection, id: string, expectedRevision: number, value: T): Promise<StoredRecord<T>>
  delete(collection: Collection, id: string, expectedRevision: number): Promise<void>
}
interface DocumentRow {
  id: string
  scope: string
  revision: number
  value: string
}
interface AccountRow {
  server_id: string
  account_id: string
  status: 'active' | 'deactivated'
  created_at: Date | number | string
  deactivated_at: Date | number | string | null
}
interface IdentityRow {
  server_id: string
  provider_id: string
  issuer: string
  subject: string
  account_id: string
  verified_at: Date | number | string
  linked_at: Date | number | string
}
export interface Database {
  accounts: AccountRow
  external_identities: IdentityRow
  [table: string]: DocumentRow | AccountRow | IdentityRow
}
export type DatabaseSession = Kysely<Database> | Transaction<Database>
export type StorageOptions =
  | { driver: 'sqlite'; filename: string; busyTimeout?: number; readonly?: boolean }
  | { driver: 'postgres'; connectionString?: string; pool?: Pool; readonly?: boolean }
export interface StorageSnapshot {
  formatVersion: 1
  schemaVersion: 1
  records: Record<Collection, StoredRecord[]>
  accounts: AccountRow[]
  identities: IdentityRow[]
}
const schemaVersion = '001_unified_storage'
// Frozen migration input. Future collections require a new migration, not edits here.
const versionOneTables = [
  'arcadia_servers',
  'arcadia_bindings',
  'arcadia_principals',
  'arcadia_grants',
  'arcadia_credentials',
  'arcadia_operations',
  'arcadia_audit',
  'arcadia_retentions',
  'arcadia_environment_versions',
  'arcadia_sessions',
] as const

function validKey(value: string) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512 || /\p{Cc}/u.test(value))
    throw new Error('INVALID_STORAGE_KEY')
}
function encode(value: unknown) {
  const json = JSON.stringify(value)
  if (json === undefined) throw new Error('INVALID_STORAGE_VALUE')
  return json
}
function record<T>(row: DocumentRow): StoredRecord<T> {
  return { id: row.id, scope: row.scope, revision: Number(row.revision), value: JSON.parse(row.value) as T }
}
function table(collection: Collection): string {
  if (!Object.hasOwn(tables, collection)) throw new Error('INVALID_COLLECTION')
  return tables[collection]
}
function documentStore(db: DatabaseSession, driver: StorageOptions['driver']): StorageTransaction {
  // Table names are a closed internal allowlist; callers never submit SQL or names.
  const query = (driver === 'postgres' ? db.withSchema('public') : db) as Kysely<Record<string, DocumentRow>>
  return {
    async listAccounts(serverId, { limit, cursor }) {
      validKey(serverId)
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_ACCOUNT_PAGE')
      if (cursor !== undefined) snapshotUuid(cursor)
      const accounts = driver === 'postgres' ? db.withSchema('arcadia_auth') : db
      let q = accounts
        .selectFrom('accounts')
        .selectAll()
        .where('server_id', '=', serverId)
        .orderBy('account_id')
        .limit(limit)
      if (cursor) q = q.where('account_id', '>', cursor)
      return (await q.execute()).map(accountSummary)
    },
    async accountDetails(serverId, accountId) {
      validKey(serverId)
      snapshotUuid(accountId)
      const accounts = driver === 'postgres' ? db.withSchema('arcadia_auth') : db
      const row = await accounts
        .selectFrom('accounts')
        .selectAll()
        .where('server_id', '=', serverId)
        .where('account_id', '=', accountId)
        .executeTakeFirst()
      return row ? accountSummary(row) : null
    },
    async deactivateAccount(serverId, accountId) {
      return deactivateAccountRow(db, driver, serverId, accountId)
    },
    async accountStatus(serverId, accountId) {
      const accounts = driver === 'postgres' ? db.withSchema('arcadia_auth') : db
      let query = accounts
        .selectFrom('accounts')
        .select('status')
        .where('server_id', '=', serverId)
        .where('account_id', '=', accountId)
      if (driver === 'postgres') query = query.forUpdate()
      return (await query.executeTakeFirst())?.status ?? null
    },
    async get<T>(collection: Collection, id: string) {
      validKey(id)
      const row = await query.selectFrom(table(collection)).selectAll().where('id', '=', id).executeTakeFirst()
      return row ? record<T>(row) : null
    },
    async list<T>(collection: Collection, scope?: string) {
      let q = query.selectFrom(table(collection)).selectAll().orderBy('id')
      if (scope !== undefined) {
        validKey(scope)
        q = q.where('scope', '=', scope)
      }
      return (await q.execute()).map(row => record<T>(row))
    },
    async create<T>(collection: Collection, input: { id: string; scope: string; value: T }) {
      validKey(input.id)
      validKey(input.scope)
      const row = { id: input.id, scope: input.scope, revision: 1, value: encode(input.value) }
      const inserted = await query
        .insertInto(table(collection))
        .values(row)
        .onConflict(oc => oc.column('id').doNothing())
        .returningAll()
        .executeTakeFirst()
      if (!inserted) throw new StorageConflictError('ALREADY_EXISTS')
      return record<T>(inserted)
    },
    async replace<T>(collection: Collection, id: string, revision: number, value: T) {
      validKey(id)
      if (!Number.isSafeInteger(revision) || revision < 1) throw new StorageConflictError('REVISION_CONFLICT')
      const updated = await query
        .updateTable(table(collection))
        .set({ revision: revision + 1, value: encode(value) })
        .where('id', '=', id)
        .where('revision', '=', revision)
        .returningAll()
        .executeTakeFirst()
      if (!updated) throw new StorageConflictError('REVISION_CONFLICT')
      return record<T>(updated)
    },
    async delete(collection, id, revision) {
      validKey(id)
      const result = await query
        .deleteFrom(table(collection))
        .where('id', '=', id)
        .where('revision', '=', revision)
        .executeTakeFirst()
      if (result.numDeletedRows !== 1n) throw new StorageConflictError('REVISION_CONFLICT')
    },
  }
}

export class DurableStorage implements StorageTransaction {
  readonly driver: StorageOptions['driver']
  readonly readonly: boolean
  /** Internal SQL boundary for repositories in this server-only package. */
  readonly database: Kysely<Database>
  private readonly pool?: Pool
  private readonly ownsPool: boolean
  constructor(options: StorageOptions) {
    this.driver = options.driver
    this.readonly = options.readonly ?? false
    this.ownsPool = options.driver === 'postgres' && !options.pool
    if (options.driver === 'sqlite') {
      const sqlite = new Sqlite(options.filename, { readonly: this.readonly, fileMustExist: this.readonly })
      sqlite.pragma('foreign_keys = ON')
      if (!this.readonly) sqlite.pragma('journal_mode = WAL')
      sqlite.pragma(`busy_timeout = ${Math.max(0, Math.min(30000, options.busyTimeout ?? 5000))}`)
      this.database = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) })
    } else {
      if (!options.pool && !options.connectionString) throw new Error('PostgreSQL requires connectionString or pool')
      this.pool =
        options.pool ?? new pg.Pool({ connectionString: options.connectionString, connectionTimeoutMillis: 10000 })
      // Existing callers retain ownership of their pool; Kysely still releases clients.
      const pool = this.ownsPool ? this.pool : { connect: () => this.pool!.connect(), end: async () => {} }
      this.database = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
    }
  }
  accountDatabase(db: DatabaseSession = this.database): DatabaseSession {
    return this.driver === 'postgres' ? db.withSchema('arcadia_auth') : db
  }
  encodeTime(time: number): Date | number {
    return this.driver === 'postgres' ? new Date(time) : time
  }
  async sqlTransaction<T>(action: (db: DatabaseSession) => Promise<T>, serializable = false): Promise<T> {
    if (this.readonly) throw new Error('READ_ONLY_STORAGE')
    if (this.driver === 'postgres')
      return this.database
        .transaction()
        .setIsolationLevel(serializable ? 'serializable' : 'read committed')
        .execute(action)
    // Reserve the sole writer before reading. The connection executor serializes callers.
    return this.database.connection().execute(async db => {
      await sql`BEGIN IMMEDIATE`.execute(db)
      try {
        const result = await action(db)
        await sql`COMMIT`.execute(db)
        return result
      } catch (error) {
        try {
          await sql`ROLLBACK`.execute(db)
        } catch {
          /* Preserve cause. */
        }
        throw error
      }
    })
  }
  async transaction<T>(action: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    try {
      return await this.sqlTransaction(db => action(documentStore(db, this.driver)), true)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && (error.code === '40001' || error.code === '40P01'))
        throw new StorageConflictError('REVISION_CONFLICT')
      throw error
    }
  }
  listAccounts(serverId: string, options: { limit: number; cursor?: string }) {
    return documentStore(this.database, this.driver).listAccounts(serverId, options)
  }
  accountDetails(serverId: string, accountId: string) {
    return documentStore(this.database, this.driver).accountDetails(serverId, accountId)
  }
  deactivateAccount(serverId: string, accountId: string) {
    return this.transaction(tx => tx.deactivateAccount(serverId, accountId))
  }
  accountStatus(serverId: string, accountId: string) {
    return documentStore(this.database, this.driver).accountStatus(serverId, accountId)
  }
  get<T>(collection: Collection, id: string) {
    return documentStore(this.database, this.driver).get<T>(collection, id)
  }
  list<T>(collection: Collection, scope?: string) {
    return documentStore(this.database, this.driver).list<T>(collection, scope)
  }
  create<T>(collection: Collection, value: { id: string; scope: string; value: T }) {
    return this.transaction(tx => tx.create(collection, value))
  }
  replace<T>(collection: Collection, id: string, revision: number, value: T) {
    return this.transaction(tx => tx.replace(collection, id, revision, value))
  }
  delete(collection: Collection, id: string, revision: number) {
    return this.transaction(tx => tx.delete(collection, id, revision))
  }
  private migrator() {
    const driver = this.driver
    return new Migrator({
      db: this.database,
      ...(driver === 'postgres' ? { migrationTableSchema: 'public' } : {}),
      provider: {
        getMigrations: async () => ({
          [schemaVersion]: {
            up: async (db: Kysely<unknown>) => {
              const schema = driver === 'postgres' ? db.schema.withSchema('public') : db.schema
              for (const name of versionOneTables) {
                await schema
                  .createTable(name)
                  .addColumn('id', 'text', c => c.primaryKey().notNull())
                  .addColumn('scope', 'text', c => c.notNull())
                  .addColumn('revision', 'integer', c => c.notNull())
                  .addColumn('value', 'text', c => c.notNull())
                  .execute()
                await schema.createIndex(`${name}_scope`).on(name).column('scope').execute()
              }
              if (driver === 'sqlite') {
                await db.schema
                  .createTable('accounts')
                  .addColumn('server_id', 'text', c => c.notNull())
                  .addColumn('account_id', 'text', c => c.notNull())
                  .addColumn('status', 'text', c => c.notNull().defaultTo('active'))
                  .addColumn('created_at', 'integer', c => c.notNull())
                  .addColumn('deactivated_at', 'integer')
                  .addPrimaryKeyConstraint('accounts_pk', ['server_id', 'account_id'])
                  .addCheckConstraint('account_status', sql`status IN ('active', 'deactivated')`)
                  .addCheckConstraint('account_server_length', sql`length(server_id) BETWEEN 1 AND 128`)
                  .execute()
                await db.schema
                  .createTable('external_identities')
                  .addColumn('server_id', 'text', c => c.notNull())
                  .addColumn('provider_id', 'text', c => c.notNull())
                  .addColumn('issuer', 'text', c => c.notNull())
                  .addColumn('subject', 'text', c => c.notNull())
                  .addColumn('account_id', 'text', c => c.notNull())
                  .addColumn('verified_at', 'integer', c => c.notNull())
                  .addColumn('linked_at', 'integer', c => c.notNull())
                  .addPrimaryKeyConstraint('identity_pk', ['server_id', 'provider_id', 'issuer', 'subject'])
                  .addCheckConstraint('identity_provider_length', sql`length(provider_id) BETWEEN 1 AND 64`)
                  .addCheckConstraint('identity_issuer_length', sql`length(issuer) BETWEEN 1 AND 512`)
                  .addCheckConstraint('identity_subject_length', sql`length(subject) BETWEEN 1 AND 512`)
                  .addForeignKeyConstraint(
                    'identity_account',
                    ['server_id', 'account_id'],
                    'accounts',
                    ['server_id', 'account_id'],
                    c => c.onDelete('restrict'),
                  )
                  .execute()
                await db.schema
                  .createIndex('identity_account_idx')
                  .on('external_identities')
                  .columns(['server_id', 'account_id'])
                  .execute()
              }
            },
          },
        }),
      },
    })
  }
  async migrate(): Promise<void> {
    if (this.readonly) throw new Error('READ_ONLY_STORAGE')
    // Validate the deployed G3 schema before recording a migration baseline.
    if (this.pool) await ensureAccountSchema(this.pool)
    const result = await this.migrator().migrateToLatest()
    if (result.error) throw result.error
    await this.checkSchema()
  }
  /** Reads metadata only; startup never creates migration tables. */
  async schemaStatus(): Promise<'empty' | 'ready' | 'migration-required'> {
    const tables = await this.database.introspection.getTables({ withInternalKyselyTables: true })
    if (tables.length === 0) return 'empty'
    if (
      !tables.some(
        table => table.name === 'kysely_migration' && (this.driver === 'sqlite' || table.schema === 'public'),
      )
    )
      return 'migration-required'
    const migrations = await sql<{
      name: string
    }>`SELECT name FROM ${sql.table(this.driver === 'postgres' ? 'public.kysely_migration' : 'kysely_migration')}`.execute(
      this.database,
    )
    return migrations.rows.length === 1 && migrations.rows[0]?.name === schemaVersion ? 'ready' : 'migration-required'
  }
  async checkSchema(): Promise<void> {
    const tableInfo = await this.database.introspection.getTables({ withInternalKyselyTables: true })
    if (
      tableInfo.some(
        table => table.name === 'kysely_migration' && (this.driver === 'sqlite' || table.schema === 'public'),
      )
    ) {
      const migrations = await sql<{
        name: string
      }>`SELECT name FROM ${sql.table(this.driver === 'postgres' ? 'public.kysely_migration' : 'kysely_migration')}`.execute(
        this.database,
      )
      if (migrations.rows.some(m => m.name !== schemaVersion)) throw new Error('STORAGE_SCHEMA_TOO_NEW')
    }
    if ((await this.schemaStatus()) !== 'ready') throw new Error('STORAGE_MIGRATION_REQUIRED')
    for (const collection of collections) {
      const metadata = tableInfo.find(
        entry => entry.name === table(collection) && (this.driver === 'sqlite' || entry.schema === 'public'),
      )
      if (!metadata || metadata.isView) throw new Error('STORAGE_SCHEMA_INVALID')
      for (const name of ['id', 'scope', 'revision', 'value']) {
        const column = metadata.columns.find(entry => entry.name === name)
        const expected = name === 'revision' ? (this.driver === 'postgres' ? 'int4' : 'integer') : 'text'
        if (!column || column.isNullable || column.dataType.toLowerCase() !== expected)
          throw new Error('STORAGE_SCHEMA_INVALID')
      }
    }
    if (this.pool) await validateAccountSchema(this.pool)
    else {
      const expected: Record<string, Record<string, string>> = {
        accounts: {
          server_id: 'TEXT',
          account_id: 'TEXT',
          status: 'TEXT',
          created_at: 'INTEGER',
          deactivated_at: 'INTEGER',
        },
        external_identities: {
          server_id: 'TEXT',
          provider_id: 'TEXT',
          issuer: 'TEXT',
          subject: 'TEXT',
          account_id: 'TEXT',
          verified_at: 'INTEGER',
          linked_at: 'INTEGER',
        },
      }
      for (const [name, columns] of Object.entries(expected)) {
        const info = await sql<{
          name: string
          type: string
          notnull: number
          pk: number
        }>`PRAGMA table_info(${sql.raw(name)})`.execute(this.database)
        for (const [column, type] of Object.entries(columns)) {
          const found = info.rows.find(row => row.name === column)
          if (!found || found.type.toUpperCase() !== type || (column !== 'deactivated_at' && found.notnull !== 1))
            throw new Error('STORAGE_SCHEMA_INVALID')
        }
        const primary = info.rows
          .filter(row => row.pk > 0)
          .sort((a, b) => a.pk - b.pk)
          .map(row => row.name)
          .join(',')
        if (primary !== (name === 'accounts' ? 'server_id,account_id' : 'server_id,provider_id,issuer,subject'))
          throw new Error('STORAGE_SCHEMA_INVALID')
      }
      const foreign = await sql<{
        id: number
        seq: number
        table: string
        from: string
        to: string
        on_delete: string
      }>`PRAGMA foreign_key_list(external_identities)`.execute(this.database)
      const accountForeign = foreign.rows.filter(row => row.table === 'accounts').sort((a, b) => a.seq - b.seq)
      if (
        accountForeign.length !== 2 ||
        accountForeign[0]?.id !== accountForeign[1]?.id ||
        accountForeign.map(row => `${row.from}:${row.to}:${row.on_delete}`).join(',') !==
          'server_id:server_id:RESTRICT,account_id:account_id:RESTRICT'
      )
        throw new Error('STORAGE_SCHEMA_INVALID')
      const definitions = await sql<{
        name: string
        sql: string
      }>`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('accounts', 'external_identities')`.execute(
        this.database,
      )
      const requiredChecks: Record<string, string[]> = {
        accounts: ["check(statusin('active','deactivated'))", 'check(length(server_id)between1and128)'],
        external_identities: [
          'check(length(provider_id)between1and64)',
          'check(length(issuer)between1and512)',
          'check(length(subject)between1and512)',
        ],
      }
      for (const [name, checks] of Object.entries(requiredChecks)) {
        const definition =
          definitions.rows
            .find(row => row.name === name)
            ?.sql.toLowerCase()
            .replace(/\s|"/g, '') ?? ''
        if (checks.some(check => !definition.includes(check))) throw new Error('STORAGE_SCHEMA_INVALID')
      }
      const violations = await sql`PRAGMA foreign_key_check`.execute(this.database)
      if (violations.rows.length) throw new Error('STORAGE_SCHEMA_INVALID')
    }
  }
  /** Resolve an existing server identity when initializing a new local data directory. */
  async knownServerIds(): Promise<string[]> {
    const accounts = await this.accountDatabase()
      .selectFrom('accounts')
      .select('server_id')
      .distinct()
      .limit(1001)
      .execute()
    const documents = (this.driver === 'postgres' ? this.database.withSchema('public') : this.database) as Kysely<
      Record<string, DocumentRow>
    >
    const servers = await documents.selectFrom(table('servers')).select('id').limit(1001).execute()
    return [...new Set([...accounts.map(row => row.server_id), ...servers.map(row => row.id)])].sort()
  }
  async exportSnapshot(): Promise<StorageSnapshot> {
    return this.sqlTransaction(async db => {
      const records = {} as Record<Collection, StoredRecord[]>
      for (const collection of collections) records[collection] = await documentStore(db, this.driver).list(collection)
      const accountDb = this.accountDatabase(db)
      const asTime = (value: Date | string | number | null) =>
        value === null ? null : typeof value === 'number' ? value : new Date(value).getTime()
      const accounts = (
        await accountDb.selectFrom('accounts').selectAll().orderBy('server_id').orderBy('account_id').execute()
      ).map(row => ({ ...row, created_at: asTime(row.created_at)!, deactivated_at: asTime(row.deactivated_at) }))
      const identities = (
        await accountDb
          .selectFrom('external_identities')
          .selectAll()
          .orderBy('server_id')
          .orderBy('provider_id')
          .orderBy('issuer')
          .orderBy('subject')
          .execute()
      ).map(row => ({ ...row, verified_at: asTime(row.verified_at)!, linked_at: asTime(row.linked_at)! }))
      return { formatVersion: 1, schemaVersion: 1, records, accounts, identities }
    }, true)
  }
  async importSnapshot(snapshot: StorageSnapshot): Promise<void> {
    if (
      !snapshot ||
      snapshot.formatVersion !== 1 ||
      snapshot.schemaVersion !== 1 ||
      !Array.isArray(snapshot.accounts) ||
      !Array.isArray(snapshot.identities)
    )
      throw new Error('INVALID_STORAGE_SNAPSHOT')
    await this.sqlTransaction(async db => {
      const store = documentStore(db, this.driver),
        accountDb = this.accountDatabase(db)
      for (const collection of collections) {
        if (!Array.isArray(snapshot.records?.[collection])) throw new Error('INVALID_STORAGE_SNAPSHOT')
        if ((await store.list(collection)).length) throw new Error('IMPORT_TARGET_NOT_EMPTY')
      }
      if (await accountDb.selectFrom('accounts').select('account_id').executeTakeFirst())
        throw new Error('IMPORT_TARGET_NOT_EMPTY')
      const query = (this.driver === 'postgres' ? db.withSchema('public') : db) as Kysely<Record<string, DocumentRow>>
      for (const collection of collections)
        for (const row of snapshot.records[collection]) {
          validKey(row.id)
          validKey(row.scope)
          if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('INVALID_STORAGE_SNAPSHOT')
          await query
            .insertInto(table(collection))
            .values({ id: row.id, scope: row.scope, revision: row.revision, value: encode(row.value) })
            .execute()
        }
      for (const row of snapshot.accounts) {
        snapshotText(row.server_id, 128)
        snapshotUuid(row.account_id)
        snapshotTime(row.created_at)
        if (row.deactivated_at !== null) snapshotTime(row.deactivated_at)
        if (row.status !== 'active' && row.status !== 'deactivated') throw new Error('INVALID_STORAGE_SNAPSHOT')
        if (
          typeof row.created_at !== 'number' ||
          (row.deactivated_at !== null && typeof row.deactivated_at !== 'number')
        )
          throw new Error('INVALID_STORAGE_SNAPSHOT')
        await accountDb
          .insertInto('accounts')
          .values({
            ...row,
            created_at: this.encodeTime(row.created_at),
            deactivated_at: row.deactivated_at === null ? null : this.encodeTime(row.deactivated_at),
          })
          .execute()
      }
      for (const row of snapshot.identities) {
        snapshotText(row.server_id, 128)
        snapshotUuid(row.account_id)
        snapshotText(row.provider_id, 64)
        snapshotText(row.issuer, 512)
        snapshotText(row.subject, 512)
        snapshotTime(row.verified_at)
        snapshotTime(row.linked_at)
        if (typeof row.verified_at !== 'number' || typeof row.linked_at !== 'number')
          throw new Error('INVALID_STORAGE_SNAPSHOT')
        await accountDb
          .insertInto('external_identities')
          .values({ ...row, verified_at: this.encodeTime(row.verified_at), linked_at: this.encodeTime(row.linked_at) })
          .execute()
      }
    }, true)
  }
  async close() {
    await this.database.destroy()
  }
}
export function openStorage(options: StorageOptions): DurableStorage {
  return new DurableStorage(options)
}

function snapshotText(value: unknown, maximum: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !value.trim() || /\p{Cc}/u.test(value))
    throw new Error('INVALID_STORAGE_SNAPSHOT')
}
function snapshotUuid(value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error('INVALID_STORAGE_SNAPSHOT')
}
function snapshotTime(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 8.64e15)
    throw new Error('INVALID_STORAGE_SNAPSHOT')
}

function accountSummary(row: AccountRow): AccountSummary {
  const time = (value: Date | number | string) => (typeof value === 'number' ? value : new Date(value).getTime())
  return {
    accountId: row.account_id,
    status: row.status,
    createdAt: time(row.created_at),
    deactivatedAt: row.deactivated_at === null ? null : time(row.deactivated_at),
  }
}
/** Shared internal mutation for player-account and administration commands. */
export async function deactivateAccountRow(
  db: DatabaseSession,
  driver: StorageOptions['driver'],
  serverId: string,
  accountId: string,
): Promise<boolean> {
  validKey(serverId)
  snapshotUuid(accountId)
  const accounts = driver === 'postgres' ? db.withSchema('arcadia_auth') : db
  const now = Date.now()
  const changed = await accounts
    .updateTable('accounts')
    .set({ status: 'deactivated', deactivated_at: driver === 'postgres' ? new Date(now) : now })
    .where('server_id', '=', serverId)
    .where('account_id', '=', accountId)
    .where('status', '=', 'active')
    .returning('account_id')
    .executeTakeFirst()
  if (changed) return true
  return !!(await accounts
    .selectFrom('accounts')
    .select('account_id')
    .where('server_id', '=', serverId)
    .where('account_id', '=', accountId)
    .executeTakeFirst())
}

/** A dedicated file lock, independent from business DB transactions; released by the OS on process death. */
export function acquireStorageOwner(
  filename: string,
  mode: 'server' | 'maintenance' | 'shared' = 'server',
): { close(): void } {
  const lease = new Sqlite(filename, { timeout: 0, fileMustExist: mode === 'shared' })
  try {
    if (mode !== 'shared') lease.exec('CREATE TABLE IF NOT EXISTS owner_lease (id INTEGER PRIMARY KEY)')
    lease.exec(mode === 'shared' ? 'BEGIN' : mode === 'maintenance' ? 'BEGIN EXCLUSIVE' : 'BEGIN IMMEDIATE')
    if (mode === 'shared') lease.prepare('SELECT id FROM owner_lease LIMIT 1').get()
  } catch (error) {
    lease.close()
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED')
    )
      throw new Error('SERVER_DATA_DIRECTORY_IN_USE', { cause: error })
    throw error
  }
  let closed = false
  return {
    close() {
      if (closed) return
      closed = true
      lease.close()
    },
  }
}
