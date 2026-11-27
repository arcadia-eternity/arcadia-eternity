import { isDeepStrictEqual } from 'node:util'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import type {
  ContentWorkspace,
  EnvironmentDocument,
  EnvironmentExport,
  EnvironmentExportMode,
  EnvironmentExportPreview,
  EnvironmentImportProbe,
  EnvironmentInstallation,
  PrepareEnvironmentInput,
  resolveEnvironmentPackageChange,
  EnvironmentPackageChange,
  StaticPreparer,
  UnavailableInstallation,
} from '@arcadia-eternity/content-sdk/management-workspace'
import type { ContentLibrary } from './content-library.ts'

const fail = (code: string, message = code) => Object.assign(new Error(message), { code })
function safeInstallation(
  version: EnvironmentInstallation,
): Omit<EnvironmentInstallation, 'directory' | 'materialDirectory'>
function safeInstallation(version: EnvironmentInstallation | UnavailableInstallation): PublicInstallation
function safeInstallation(version: EnvironmentInstallation | UnavailableInstallation) {
  const {
    directory: _directory,
    materialDirectory: _materialDirectory,
    ...metadata
  } = version as typeof version & { directory?: string; materialDirectory?: string }
  return metadata
}

type PublicInstallation = Omit<EnvironmentInstallation, 'directory' | 'materialDirectory'> | UnavailableInstallation

interface BuiltinEnvironment {
  workspace: ContentWorkspace
  id: string
}

type EnvironmentLibrary = Pick<ContentLibrary, 'prepareEnvironmentProject' | 'saveEnvironmentMember' | 'copyMember'> &
  Partial<Pick<ContentLibrary, 'acquireInitialEnvironment' | 'retireLegacySelection'>>

type RecipeSource = { kind: 'archive'; file: string } | { kind: 'npm'; spec: string }

interface LocalEnvironmentOptions {
  openWorkspace: () => Promise<ContentWorkspace>
  library: EnvironmentLibrary
  validate: StaticPreparer
  acquireRecipe: (
    source: RecipeSource,
    destination: string,
    options: { signal: AbortSignal; offline: boolean },
  ) => Promise<{ document: EnvironmentDocument; directory: string; integrity?: string }>
  resolvePackageChange: typeof resolveEnvironmentPackageChange
  baseRules?: EnvironmentDocument['rules']
  openBuiltin?: () => Promise<BuiltinEnvironment | undefined>
}

type OperationProgress = Parameters<NonNullable<PrepareEnvironmentInput['onProgress']>>[0]
type OperationResult =
  Exclude<PublicInstallation, UnavailableInstallation> | { environmentId: string } | { packageId: string }
type ExecuteOperation = (signal: AbortSignal, progress: (event: OperationProgress) => void) => Promise<OperationResult>

interface LocalEnvironmentJob {
  id: string
  kind: string
  status: 'queued' | 'running' | 'cancelled' | 'failed' | 'succeeded'
  createdAt: number
  updatedAt?: number
  progress?: OperationProgress
  result?: OperationResult
  error?: { code: string; message: string }
  controller: AbortController
  execute: ExecuteOperation
  promise?: Promise<void>
}

interface ApplyOptions {
  expectedRevision: string | null
  copyFrom?: string
  allowDownload?: boolean
}

/** Rejects an acquired recipe before it is applied, for example against a signed workshop index. */
export type RecipeCheck = (recipe: { directory: string; integrity?: string }) => void | Promise<void>

interface RecipeRequest {
  action: 'install-recipe'
  source: { kind: 'file' } | Extract<RecipeSource, { kind: 'npm' }>
  environmentId?: string
  allowDownload?: boolean
}

type InstallationTarget =
  { environmentId: string; installationId?: string } | { environmentId?: string; installationId: string }

type LocalEnvironmentRequest =
  | RecipeRequest
  | { action: 'snapshot' | 'clear-completed' }
  | ({ action: 'select' | 'export-preview' } & InstallationTarget)
  | ({ action: 'export'; mode?: EnvironmentExportMode } & InstallationTarget)
  | (EnvironmentPackageChange & { allowDownload?: boolean })
  | ({ action: 'apply'; document: EnvironmentDocument } & ApplyOptions)
  | { action: 'delete-draft'; environmentId: string; expectedRevision: string }
  | { action: 'clear-installation'; installationId: string }
  | { action: 'save-member'; environmentId: string; name: string; integrity: string }
  | {
      action: 'use-member'
      environmentId: string
      name: string
      integrity: string
      targetId: string
      expectedRevision: string
    }
  | { action: 'import'; environmentId?: string; bundle: EnvironmentExport; allowDownload?: boolean }
  | { action: 'import-preview'; probe: EnvironmentImportProbe }
  | { action: 'cancel' | 'retry'; operationId: string }

