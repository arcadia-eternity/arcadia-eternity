import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import {
  collections,
  openStorage,
  type DurableStorage,
  type StorageSnapshot,
  type StoredRecord,
} from '@arcadia-eternity/database'
import {
  ContentWorkspace,
  type StaticPreparer,
  type WorkspaceSnapshot,
} from '@arcadia-eternity/content-sdk/management-workspace'

export interface ServerBackup {
  format: 'arcadia.server-backup/1'
  schemaVersion: 1
  createdAt: number
  serverId: string
  workspace: WorkspaceSnapshot
  storage: StorageSnapshot
}
export interface BackupSummary {
  serverId: string
  workspaceId: string
  servers: number
  environments: number
  installations: number
  accounts: number
  materialBytes: number
}
export class ServerBackupError extends Error {
  constructor(
    readonly code: string,
    readonly recoveryDirectory?: string,
  ) {
    super(recoveryDirectory ? code + ': ' + recoveryDirectory : code)
    this.name = 'ServerBackupError'
  }
}
const fail = (code: string): never => {
  throw new ServerBackupError(code)
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SERVER_BACKUP')
  return value as Record<string, unknown>
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 512 || /\p{Cc}/u.test(value))
    fail('INVALID_SERVER_BACKUP')
  return value as string
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) fail('INVALID_SERVER_BACKUP')
  return value as unknown[]
}
function uniqueRecords(value: unknown): Map<string, StoredRecord> {
  const result = new Map<string, StoredRecord>()
  for (const candidate of array(value)) {
    const row = object(candidate),
      id = string(row.id)
    string(row.scope)
    if (result.has(id) || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1) fail('INVALID_SERVER_BACKUP')
    object(row.value)
    result.set(id, candidate as StoredRecord)
  }
  return result
}

