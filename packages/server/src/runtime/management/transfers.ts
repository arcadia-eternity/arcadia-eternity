import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { DurableStorage } from '@arcadia-eternity/database'
import type {
  ContentWorkspace,
  EnvironmentExport,
  StaticPreparer,
} from '@arcadia-eternity/content-sdk/management-workspace'
import { ManagementAuth, managementScopeKey, type ManagementActor, type ManagementScope } from './auth'
import { OperationService, type Operation } from './operations'

type TransferWorkspace = Pick<
  ContentWorkspace,
  | 'workspaceId'
  | 'exportVersion'
  | 'importVersion'
  | 'recoverImport'
  | 'forgetImport'
  | 'acquire'
  | 'retain'
  | 'releaseRetention'
  | 'references'
>
export interface ManagementTransfersOptions {
  storage: DurableStorage
  workspace: TransferWorkspace
  operations: OperationService
  auth: ManagementAuth
  directory: string
  validate: StaticPreparer
  maxBytes?: number
  ttlMs?: number
  now?: () => number
}
export interface TransferDownload {
  file: string
  filename: string
  bytes: number
  release(): Promise<void>
}
class ManagementTransferError extends Error {
  constructor(
    readonly code: string,
    readonly status = 422,
  ) {
    super(code)
  }
}
interface ExportResult {
  downloadPath: string
  filename: string
  bytes: number
  expiresAt: number
}
const fail = (code: string, status = 422): never => {
  throw new ManagementTransferError(code, status)
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const validId = (id: string) => {
  if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail('TRANSFER_NOT_FOUND', 404)
  return id
}
const safeString = (input: unknown, max = 128): input is string =>
  typeof input === 'string' && input.length > 0 && input.length <= max && !/\p{Cc}/u.test(input)
const safeVersion = (version: Awaited<ReturnType<ContentWorkspace['importVersion']>>) => {
  const { directory: _directory, materialDirectory: _materialDirectory, ...result } = version
  return result
}

/** Downloadable artifacts are temporary files, never a second authoritative environment in SQL. */
export class ManagementTransfers {
  readonly scope: ManagementScope
  readonly maxBytes: number
  readonly ttlMs: number
  private readonly now: () => number
  private root: string
  private initializing?: Promise<void>
  private readonly active = new Map<string, number>()
  private readonly locks = new Map<string, Promise<void>>()
  private closed = false
  constructor(private readonly options: ManagementTransfersOptions) {
    this.scope = { kind: 'workspace', id: options.workspace.workspaceId }
    this.root = resolve(options.directory, `owner-${digest(options.operations.ownerId)}`)
    this.now = options.now ?? Date.now
    this.maxBytes = options.maxBytes ?? 128 * 1024 * 1024
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000
    if (
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1024 ||
      this.maxBytes > 1024 * 1024 * 1024 ||
      !Number.isSafeInteger(this.ttlMs) ||
      this.ttlMs < 1000 ||
      this.ttlMs > 30 * 24 * 60 * 60 * 1000
    )
      fail('TRANSFER_CONFIGURATION_INVALID')
  }
  async ready(): Promise<void> {
    if (this.closed) fail('MANAGEMENT_STOPPED', 503)
    this.initializing ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 })
      const info = await lstat(this.root)
      if (!info.isDirectory() || info.isSymbolicLink()) fail('TRANSFER_DIRECTORY_UNSAFE')
      this.root = await realpath(this.root)
    })().catch(error => {
      this.initializing = undefined
      throw error
    })
    await this.initializing
  }
  private file(name: string) {
    if (!/^(?:export|upload)-[a-f0-9]{64}\.json$/.test(name)) fail('TRANSFER_NOT_FOUND', 404)
    return join(this.root, name)
  }
  private pin(name: string): () => void {
    this.active.set(name, (this.active.get(name) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.active.get(name) ?? 1) - 1
      if (count) this.active.set(name, count)
      else this.active.delete(name)
    }
  }
  private async exclusive<T>(name: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(name) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(done => {
      release = done
    })
    this.locks.set(name, current)
    await previous
    try {
      return await action()
    } finally {
      release()
      if (this.locks.get(name) === current) this.locks.delete(name)
    }
  }
  private async write(name: string, bytes: Buffer) {
    if (bytes.length > this.maxBytes) fail('TRANSFER_TOO_LARGE', 413)
    await this.ready()
    await this.exclusive(name, async () => {
      const temporary = join(this.root, `tmp-${randomUUID()}.json`)
      try {
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
        await rename(temporary, this.file(name))
      } finally {
        await rm(temporary, { force: true })
      }
    })
  }

  private async metadata(name: string) {
    await this.ready()
    return this.exclusive(name, async () => {
      const file = this.file(name)
      let info
      try {
        info = await lstat(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fail('TRANSFER_EXPIRED', 410)
        throw error
      }
      if (!info.isFile() || info.isSymbolicLink() || info.size > this.maxBytes || (await realpath(file)) !== file)
        fail('TRANSFER_ARTIFACT_INVALID', 409)
      return { file, info }
    })
  }
  async export(
    actor: ManagementActor,
    versionId: string,
    idempotencyKey: string,
    retryOf?: string,
  ): Promise<Operation> {
    await this.ready()
    await this.options.auth.authorize(actor, this.scope, 'export')
    if (!safeString(versionId)) fail('ENVIRONMENT_VERSION_INVALID')
    return this.options.operations.submit(
      {
        kind: 'environment.export',
        scope: managementScopeKey(this.scope),
        actor,
        idempotencyKey,
        input: { versionId },
        ...(retryOf ? { retryOf } : {}),
      },
      async context => {
        const name = `export-${context.operationId}.json`
        const unpin = this.pin(name)
        let lease: Awaited<ReturnType<TransferWorkspace['acquire']>> | undefined
        let completed = false,
          commitAttempted = false
        try {
          lease = await this.options.workspace.acquire(versionId, `export:${context.operationId}`)
          await context.checkCurrent()
          await this.options.auth.authorize(actor, this.scope, 'export')
          await context.progress({ stage: 'exporting' })
          const bundle = await this.options.workspace.exportVersion(versionId)
          const bytes = Buffer.from(JSON.stringify(bundle))
          await context.checkCurrent()
          await this.write(name, bytes)
          const result: ExportResult = {
            downloadPath: `/api/management/v1/transfers/${context.operationId}`,
            filename: `environment-${lease.environmentId}.json`,
            bytes: bytes.length,
            expiresAt: this.now() + this.ttlMs,
          }
          commitAttempted = true
          const committed = await context.commit(async tx => {
            await this.options.auth.authorizeInTransaction(tx, actor, this.scope, 'export')
            return result
          })
          completed = true
          return committed
        } finally {
          // A database disconnect can hide a successful commit. Keep the artifact
          // once commit was attempted; only inaccessible orphan data may await expiry.
          try {
            if (!completed && !commitAttempted) await this.exclusive(name, () => rm(this.file(name), { force: true }))
          } finally {
            try {
              await lease?.release()
            } finally {
              unpin()
            }
          }
        }
      },
    )
  }
  async import(
    actor: ManagementActor,
    bundle: unknown,
    input: {
      environmentId?: string
      expectedRevision?: string | null
      idempotencyKey: string
      retryOf?: string
    },
  ): Promise<Operation> {
    await this.ready()
    await this.options.auth.authorize(actor, this.scope, 'edit')
    await this.options.auth.authorize(actor, this.scope, 'prepare')
    if (
      !bundle ||
      typeof bundle !== 'object' ||
      Array.isArray(bundle) ||
      (bundle as { format?: unknown }).format !== 'arcadia.environment-export/1'
    )
      fail('ENVIRONMENT_EXPORT_INVALID')
    if (input.environmentId !== undefined && !safeString(input.environmentId)) fail('ENVIRONMENT_ID_INVALID')
    if (input.expectedRevision !== undefined && input.expectedRevision !== null && !safeString(input.expectedRevision))
      fail('REVISION_INVALID')
    let bytes: Buffer
    try {
      bytes = Buffer.from(JSON.stringify(bundle))
    } catch {
      return fail('ENVIRONMENT_EXPORT_INVALID')
    }
    if (bytes.length > this.maxBytes) fail('TRANSFER_TOO_LARGE', 413)
    const bundleDigest = digest(bytes)
    const uploadId = digest(`${this.options.operations.ownerId}\0${managementScopeKey(this.scope)}\0${bundleDigest}`)
    const name = `upload-${uploadId}.json`
    const unpin = this.pin(name)
    try {
      await this.write(name, bytes)
      return await this.options.operations.submit(
        {
          kind: 'environment.import',
          scope: managementScopeKey(this.scope),
          actor,
          idempotencyKey: input.idempotencyKey,
          ...(input.retryOf ? { retryOf: input.retryOf } : {}),
          input: {
            bundleDigest,
            uploadId,
            environmentId: input.environmentId ?? null,
            expectedRevision: input.expectedRevision ?? null,
          },
        },
        async context => {
          const release = this.pin(name)
          try {
            await context.checkCurrent()
            await this.options.auth.authorize(actor, this.scope, 'edit')
            await this.options.auth.authorize(actor, this.scope, 'prepare')
            const { file } = await this.metadata(name)
            const contents = await readFile(file)
            if (digest(contents) !== bundleDigest) fail('TRANSFER_ARTIFACT_INVALID', 409)
            const parsed = JSON.parse(contents.toString('utf8')) as EnvironmentExport
            await context.progress({ stage: 'importing' })
            const version = await this.options.workspace.importVersion(
              parsed,
              {
                importId: context.operationId,
                ...(input.environmentId ? { environmentId: input.environmentId } : {}),
                expectedRevision: input.expectedRevision ?? null,
                signal: context.signal,
                beforeCommit: async () => {
                  // This is the cancellation boundary: after durable intent, file commit
                  // may fail but can no longer be represented as a cancelled/no-op import.
                  await context.commit(
                    async tx => {
                      await this.options.auth.authorizeInTransaction(tx, actor, this.scope, 'edit')
                      await this.options.auth.authorizeInTransaction(tx, actor, this.scope, 'prepare')
                      return { imported: false, environmentId: input.environmentId ?? parsed.document.id }
                    },
                    { finalize: false },
                  )
                },
              },
              this.options.validate,
            )
            return safeVersion(version)
          } finally {
            release()
          }
        },
      )
    } finally {
      unpin()
    }
  }
  async retry(actor: ManagementActor, operationId: string, idempotencyKey: string): Promise<Operation> {
    await this.ready()
    const previous = await this.options.operations.get(validId(operationId))
    if (
      previous.scope !== managementScopeKey(this.scope) ||
      !['environment.import', 'environment.export'].includes(previous.kind)
    )
      return fail('TRANSFER_NOT_FOUND', 404)
    if (previous.committed) {
      if (previous.kind !== 'environment.import' || !['failed', 'interrupted'].includes(previous.status))
        return fail('OPERATION_ALREADY_COMMITTED', 409)
      await this.options.auth.authorize(actor, this.scope, 'edit')
      await this.options.auth.authorize(actor, this.scope, 'prepare')
      return this.recoverImport(previous)
    }
    if (!['failed', 'cancelled', 'interrupted'].includes(previous.status)) return fail('OPERATION_NOT_RETRYABLE', 409)
    if (previous.kind === 'environment.export') {
      const input = previous.input as { versionId: string }
      return this.export(actor, input.versionId, idempotencyKey, previous.id)
    }
    await this.options.auth.authorize(actor, this.scope, 'edit')
    await this.options.auth.authorize(actor, this.scope, 'prepare')
    const input = previous.input as {
      uploadId: string
      bundleDigest: string
      environmentId: string | null
      expectedRevision: string | null
    }
    const name = `upload-${validId(input.uploadId)}.json`,
      unpin = this.pin(name)
    try {
      const { file } = await this.metadata(name)
      const bytes = await readFile(file)
      if (digest(bytes) !== input.bundleDigest) return fail('TRANSFER_ARTIFACT_INVALID', 409)
      return await this.import(actor, JSON.parse(bytes.toString('utf8')), {
        ...(input.environmentId ? { environmentId: input.environmentId } : {}),
        expectedRevision: input.expectedRevision,
        idempotencyKey,
        retryOf: previous.id,
      })
    } finally {
      unpin()
    }
  }
  async download(actor: ManagementActor, operationId: string): Promise<TransferDownload> {
    await this.ready()
    await this.options.auth.authorize(actor, this.scope, 'export')
    const id = validId(operationId)
    const operation = await this.options.operations.get(id)
    if (operation.scope !== managementScopeKey(this.scope) || operation.kind !== 'environment.export')
      fail('TRANSFER_NOT_FOUND', 404)
    if (operation.status !== 'succeeded') fail('TRANSFER_NOT_READY', 409)
    const result = operation.result as ExportResult | undefined
    if (!result || typeof result.expiresAt !== 'number' || result.expiresAt <= this.now())
      return fail('TRANSFER_EXPIRED', 410)
    const name = `export-${id}.json`,
      unpin = this.pin(name)
    try {
      const { file, info } = await this.metadata(name)
      if (info.size !== result.bytes) fail('TRANSFER_ARTIFACT_INVALID', 409)
      return {
        file,
        filename: result.filename,
        bytes: info.size,
        release: async () => {
          unpin()
        },
      }
    } catch (error) {
      unpin()
      throw error
    }
  }
  async references(actor: ManagementActor, versionId: string) {
    await this.options.auth.authorize(actor, this.scope, 'read')
    const references = await this.options.workspace.references(versionId)
    return {
      references: references.map(reference => {
        const result: Record<string, unknown> = {}
        for (const key of ['kind', 'versionId', 'retentionId', 'serverId', 'bindingId', 'owner', 'id']) {
          const value = reference[key]
          // IDs have a bounded printable shape; user-controlled paths/diagnostics aren't sent.
          if (safeString(value, 256) && !/[\\/]/.test(value)) result[key] = value
        }
        return result
      }),
    }
  }
  private recoverImport(operation: Operation): Promise<Operation> {
    return this.exclusive(`import:${operation.id}`, async () => {
      const current = await this.options.operations.get(operation.id)
      if (current.status === 'succeeded') return current
      const version = await this.options.workspace.recoverImport(current.id)
      const recovered = await this.options.operations.recoverCommitted(current.id, safeVersion(version))
      await this.options.workspace.forgetImport(current.id)
      return recovered
    })
  }
  async cleanup(): Promise<{ removed: number }> {
    await this.ready()
    const cutoff = this.now() - this.ttlMs
    let removed = 0
    const operations = await this.options.operations.list()
    for (const operation of operations) {
      if (
        operation.kind !== 'environment.import' ||
        operation.scope !== managementScopeKey(this.scope) ||
        ['queued', 'running'].includes(operation.status)
      )
        continue
      if (!operation.committed) await this.options.workspace.forgetImport(operation.id, { discard: true })
      else if (operation.status === 'succeeded') await this.options.workspace.forgetImport(operation.id)
      else {
        // Conflicting external edits remain a failed/interrupted task and a pinned
        // intent. An authorized retry reports the concrete conflict for repair.
        await this.recoverImport(operation).catch(() => {})
      }
    }
    const activeUploads = new Set(
      operations
        .filter(
          operation => operation.kind === 'environment.import' && ['queued', 'running'].includes(operation.status),
        )
        .map(operation => (operation.input as { uploadId?: string }).uploadId),
    )
    for (const name of await readdir(this.root)) {
      if (!/^(?:export|upload)-[a-f0-9]{64}\.json$|^tmp-[a-f0-9-]{36}\.json$/.test(name) || this.active.has(name))
        continue
      if (name.startsWith('upload-') && activeUploads.has(name.slice(7, -5))) continue
      if (name.startsWith('export-')) {
        const operation = operations.find(item => item.id === name.slice(7, -5))
        if (operation && ['queued', 'running'].includes(operation.status)) continue
        const expiresAt = (operation?.result as Partial<ExportResult> | undefined)?.expiresAt
        if (typeof expiresAt === 'number' && expiresAt > this.now()) continue
      }
      await this.exclusive(name, async () => {
        if (this.active.has(name)) return
        const file = join(this.root, name)
        const info = await lstat(file).catch(() => undefined)
        if (!info || !info.isFile() || info.isSymbolicLink() || info.mtimeMs > cutoff) return
        if (this.active.has(name)) return
        // Acquiring metadata or replacing this artifact waits for this unlink.
        await rm(file, { force: true })
        removed++
      })
    }
    return { removed }
  }
  async close() {
    this.closed = true
  }
}
