import { createHash, randomUUID } from 'node:crypto'
import type { DurableStorage, StoredRecord } from '@arcadia-eternity/database'

export type OperationStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface OperationProgress {
  stage: string
  completed?: number
  total?: number
}
export interface OperationFailure {
  code: string
  message: string
  retryable: boolean
}
export interface OperationValue {
  kind: string
  scope: string
  actor: unknown
  input: unknown
  inputFingerprint: string
  idempotencyKey: string
  retryOf?: string
  attempt: number
  rootOperationId: string
  ownerId: string
  bootId: string
  status: OperationStatus
  cancelRequested: boolean
  /** A durable effect exists; cancellation can no longer undo this operation. */
  committed?: boolean
  progress?: OperationProgress
  result?: unknown
  error?: OperationFailure
  createdAt: number
  updatedAt: number
}
export interface Operation extends OperationValue {
  id: string
  revision: number
}
export interface OperationSubmission {
  kind: string
  scope: string
  actor: unknown
  idempotencyKey: string
  input: unknown
  retryOf?: string
}
type StorageTransaction = Parameters<Parameters<DurableStorage['transaction']>[0]>[0]
export interface OperationContext {
  readonly signal: AbortSignal
  readonly operationId: string
  readonly attempt: number
  /** Recheck immediately before a non-transactional effect; publication should use commit. */
  checkCurrent(): Promise<void>
  progress(value: OperationProgress): Promise<void>
  /** Commit a short domain mutation. Defer finalization while applying its runtime counterpart. */
  commit<T>(action: (transaction: StorageTransaction) => Promise<T>, options?: { finalize?: boolean }): Promise<T>
}
export class OperationError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code)
  }
}

const terminal = (status: OperationStatus) => !['queued', 'running'].includes(status)
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const present = (record: StoredRecord<OperationValue>): Operation => ({
  ...structuredClone(record.value),
  id: record.id,
  revision: record.revision,
})

/** Stable JSON also rejects lossy/non-JSON input rather than deduplicating different commands. */
function canonical(value: unknown): string {
  const ancestors = new Set<object>()
  const visit = (item: unknown): string => {
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (typeof item !== 'object' || item === null || ancestors.has(item))
      throw new OperationError('OPERATION_INPUT_INVALID', 422)
    ancestors.add(item)
    try {
      if (Array.isArray(item)) return '[' + Array.from(item, visit).join(',') + ']'
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item)))
        throw new OperationError('OPERATION_INPUT_INVALID', 422)
      return (
        '{' +
        Object.keys(item)
          .sort()
          .map(key => JSON.stringify(key) + ':' + visit((item as Record<string, unknown>)[key]))
          .join(',') +
        '}'
      )
    } finally {
      ancestors.delete(item)
    }
  }
  const result = visit(value)
  if (Buffer.byteLength(result) > 128 * 1024) throw new OperationError('OPERATION_INPUT_TOO_LARGE', 422)
  return result
}

function actorIdentity(actor: unknown): string {
  if (actor && typeof actor === 'object' && 'principalId' in actor && typeof actor.principalId === 'string')
    return actor.principalId
  throw new OperationError('OPERATION_ACTOR_INVALID', 422)
}

function failure(error: unknown): OperationFailure {
  // Exception text may contain private paths, connection strings or provider responses.
  // Only deliberately exposed, stable codes cross the operation API boundary.
  const code =
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
      ? error.code
      : 'OPERATION_FAILED'
  return { code, message: code, retryable: !['FORBIDDEN', 'UNAUTHORIZED', 'OPERATION_INPUT_INVALID'].includes(code) }
}

/** The caller owns the workspace's exclusive writer lock and all authorization checks. */
export class OperationService {
  readonly bootId: string
  readonly ownerId: string
  private readonly now: () => number
  private initializing?: Promise<void>
  private closed = false
  private readonly active = new Map<string, { controller: AbortController; promise: Promise<void> }>()

