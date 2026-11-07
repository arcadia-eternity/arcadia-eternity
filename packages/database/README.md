# Server persistence

This package is server-only. Both SQLite and PostgreSQL execute the same Kysely repositories. UI modules must depend on their own DTOs or the shared protocol, never this package.

```ts
const storage = openStorage({ driver: 'sqlite', filename: '/data/arcadia.sqlite' })
// Alternatively: { driver: 'postgres', connectionString: process.env.DATABASE_URL }
if ((await storage.schemaStatus()) === 'empty') await storage.migrate()
await storage.checkSchema()
const accounts = new SQLAccountDirectory(storage, serverId)
```

`schemaStatus` and `checkSchema` do not perform DDL. `readonly: true` opens existing SQLite files without changing their journal mode and rejects mutations. Server status uses a separate absent-file check, so inspection does not create directories or a database. Existing databases needing migration must be upgraded explicitly during maintenance. `migrate` validates the existing PostgreSQL `arcadia_auth` schema before recording its baseline; account IDs and verified identity keys remain unchanged. The compatibility `PgAccountDirectory(pool, serverId)` delegates to the same account implementation and does not own the caller's pool.

SQLite enables foreign keys, WAL and a bounded busy timeout. Write transactions reserve the sole writer with `BEGIN IMMEDIATE`; account ownership uses row locks on PostgreSQL. Management transactions use serializable PostgreSQL isolation and report serialization/deadlock contention as `REVISION_CONFLICT`. Callers must explicitly retry only operations whose entire callback is repeatable. Transaction callbacks must not download, send email, run author code, or perform other external side effects.

Management records use separate tables per collection, immutable IDs/scopes, revision-checked changes and transactionally recorded audit/retention entries. Server/default-binding, workspace/version and delegated-permission invariants belong to the management service and must be checked inside the same transaction as the change. SQL and connection objects are implementation details of server repositories and are not remotely exposed.

`exportSnapshot` captures a consistent versioned logical snapshot, including accounts and their verified identities. `importSnapshot` requires an empty destination and rolls back every row if validation or constraints fail. Higher-level server restore must validate all domain references, discard runtime sessions and one-time credentials, and protect the backup as sensitive account/administration data. Environment files and secrets are handled separately; changing the database URL does not migrate them. A raw logical snapshot is not a public environment share or a new-server clone.

The removed Supabase SDK, public-table repositories, cleanup scripts and ELO migration scripts are not used by current accounts. Historical SQL under `sql/` is retained for inspection/export planning only; do not apply it to the current schema or merge unverified legacy player rows into authenticated accounts.

Server lifecycle ownership uses a separate SQLite lease file, never the business database transaction. A running server holds a reserved lease, credential commands hold shared leases, and migration/backup require exclusive leases. Kernel file locks release on process death; no stale PID file needs unsafe deletion. Existing server identity is checked before migration. A new data directory adopts a sole pre-existing server/account namespace, while multiple namespaces require explicit selection.