/** Pure preflight. Domain references are validated before any target writes. */
export function inspectServerBackup(value: unknown): BackupSummary {
  const backup = object(value)
  if (
    backup.format !== 'arcadia.server-backup/1' ||
    backup.schemaVersion !== 1 ||
    !Number.isSafeInteger(backup.createdAt)
  )
    fail('UNSUPPORTED_SERVER_BACKUP')
  const serverId = string(backup.serverId),
    workspace = object(backup.workspace),
    storage = object(backup.storage)
  if (workspace.format !== 'arcadia.workspace-snapshot/2' || storage.formatVersion !== 1 || storage.schemaVersion !== 1)
    fail('UNSUPPORTED_SERVER_BACKUP')
  const workspaceId = string(workspace.workspaceId),
    records = object(storage.records)
  const maps = Object.fromEntries(collections.map(name => [name, uniqueRecords(records[name])])) as Record<
    (typeof collections)[number],
    Map<string, StoredRecord>
  >
  const serverIds = new Set(maps.servers.keys())
  if (!serverIds.has(serverId)) fail('BACKUP_SERVER_NOT_FOUND')
  for (const [id, row] of maps.servers) {
    if (row.scope !== 'server:' + id || object(row.value).workspaceId !== workspaceId) fail('BACKUP_WORKSPACE_MISMATCH')
  }
  const drafts = new Set<string>()
  for (const value of array(workspace.drafts)) {
    const draft = object(value),
      id = string(object(draft.document).id)
    if (drafts.has(id)) fail('INVALID_SERVER_BACKUP')
    string(draft.revision)
    drafts.add(id)
  }
  const installations = new Map<string, string>()
  let materialBytes = 0,
    materialFiles = 0
  for (const entryValue of array(workspace.installations)) {
    const entry = object(entryValue),
      version = object(entry.version),
      id = string(version.installationId)
    const environmentId = string(version.environmentId)
    if (installations.has(id) || !drafts.has(environmentId) || object(version.document).id !== environmentId)
      fail('BACKUP_ENVIRONMENT_REFERENCE_INVALID')
    string(version.contentRevision)
    string(version.draftRevision)
    if (!Number.isSafeInteger(version.createdAt)) fail('INVALID_SERVER_BACKUP')
    installations.set(id, environmentId)
  }
  const materialSets = [
    ...array(workspace.installations).map(entry => ({ files: object(entry).files, lockRequired: true })),
    ...array(workspace.drafts)
      .filter(draft => !installations.has(string(object(object(draft).document).id)))
      .map(draft => ({ files: object(draft).files, lockRequired: false })),
  ]
  for (const entry of materialSets) {
    const paths = new Set<string>()
    for (const fileValue of array(entry.files)) {
      const file = object(fileValue),
        path = string(file.path),
        data = file.data
      if (
        path.startsWith('/') ||
        /^[a-z]:/i.test(path) ||
        path.includes('\\') ||
        !['package.json', 'package-lock.json', 'node_modules', 'candidates'].includes(path.split('/')[0]!) ||
        path
          .split('/')
          .some(part => !part || ['.', '..', '.git', '.env', '.npmrc', '.arcadia', '.bin'].includes(part)) ||
        paths.has(path.toLowerCase())
      )
        fail('BACKUP_MATERIAL_PATH_INVALID')
      if (typeof data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
        fail('BACKUP_MATERIAL_INVALID')
      paths.add(path.toLowerCase())
      materialBytes += Buffer.byteLength(data as string, 'base64')
      materialFiles++
      if (materialBytes > 1024 * 1024 * 1024 || materialFiles > 100000) fail('BACKUP_SIZE_LIMIT')
    }
    if (!paths.has('package.json') || (entry.lockRequired && !paths.has('package-lock.json')))
      fail('BACKUP_MATERIAL_INCOMPLETE')
  }
  for (const row of maps.bindings.values()) {
    const binding = object(row.value),
      bindingServer = string(binding.serverId)
    if (!serverIds.has(bindingServer) || row.scope !== 'server:' + bindingServer || binding.workspaceId !== workspaceId)
      fail('BACKUP_BINDING_REFERENCE_INVALID')
    const environmentId = string(binding.environmentId)
    if (!drafts.has(environmentId)) fail('BACKUP_ENVIRONMENT_REFERENCE_INVALID')
  }
  for (const [id, row] of maps.servers) {
    const defaultId = object(row.value).defaultBindingId
    if (defaultId !== undefined) {
      const binding = maps.bindings.get(string(defaultId))
      if (!binding || object(binding.value).serverId !== id) fail('BACKUP_DEFAULT_BINDING_INVALID')
    }
  }
  const accounts = new Set<string>()
  for (const accountValue of array(storage.accounts)) {
    const account = object(accountValue),
      server = string(account.server_id),
      id = string(account.account_id)
    if (
      !serverIds.has(server) ||
      accounts.has(server + ':' + id) ||
      !['active', 'deactivated'].includes(string(account.status))
    )
      fail('BACKUP_ACCOUNT_REFERENCE_INVALID')
    accounts.add(server + ':' + id)
  }
  const identities = new Set<string>()
  for (const identityValue of array(storage.identities)) {
    const identity = object(identityValue)
    const key = JSON.stringify(['server_id', 'provider_id', 'issuer', 'subject'].map(name => string(identity[name])))
    if (identities.has(key) || !accounts.has(string(identity.server_id) + ':' + string(identity.account_id)))
      fail('BACKUP_IDENTITY_REFERENCE_INVALID')
    identities.add(key)
  }
  const validScope = (scope: unknown) =>
    scope === 'workspace:' + workspaceId ||
    (typeof scope === 'string' && scope.startsWith('server:') && serverIds.has(scope.slice(7)))
  for (const row of maps.principals.values()) {
    const principal = object(row.value)
    if (
      principal.accountId !== undefined &&
      !accounts.has(string(principal.serverId) + ':' + string(principal.accountId))
    )
      fail('BACKUP_PRINCIPAL_REFERENCE_INVALID')
  }
  for (const row of maps.grants.values()) {
    const grant = object(row.value),
      scope = object(grant.scope)
    if (
      !maps.principals.has(string(grant.principalId)) ||
      !validScope(string(scope.kind) + ':' + string(scope.id)) ||
      row.scope !== string(scope.kind) + ':' + string(scope.id)
    )
      fail('BACKUP_GRANT_REFERENCE_INVALID')
  }
  for (const row of maps.retentions.values()) {
    if (row.scope !== 'workspace:' + workspaceId || !installations.has(string(object(row.value).installationId)))
      fail('BACKUP_RETENTION_REFERENCE_INVALID')
  }
  // Backups never grant old bearer sessions or one-time codes a second life.
  if (maps.sessions.size || maps.credentials.size) fail('BACKUP_CONTAINS_RUNTIME_CREDENTIALS')
  return {
    serverId,
    workspaceId,
    servers: serverIds.size,
    environments: drafts.size,
    installations: installations.size,
    accounts: accounts.size,
    materialBytes,
  }
}

function withoutRuntime(snapshot: StorageSnapshot): StorageSnapshot {
  const result = structuredClone(snapshot)
  result.records.credentials = []
  result.records.sessions = []
  result.records.environmentVersions = [] // Environment metadata belongs to the npm projects.
  result.records.operations = result.records.operations.map(row => {
    const value = object(row.value)
    return {
      ...row,
      value: {
        ...value,
        bootId: '',
        ...(['queued', 'running'].includes(string(value.status))
          ? {
              status: 'interrupted',
              cancelRequested: true,
              error: {
                code: 'SERVER_RESTORED',
                message: 'Server restored; reauthorize and retry the operation.',
                retryable: true,
              },
            }
          : {}),
      },
    }
  })
  result.records.retentions = result.records.retentions.filter(
    row => !string(object(row.value).retentionId).includes(':candidate:'),
  )
  result.records.bindings = result.records.bindings.map(row => ({
    ...row,
    value: { ...object(row.value), condition: 'unavailable', reason: 'SERVER_RESTORED', observedBootId: '' },
  }))
  return result
}

/** Caller must hold a real maintenance exclusion, or own the stopped server workspace. */
export async function createServerBackup(input: {
  storage: DurableStorage
  workspace: ContentWorkspace
  serverId: string
  maintenance: <T>(work: () => Promise<T>) => Promise<T>
}): Promise<ServerBackup> {
  return input.maintenance(async () => {
    const storage = withoutRuntime(await input.storage.exportSnapshot())
    const workspace = await input.workspace.exportSnapshot()
    const result: ServerBackup = {
      format: 'arcadia.server-backup/1',
      schemaVersion: 1,
      createdAt: Date.now(),
      serverId: input.serverId,
      workspace,
      storage,
    }
    inspectServerBackup(result)
    return result
  })
}

export interface OnlineBackupWorkspace {
  captureSnapshot(): ReturnType<ContentWorkspace['captureSnapshot']>
  isSnapshotCurrent(stamp: Parameters<ContentWorkspace['isSnapshotCurrent']>[0]): Promise<boolean>
}

/**
 * Files are copied under the sole owner's mutex, then the database captures one
 * atomic instant. A same-owner, unchanged workspace stamp brackets that instant.
 * No database transaction is held while copying files or communicating over IPC.
 */
export async function createOnlineServerBackup(input: {
  storage: Pick<DurableStorage, 'exportSnapshot'>
  workspace: OnlineBackupWorkspace
  serverId: string
  signal?: AbortSignal
  maxAttempts?: number
  onAttempt?: (attempt: number) => void | Promise<void>
}): Promise<ServerBackup> {
  const attempts = input.maxAttempts ?? 3
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10)
    throw new ServerBackupError('INVALID_BACKUP_ATTEMPTS')
  for (let attempt = 1; attempt <= attempts; attempt++) {
    input.signal?.throwIfAborted()
    await input.onAttempt?.(attempt)
    let capture: Awaited<ReturnType<ContentWorkspace['captureSnapshot']>>
    try {
      capture = await input.workspace.captureSnapshot()
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (typeof code === 'string' && ['WORKSPACE_SNAPSHOT_UNSETTLED', 'MATERIAL_SOURCE_CHANGED'].includes(code))
        continue
      throw error
    }
    let storage: StorageSnapshot
    let current: boolean
    try {
      input.signal?.throwIfAborted()
      storage = withoutRuntime(await input.storage.exportSnapshot())
    } finally {
      // Always consume the private observations, including DB/cancellation failure.
      current = await input.workspace.isSnapshotCurrent(capture.stamp)
    }
    input.signal?.throwIfAborted()
    if (!current) continue
    const backup: ServerBackup = {
      format: 'arcadia.server-backup/1',
      schemaVersion: 1,
      createdAt: Date.now(),
      serverId: input.serverId,
      workspace: capture.snapshot,
      storage,
    }
    inspectServerBackup(backup)
    return backup
  }
  throw new ServerBackupError('BACKUP_BUSY')
}