  constructor(
    private readonly storage: DurableStorage,
    options: { bootId?: string; ownerId?: string; now?: () => number } = {},
  ) {
    this.bootId = options.bootId ?? randomUUID()
    this.ownerId = options.ownerId ?? 'default'
    if (!this.ownerId || this.ownerId.length > 512 || /\p{Cc}/u.test(this.ownerId))
      throw new OperationError('OPERATION_OWNER_INVALID', 422)
    this.now = options.now ?? Date.now
  }

  async ready(): Promise<void> {
    if (this.closed) throw new OperationError('MANAGEMENT_STOPPED', 503)
    this.initializing ??= this.update(async tx => {
      for (const record of await tx.list<OperationValue>('operations')) {
        if (
          record.value.ownerId !== this.ownerId ||
          terminal(record.value.status) ||
          record.value.bootId === this.bootId
        )
          continue
        await this.change(tx, record, {
          ...record.value,
          status: 'interrupted',
          updatedAt: this.now(),
          error: { code: 'OWNER_RESTARTED', message: 'OWNER_RESTARTED', retryable: true },
        })
      }
    }).catch(error => {
      this.initializing = undefined
      throw error
    })
    await this.initializing
  }

  async submit(input: OperationSubmission, work: (context: OperationContext) => Promise<unknown>): Promise<Operation> {
    await this.ready()
    if (this.closed) throw new OperationError('MANAGEMENT_STOPPED', 503)
    for (const value of [input.kind, input.scope, input.idempotencyKey]) {
      if (typeof value !== 'string' || !value.trim() || value.length > 512 || /\p{Cc}/u.test(value))
        throw new OperationError('OPERATION_INPUT_INVALID', 422)
    }
    const principalId = actorIdentity(input.actor)
    canonical(input.actor)
    const inputFingerprint = digest(canonical(input.input))
    const id = digest(canonical([this.ownerId, principalId, input.scope, input.kind, input.idempotencyKey]))
    let created = false
    let record: StoredRecord<OperationValue>
    const compatible = (existing: StoredRecord<OperationValue>) => {
      if (existing.value.inputFingerprint !== inputFingerprint || existing.value.retryOf !== input.retryOf)
        throw new OperationError('IDEMPOTENCY_CONFLICT')
      return existing
    }
    try {
      record = await this.update(async tx => {
        created = false
        const existing = await tx.get<OperationValue>('operations', id)
        if (existing) return compatible(existing)
        let attempt = 1
        let rootOperationId = id
        if (input.retryOf) {
          const previous = await tx.get<OperationValue>('operations', input.retryOf)
          if (!previous || previous.value.ownerId !== this.ownerId) throw new OperationError('OPERATION_NOT_FOUND', 404)
          if (!['failed', 'cancelled', 'interrupted'].includes(previous.value.status))
            throw new OperationError('OPERATION_NOT_RETRYABLE')
          if (
            previous.value.kind !== input.kind ||
            previous.scope !== input.scope ||
            actorIdentity(previous.value.actor) !== principalId ||
            previous.value.inputFingerprint !== inputFingerprint
          )
            throw new OperationError('OPERATION_RETRY_MISMATCH')
          attempt = previous.value.attempt + 1
          rootOperationId = previous.value.rootOperationId
        }
        const timestamp = this.now()
        const next = await tx.create<OperationValue>('operations', {
          id,
          scope: input.scope,
          value: {
            kind: input.kind,
            scope: input.scope,
            actor: structuredClone(input.actor),
            input: structuredClone(input.input),
            inputFingerprint,
            idempotencyKey: input.idempotencyKey,
            ...(input.retryOf ? { retryOf: input.retryOf } : {}),
            attempt,
            rootOperationId,
            ownerId: this.ownerId,
            bootId: this.bootId,
            status: 'queued',
            cancelRequested: false,
            committed: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        })
        await this.audit(tx, next, 'submitted')
        created = true
        return next
      })
    } catch (error) {
      // PG concurrent inserts can lose after the initial read. Inspect the winner
      // only after the failed transaction has rolled back.
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        typeof error.code !== 'string' ||
        !['ALREADY_EXISTS', 'REVISION_CONFLICT'].includes(error.code)
      )
        throw error
      const winner = await this.storage.get<OperationValue>('operations', id)
      if (!winner) throw error
      created = false
      record = compatible(winner)
    }
    if (created) {
      const controller = new AbortController()
      const promise = Promise.resolve().then(() => this.run(record.id, controller, work))
      this.active.set(record.id, { controller, promise })
      // run catches task errors; the final guard also contains failures while persisting an error.
      void promise.catch(() => {}).finally(() => this.active.delete(record.id))
    }
    return present(record)
  }