interface RequestOptions {
  chooseRecipeArchive?: () => Promise<string | null | undefined>
}

type RequestResult =
  | Awaited<ReturnType<LocalEnvironments['snapshot']>>
  | EnvironmentExport
  | EnvironmentExportPreview
  | { operationId: string }
  | { deleted: boolean }
  | { cancelled: boolean }
  | { cleared: boolean }
  | string[]
  | null

interface LocalSelection {
  environmentId: string
  builtinAliases?: string[]
  checkedBuiltinIds?: (string | undefined)[]
}

const hasErrorCode = (error: unknown, code: string) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === code

/** The local library owns persistent environment npm projects without a server process.
 * Local hosting borrows read leases for its room catalog. Persistent server bindings live in the management workspace.
 */
export class LocalEnvironments {
  #opening?: Promise<ContentWorkspace>
  #builtin?: BuiltinEnvironment
  #builtinIds: string[] = []
  #aliases = new Set<string>()
  #selectedId?: string
  #jobs = new Map<string, LocalEnvironmentJob>()
  #closed = false
  #tail = Promise.resolve()
  declare readonly openBuiltin: LocalEnvironmentOptions['openBuiltin']
  declare readonly baseRules: LocalEnvironmentOptions['baseRules']
  declare readonly openWorkspace: LocalEnvironmentOptions['openWorkspace']
  declare readonly library: LocalEnvironmentOptions['library']
  declare readonly validate: LocalEnvironmentOptions['validate']
  declare readonly acquireRecipe: LocalEnvironmentOptions['acquireRecipe']
  declare readonly resolvePackageChange: LocalEnvironmentOptions['resolvePackageChange']

