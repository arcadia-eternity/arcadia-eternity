import { randomUUID } from 'node:crypto'

const fail = (code, message = code) => Object.assign(new Error(message), { code })
const safeVersion = version => {
  const { directory, materialDirectory, adopted, ...metadata } = version
  return metadata
}
/** The local library owns drafts and copied immutable versions without a server process.
 * Published servers import their own copy; no server binding points into this workspace.
 */
export class LocalEnvironments {
  #opening
  #jobs = new Map()
  #closed = false
  constructor({ openWorkspace, library, validate }) {
    this.openWorkspace = openWorkspace
    this.library = library
    this.validate = validate
  }
  ready() {
    if (this.#closed) throw fail('WORKSPACE_CLOSED', '环境库已关闭')
    this.#opening ??= this.openWorkspace().catch(error => {
      this.#opening = undefined
      throw error
    })
    return this.#opening
  }
  async snapshot() {
    const workspace = await this.ready()
    return {
      workspaceId: workspace.workspaceId,
      environments: await workspace.listDrafts(),
      versions: (await workspace.listVersions()).map(safeVersion),
      operations: [...this.#jobs.values()].map(({ controller, promise, ...job }) => job).reverse(),
    }
  }
  start(kind, execute) {
    if (this.#closed) throw fail('WORKSPACE_CLOSED', '环境库已关闭')
    if ([...this.#jobs.values()].some(job => job.status === 'running'))
      throw fail('WORKSPACE_BUSY', '请等待当前任务完成或取消后重试')
    const job = { id: randomUUID(), kind, status: 'running', createdAt: Date.now(), controller: new AbortController() }
    const work = async () => {
      try {
        const result = await execute(job.controller.signal)
        job.status = 'succeeded'
        job.result = result
      } catch (error) {
        job.status = job.controller.signal.aborted ? 'cancelled' : 'failed'
        job.error = { code: error.code ?? 'ENVIRONMENT_FAILED', message: error.message ?? '环境操作失败' }
      } finally {
        job.updatedAt = Date.now()
      }
    }
    this.#jobs.set(job.id, job)
    for (const [id, item] of this.#jobs) if (this.#jobs.size > 30 && item.status !== 'running') this.#jobs.delete(id)
    job.promise = work()
    return { operationId: job.id }
  }
  async request(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_REQUEST')
    if (Buffer.byteLength(JSON.stringify(input)) > (input.action === 'import' ? 130 : 2) * 1024 * 1024)
      throw fail('REQUEST_TOO_LARGE')
    const workspace = await this.ready()
    switch (input.action) {
      case 'snapshot':
        return this.snapshot()
      case 'save':
        return workspace.saveDraft({ document: input.document, expectedRevision: input.expectedRevision })
      case 'delete-draft':
        await workspace.deleteDraft({ environmentId: input.environmentId, expectedRevision: input.expectedRevision })
        return { deleted: true }
      case 'delete-version':
        await workspace.deleteVersion(input.versionId)
        return { deleted: true }
      case 'references':
        return { references: await workspace.references(input.versionId) }
      case 'export':
        return workspace.exportVersion(input.versionId)
      case 'cancel': {
        const job = this.#jobs.get(input.operationId)
        if (!job) throw fail('OPERATION_NOT_FOUND')
        if (job.status === 'running') job.controller.abort(fail('OPERATION_CANCELLED', '已取消'))
        return { cancelled: job.status === 'running' }
      }
      case 'prepare': {
        const environmentId = input.environmentId,
          expectedRevision = input.expectedRevision
        const draft = await workspace.getDraft(environmentId)
        if (draft.revision !== expectedRevision) throw fail('REVISION_CONFLICT', '环境已被修改，请刷新后重试')
        return this.start('environment.prepare', async signal => {
          const lease = await this.library.prepareEnvironmentProject(draft.document, {
            signal,
            offline: input.allowDownload !== true,
          })
          try {
            return safeVersion(
              await workspace.prepareVersion(
                { environmentId, expectedRevision, projectDirectory: lease.directory, signal },
                this.validate,
              ),
            )
          } finally {
            await lease.release()
          }
        })
      }
      case 'import':
        return this.start('environment.import', async signal =>
          safeVersion(
            await workspace.importVersion(
              input.bundle,
              { environmentId: input.environmentId, expectedRevision: null, signal },
              this.validate,
            ),
          ),
        )
      default:
        throw fail('INVALID_ACTION', '不支持的环境操作')
    }
  }
  async close() {
    this.#closed = true
    for (const job of this.#jobs.values()) if (job.status === 'running') job.controller.abort(fail('WORKSPACE_CLOSED'))
    await Promise.allSettled([...this.#jobs.values()].map(job => job.promise))
    const workspace = await this.#opening?.catch(() => undefined)
    await workspace?.close()
  }
}