  async get(id: string): Promise<Operation> {
    const record = await this.storage.get<OperationValue>('operations', id)
    if (!record || record.value.ownerId !== this.ownerId) throw new OperationError('OPERATION_NOT_FOUND', 404)
    return present(record)
  }

  /** A domain owner has reconciled an already committed filesystem/runtime effect. */
  async recoverCommitted(id: string, result: unknown): Promise<Operation> {
    const record = await this.update(async tx => {
      const previous = await tx.get<OperationValue>('operations', id)
      if (!previous || previous.value.ownerId !== this.ownerId) throw new OperationError('OPERATION_NOT_FOUND', 404)
      if (!previous.value.committed || !terminal(previous.value.status))
        throw new OperationError('OPERATION_NOT_RETRYABLE')
      if (previous.value.status === 'succeeded') return previous
      const { error: _error, ...value } = previous.value
      return this.change(tx, previous, { ...value, status: 'succeeded', result, updatedAt: this.now() })
    })
    return present(record)
  }

  async list(scope?: string): Promise<Operation[]> {
    return (await this.storage.list<OperationValue>('operations', scope))
      .filter(row => row.value.ownerId === this.ownerId)
      .map(present)
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  }

  async cancel(id: string): Promise<Operation> {
    const record = await this.update(async tx => {
      const current = await tx.get<OperationValue>('operations', id)
      if (!current || current.value.ownerId !== this.ownerId) throw new OperationError('OPERATION_NOT_FOUND', 404)
      if (terminal(current.value.status) || current.value.cancelRequested || current.value.committed) return current
      return this.change(tx, current, {
        ...current.value,
        cancelRequested: true,
        status: current.value.status === 'queued' ? 'cancelled' : current.value.status,
        updatedAt: this.now(),
      })
    })
    if (record.value.cancelRequested) this.active.get(id)?.controller.abort()
    return present(record)
  }

  private assertCurrent(record: StoredRecord<OperationValue>) {
    if (this.closed || record.value.bootId !== this.bootId || record.value.status === 'interrupted')
      throw new OperationError('OPERATION_INTERRUPTED')
    if (record.value.cancelRequested || record.value.status === 'cancelled')
      throw new OperationError('OPERATION_CANCELLED')
    if (record.value.status !== 'running') throw new OperationError('OPERATION_ALREADY_FINISHED')
  }

  private async current(tx: Pick<StorageTransaction, 'get'>, id: string) {
    const record = await tx.get<OperationValue>('operations', id)
    if (!record) throw new OperationError('OPERATION_NOT_FOUND', 404)
    this.assertCurrent(record)
    return record
  }

