# Server backup, restore and clone

The server backup API is implemented in `bin/server-backup.ts`. It is distinct from an environment share or editable source-project export: a server backup contains private account and authorization records and the complete managed workspace.

## Consistent capture

`createServerBackup({ storage, workspace, serverId, maintenance })` captures a versioned database snapshot and the immutable workspace materials under the supplied maintenance exclusion. The CLI uses this **offline operation**: stop the server, acquire the workspace's sole-owner lock, and capture the backup. Running hosts use the separate `createOnlineServerBackup` protocol below; a no-op maintenance callback is not an online consistency mechanism.

The archive stores portable JSON and material bytes, not SQLite database files, live WAL files, PostgreSQL connection strings, or absolute source paths. SQLite and PostgreSQL use the same logical snapshot. The workspace's standard lock and static preparation validation remain authoritative for imported materials.

## Online capture

Running hosts use `createOnlineServerBackup({ storage, workspace, serverId, signal?, maxAttempts?, onAttempt? })`. This separate API does not require a pretend maintenance callback or hold a database transaction while copying files:

1. The sole workspace owner copies its environment documents and immutable material bytes under its mutation mutex, returning a one-use stamp containing workspace identity, owner boot identity, and a generation.
2. The database exports one atomic snapshot of accounts, configuration, bindings, grants, jobs, and retention records.
3. The same workspace owner checks and consumes the stamp. Every snapshot-affecting mutation invalidates the generation before its first awaited write, including failed partial imports and cleanup. Private bounded file/directory observations additionally detect out-of-band changes during capture.
4. If the stamp remains current, the copied workspace was unchanged across the database snapshot. Domain-reference validation and credential removal run before returning the archive. If the stamp changed, the attempt is discarded and retried, with a default limit of three and a hard maximum of ten. Continued changes return `BACKUP_BUSY`; no partial archive is returned.

Unresolved import commit receipts return an unsettled snapshot and eventually `BACKUP_BUSY` until the operation owner reconciles commit versus discard. They are never silently omitted from a successful archive. Cancellation and database errors still consume the private observations.

For client-hosted servers, both capture and stamp checking cross the existing private child/parent IPC connection to the sole desktop workspace owner. A trusted local edit therefore invalidates a snapshot requested by the server child. Author source edits do not change already captured immutable versions; retained, adopted package materials remain subject to the same owner and library reference protection.

The CLI host wires this callback to `ManagementBackups`. With the `server.backup` capability, `POST /api/management/v1/servers/:id/backup` creates an asynchronous operation and `GET /api/management/v1/backups/:operationId` retrieves its result. The shared management page exposes creation and manual download. Server `backup` and workspace `export` permissions are checked on creation, commit and retrieval; every server included in the archive must be authorized. Cancellation/retry use the existing operation contract. The snapshot API itself remains independent of HTTP authentication.

Private artifact files default to a 512 MiB limit and 24-hour expiry. Operation rows contain download metadata rather than the archive. Retrieval checks scope, integrity and expiry again; active retrieval is protected from cleanup. An uncertain database commit preserves the artifact for later authenticated lookup. Restore and clone remain host operations against an inactive, new target directory.

Before returning, capture validates server/workspace membership, default binding references, binding environment/version references, account/identity ownership, principal/grant scopes, and version retention references. A database containing another workspace is rejected rather than silently exporting unrelated data.

Runtime sessions and all bearer/bootstrap credentials are omitted. Queued/running operations become interrupted; observed bindings become unavailable until the restored process verifies them. Workspace version indexes are rebuilt from the exported immutable files. Accounts, grants, identity mappings, and stable server/workspace/version identifiers remain available for original-server recovery.

## Preflight and original-server recovery

`inspectServerBackup(archive)` performs a read-only structural/domain preflight and returns server, environment, version, account, and material-size counts. Full static content validation occurs during staged restore.

`restoreServerBackup({ backup, targetDirectory, mode: 'restore', preparer, postgres? })` requires a new target directory. It:

1. Validates the archive and domain references.
2. Creates an inactive sibling staging directory.
3. Restores every environment material and verifies its existing content revision with the trusted static preparer.
4. Restores workspace/version identity and writes the persistent server identity.
5. Imports the validated logical snapshot into an empty SQLite database in staging, or into the explicitly configured empty PostgreSQL target.
6. Closes database/workspace handles, then publishes the complete server directory.

Existing targets are refused. The source archive and source deployment are never deleted or changed. The target requires a new owner login code or another explicit authentication path; previous cookies and tokens do not become valid again. Active rooms, network seats, worker leases, and socket sessions do not resume.

SQLite restoration is published with its staged directory. PostgreSQL and filesystem changes cannot share one transaction: if the database import commits but directory publication fails, the operation returns `RESTORE_REQUIRES_RECOVERY` and a `recoveryDirectory`. That directory retains the complete prepared files and `restore-intent.json`. Do not retry an import into the now-populated database or delete it automatically; resolve the destination conflict and complete publication from the retained directory.

## Clone

Using `mode: 'clone'` produces a new server identity for every exported server, a new workspace identity, and new binding/version IDs. Default bindings and version references are remapped. It retains content and server configuration, but excludes player accounts, external identities, administrator principals/grants, credentials, sessions, operation history, and audit history. Binding retention roots are rebuilt for the cloned references. A host-issued login code initializes the new owner.

Environment-only sharing remains the appropriate operation when recipients should receive content without server configuration or private account data.

## Evidence

`bin/__tests__/server-backup.test.ts` exercises real SQLite and filesystem capture/recovery, identifier preservation, clone isolation, invalid-reference/path rejection, static material mismatch, and refusal to overwrite an existing target. Its material fixture is a small installed-project tree with a trusted static validator.

With `TEST_BACKUP_DATABASE_URL` pointing to an isolated PostgreSQL instance whose role can create disposable databases, two additional cases run: SQLite → PostgreSQL → SQLite identity/reference preservation, and PostgreSQL import followed by a final filesystem publication conflict. The latter proves that imported data and the recovery directory remain available while an existing target file is preserved. Each case creates and removes its own test database.

On 2026-11-05 the backup suite passed **14 cases** against real SQLite and an isolated PostgreSQL 17.11 instance. The online cases deliberately interleave actual preparation/publication, account/config/job writes, and material GC with capture, then verify retry and a consistent resulting archive. Continuous edits return bounded busy failures; cancellation consumes the stamp.

The workspace suite passed **20 cases**, including one-use/owner-scoped stamps, metadata and external material changes, and unresolved import recovery. The private desktop workspace transport suite passed **13 cases**, including a real parent-owner edit invalidating a child-requested capture. Strict TypeScript checking passed for the backup API.

The real paired production UI scenario in `packages/web-ui/e2e/management-backup.spec.ts` passed **1/1 in 13.6 seconds**: one-use owner login, credential metadata without secret persistence, token revocation, backup download/offline inspection, and restart with stable IDs and preserved download history. It used guest account mode; durable account preservation is covered separately by database backup tests. Browser errors and unexpected responses were empty. Full desktop release, real-provider and deployment fault acceptance remain separate; see [the validation record](validation/unified-management-2026-11-05.md).
