import { randomUUID } from 'node:crypto'
import type {
  ContentWorkspace,
  ContentWorkspaceOptions,
  EnvironmentDocument,
  EnvironmentInstallation,
  PrepareEnvironmentInput,
  StaticPreparer,
} from '@arcadia-eternity/content-sdk/management-workspace'

/** This channel is the inherited parent process IPC, never a renderer or HTTP transport. */
interface DesktopWorkspaceChannel {
  readonly connected?: boolean
  send(message: object, callback?: (error: Error | null) => void): unknown
  on(event: 'message' | 'disconnect', listener: (message?: unknown) => void): unknown
  off(event: 'message' | 'disconnect', listener: (message?: unknown) => void): unknown
}

export interface DesktopWorkspaceProxyOptions {
  retentions: NonNullable<ContentWorkspaceOptions['retentions']>
  timeoutMs?: number
  channel?: DesktopWorkspaceChannel
}

type Pending = {
  finish(error?: Error, value?: unknown): void
  controller: AbortController
  preparer?: StaticPreparer
  beforeCommit?: () => Promise<void>
  onProgress?: PrepareEnvironmentInput['onProgress']
}

const namespace = 'arcadia.desktop.workspace'
const error = (code: string, message = code) => Object.assign(new Error(message), { code })
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
const remoteError = (value: unknown) => {
  const detail = record(value)
  return error(
    typeof detail?.code === 'string' ? detail.code : 'WORKSPACE_REQUEST_FAILED',
    typeof detail?.message === 'string' ? detail.message : '工作区请求失败',
  )
}
const serializedError = (value: unknown) => {
  const detail = record(value)
  return {
    code: typeof detail?.code === 'string' ? detail.code : 'WORKSPACE_CALLBACK_FAILED',
    message: value instanceof Error ? value.message : '工作区回调失败',
  }
}

