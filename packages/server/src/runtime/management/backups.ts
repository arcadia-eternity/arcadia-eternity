import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { DurableStorage, StorageTransaction } from '@arcadia-eternity/database'
import { ManagementAuth, managementScopeKey, type ManagementActor, type ManagementScope } from './auth'
import { OperationService, type Operation } from './operations'

export interface ManagementBackupsOptions {
  storage: DurableStorage
  auth: ManagementAuth
  operations: OperationService
  directory: string
  serverId: string
  workspaceId: string
  createServerBackup: (signal: AbortSignal) => Promise<unknown>
  maxBytes?: number
  ttlMs?: number
  now?: () => number
}
interface BackupDownloadResult {
  downloadPath: string
  filename: string
  bytes: number
  expiresAt: number
  sha256: string
}
class ManagementBackupError extends Error {
  constructor(
    readonly code: string,
    readonly status = 422,
  ) {
    super(code)
  }
}
const fail = (code: string, status = 422): never => {
  throw new ManagementBackupError(code, status)
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const validId = (id: string) => {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail('BACKUP_NOT_FOUND', 404)
  return id
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('BACKUP_ARTIFACT_INVALID', 409)
  return value as Record<string, unknown>
}

/** Sensitive archives live only in a private temporary artifact directory, never in operation rows. */
export class ManagementBackups {
  readonly serverScope: ManagementScope
  readonly workspaceScope: ManagementScope
  readonly maxBytes: number
  readonly ttlMs: number
  private readonly now: () => number
  private root: string
  private initializing?: Promise<void>
  private closed = false
  private readonly active = new Map<string, number>()
  private readonly locks = new Map<string, Promise<void>>()
  private readonly capturing = new Set<AbortController>()
  constructor(private readonly options: ManagementBackupsOptions) {
    this.serverScope = { kind: 'server', id: options.serverId }
    this.workspaceScope = { kind: 'workspace', id: options.workspaceId }
    this.root = resolve(options.directory, `backup-owner-${digest(options.operations.ownerId)}`)
    this.maxBytes = options.maxBytes ?? 512 * 1024 * 1024
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000
    this.now = options.now ?? Date.now
    if (
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1024 ||
      this.maxBytes > 512 * 1024 * 1024 ||
      !Number.isSafeInteger(this.ttlMs) ||
      this.ttlMs < 1000 ||
      this.ttlMs > 30 * 24 * 60 * 60 * 1000
    )
      fail('BACKUP_CONFIGURATION_INVALID')
  }
  async ready(): Promise<void> {
    if (this.closed) fail('MANAGEMENT_STOPPED', 503)
    this.initializing ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const info = await lstat(this.root)
      if (!info.isDirectory() || info.isSymbolicLink()) fail('BACKUP_DIRECTORY_UNSAFE')
      this.root = await realpath(this.root)
    })().catch(error => {
      this.initializing = undefined
      throw error
    })
    await this.initializing
  }
  private file(id: string) {
    return join(this.root, `backup-${validId(id)}.json`)
  }
  private pin(name: string) {
    this.active.set(name, (this.active.get(name) ?? 0) + 1)
    return () => {
      const count = (this.active.get(name) ?? 1) - 1
      if (count) this.active.set(name, count)
      else this.active.delete(name)
    }
  }
  private async exclusive<T>(name: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>(done => {
      release = done
    })
    this.locks.set(name, next)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.locks.get(name) === next) this.locks.delete(name)
    }
  }
  async authorize(
    actor: ManagementActor,
    serverIds: readonly string[] = [this.options.serverId],
    transaction?: StorageTransaction,
  ) {
    const check = async (tx: StorageTransaction) => {
      await this.options.auth.authorizeInTransaction(tx, actor, this.workspaceScope, 'export')
      for (const id of new Set([this.options.serverId, ...serverIds])) {
        await this.options.auth.authorizeInTransaction(tx, actor, { kind: 'server', id }, 'backup')
        const server = await tx.get<{ workspaceId: string }>('servers', id)
        if (!server || server.value.workspaceId !== this.options.workspaceId) fail('BACKUP_SCOPE_MISMATCH', 409)
      }
    }
    if (transaction) await check(transaction)
    else await this.options.storage.transaction(check)
  }
  private archiveServers(value: unknown): string[] {
    const archive = object(value),
      workspace = object(archive.workspace),
      storage = object(archive.storage)
    if (
      archive.format !== 'arcadia.server-backup/1' ||
      archive.schemaVersion !== 1 ||
      archive.serverId !== this.options.serverId ||
      workspace.workspaceId !== this.options.workspaceId
    )
      return fail('BACKUP_SCOPE_MISMATCH', 409)
    const records = object(storage.records)
    if (
      !Array.isArray(records.servers) ||
      !Array.isArray(records.credentials) ||
      records.credentials.length ||
      !Array.isArray(records.sessions) ||
      records.sessions.length
    )
      return fail('BACKUP_ARTIFACT_INVALID', 409)
    const ids = records.servers.map(value => {
      const server = object(value)
      if (
        typeof server.id !== 'string' ||
        server.scope !== `server:${server.id}` ||
        object(server.value).workspaceId !== this.options.workspaceId
      )
        return fail('BACKUP_SCOPE_MISMATCH', 409)
      return server.id
    })
    if (!ids.includes(this.options.serverId) || ids.length !== new Set(ids).size)
      return fail('BACKUP_SCOPE_MISMATCH', 409)
    return ids
  }
  private async write(id: string, bytes: Buffer, signal: AbortSignal) {
    if (bytes.length > this.maxBytes) fail('BACKUP_TOO_LARGE', 413)
    await this.ready()
    const name = `backup-${validId(id)}.json`
    await this.exclusive(name, async () => {
      const temporaryName = `tmp-${randomUUID()}.json`,
        temporary = join(this.root, temporaryName)
      const release = this.pin(temporaryName)
      try {
        signal.throwIfAborted()
        const handle = await open(temporary, 'wx', 0o600)
        try {
          await handle.writeFile(bytes)
          await handle.sync()
        } finally {
          await handle.close()
        }
        signal.throwIfAborted()
        await rename(temporary, this.file(id))
        const directory = await open(this.root, 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      } finally {
        await rm(temporary, { force: true })
        release()
      }
    })
  }
  async create(actor: ManagementActor, idempotencyKey: string, retryOf?: string): Promise<Operation> {
    await this.ready()
    await this.authorize(actor)
    return this.options.operations.submit(
      {
        kind: 'server.backup',
        scope: managementScopeKey(this.serverScope),
        actor,
        idempotencyKey,
        input: { serverId: this.options.serverId, workspaceId: this.options.workspaceId },
        ...(retryOf ? { retryOf } : {}),
      },
      // Large captures are serialized per owner, so concurrent API requests cannot
      // multiply the maximum in-memory archive size.
      async context =>
        this.exclusive('capture', async () => {
          const name = `backup-${context.operationId}.json`,
            release = this.pin(name)
          const controller = new AbortController()
          this.capturing.add(controller)
          const signal = AbortSignal.any([context.signal, controller.signal])
          let commitAttempted = false
          try {
            await this.ready()
            await context.checkCurrent()
            await this.authorize(actor)
            await context.progress({ stage: 'capturing' })
            const archive = await this.options.createServerBackup(signal)
            signal.throwIfAborted()
            const serverIds = this.archiveServers(archive)
            await this.authorize(actor, serverIds)
            const bytes = Buffer.from(JSON.stringify(archive))
            await context.checkCurrent()
            await context.progress({ stage: 'writing' })
            await this.write(context.operationId, bytes, signal)
            signal.throwIfAborted()
            const result: BackupDownloadResult = {
              downloadPath: `/api/management/v1/backups/${context.operationId}`,
              filename: `server-backup-${context.operationId.slice(0, 12)}.json`,
              bytes: bytes.length,
              expiresAt: this.now() + this.ttlMs,
              sha256: digest(bytes),
            }
            commitAttempted = true
            return await context.commit(async tx => {
              await this.authorize(actor, serverIds, tx)
              return result
            })
          } finally {
            // An uncertain DB commit might have succeeded: preserve that artifact for
            // authenticated retrieval/expiry, never claim an unverified rollback.
            try {
              if (!commitAttempted)
                await this.exclusive(name, () => rm(this.file(context.operationId), { force: true }))
            } finally {
              this.capturing.delete(controller)
              release()
            }
          }
        }),
    )
  }
  async retry(actor: ManagementActor, operationId: string, idempotencyKey: string) {
    await this.authorize(actor)
    const previous = await this.operation(operationId)
    if (!['failed', 'cancelled', 'interrupted'].includes(previous.status)) fail('OPERATION_NOT_RETRYABLE', 409)
    return this.create(actor, idempotencyKey, previous.id)
  }
  private async operation(id: string) {
    const operation = await this.options.operations.get(validId(id))
    const input = object(operation.input)
    if (
      operation.kind !== 'server.backup' ||
      operation.scope !== managementScopeKey(this.serverScope) ||
      input.serverId !== this.options.serverId ||
      input.workspaceId !== this.options.workspaceId
    )
      fail('BACKUP_NOT_FOUND', 404)
    return operation
  }
  async download(actor: ManagementActor, id: string): Promise<unknown> {
    await this.ready()
    await this.authorize(actor)
    const operation = await this.operation(id)
    if (operation.status !== 'succeeded') fail('BACKUP_NOT_READY', 409)
    const result = operation.result as BackupDownloadResult | undefined
    if (!result || typeof result.expiresAt !== 'number' || result.expiresAt <= this.now()) fail('BACKUP_EXPIRED', 410)
    const name = `backup-${id}.json`,
      release = this.pin(name)
    try {
      return await this.exclusive(name, async () => {
        let handle
        try {
          handle = await open(this.file(id), constants.O_RDONLY | constants.O_NOFOLLOW)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('BACKUP_EXPIRED', 410)
          return fail('BACKUP_ARTIFACT_INVALID', 409)
        }
        let bytes: Buffer
        try {
          const info = await handle.stat()
          if (!info.isFile() || info.size > this.maxBytes || info.size !== result!.bytes)
            fail('BACKUP_ARTIFACT_INVALID', 409)
          bytes = await handle.readFile()
        } finally {
          await handle.close()
        }
        if (bytes.length > this.maxBytes || digest(bytes) !== result!.sha256) fail('BACKUP_ARTIFACT_INVALID', 409)
        const archive: unknown = JSON.parse(bytes.toString('utf8'))
        await this.authorize(actor, this.archiveServers(archive))
        if (this.closed) fail('MANAGEMENT_STOPPED', 503)
        return archive
      })
    } finally {
      release()
    }
  }
  async cleanup(): Promise<{ removed: number }> {
    await this.ready()
    const operations = await this.options.operations.list(managementScopeKey(this.serverScope))
    let removed = 0
    for (const name of await readdir(this.root)) {
      if (!/^backup-[a-f0-9]{64}\.json$|^tmp-[a-f0-9-]{36}\.json$/.test(name) || this.active.has(name)) continue
      const operation = name.startsWith('backup-')
        ? operations.find(value => value.id === name.slice(7, -5))
        : undefined
      if (operation && ['queued', 'running'].includes(operation.status)) continue
      const expiresAt = (operation?.result as Partial<BackupDownloadResult> | undefined)?.expiresAt
      if (typeof expiresAt === 'number' && expiresAt > this.now()) continue
      await this.exclusive(name, async () => {
        if (this.active.has(name)) return
        const file = join(this.root, name),
          info = await lstat(file).catch(() => undefined)
        if (!info?.isFile() || info.isSymbolicLink()) return
        // Orphan artifacts keep a grace period; successful artifacts expire at the
        // recorded deadline, independent of the filesystem's wall clock.
        if (expiresAt === undefined && info.mtimeMs > this.now() - this.ttlMs) return
        await rm(file, { force: true })
        removed++
      })
    }
    return { removed }
  }
  async close() {
    this.closed = true
    for (const controller of this.capturing) controller.abort()
  }
}
