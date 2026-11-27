import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import type {
  ContentWorkspace,
  ContentWorkspaceOptions,
  EnvironmentDocument,
  OwnedContentWorkspace,
  PrepareEnvironmentInput,
  StaticPreparer,
} from '@arcadia-eternity/content-sdk/management-workspace'

type Retentions = NonNullable<ContentWorkspaceOptions['retentions']>
type Progress = NonNullable<PrepareEnvironmentInput['onProgress']>
type ContentProjectLease = { directory: string; release: () => void | Promise<void> }
type WorkspaceChild = Pick<ChildProcess, 'connected' | 'on' | 'once' | 'off' | 'send'>
type OpenClientWorkspace = () => Promise<Pick<ContentWorkspace, 'acquire' | 'listInstallations'>>
type PrepareRequest = Omit<PrepareEnvironmentInput, 'signal' | 'beforeCommit' | 'onProgress'> & {
  hasBeforeCommit?: boolean
  hasProgress?: boolean
}
type ImportOptions = Parameters<ContentWorkspace['importEnvironment']>[1]
type ImportRequest = Omit<ImportOptions, 'signal' | 'beforeCommit'> & { hasBeforeCommit?: boolean }
type CallbackResults = {
  prepare: Awaited<ReturnType<StaticPreparer>>
  progress: void
  beforeCommit: void
  'retention.list': Awaited<ReturnType<Retentions['list']>>
  'retention.put': void
  'retention.remove': void
}
type WorkspaceCallback = <Kind extends keyof CallbackResults>(
  kind: Kind,
  input: object,
  requestId?: string,
) => Promise<CallbackResults[Kind]>
type WorkspaceConnection = { callback: WorkspaceCallback }
type CallbackPending = { resolve: (value: unknown) => void; reject: (error: unknown) => void }
type WorkspaceRequest = { id: string; method: string; args: unknown[] }
type ChildMessage = Partial<WorkspaceRequest> & {
  type?: unknown
  ok?: boolean
  value?: unknown
  error?: { code?: string; message?: string }
}

interface WorkspaceOwnerOptions {
  root: string
  openWorkspace: (root: string, options: ContentWorkspaceOptions) => Promise<OwnedContentWorkspace>
  library: {
    knowsOfficialMaterial: (digest: string) => Promise<boolean>
    prepareEnvironmentProject: (
      document: EnvironmentDocument,
      options: { projectDirectory: string; signal: AbortSignal; onProgress?: Progress },
    ) => Promise<ContentProjectLease>
  }
  synchronize?: (workspace: OwnedContentWorkspace) => void | Promise<void>
  /** Rejects a staged project before the hosted server validates and commits it, e.g. for revoked releases. */
  checkProject?: (directory: string, signal: AbortSignal) => Promise<void>
  builtinId?: () => string | undefined
  timeoutMs?: number
}