  private async run(id: string, controller: AbortController, work: (context: OperationContext) => Promise<unknown>) {
    try {
      const running = await this.update(async tx => {
        const record = await tx.get<OperationValue>('operations', id)
        if (!record || record.value.status !== 'queued' || record.value.bootId !== this.bootId || this.closed)
          return null
        return this.change(tx, record, { ...record.value, status: 'running', updatedAt: this.now() })
      })
      if (!running) return
      const context: OperationContext = {
        signal: controller.signal,
        operationId: id,
        attempt: running.value.attempt,
        checkCurrent: async () => {
          await this.current(this.storage, id)
        },
        progress: async progress => {
          if (
            typeof progress.stage !== 'string' ||
            progress.stage.length > 120 ||
            /\p{Cc}/u.test(progress.stage) ||
            [progress.completed, progress.total].some(
              value => value !== undefined && (!Number.isFinite(value) || value < 0),
            )
          )
            throw new OperationError('OPERATION_PROGRESS_INVALID', 422)
          await this.update(async tx => {
            const record = await this.current(tx, id)
            await tx.replace('operations', id, record.revision, {
              ...record.value,
              progress: structuredClone(progress),
              updatedAt: this.now(),
            })
          })
        },
        commit: async (action, options) =>
          this.storage.transaction(async tx => {
            const record = await this.current(tx, id)
            if (record.value.committed) throw new OperationError('OPERATION_ALREADY_COMMITTED')
            const result = await action(tx)
            // Cancellation/fencing and domain writes use this same serialized DB transaction.
            await this.change(tx, record, {
              ...record.value,
              status: options?.finalize === false ? 'running' : 'succeeded',
              committed: true,
              result: result ?? null,
              updatedAt: this.now(),
            })
            return result
          }),
      }
      const result = await work(context)
      await this.finish(id, result)
    } catch (error) {
      await this.finish(id, undefined, error, true)
    }
  }

  private async finish(id: string, result?: unknown, error?: unknown, failed = false) {
    await this.update(async tx => {
      const record = await tx.get<OperationValue>('operations', id)
      if (!record || terminal(record.value.status) || record.value.bootId !== this.bootId) return
      const status: OperationStatus = this.closed
        ? 'interrupted'
        : record.value.cancelRequested && !record.value.committed
          ? 'cancelled'
          : failed
            ? 'failed'
            : 'succeeded'
      await this.change(tx, record, {
        ...record.value,
        status,
        ...(status === 'succeeded' ? { result: result === undefined ? (record.value.result ?? null) : result } : {}),
        ...(status === 'failed' ? { error: failure(error) } : {}),
        ...(status === 'interrupted'
          ? { error: { code: 'OWNER_STOPPED', message: 'OWNER_STOPPED', retryable: true } }
          : {}),
        updatedAt: this.now(),
      })
    })
  }

  private async audit(tx: StorageTransaction, record: StoredRecord<OperationValue>, action: string) {
    await tx.create('audit', {
      id: randomUUID(),
      scope: record.scope,
      value: {
        kind: 'operation',
        action,
        operationId: record.id,
        principalId: actorIdentity(record.value.actor),
        status: record.value.status,
        attempt: record.value.attempt,
        createdAt: this.now(),
      },
    })
  }

  /** Only runner-owned database-only mutations may be replayed after serialization conflicts. */
  private async update<T>(action: (transaction: StorageTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.storage.transaction(action)
      } catch (error) {
        if (
          attempt >= 2 ||
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'REVISION_CONFLICT'
        )
          throw error
      }
    }
  }

  private async change(tx: StorageTransaction, previous: StoredRecord<OperationValue>, value: OperationValue) {
    const record = await tx.replace('operations', previous.id, previous.revision, value)
    await this.audit(tx, record, value.committed && !previous.value.committed ? 'committed' : value.status)
    return record
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const { controller } of this.active.values()) controller.abort()
    // Fence every current operation before returning, even when an external command
    // does not promptly observe AbortSignal. Late callbacks cannot commit afterward.
    await this.update(async tx => {
      for (const record of await tx.list<OperationValue>('operations')) {
        if (
          record.value.ownerId !== this.ownerId ||
          record.value.bootId !== this.bootId ||
          terminal(record.value.status)
        )
          continue
        await this.change(tx, record, {
          ...record.value,
          status: 'interrupted',
          updatedAt: this.now(),
          error: { code: 'OWNER_STOPPED', message: 'OWNER_STOPPED', retryable: true },
        })
      }
    })
  }
}