/** Borrow the desktop-owned workspace. The child never opens a second filesystem owner. */
export async function createDesktopWorkspaceProxy(options: DesktopWorkspaceProxyOptions): Promise<ContentWorkspace> {
  const timeoutMs = options.timeoutMs ?? 120_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw error('WORKSPACE_TIMEOUT_INVALID')
  const channel: DesktopWorkspaceChannel = options.channel ?? {
    get connected() {
      return process.connected
    },
    send(message, callback) {
      if (!process.send) throw error('WORKSPACE_PARENT_DISCONNECTED')
      return callback ? process.send(message, callback) : process.send(message)
    },
    on(event, listener) {
      process.on(event, listener)
    },
    off(event, listener) {
      process.off(event, listener)
    },
  }
  const pending = new Map<string, Pending>()
  let disconnected = false
  let closing = false
  let closePromise: Promise<void> | undefined

  function send(message: object) {
    if (disconnected || channel.connected === false) throw error('WORKSPACE_PARENT_DISCONNECTED')
    channel.send(message, sendError => {
      if (sendError) disconnect()
    })
  }
  function notifyCancellation(id: string) {
    try {
      send({ type: `${namespace}.cancel`, id })
    } catch {
      /* The parent exit also cancels its requests. */
    }
  }
  function detach() {
    channel.off('message', onMessage)
    channel.off('disconnect', disconnect)
  }
  function disconnect() {
    if (disconnected) return
    disconnected = true
    for (const request of [...pending.values()]) request.finish(error('WORKSPACE_PARENT_DISCONNECTED'))
    detach()
  }
  function request<T>(
    method: string,
    args: unknown[] = [],
    signal?: AbortSignal,
    preparer?: StaticPreparer,
    beforeCommit?: () => Promise<void>,
    onProgress?: PrepareEnvironmentInput['onProgress'],
  ): Promise<T> {
    if (disconnected || channel.connected === false) return Promise.reject(error('WORKSPACE_PARENT_DISCONNECTED'))
    if (closing && method !== 'close') return Promise.reject(error('WORKSPACE_CLOSED'))
    if (signal?.aborted) return Promise.reject(signal.reason ?? error('WORKSPACE_REQUEST_CANCELLED'))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController()
      const onAbort = () => {
        notifyCancellation(id)
        finish(signal?.reason instanceof Error ? signal.reason : error('WORKSPACE_REQUEST_CANCELLED'))
      }
      const timer = setTimeout(() => {
        notifyCancellation(id)
        finish(error('WORKSPACE_REQUEST_TIMEOUT'))
      }, timeoutMs)
      function finish(failure?: Error, value?: unknown) {
        if (!pending.delete(id)) return
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (failure) {
          controller.abort(failure)
          reject(failure)
        } else resolve(value as T)
      }
      pending.set(id, { finish, controller, preparer, beforeCommit, onProgress })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) return onAbort()
      try {
        send({ type: namespace, id, method, args })
      } catch (failure) {
        finish(failure instanceof Error ? failure : error('WORKSPACE_PARENT_DISCONNECTED'))
      }
    })
  }
  async function callback(message: Record<string, unknown>) {
    const id = message.id as string
    try {
      const input = record(message.input) ?? {}
      let value: unknown
      if (message.kind === 'prepare') {
        const active = typeof message.requestId === 'string' ? pending.get(message.requestId) : undefined
        if (!active?.preparer) throw error('WORKSPACE_PREPARER_EXPIRED')
        if (typeof input.directory !== 'string' || !record(input.draft)) throw error('WORKSPACE_CALLBACK_INVALID')
        active.controller.signal.throwIfAborted()
        value = await active.preparer({
          directory: input.directory,
          draft: input.draft as EnvironmentDocument,
          signal: active.controller.signal,
        })
        active.controller.signal.throwIfAborted()
      } else if (message.kind === 'progress') {
        const active = typeof message.requestId === 'string' ? pending.get(message.requestId) : undefined
        if (!active?.onProgress) throw error('WORKSPACE_PROGRESS_EXPIRED')
        if (
          typeof input.stage !== 'string' ||
          input.stage.length > 120 ||
          [input.completed, input.total].some(
            value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0),
          )
        )
          throw error('WORKSPACE_CALLBACK_INVALID')
        active.controller.signal.throwIfAborted()
        await active.onProgress({
          stage: input.stage,
          completed: input.completed as number | undefined,
          total: input.total as number | undefined,
        })
        active.controller.signal.throwIfAborted()
      } else if (message.kind === 'beforeCommit') {
        const active = typeof message.requestId === 'string' ? pending.get(message.requestId) : undefined
        if (!active?.beforeCommit) throw error('WORKSPACE_COMMIT_EXPIRED')
        active.controller.signal.throwIfAborted()
        await active.beforeCommit()
        active.controller.signal.throwIfAborted()
      } else if (message.kind === 'retention.list') {
        if (typeof input.installationId !== 'string') throw error('WORKSPACE_CALLBACK_INVALID')
        value = await options.retentions.list(input.installationId)
      } else if (message.kind === 'retention.put') {
        if (typeof input.installationId !== 'string' || typeof input.retentionId !== 'string')
          throw error('WORKSPACE_CALLBACK_INVALID')
        if (!options.retentions.put) throw error('RETENTION_UNAVAILABLE')
        await options.retentions.put(input.installationId, input.retentionId)
      } else if (message.kind === 'retention.remove') {
        if (typeof input.retentionId !== 'string') throw error('WORKSPACE_CALLBACK_INVALID')
        if (!options.retentions.remove) throw error('RETENTION_UNAVAILABLE')
        await options.retentions.remove(input.retentionId)
      } else throw error('WORKSPACE_CALLBACK_INVALID')
      send({ type: `${namespace}.callback.result`, id, ok: true, value })
    } catch (failure) {
      try {
        send({ type: `${namespace}.callback.result`, id, ok: false, error: serializedError(failure) })
      } catch {
        /* Parent disconnected. */
      }
    }
  }
  function onMessage(value?: unknown) {
    const message = record(value)
    if (!message || typeof message.id !== 'string' || message.id.length > 80) return
    if (message.type === `${namespace}.callback`) {
      void callback(message)
      return
    }
    if (message.type !== `${namespace}.result`) return
    const active = pending.get(message.id)
    if (active) {
      if (message.ok === true) active.finish(undefined, message.value)
      else active.finish(remoteError(message.error))
    } else {
      // An acquire may finish just after cancellation. Return its orphan lease.
      const lease = record(message.value)
      if (message.ok === true && typeof lease?.leaseToken === 'string')
        void request('release', [lease.leaseToken]).catch(() => {})
    }
  }
  channel.on('message', onMessage)
  channel.on('disconnect', disconnect)

  const prepare = (method: 'prepareEnvironment', input: PrepareEnvironmentInput, preparer: StaticPreparer) => {
    const { signal, beforeCommit, onProgress, ...serializable } = input
    return request<EnvironmentInstallation>(
      method,
      [{ ...serializable, hasBeforeCommit: !!beforeCommit, hasProgress: !!onProgress }],
      signal,
      preparer,
      beforeCommit,
      onProgress,
    )
  }
  const close = () => {
    closePromise ??= (async () => {
      closing = true
      for (const [id, active] of [...pending]) {
        notifyCancellation(id)
        active.finish(error('WORKSPACE_CLOSED'))
      }
      try {
        if (!disconnected) await request('close')
      } finally {
        disconnected = true
        detach()
      }
    })()
    return closePromise
  }
  try {
    const descriptor = await request<{ root: string; workspaceId: string; bootId: string }>('describe')
    if (
      !descriptor ||
      [descriptor.root, descriptor.workspaceId, descriptor.bootId].some(value => typeof value !== 'string' || !value)
    )
      throw error('WORKSPACE_DESCRIPTOR_INVALID')
    return {
      root: descriptor.root,
      get workspaceId() {
        return descriptor.workspaceId
      },
      bootId: descriptor.bootId,
      listDrafts: () => request('listDrafts'),
      getDraft: id => request('getDraft', [id]),
      saveDraft: input => request('saveDraft', [input]),
      deleteDraft: input => request('deleteDraft', [input]),
      listInstallations: id => request('listInstallations', id === undefined ? [] : [id]),
      getInstallation: id => request('getInstallation', [id]),
      async acquire(installationId, owner) {
        const lease = await request<EnvironmentInstallation & { leaseToken: string }>('acquire', [
          installationId,
          owner ?? 'runtime',
        ])
        if (!lease || typeof lease.leaseToken !== 'string' || !lease.leaseToken) throw error('WORKSPACE_LEASE_INVALID')
        const { leaseToken, ...version } = lease
        let releasePromise: Promise<void> | undefined
        return {
          ...version,
          release() {
            releasePromise ??= disconnected || closing ? Promise.resolve() : request<void>('release', [leaseToken])
            return releasePromise
          },
        }
      },
      retain: (id, retentionId) => request('retain', [id, retentionId]),
      releaseRetention: id => request('releaseRetention', [id]),
      references: id => request('references', [id]),
      clearInstallation: id => request('clearInstallation', [id]),
      exportEnvironment: id => request('exportEnvironment', [id]),
      exportSnapshot: () => request('exportSnapshot'),
      captureSnapshot: () => request('captureSnapshot'),
      isSnapshotCurrent: stamp => request('isSnapshotCurrent', [stamp]),
      recoverImport: id => request('recoverImport', [id]),
      forgetImport: (id, input) => request('forgetImport', [id, input ?? {}]),
      async restoreSnapshot(snapshot, input, preparer) {
        const restored = await request<{ workspaceId: string; installationIds: Record<string, string> }>(
          'restoreSnapshot',
          [snapshot, input],
          undefined,
          preparer,
        )
        descriptor.workspaceId = restored.workspaceId
        return restored
      },
      importEnvironment(bundle, input, preparer) {
        const { signal, beforeCommit, ...serializable } = input
        return request(
          'importEnvironment',
          [bundle, { ...serializable, hasBeforeCommit: !!beforeCommit }],
          signal,
          preparer,
          beforeCommit,
        )
      },
      prepareEnvironment: (input, preparer) => prepare('prepareEnvironment', input, preparer),
      reconcile: () => request('reconcile'),
      cleanupStaging: () => request('cleanupStaging'),
      close,
    }
  } catch (failure) {
    // A failed handshake must not spend a second full timeout waiting for a
    // parent which already failed to answer. Request cleanup without awaiting it.
    closing = true
    try {
      send({ type: namespace, id: randomUUID(), method: 'close', args: [] })
    } catch {
      // A dead parent owns no live child-specific lease.
    }
    disconnected = true
    detach()
    throw failure
  }
}
