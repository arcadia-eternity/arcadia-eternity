import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'

const fail = (code, message = code) => Object.assign(new Error(message), { code })
const safeInstallation = version => {
  const { directory, materialDirectory, ...metadata } = version
  return metadata
}
/** The local library owns persistent environment npm projects without a server process.
 * Local hosting borrows read leases for its room catalog. Persistent server bindings live in the management workspace.
 */
export class LocalEnvironments {
  #opening
  #selectedId
  #jobs = new Map()
  #closed = false
  #tail = Promise.resolve()
  constructor({ openWorkspace, library, validate, addPackage, removePackage, baseRules }) {
    this.baseRules = baseRules
    this.openWorkspace = openWorkspace
    this.library = library
    this.validate = validate
    this.addPackage = addPackage
    this.removePackage = removePackage
  }
  ready() {
    if (this.#closed) throw fail('WORKSPACE_CLOSED', '环境库已关闭')
    this.#opening ??= this.openWorkspace()
      .then(async workspace => {
        try {
          await this.library?.synchronizeEnvironments?.(workspace, this.validate)
          const file = join(workspace.root, 'local-selection.json')
          const saved = await readFile(file, 'utf8').catch(error => {
            if (error.code !== 'ENOENT') throw error
          })
          if (saved) {
            const selection = JSON.parse(saved)
            if (typeof selection.environmentId !== 'string') throw fail('INVALID_LOCAL_SELECTION')
            this.#selectedId = selection.environmentId
          } else if (this.library?.acquireInitialEnvironment) {
            // Copy the last working legacy selection once. Never replace existing user environments.
            const lease = await this.library.acquireInitialEnvironment()
            try {
              const id = `local-${randomUUID()}`
              const document = {
                schemaVersion: 2,
                id,
                name: '默认环境',
                packages: Object.fromEntries(lease.packages.map(pkg => [pkg.name, pkg.version])),
                sources: [],
                rules: (lease.packages.some(pkg => pkg.name === '@arcadia-eternity/data-pack-base') &&
                  this.baseRules) || { schemaVersion: 1 },
                requires: {},
              }
              await workspace.prepareEnvironment(
                { environmentId: id, document, expectedRevision: null, projectDirectory: lease.directory },
                this.validate,
              )
              await this.#saveSelection(workspace, id)
            } finally {
              await lease.release()
            }
          }
          // The package library no longer owns the user's runtime selection.
          if (this.#selectedId) await this.library?.retireLegacySelection?.()
          return workspace
        } catch (error) {
          await workspace.close()
          throw error
        }
      })
      .catch(error => {
        this.#opening = undefined
        throw error
      })
    return this.#opening
  }
  async #saveSelection(workspace, environmentId) {
    const file = join(workspace.root, 'local-selection.json')
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ environmentId }), { flag: 'wx' })
      await rename(temporary, file)
      this.#selectedId = environmentId
    } finally {
      await rm(temporary, { force: true })
    }
  }
  async acquireProject(environmentId) {
    const workspace = await this.ready()
    const id = environmentId ?? this.#selectedId
    if (!id) throw fail('LOCAL_ENVIRONMENT_NOT_SELECTED', '请选择本地使用的环境')
    return workspace.acquire(id, 'local-play')
  }
  async snapshot() {
    const workspace = await this.ready()
    return {
      workspaceId: workspace.workspaceId,
      selectedEnvironmentId: this.#selectedId,
      environments: await workspace.listDrafts(),
      installations: (await workspace.listInstallations()).map(safeInstallation),
      operations: [...this.#jobs.values()].map(({ controller, promise, execute, ...job }) => job).reverse(),
    }
  }
  start(kind, execute) {
    if (this.#closed) throw fail('WORKSPACE_CLOSED', '环境库已关闭')
    if ([...this.#jobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 30)
      throw fail('WORKSPACE_BUSY', '任务队列已满')
    const job = {
      id: randomUUID(),
      kind,
      status: 'queued',
      createdAt: Date.now(),
      controller: new AbortController(),
      execute,
    }
    const work = async () => {
      try {
        job.controller.signal.throwIfAborted()
        job.status = 'running'
        const result = await execute(job.controller.signal, progress => {
          job.controller.signal.throwIfAborted()
          job.progress = progress
          job.updatedAt = Date.now()
        })
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
    for (const [id, item] of this.#jobs)
      if (this.#jobs.size > 30 && !['queued', 'running'].includes(item.status)) this.#jobs.delete(id)
    job.promise = this.#tail.then(work)
    this.#tail = job.promise.catch(() => {})
    return { operationId: job.id }
  }
  async request(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('INVALID_REQUEST')
    if (
      Buffer.byteLength(JSON.stringify(input)) >
      (['import', 'import-preview'].includes(input.action) ? 130 : 2) * 1024 * 1024
    )
      throw fail('REQUEST_TOO_LARGE')
    const workspace = await this.ready()
    switch (input.action) {
      case 'select': {
        return this.start('environment.select', async signal => {
          const lease = await workspace.acquire(input.environmentId, 'select-local-play')
          try {
            signal.throwIfAborted()
            await this.#saveSelection(workspace, input.environmentId)
            return { environmentId: input.environmentId }
          } finally {
            await lease.release()
          }
        })
      }
      case 'snapshot':
        return this.snapshot()
      case 'add-package':
      case 'remove-package': {
        const adding = input.action === 'add-package'
        const allowed = adding
          ? ['action', 'environmentId', 'expectedRevision', 'name', 'version', 'source', 'allowDownload']
          : ['action', 'environmentId', 'expectedRevision', 'name', 'cascade', 'allowDownload']
        if (Object.keys(input).some(key => !allowed.includes(key))) throw fail('INVALID_REQUEST')
        const draft = await (adding ? this.addPackage : this.removePackage)(
          {
            listDrafts: () => workspace.listDrafts(),
            listInstallations: () => workspace.listInstallations(),
            saveDraft: async ({ document, expectedRevision }) => ({ document, revision: expectedRevision }),
          },
          input,
        )
        return this.request({ ...input, action: 'apply', document: draft.document })
      }
      case 'apply': {
        const document = structuredClone(input.document)
        const environmentId = document.id
        return this.start('environment.apply', async (signal, onProgress) => {
          const current = await workspace.getDraft(environmentId).catch(error => {
            if (error.code !== 'ENOENT') throw error
            return undefined
          })
          if ((current?.revision ?? null) !== input.expectedRevision) throw fail('REVISION_CONFLICT')
          const seed =
            input.copyFrom && input.expectedRevision === null
              ? await workspace.acquire(input.copyFrom, 'copy-environment')
              : undefined
          let lease
          try {
            lease = await this.library.prepareEnvironmentProject(document, {
              projectDirectory: seed?.directory ?? join(workspace.root, 'environments', environmentId),
              signal,
              offline: input.allowDownload !== true,
              onProgress,
            })
            return safeInstallation(
              await workspace.prepareEnvironment(
                {
                  environmentId,
                  document,
                  expectedRevision: input.expectedRevision,
                  projectDirectory: lease.directory,
                  signal,
                  onProgress,
                },
                this.validate,
              ),
            )
          } finally {
            await lease?.release()
            await seed?.release()
          }
        })
      }
      case 'delete-draft':
        if (input.environmentId === this.#selectedId) throw fail('ENVIRONMENT_IN_USE', '请先切换本地使用的环境')
        await workspace.deleteDraft({ environmentId: input.environmentId, expectedRevision: input.expectedRevision })
        return { deleted: true }
      case 'clear-installation':
        if (input.installationId === this.#selectedId) throw fail('ENVIRONMENT_IN_USE', '请先切换本地使用的环境')
        await workspace.clearInstallation(input.installationId)
        return { deleted: true }
      case 'save-member':
      case 'use-member': {
        return this.start('environment.' + input.action, async signal => {
          const source = await workspace.acquire(input.environmentId, 'share-member')
          try {
            const member = source.members?.find(item => item.name === input.name)
            if (!member?.archiveIntegrity || member.archiveIntegrity !== input.integrity)
              throw fail('REVISION_CONFLICT', '内容包已更改，请重新选择')
            if (input.action === 'save-member')
              return { packageId: await this.library.saveEnvironmentMember(source.directory, input.name, signal) }
            if (input.targetId === input.environmentId) throw fail('INVALID_REQUEST')
            const target = await workspace.getDraft(input.targetId)
            if (target.revision !== input.expectedRevision) throw fail('REVISION_CONFLICT')
            const directory = join(workspace.root, 'staging', 'member-' + randomUUID())
            await mkdir(directory)
            try {
              const targetDirectory = join(workspace.root, 'environments', input.targetId)
              const { archive } = await this.library.copyMember(
                source.directory,
                input.name,
                targetDirectory,
                directory,
                signal,
              )
              const document = {
                ...target.document,
                packages: { ...target.document.packages, [input.name]: 'file:' + archive },
                sources: target.document.sources.filter(name => name !== input.name),
              }
              return safeInstallation(
                await workspace.prepareEnvironment(
                  { environmentId: input.targetId, document, expectedRevision: target.revision, directory, signal },
                  this.validate,
                ),
              )
            } finally {
              await rm(directory, { recursive: true, force: true })
            }
          } finally {
            await source.release()
          }
        })
      }
      case 'export-preview':
        return workspace.previewEnvironmentExport(input.installationId)
      case 'import-preview':
        return workspace.missingEnvironmentArchives(input.probe)
      case 'export':
        return workspace.exportEnvironment(input.installationId, input.mode)
      case 'cancel': {
        const job = this.#jobs.get(input.operationId)
        if (!job) throw fail('OPERATION_NOT_FOUND')
        const cancellable = ['queued', 'running'].includes(job.status)
        if (cancellable) {
          job.controller.abort(fail('OPERATION_CANCELLED', '已取消'))
          if (job.status === 'queued') {
            job.status = 'cancelled'
            job.updatedAt = Date.now()
          }
        }
        return { cancelled: cancellable }
      }
      case 'clear-completed':
        for (const [id, job] of this.#jobs) if (!['queued', 'running'].includes(job.status)) this.#jobs.delete(id)
        return { cleared: true }
      case 'retry': {
        const job = this.#jobs.get(input.operationId)
        if (!job) throw fail('OPERATION_NOT_FOUND')
        if (!['failed', 'cancelled'].includes(job.status)) throw fail('OPERATION_NOT_RETRYABLE')
        return this.start(job.kind, job.execute)
      }
      case 'import':
        return this.start('environment.import', async signal =>
          safeInstallation(
            await workspace.importEnvironment(
              input.bundle,
              {
                environmentId: input.environmentId,
                expectedRevision: null,
                signal,
                allowDownload: input.allowDownload === true,
              },
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
    for (const job of this.#jobs.values())
      if (['queued', 'running'].includes(job.status)) job.controller.abort(fail('WORKSPACE_CLOSED'))
    await Promise.allSettled([...this.#jobs.values()].map(job => job.promise))
    const workspace = await this.#opening?.catch(() => undefined)
    await workspace?.close()
  }
}