function cloneStorage(snapshot: StorageSnapshot, workspaceId: string) {
  const result = withoutRuntime(snapshot)
  const servers = new Map(result.records.servers.map(row => [row.id, randomUUID()]))
  const bindings = new Map(result.records.bindings.map(row => [row.id, randomUUID()]))
  for (const collection of ['accounts', 'identities'] as const) result[collection] = []
  for (const collection of [
    'principals',
    'grants',
    'credentials',
    'sessions',
    'operations',
    'audit',
    'retentions',
    'environmentVersions',
  ] as const)
    result.records[collection] = []
  result.records.servers = result.records.servers.map(row => {
    const value = object(row.value)
    const initialization =
      value.initialization && typeof value.initialization === 'object' && !Array.isArray(value.initialization)
        ? object(value.initialization)
        : undefined
    return {
      id: servers.get(row.id)!,
      scope: 'server:' + servers.get(row.id),
      revision: 1,
      value: {
        ...value,
        workspaceId,
        ...(value.defaultBindingId ? { defaultBindingId: bindings.get(string(value.defaultBindingId)) } : {}),
        ...(initialization
          ? {
              // A clone must not resume a source host's interrupted bootstrap.
              initialization: {
                ...initialization,
                state: 'abandoned',
                ...(initialization.bindingId ? { bindingId: bindings.get(string(initialization.bindingId)) } : {}),
              },
            }
          : {}),
      },
    }
  })
  result.records.bindings = result.records.bindings.map(row => {
    const value = object(row.value),
      id = bindings.get(row.id)!
    const binding = {
      ...value,
      workspaceId,
      serverId: servers.get(string(value.serverId)),
    }
    const retentionId = 'binding:' + id
    result.records.retentions.push({
      id: 'workspace:' + workspaceId + ':' + retentionId,
      scope: 'workspace:' + workspaceId,
      revision: 1,
      value: { installationId: value.environmentId, retentionId },
    })
    return { id, scope: 'server:' + binding.serverId, revision: 1, value: binding }
  })
  return { storage: result, serverIds: servers }
}