const failure = (code: string, message = code) => Object.assign(new Error(message), { code })
const messageError = (error: unknown) => {
  const detail = error as Partial<NodeJS.ErrnoException> | undefined
  return { code: detail?.code ?? 'WORKSPACE_FAILED', message: detail?.message ?? '工作区操作失败' }
}
const methods = new Set<keyof ContentWorkspace>([
  'listDrafts',
  'getDraft',
  'saveDraft',
  'deleteDraft',
  'listInstallations',
  'getInstallation',
  'retain',
  'releaseRetention',
  'clearInstallation',
  'exportEnvironment',
  'previewEnvironmentExport',
  'missingEnvironmentArchives',
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
  #opening: Promise<OwnedContentWorkspace> | undefined
  #workspace: OwnedContentWorkspace | undefined
  #connections = new Set<WorkspaceConnection>()
  #retentionConnection: WorkspaceConnection | undefined
  declare readonly builtinId?: WorkspaceOwnerOptions['builtinId']
  declare readonly root: string
  declare readonly openWorkspace: WorkspaceOwnerOptions['openWorkspace']
  declare readonly library: WorkspaceOwnerOptions['library']
  declare readonly timeoutMs: number
  declare readonly synchronize?: WorkspaceOwnerOptions['synchronize']
  declare readonly checkProject?: WorkspaceOwnerOptions['checkProject']
  constructor({
    root,
    openWorkspace,
    library,
    synchronize,
    checkProject,
    builtinId,
    timeoutMs = 120000,
  }: WorkspaceOwnerOptions) {
    this.builtinId = builtinId
    this.root = root
    this.openWorkspace = openWorkspace
    this.library = library
    this.checkProject = checkProject
    this.timeoutMs = timeoutMs
    this.synchronize = synchronize
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
      try {
        await this.synchronize?.(workspace)
      } catch (error) {
        await workspace.close()
        throw error
      }
      this.#workspace = workspace
      return workspace
    })().catch(error => {
      this.#opening = undefined
      throw error
    })
    return this.#opening
  }
  #retention<Kind extends 'retention.list' | 'retention.put' | 'retention.remove'>(kind: Kind, input: object) {
    if (!this.#retentionConnection) throw failure('RETENTION_UNAVAILABLE')
    return this.#retentionConnection.callback(kind, input)
  }
  attach(child: WorkspaceChild, openClientWorkspace?: OpenClientWorkspace) {
    const leases = new Map<string, () => Promise<void>>(),
      pending = new Map<string, CallbackPending>(),
      controllers = new Map<string, AbortController>(),
      active = new Set<string>()
    let detached = false
    const send = (message: object) => {
      if (detached || !child.connected) throw failure('HOST_UNAVAILABLE')
      child.send(message, error => {
        if (error) disconnect()
      })
    }
    const callback: WorkspaceCallback = <Kind extends keyof CallbackResults>(
      kind: Kind,
      input: object,
      requestId?: string,
    ) =>
      new Promise<CallbackResults[Kind]>((resolve, reject) => {
        const id = randomUUID()
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(failure('WORKSPACE_CALLBACK_TIMEOUT'))
        }, this.timeoutMs)
        pending.set(id, {
          resolve: value => {
            clearTimeout(timer)
            resolve(value as CallbackResults[Kind])
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
    const dispatch = async (message: WorkspaceRequest): Promise<unknown> => {
      const { id, method, args } = message
      if (method === 'close') {
        await releaseLeases()
        return null
      }
      const workspace = await this.ready()
      if (method === 'knowsOfficialMaterial') return this.library.knowsOfficialMaterial(...(args as [digest: string]))
      if (method === 'describe')
        return {
          workspaceId: workspace.workspaceId,
          root: workspace.root,
          bootId: workspace.bootId,
          builtinEnvironmentId: this.builtinId?.(),
          builtinEnvironmentAliases: workspace.builtinEnvironmentAliases,
          builtinEnvironmentIds: workspace.builtinEnvironmentIds,
        }
      if ((method === 'listClientEnvironmentIds' || method === 'acquireClientEnvironment') && !openClientWorkspace)
        throw failure('WORKSPACE_METHOD_INVALID')
      if (method === 'listClientEnvironmentIds') {
        const local = await openClientWorkspace!()
        return (await local.listInstallations())
          .filter(item => item.status === 'ready')
          .map(item => item.installationId)
      }
      if (method === 'acquire' || method === 'acquireClientEnvironment') {
        const source = method === 'acquire' ? workspace : await openClientWorkspace!()
        const lease = await source.acquire(...(args as Parameters<ContentWorkspace['acquire']>))
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
        const token = args[0] as string
        const release = leases.get(token)
        leases.delete(token)
        await release?.()
        return null
      }
      if (method === 'prepareEnvironment' || method === 'importEnvironment' || method === 'restoreSnapshot') {
        const controller = controllers.get(id)!
        controller.signal.throwIfAborted()
        const prepare: StaticPreparer = async input => {
          await this.checkProject?.(input.directory, controller.signal)
          return callback('prepare', { directory: input.directory, draft: input.draft }, id)
        }
        let projectLease: ContentProjectLease | undefined
        try {
          if (method === 'importEnvironment') {
            const [bundle, options] = args as [Parameters<ContentWorkspace['importEnvironment']>[0], ImportRequest?]
            return await workspace.importEnvironment(
              bundle,
              {
                ...options,
                signal: controller.signal,
                ...(options?.hasBeforeCommit ? { beforeCommit: () => callback('beforeCommit', {}, id) } : {}),
              },
              prepare,
            )
          }
          if (method === 'restoreSnapshot') {
            const [snapshot, options] = args as Parameters<ContentWorkspace['restoreSnapshot']>
            return await workspace.restoreSnapshot(snapshot, options, prepare)
          }
          const input: PrepareRequest & PrepareEnvironmentInput = {
            ...(args[0] as PrepareRequest),
            signal: controller.signal,
          }
          if (input.hasBeforeCommit) input.beforeCommit = () => callback('beforeCommit', {}, id)
          delete input.hasBeforeCommit
          if (input.hasProgress) input.onProgress = progress => callback('progress', progress, id)
          delete input.hasProgress
          if (!input.projectDirectory && !input.directory) {
            const draft = await workspace.getDraft(input.environmentId).catch(error => {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
              return undefined
            })
            if ((draft?.revision ?? null) !== input.expectedRevision) throw failure('REVISION_CONFLICT')
            projectLease = await this.library.prepareEnvironmentProject(input.document ?? draft!.document, {
              projectDirectory: input.seedDirectory ?? join(workspace.root, 'environments', input.environmentId),
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
      const key = method as keyof ContentWorkspace
      if (!methods.has(key)) throw failure('WORKSPACE_METHOD_INVALID')
      // The typed desktop proxy supplies the tuple for each allowlisted method.
      return (workspace[key] as (...args: unknown[]) => Promise<unknown>)(...args)
    }
    const onMessage = (message: ChildMessage | null | undefined) => {
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
      const { id, method, args } = message
      if (active.has(id)) return
      active.add(id)
      if (['prepareEnvironment', 'importEnvironment', 'restoreSnapshot'].includes(method))
        controllers.set(id, new AbortController())
      void dispatch({ id, method, args })
        .then(
          value => {
            if (!detached) send({ type: 'arcadia.desktop.workspace.result', id, ok: true, value: value ?? null })
            if (method === 'close') detach()
          },
          error => {
            if (!detached) send({ type: 'arcadia.desktop.workspace.result', id, ok: false, error: messageError(error) })
          },
        )
        .catch(() => {})
        .finally(() => active.delete(id))
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
