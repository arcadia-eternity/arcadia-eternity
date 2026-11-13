import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const failure = (code, message = code) => Object.assign(new Error(message), { code })
const messageError = error => ({ code: error?.code ?? 'WORKSPACE_FAILED', message: error?.message ?? '工作区操作失败' })
const methods = new Set([
  'listDrafts',
  'getDraft',
  'saveDraft',
  'deleteDraft',
  'listInstallations',
  'getInstallation',
  'retain',
  'releaseRetention',
  'references',
  'clearInstallation',
  'exportEnvironment',
  'exportSnapshot',
  'captureSnapshot',
  'isSnapshotCurrent',
  'recoverImport',
  'forgetImport',
  'reconcile',
  'cleanupStaging',
])

/** One workspace writer in the trusted desktop process, reused by host children.
 * The child owns its DB; callbacks consult that DB before removing any materials.
 */
export class DesktopWorkspaceOwner {
  #opening
  #workspace
  #connections = new Set()
  #retentionConnection
  constructor({ root, openWorkspace, library, timeoutMs = 120000 }) {
    this.root = root
    this.openWorkspace = openWorkspace
    this.library = library
    this.timeoutMs = timeoutMs
  }
  async ready() {
    this.#opening ??= (async () => {
      const workspace = await this.openWorkspace(this.root, {
        retentions: {
          list: installationId => this.#retention('retention.list', { installationId }),
          put: (installationId, retentionId) => this.#retention('retention.put', { installationId, retentionId }),
          remove: retentionId => this.#retention('retention.remove', { retentionId }),
        },
      })
      this.#workspace = workspace
      return workspace
    })().catch(error => {
      this.#opening = undefined
      throw error
    })
    return this.#opening
  }
  #retention(kind, input) {
    if (!this.#retentionConnection) throw failure('RETENTION_UNAVAILABLE')
    return this.#retentionConnection.callback(kind, input)
  }
  attach(child) {
    const leases = new Map(),
      pending = new Map(),
      controllers = new Map(),
      active = new Set()
    let detached = false
    const send = message => {
      if (detached || !child.connected) throw failure('HOST_UNAVAILABLE')
      child.send(message, error => {
        if (error) disconnect()
      })
    }
    const callback = (kind, input, requestId) =>
      new Promise((resolve, reject) => {
        const id = randomUUID()
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(failure('WORKSPACE_CALLBACK_TIMEOUT'))
        }, this.timeoutMs)
        pending.set(id, {
          resolve: value => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: error => {
            clearTimeout(timer)
            reject(error)
          },
        })
        try {
          send({ type: 'arcadia.desktop.workspace.callback', id, requestId, kind, input })
        } catch (error) {
          pending.get(id)?.reject(error)
          pending.delete(id)
        }
      })
    const connection = { callback }
    this.#connections.add(connection)
    this.#retentionConnection = connection
    const releaseLeases = async () => {
      const held = [...leases.values()]
      leases.clear()
      await Promise.allSettled(held.map(release => release()))
    }
    const dispatch = async message => {
      const { id, method, args } = message
      if (method === 'close') {
        await releaseLeases()
        return null
      }
      const workspace = await this.ready()
      if (method === 'describe')
        return { workspaceId: workspace.workspaceId, root: workspace.root, bootId: workspace.bootId }
      if (method === 'acquire') {
        const lease = await workspace.acquire(...args)
        if (detached) {
          await lease.release()
          throw failure('HOST_UNAVAILABLE')
        }
        const token = randomUUID()
        leases.set(token, lease.release)
        const { release: _release, ...version } = lease
        return { ...version, leaseToken: token }
      }
      if (method === 'release') {
        const release = leases.get(args[0])
        leases.delete(args[0])
        await release?.()
        return null
      }
      if (method === 'prepareEnvironment' || method === 'importEnvironment' || method === 'restoreSnapshot') {
        const controller = controllers.get(id)
        controller.signal.throwIfAborted()
        const prepare = input => callback('prepare', { directory: input.directory, draft: input.draft }, id)
        let projectLease
        try {
          if (method === 'importEnvironment')
            return await workspace.importEnvironment(
              args[0],
              {
                ...args[1],
                signal: controller.signal,
                ...(args[1]?.hasBeforeCommit ? { beforeCommit: () => callback('beforeCommit', {}, id) } : {}),
              },
              prepare,
            )
          if (method === 'restoreSnapshot') return await workspace.restoreSnapshot(args[0], args[1], prepare)
          const input = { ...args[0], signal: controller.signal }
          if (input.hasBeforeCommit) input.beforeCommit = () => callback('beforeCommit', {}, id)
          delete input.hasBeforeCommit
          if (input.hasProgress) input.onProgress = progress => callback('progress', progress, id)
          delete input.hasProgress
          if (!input.projectDirectory && !input.directory) {
            const draft = await workspace.getDraft(input.environmentId)
            if (draft.revision !== input.expectedRevision) throw failure('REVISION_CONFLICT')
            projectLease = await this.library.prepareEnvironmentProject(draft.document, {
              projectDirectory: join(workspace.root, 'environments', input.environmentId),
              signal: controller.signal,
              onProgress: input.onProgress,
            })
            input.directory = projectLease.directory
          }
          return await workspace[method](input, prepare)
        } finally {
          controllers.delete(id)
          await projectLease?.release()
        }
      }
      if (!methods.has(method)) throw failure('WORKSPACE_METHOD_INVALID')
      return workspace[method](...args)
    }
    const onMessage = message => {
      if (!message || typeof message !== 'object' || typeof message.id !== 'string' || message.id.length > 80) return
      if (message.type === 'arcadia.desktop.workspace.callback.result') {
        const result = pending.get(message.id)
        if (!result) return
        pending.delete(message.id)
        if (message.ok) result.resolve(message.value)
        else result.reject(failure(message.error?.code ?? 'WORKSPACE_CALLBACK_FAILED', message.error?.message))
        return
      }
      if (message.type === 'arcadia.desktop.workspace.cancel') {
        controllers.get(message.id)?.abort(failure('OPERATION_CANCELLED'))
        return
      }
      if (
        message.type !== 'arcadia.desktop.workspace' ||
        !Array.isArray(message.args) ||
        message.args.length > 4 ||
        typeof message.method !== 'string'
      )
        return
      if (active.has(message.id)) return
      active.add(message.id)
      if (['prepareEnvironment', 'importEnvironment', 'restoreSnapshot'].includes(message.method))
        controllers.set(message.id, new AbortController())
      void dispatch(message)
        .then(
          value => {
            if (!detached)
              send({ type: 'arcadia.desktop.workspace.result', id: message.id, ok: true, value: value ?? null })
            if (message.method === 'close') detach()
          },
          error => {
            if (!detached)
              send({ type: 'arcadia.desktop.workspace.result', id: message.id, ok: false, error: messageError(error) })
          },
        )
        .catch(() => {})
        .finally(() => active.delete(message.id))
    }
    const detach = () => {
      if (detached) return
      detached = true
      child.off('message', onMessage)
      child.off('close', detach)
      child.off('disconnect', disconnect)
      for (const controller of controllers.values()) controller.abort(failure('HOST_UNAVAILABLE'))
      for (const request of pending.values()) request.reject(failure('HOST_UNAVAILABLE'))
      pending.clear()
      this.#connections.delete(connection)
      if (this.#retentionConnection === connection) this.#retentionConnection = undefined
      void releaseLeases()
    }
    // A disconnected child can still be running; its materials stay leased until
    // the process is known to have exited, rather than being freed on IPC failure.
    const disconnect = () => {
      for (const controller of controllers.values()) controller.abort(failure('HOST_UNAVAILABLE'))
      for (const request of pending.values()) request.reject(failure('HOST_UNAVAILABLE'))
      pending.clear()
      if (this.#retentionConnection === connection) this.#retentionConnection = undefined
    }
    child.on('message', onMessage)
    child.once('close', detach)
    child.once('disconnect', disconnect)
    return detach
  }
  async close() {
    await this.#opening?.catch(() => {})
    await this.#workspace?.close()
  }
}