export interface RestoreServerInput {
  backup: unknown
  targetDirectory: string
  mode: 'restore' | 'clone'
  postgres?: { connectionString: string }
  preparer: StaticPreparer
}
export interface RestoreServerResult {
  directory: string
  serverId: string
  workspaceId: string
  storageDriver: 'sqlite' | 'postgres'
}

/** Restores into an inactive sibling directory and publishes only a complete result. */
export async function restoreServerBackup(input: RestoreServerInput): Promise<RestoreServerResult> {
  const summary = inspectServerBackup(input.backup)
  if (!['restore', 'clone'].includes(input.mode)) fail('INVALID_RESTORE_MODE')
  const backup = input.backup as ServerBackup
  const target = resolve(input.targetDirectory)
  try {
    await lstat(target)
    fail('RESTORE_TARGET_EXISTS')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(dirname(target), '.' + basename(target) + '-restore-'))
  let workspace: ContentWorkspace | undefined, storage: DurableStorage | undefined
  let importedPostgres = false,
    published = false
  try {
    workspace = await ContentWorkspace.open(join(staging, 'workspace'), { retentions: { list: async () => [] } })
    const restored = await workspace.restoreSnapshot(backup.workspace, { mode: input.mode }, input.preparer)
    const clone = input.mode === 'clone' ? cloneStorage(backup.storage, restored.workspaceId) : undefined
    const snapshot = clone?.storage ?? withoutRuntime(backup.storage)
    const serverId = clone?.serverIds.get(summary.serverId) ?? summary.serverId
    const readyWorkspace = await workspace.exportSnapshot()
    inspectServerBackup({ ...backup, serverId, workspace: readyWorkspace, storage: snapshot })
    await workspace.close()
    workspace = undefined
    await writeFile(join(staging, 'identity.json'), JSON.stringify({ schemaVersion: 1, serverId }) + '\n', {
      mode: 0o600,
      flag: 'wx',
    })
    const marker = join(staging, 'restore-intent.json')
    await writeFile(
      marker,
      JSON.stringify({
        format: 'arcadia.restore-intent/1',
        serverId,
        workspaceId: restored.workspaceId,
        phase: 'files-ready',
        target,
        storageDriver: input.postgres ? 'postgres' : 'sqlite',
      }) + '\n',
      { mode: 0o600, flag: 'wx' },
    )
    storage = openStorage(
      input.postgres
        ? { driver: 'postgres', connectionString: input.postgres.connectionString }
        : { driver: 'sqlite', filename: join(staging, 'server.sqlite') },
    )
    if ((await storage.schemaStatus()) === 'empty') await storage.migrate()
    else await storage.checkSchema()
    await storage.importSnapshot(snapshot)
    importedPostgres = !!input.postgres
    await storage.close()
    storage = undefined
    await writeFile(
      marker,
      JSON.stringify({
        format: 'arcadia.restore-intent/1',
        serverId,
        workspaceId: restored.workspaceId,
        phase: 'database-imported',
        target,
        storageDriver: input.postgres ? 'postgres' : 'sqlite',
      }) + '\n',
      { mode: 0o600 },
    )
    // A concurrent operator must never lose an existing deployment.
    try {
      await lstat(target)
      fail('RESTORE_TARGET_EXISTS')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(staging, target)
    published = true
    await rm(join(target, 'restore-intent.json'))
    return {
      directory: target,
      serverId,
      workspaceId: restored.workspaceId,
      storageDriver: input.postgres ? 'postgres' : 'sqlite',
    }
  } catch (error) {
    if (published) throw new ServerBackupError('RESTORE_FINALIZATION_REQUIRED', target)
    if (importedPostgres && !published) throw new ServerBackupError('RESTORE_REQUIRES_RECOVERY', staging)
    throw error
  } finally {
    await workspace?.close()
    await storage?.close()
    if (!published && !importedPostgres) await rm(staging, { recursive: true, force: true })
  }
}