  constructor({
    openWorkspace,
    library,
    validate,
    acquireRecipe,
    resolvePackageChange,
    baseRules,
    openBuiltin,
  }: LocalEnvironmentOptions) {
    this.openBuiltin = openBuiltin
    this.baseRules = baseRules
    this.openWorkspace = openWorkspace
    this.library = library
    this.validate = validate
    this.acquireRecipe = acquireRecipe
    this.resolvePackageChange = resolvePackageChange
  }
  ready() {
    if (this.#closed) throw fail('WORKSPACE_CLOSED', '环境库已关闭')
    this.#opening ??= this.openWorkspace()
      .then(async workspace => {
        try {
          this.#builtin = await this.openBuiltin?.()
          this.#builtinIds = this.#builtin
            ? [...new Set([this.#builtin.id, ...Object.values(this.#builtin.workspace.builtinEnvironmentIds ?? {})])]
            : []
          const file = join(workspace.root, 'local-selection.json')
          const saved = await readFile(file, 'utf8').catch(error => {
            if (!hasErrorCode(error, 'ENOENT')) throw error
          })
          const selection: LocalSelection | undefined = saved ? JSON.parse(saved) : undefined
          const aliases = selection?.builtinAliases ?? []
          if (
            !Array.isArray(aliases) ||
            aliases.some(id => typeof id !== 'string' || !/^local-[a-f0-9-]{36}$/.test(id))
          )
            throw fail('INVALID_LOCAL_SELECTION')
          this.#aliases = new Set(aliases)
          // Older selections only recorded that the previous default had been checked for name conflicts.
          const sharedAliases = this.#builtin?.workspace.builtinEnvironmentAliases ?? {}
          const previousDefault =
            Object.entries(sharedAliases).find(([, id]) => id === this.#builtin?.id)?.[0] ?? this.#builtin?.id
          const checkedIds = selection?.checkedBuiltinIds ?? (selection?.builtinAliases ? [previousDefault] : [])
          const newIds = this.#builtinIds.filter(id => !checkedIds.includes(id))
          if (this.#builtin && (newIds.length || selection?.builtinAliases === undefined)) {
            const builtin = await this.#builtin.workspace.getInstallation(this.#builtin.id)
            const drafts = await workspace.listDrafts()
            for (const draft of drafts) {
              if (newIds.includes(draft.document.id)) {
                // The old personal and server workspaces allowed independently chosen IDs.
                const copy = { ...draft.document, id: 'previous-local-' + draft.revision.slice(0, 20) }
                const preserved = drafts.find(item => item.document.id === copy.id)
                if (preserved && !isDeepStrictEqual(preserved.document, copy))
                  throw fail('BUILTIN_MIGRATION_COPY_CONFLICT')
                if (!preserved) {
                  const prior = (await workspace.listInstallations(draft.document.id))[0]
                  if (prior?.status === 'ready') {
                    await workspace.prepareEnvironment(
                      {
                        environmentId: copy.id,
                        document: copy,
                        projectDirectory: prior.directory,
                        expectedRevision: null,
                      },
                      this.validate,
                    )
                  } else await workspace.saveDraft({ document: copy, expectedRevision: null })
                }
                if (selection?.environmentId === draft.document.id) selection.environmentId = copy.id
                continue
              }
              // Only fold the automatically generated, unmodified base environment.
              if (
                selection?.builtinAliases !== undefined ||
                !/^local-[a-f0-9-]{36}$/.test(draft.document.id) ||
                !isDeepStrictEqual({ ...draft.document, id: builtin.environmentId }, builtin.document)
              )
                continue
              const installed = (await workspace.listInstallations(draft.document.id))[0]
              if (
                installed?.status === 'ready' &&
                installed.contentRevision === builtin.contentRevision &&
                installed.draftRevision === draft.revision
              )
                this.#aliases.add(draft.document.id)
            }
          }
          if (selection) {
            if (typeof selection.environmentId !== 'string') throw fail('INVALID_LOCAL_SELECTION')
            this.#selectedId = this.#source(workspace, selection.environmentId).id
            if (
              this.#builtin &&
              (newIds.length || selection.builtinAliases === undefined || this.#selectedId !== selection.environmentId)
            )
              await this.#saveSelection(workspace, this.#selectedId)
          } else if (this.library?.acquireInitialEnvironment) {
            // Copy the last working legacy selection once. Never replace existing user environments.
            const lease = await this.library.acquireInitialEnvironment()
            try {
              if (this.#builtin && !lease.legacy) {
                await this.#saveSelection(workspace, this.#builtin.id)
              } else {
                const id = `local-${randomUUID()}`
                const document: EnvironmentDocument = {
                  schemaVersion: 2,
                  id,
                  name: this.#builtin ? '原本机环境' : '默认环境',
                  packages: Object.fromEntries(lease.packages.map(pkg => [pkg.name, pkg.version])),
                  sources: [],
                  rules: (lease.packages.some(pkg => pkg.name === '@arcadia-eternity/data-pack-base') &&
                    this.baseRules) || { schemaVersion: 1 },
                  requires: {},
                }
                await workspace.prepareEnvironment(
                  { environmentId: id, document, expectedRevision: null, projectDirectory: lease.directory! },
                  this.validate,
                )
                await this.#saveSelection(workspace, id)
              }
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
  async #saveSelection(workspace: ContentWorkspace, environmentId: string) {
    const file = join(workspace.root, 'local-selection.json')
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(
        temporary,
        JSON.stringify({
          environmentId,
          ...(this.#builtin && { builtinAliases: [...this.#aliases], checkedBuiltinIds: this.#builtinIds }),
        }),
        { flag: 'wx' },
      )
      await rename(temporary, file)
      this.#selectedId = environmentId
    } finally {
      await rm(temporary, { force: true })
    }
  }
  #source(workspace: ContentWorkspace, id: string): BuiltinEnvironment {
    const builtin = this.#builtin
    if (builtin) {
      if (this.#aliases.has(id)) return builtin
      const aliases = builtin.workspace.builtinEnvironmentAliases
      if (aliases && Object.hasOwn(aliases, id)) return { workspace: builtin.workspace, id: aliases[id] }
      if (this.#builtinIds.includes(id)) return { workspace: builtin.workspace, id }
    }
    return { workspace, id }
  }
  async hostingWorkspace() {
    const workspace = await this.ready()
    return {
      listInstallations: async () =>
        (await workspace.listInstallations()).filter(
          item => this.#source(workspace, item.installationId).workspace === workspace,
        ),
      acquire: (id: string, owner?: string) => workspace.acquire(id, owner),
    }
  }
  async acquireProject(environmentId?: string) {
    const workspace = await this.ready()
    const id = environmentId ?? this.#selectedId
    if (!id) throw fail('LOCAL_ENVIRONMENT_NOT_SELECTED', '请选择本地使用的环境')
    const source = this.#source(workspace, id)
    return source.workspace.acquire(source.id, 'local-play')
  }
  async snapshot() {
    const workspace = await this.ready()
    const builtinWorkspace = this.#builtin?.workspace
    return {
      workspaceId: workspace.workspaceId,
      selectedEnvironmentId: this.#selectedId,
      builtinEnvironmentAliases: this.#builtin?.workspace.builtinEnvironmentAliases,
      environments: [
        ...(builtinWorkspace
          ? await Promise.all(
              this.#builtinIds.map(async id => ({ ...(await builtinWorkspace.getDraft(id)), builtin: true })),
            )
          : []),
        ...(await workspace.listDrafts()).filter(d => this.#source(workspace, d.document.id).workspace === workspace),
      ],
      installations: [
        ...(builtinWorkspace
          ? (await Promise.all(this.#builtinIds.map(id => builtinWorkspace.listInstallations(id)))).flat()
          : []),
        ...(await workspace.listInstallations()).filter(
          item => this.#source(workspace, item.installationId).workspace === workspace,
        ),
      ].map(safeInstallation),
      operations: [...this.#jobs.values()]
        .map(({ controller: _controller, promise: _promise, execute: _execute, ...job }) => job)
        .reverse(),
    }
  }
  /** Install an environment recipe into a new environment id. */
  async installRecipe(
    source: RecipeSource,
    input: { environmentId?: string; allowDownload?: boolean; verify?: RecipeCheck },
  ) {
    const workspace = await this.ready()
    return this.start('environment.install-recipe', async (signal, onProgress) => {
      const staging = join(workspace.root, 'staging', 'recipe-' + randomUUID())
      try {
        onProgress({ stage: 'resolving' })
        const acquired = await this.acquireRecipe(source, staging, {
          signal,
          offline: input.allowDownload !== true,
        })
        await input.verify?.(acquired)
        const document = { ...acquired.document, id: input.environmentId ?? acquired.document.id }
        signal.throwIfAborted()
        if (this.#source(workspace, document.id).workspace !== workspace)
          throw fail('BUILTIN_ENVIRONMENT_READ_ONLY', '内置环境为只读，请指定新的环境标识')
        // A partial installation can have materials even when its draft is missing.
        const exists = await lstat(join(workspace.root, 'environments', document.id)).catch(error => {
          if (!hasErrorCode(error, 'ENOENT')) throw error
        })
        if (exists) throw fail('ENVIRONMENT_ALREADY_EXISTS', '环境标识已存在，请指定新的环境标识')
        return await this.#apply(
          workspace,
          document,
          { expectedRevision: null, allowDownload: input.allowDownload },
          signal,
          onProgress,
          acquired.directory,
        )
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
    })
  }
  start(kind: string, execute: ExecuteOperation) {
    if (this.#closed) throw fail('WORKSPACE_CLOSED', '环境库已关闭')
    if ([...this.#jobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 30)
      throw fail('WORKSPACE_BUSY', '任务队列已满')
    const job: LocalEnvironmentJob = {
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
        const details = error as { code?: string; message?: string } | null | undefined
        job.error = { code: details?.code ?? 'ENVIRONMENT_FAILED', message: details?.message ?? '环境操作失败' }
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
  async waitForOperation(id: string) {
    const job = this.#jobs.get(id)
    if (!job) throw fail('OPERATION_NOT_FOUND')
    await job.promise
    if (job.status !== 'succeeded') throw fail(job.error?.code ?? 'ENVIRONMENT_FAILED', job.error?.message)
    return job.result!
  }
  async #apply(
    workspace: ContentWorkspace,
    document: EnvironmentDocument,
    { expectedRevision, copyFrom, allowDownload }: ApplyOptions,
    signal: AbortSignal,
    onProgress: (event: OperationProgress) => void,
    recipeDirectory?: string,
  ) {
    const environmentId = document.id
    const current = await workspace.getDraft(environmentId).catch(error => {
      if (!hasErrorCode(error, 'ENOENT')) throw error
      return undefined
    })
    if ((current?.revision ?? null) !== expectedRevision) throw fail('REVISION_CONFLICT')
    const origin = copyFrom ? this.#source(workspace, copyFrom) : undefined
    const seed =
      origin && expectedRevision === null ? await origin.workspace.acquire(origin.id, 'copy-environment') : undefined
    let lease
    try {
      lease = await this.library.prepareEnvironmentProject(document, {
        projectDirectory: seed?.directory ?? recipeDirectory ?? join(workspace.root, 'environments', environmentId),
        signal,
        offline: allowDownload !== true,
        onProgress,
      })
      return safeInstallation(
        await workspace.prepareEnvironment(
          {
            environmentId,
            document,
            expectedRevision,
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
  }
  async request(input: RecipeRequest, options?: RequestOptions): Promise<{ operationId: string } | null>
  async request(input: unknown, options?: RequestOptions): Promise<RequestResult>
  async request(value: unknown, { chooseRecipeArchive }: RequestOptions = {}): Promise<RequestResult> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('INVALID_REQUEST')
    const input = value as LocalEnvironmentRequest
    if (
      Buffer.byteLength(JSON.stringify(input)) >
      (['import', 'import-preview'].includes(input.action) ? 130 : 2) * 1024 * 1024
    )
      throw fail('REQUEST_TOO_LARGE')
    const workspace = await this.ready()
    const fields = input as LocalEnvironmentRequest & {
      environmentId?: string
      installationId?: string
      document?: EnvironmentDocument
      targetId?: string
      bundle?: EnvironmentExport
    }
    const source = this.#source(workspace, (fields.environmentId ?? fields.installationId)!)
    const targets: Partial<Record<LocalEnvironmentRequest['action'], string | undefined>> = {
      apply: fields.document?.id,
      'install-recipe': fields.environmentId,
      'add-package': fields.environmentId,
      'remove-package': fields.environmentId,
      'delete-draft': fields.environmentId,
      'clear-installation': fields.installationId,
      'use-member': fields.targetId,
      import: fields.environmentId || fields.bundle?.document?.id,
    }
    const target = targets[input.action]
    if (target && this.#source(workspace, target).workspace !== workspace)
      throw fail('BUILTIN_ENVIRONMENT_READ_ONLY', '内置环境为只读')
    switch (input.action) {
      case 'select': {
        return this.start('environment.select', async signal => {
          const lease = await source.workspace.acquire(source.id, 'select-local-play')
          try {
            signal.throwIfAborted()
            await this.#saveSelection(workspace, source.id)
            return { environmentId: source.id }
          } finally {
            await lease.release()
          }
        })
      }
      case 'snapshot':
        return this.snapshot()
      case 'install-recipe': {
        if (
          Object.keys(input).some(key => !['action', 'source', 'allowDownload', 'environmentId'].includes(key)) ||
          (input.allowDownload !== undefined && typeof input.allowDownload !== 'boolean') ||
          (input.environmentId !== undefined &&
            (typeof input.environmentId !== 'string' ||
              !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.environmentId) ||
              input.environmentId === 'default'))
        )
          throw fail('INVALID_REQUEST', '环境安装参数无效')
        let source: RecipeSource
        const requested = input.source
        if (requested?.kind === 'file' && Object.keys(requested).length === 1) {
          const file = await chooseRecipeArchive!()
          if (!file) return null
          source = { kind: 'archive', file }
        } else if (
          requested?.kind !== 'npm' ||
          Object.keys(requested).length !== 2 ||
          typeof requested.spec !== 'string' ||
          !requested.spec.length ||
          requested.spec.length > 256
        )
          throw fail('INVALID_REQUEST', '请选择本地 .tgz 或输入完整 npm 包名和版本')
        else source = requested
        return this.installRecipe(source, input)
      }
      case 'add-package':
      case 'remove-package': {
        const adding = input.action === 'add-package'
        const allowed = adding
          ? ['action', 'environmentId', 'expectedRevision', 'name', 'version', 'source', 'allowDownload']
          : ['action', 'environmentId', 'expectedRevision', 'name', 'cascade', 'allowDownload']
        if (Object.keys(input).some(key => !allowed.includes(key))) throw fail('INVALID_REQUEST')
        const change = await this.resolvePackageChange(workspace, input)
        return this.request({ action: 'apply', ...change, allowDownload: input.allowDownload })
      }
      case 'apply': {
        const document = structuredClone(input.document)
        return this.start('environment.apply', (signal, onProgress) =>
          this.#apply(workspace, document, input, signal, onProgress),
        )
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
          const origin = this.#source(workspace, input.environmentId)
          const source = await origin.workspace.acquire(origin.id, 'share-member')
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
        return source.workspace.previewEnvironmentExport(source.id)
      case 'import-preview':
        return workspace.missingEnvironmentArchives(input.probe)
      case 'export':
        return source.workspace.exportEnvironment(source.id, input.mode)
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
