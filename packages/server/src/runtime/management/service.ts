import { setEnvironmentPackageEnabled } from '@arcadia-eternity/content-sdk/management-workspace'
import type {
  ManagementCapabilities,
  ManagementOperation,
  ManagedEnvironmentInstallation,
} from '@arcadia-eternity/protocol'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  assertEnvironmentRequirements,
  validateEnvironmentRules,
} from '@arcadia-eternity/content-sdk/environment-rules'
import type {
  ContentWorkspace,
  EnvironmentInstallation,
  UnavailableInstallation,
  PrepareEnvironmentInput,
  StaticPreparer,
} from '@arcadia-eternity/content-sdk/management-workspace'
import type { DurableStorage, StoredRecord, StorageTransaction } from '@arcadia-eternity/database'
import {
  ManagementAuth,
  MANAGEMENT_ACTIONS,
  managementScopeKey,
  type ManagementActor,
  type ManagementScope,
} from './auth'
import { ManagementTransfers } from './transfers'
import { ManagementBackups } from './backups'
import { ManagementAccounts } from './accounts'
import type { AccountDirectory } from '../accounts/directory'
import type { SessionRegistry } from '../session'
import { managementFailure } from './http'
import {
  normalizeServerSettings,
  patchServerSettings,
  compareServerSettings,
  type ServerSettings,
  type ServerSettingsConstraints,
} from './settings'
import { OperationService, type Operation, type OperationContext } from './operations'
import { ServerEnvironmentRegistry, type EnvironmentAdmissionRules } from '../environments'
import type { RoomRegistry } from '../rooms'

export type WorkspaceInstallation = EnvironmentInstallation
export type ManagementWorkspace = Pick<
  ContentWorkspace,
  | 'workspaceId'
  | 'listDrafts'
  | 'saveDraft'
  | 'deleteDraft'
  | 'listInstallations'
  | 'getInstallation'
  | 'acquire'
  | 'retain'
  | 'releaseRetention'
  | 'prepareEnvironment'
  | 'clearInstallation'
  | 'exportEnvironment'
  | 'importEnvironment'
  | 'recoverImport'
  | 'forgetImport'
  | 'references'
>
export interface Binding {
  serverId: string
  workspaceId: string
  environmentId: string
  executionPolicy: 'server' | 'peer'
  enabled: boolean
  visibility: 'public' | 'private'
  matchmakingEnabled: boolean
  condition: 'applying' | 'available' | 'unavailable' | 'degraded'
  reason?: string
  observedBootId: string
}
export interface ManagedServer {
  name: string
  workspaceId: string
  defaultBindingId?: string
  settings?: ServerSettings
  /** Host-owned first-run state; never infer it from an empty binding list. */
  initialization?: {
    kind: 'builtin' | 'desktop' | 'npm'
    environmentId: string
    state: 'pending' | 'completed' | 'abandoned'
    bindingId?: string
  }
}
export interface ManagementRequest {
  method: string
  path: string
  /** Internal retry lineage; HTTP transports never deserialize this field. */
  retryOf?: string
  body?: unknown
  headers?: Record<string, string | undefined>
}
export interface ManagementResponse {
  status: number
  body: unknown
  headers?: Record<string, string>
}
export interface ManagementOptions {
  storage: DurableStorage
  workspace: ManagementWorkspace
  serverId: string
  environments: ServerEnvironmentRegistry
  rooms: RoomRegistry
  sessions: SessionRegistry
  accountDirectory?: AccountDirectory
  name?: string
  runtimeSettings?: ServerSettings
  listenAddress?: () => { host: string; port: number } | undefined
  settingsConstraints?: ServerSettingsConstraints
  /** Host-registered environment sources. Never populated from remote request paths. */
  resolveProject?: (environmentId: string) => Promise<string>
  prepareEnvironment?: (input: PrepareEnvironmentInput, validator: StaticPreparer) => Promise<EnvironmentInstallation>
  /** Official hosts must reject third-party server execution. */
  allowThirdPartyExecution?: boolean
  transferDirectory?: string
  /** Host-owned consistent capture; API callers cannot choose database or filesystem sources. */
  createServerBackup?: (signal: AbortSignal) => Promise<unknown>
  /** Opt-in first-run initializer. Existing server records are deliberately never backfilled. */
  initialization?: { kind: 'builtin' | 'desktop' | 'npm'; environmentId: string }
}
export class ManagementError extends Error {
  constructor(
    readonly code: string,
    readonly status = 422,
  ) {
    super(code)
  }
}
const fail = (code: string, status = 422): never => {
  throw new ManagementError(code, status)
}
const shippedBasePackage = '@arcadia-eternity/data-pack-base'
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST')
  return value as Record<string, unknown>
}
const text = (value: unknown, max = 128): string => {
  if (typeof value !== 'string' || !value.length || value.length > max || /\p{Cc}/u.test(value)) fail('INVALID_REQUEST')
  return value as string
}
const revision = (request: ManagementRequest) => {
  const raw = request.headers?.['if-match']
  if (!raw) fail('REVISION_REQUIRED', 428)
  const value = Number(raw?.replace(/^"|"$/g, ''))
  if (!Number.isSafeInteger(value) || value < 1) fail('INVALID_REVISION')
  return value
}
const flatten = <T extends object>(record: StoredRecord<T>) => {
  return { id: record.id, revision: record.revision, ...record.value }
}
const publicOperation = (op: Operation): ManagementOperation => {
  const { actor: _actor, input: _input, ...view } = op
  return view
}
const safeInstallation = (version: WorkspaceInstallation | UnavailableInstallation): ManagedEnvironmentInstallation => {
  if (version.status !== 'ready') return version
  const {
    directory: _directory,
    materialDirectory: _materialDirectory,
    ...publicVersion
  } = version as WorkspaceInstallation & { materialDirectory?: string }
  return publicVersion
}

/** Static preparation only; metadata capture does not execute author module code. */
export async function validateWorkspaceProject(
  { directory, signal }: { directory: string; signal?: AbortSignal },
  preparation: { effectPreparation?: 'compile' | 'prebuilt-only' } = {},
) {
  signal?.throwIfAborted()
  const temporary = new ServerEnvironmentRegistry()
  try {
    const descriptor = await temporary.prepareNpm(directory, { policy: { profile: 'self-hosted' } }, preparation)
    signal?.throwIfAborted()
    return { contentRevision: descriptor.runtime.contentRevision, packages: descriptor.packages }
  } catch (error) {
    const code = (error as { diagnostics?: { code?: string }[] }).diagnostics?.[0]?.code
    if (code && /^[A-Z][A-Z0-9_]+$/.test(code)) throw new ManagementError(code)
    throw error
  } finally {
    await temporary.stop()
  }
}

/** The shared local/HTTP application layer. Only the transports decide how an actor is authenticated. */
export class ManagementService {
  readonly auth: ManagementAuth
  readonly operations: OperationService
  readonly accounts: ManagementAccounts
  readonly transfers?: ManagementTransfers
  readonly backups?: ManagementBackups
  private collector?: ReturnType<typeof setInterval>
  private lastTransferCleanup = 0
  readonly bootId = randomUUID()
  private readonly activeRuntimes = new Map<string, string>()
  private readonly runtimes = new Map<string, { runtimeId: string; installationId: string }>()
  private pending: Promise<unknown> = Promise.resolve()
  private localSession?: { actor: ManagementActor; expiresAt: number }
  private readyPromise?: Promise<void>
  private closed = false
  constructor(readonly options: ManagementOptions) {
    this.auth = new ManagementAuth(options.storage)
    this.operations = new OperationService(options.storage, {
      bootId: this.bootId,
      ownerId: `${options.workspace.workspaceId}:${options.serverId}`,
    })
    this.accounts = new ManagementAccounts(
      options.storage,
      {
        serverId: options.serverId,
        directory: options.accountDirectory,
        sessions: options.sessions,
        revokeSession: session => options.rooms.revoke(session),
      },
      this.auth,
    )
    if (options.transferDirectory)
      this.transfers = new ManagementTransfers({
        storage: options.storage,
        workspace: options.workspace,
        operations: this.operations,
        auth: this.auth,
        directory: options.transferDirectory,
        validate: this.validator,
        beforeImport: (actor, environmentId) => this.authorizeEnvironmentUpdate(actor, environmentId),
        onImported: () => this.reconcile(),
      })
    if (options.transferDirectory && options.createServerBackup)
      this.backups = new ManagementBackups({
        storage: options.storage,
        auth: this.auth,
        operations: this.operations,
        directory: options.transferDirectory,
        serverId: options.serverId,
        workspaceId: options.workspace.workspaceId,
        createServerBackup: options.createServerBackup,
      })
  }
  private readonly validator: StaticPreparer = async input => {
    await this.assertRequiredPackages(input.draft)
    return validateWorkspaceProject(input, {
      effectPreparation: this.options.allowThirdPartyExecution ? 'compile' : 'prebuilt-only',
    })
  }
  private async builtinEnvironmentId() {
    const server = await this.options.storage.get<ManagedServer>('servers', this.options.serverId)
    const initialization = server?.value.initialization
    return initialization?.kind === 'builtin' ? initialization.environmentId : undefined
  }
  private async assertRequiredPackages(document: { id?: unknown; packages?: unknown }) {
    if (
      typeof document.id === 'string' &&
      document.id === (await this.builtinEnvironmentId()) &&
      !Object.hasOwn(object(document.packages), shippedBasePackage)
    )
      fail('DEFAULT_ENVIRONMENT_PACKAGE_REQUIRED', 409)
  }
  get serverScope(): ManagementScope {
    return { kind: 'server', id: this.options.serverId }
  }
  get workspaceScope(): ManagementScope {
    return { kind: 'workspace', id: this.options.workspace.workspaceId }
  }
  get ownerPermissions() {
    return [this.serverScope, this.workspaceScope].map(scope => ({
      scope,
      actions: [...MANAGEMENT_ACTIONS[scope.kind]],
    }))
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.catch(() => undefined).then(action)
    this.pending = result.catch(() => undefined)
    return result
  }
  ready(): Promise<void> {
    this.readyPromise ??= this.initialize()
    return this.readyPromise
  }
  private async initialize() {
    await this.options.environments.ready()
    await this.operations.ready()
    await this.transfers?.ready()
    await this.transfers?.cleanup()
    await this.backups?.ready()
    await this.backups?.cleanup()
    this.lastTransferCleanup = Date.now()
    const existing = await this.options.storage.get<ManagedServer>('servers', this.options.serverId)
    if (!existing)
      await this.options.storage.create('servers', {
        id: this.options.serverId,
        scope: managementScopeKey(this.serverScope),
        value: {
          name: this.options.name ?? this.options.serverId,
          workspaceId: this.options.workspace.workspaceId,
          settings: this.options.runtimeSettings ?? normalizeServerSettings(),
          ...(this.options.initialization
            ? { initialization: { ...this.options.initialization, state: 'pending' as const } }
            : {}),
        },
      })
    else if (existing.value.workspaceId !== this.options.workspace.workspaceId) fail('SERVER_WORKSPACE_MISMATCH', 409)
    await this.reconcile()
    this.collector = setInterval(() => {
      void this.exclusive(async () => {
        await this.collectRuntimes()
        if (Date.now() - this.lastTransferCleanup >= 60_000) {
          await this.transfers?.cleanup()
          await this.backups?.cleanup()
          this.lastTransferCleanup = Date.now()
        }
      }).catch(() => undefined)
    }, 1000)
    this.collector.unref()
  }
  private async bindings() {
    return this.options.storage.list<Binding>('bindings', managementScopeKey(this.serverScope))
  }
  private async authorizeEnvironmentUpdate(actor: ManagementActor, environmentId: string) {
    const bindings = (await this.options.storage.list<Binding>('bindings')).filter(
      row => row.value.workspaceId === this.options.workspace.workspaceId && row.value.environmentId === environmentId,
    )
    if (!bindings.length) return
    await this.auth.authorize(actor, this.workspaceScope, 'environment.use')
    for (const serverId of new Set(bindings.map(row => row.value.serverId)))
      await this.auth.authorize(actor, { kind: 'server', id: serverId }, 'publish')
  }
  private async binding(id: string) {
    const row = await this.options.storage.get<Binding>('bindings', id)
    if (
      !row ||
      row.value.serverId !== this.options.serverId ||
      row.value.workspaceId !== this.options.workspace.workspaceId
    )
      fail('BINDING_NOT_FOUND', 404)
    return row!
  }
  /** A marker is created only with a new server record, never reconstructed from current settings. */
  async pendingInitialization(kind: 'builtin' | 'desktop' | 'npm', environmentId: string): Promise<boolean> {
    await this.ready()
    const initialization = (await this.options.storage.get<ManagedServer>('servers', this.options.serverId))?.value
      .initialization
    return !!(
      initialization &&
      initialization.kind === kind &&
      initialization.environmentId === environmentId &&
      initialization.state === 'pending'
    )
  }
  async pendingInitializationInfo(): Promise<
    { kind: 'builtin' | 'desktop' | 'npm'; environmentId: string } | undefined
  > {
    await this.ready()
    const initialization = (await this.options.storage.get<ManagedServer>('servers', this.options.serverId))?.value
      .initialization
    if (!initialization || initialization.state !== 'pending') return undefined
    return { kind: initialization.kind, environmentId: initialization.environmentId }
  }
  /** Return only the binding durably claimed by this initializer, never a same-named draft. */
  async initializationBinding(
    kind: 'builtin' | 'desktop' | 'npm',
    environmentId: string,
  ): Promise<StoredRecord<Binding> | undefined> {
    await this.ready()
    const server = await this.options.storage.get<ManagedServer>('servers', this.options.serverId)
    const initialization = server?.value.initialization
    if (
      !initialization ||
      initialization.kind !== kind ||
      initialization.environmentId !== environmentId ||
      initialization.state === 'abandoned' ||
      !initialization.bindingId
    )
      return undefined
    const binding = await this.options.storage.get<Binding>('bindings', initialization.bindingId)
    if (
      !binding ||
      binding.value.serverId !== this.options.serverId ||
      binding.value.workspaceId !== this.options.workspace.workspaceId ||
      binding.value.environmentId !== environmentId
    ) {
      if (initialization.state === 'completed') return undefined
      fail('INITIALIZATION_BINDING_INVALID', 409)
    }
    return binding!
  }
  /** Persist the exact owned binding atomically with its creation for crash recovery. */
  async ensureInitializationBinding(
    kind: 'builtin' | 'desktop' | 'npm',
    environmentId: string,
  ): Promise<StoredRecord<Binding> | undefined> {
    await this.ready()
    const binding = await this.exclusive(() =>
      this.options.storage.transaction(async tx => {
        const server = await tx.get<ManagedServer>('servers', this.options.serverId)
        const initialization = server?.value.initialization
        if (
          !server ||
          !initialization ||
          initialization.kind !== kind ||
          initialization.environmentId !== environmentId ||
          initialization.state !== 'pending'
        )
          return undefined
        if (initialization.bindingId) {
          const binding = await tx.get<Binding>('bindings', initialization.bindingId)
          if (
            !binding ||
            binding.value.serverId !== this.options.serverId ||
            binding.value.workspaceId !== this.options.workspace.workspaceId ||
            binding.value.environmentId !== environmentId
          )
            fail('INITIALIZATION_BINDING_INVALID', 409)
          return binding!
        }
        const binding = await tx.create<Binding>('bindings', {
          id: randomUUID(),
          scope: managementScopeKey(this.serverScope),
          value: {
            serverId: this.options.serverId,
            workspaceId: this.options.workspace.workspaceId,
            environmentId,
            executionPolicy: 'server',
            enabled: false,
            visibility: 'private',
            matchmakingEnabled: false,
            condition: 'unavailable',
            observedBootId: this.bootId,
          },
        })
        await tx.replace('servers', server.id, server.revision, {
          ...server.value,
          initialization: { ...initialization, bindingId: binding.id },
        })
        return binding
      }),
    )
    if (binding) await this.options.workspace.retain(environmentId, `binding:${binding.id}`)
    return binding
  }
  async completeInitialization(
    kind: 'builtin' | 'desktop' | 'npm',
    environmentId: string,
    bindingId: string,
  ): Promise<void> {
    await this.ready()
    await this.exclusive(async () => {
      await this.options.storage.transaction(async tx => {
        const server = await tx.get<ManagedServer>('servers', this.options.serverId)
        const initialization = server?.value.initialization
        if (
          !server ||
          !initialization ||
          initialization.kind !== kind ||
          initialization.environmentId !== environmentId ||
          initialization.bindingId !== bindingId ||
          initialization.state !== 'pending'
        )
          return
        const binding = await tx.get<Binding>('bindings', bindingId)
        if (
          !binding ||
          binding.value.serverId !== this.options.serverId ||
          !binding.value.enabled ||
          binding.value.condition !== 'available' ||
          server.value.defaultBindingId !== bindingId
        )
          fail('INITIALIZATION_INCOMPLETE', 409)
        await tx.replace('servers', server.id, server.revision, {
          ...server.value,
          initialization: { ...initialization, state: 'completed' },
        })
      })
    })
  }
  /** Stop a pending host bootstrap when durable administrator configuration wins. */
  async abandonInitialization(kind: 'builtin' | 'desktop' | 'npm', environmentId: string): Promise<void> {
    await this.ready()
    await this.exclusive(async () => {
      const server = await this.options.storage.get<ManagedServer>('servers', this.options.serverId)
      const initialization = server?.value.initialization
      if (
        !server ||
        !initialization ||
        initialization.kind !== kind ||
        initialization.environmentId !== environmentId ||
        initialization.state !== 'pending'
      )
        return
      await this.options.storage.replace('servers', server.id, server.revision, {
        ...server.value,
        initialization: { ...initialization, state: 'abandoned' },
      })
    })
  }
  private async ensureRuntime(
    bindingId: string,
    installationId: string,
    executionPolicy: 'server' | 'peer' = 'server',
    force = false,
  ) {
    const version = await this.options.workspace.getInstallation(installationId)
    const key = `${bindingId}:${installationId}:${executionPolicy}:${version.createdAt}:${version.draftRevision}${force ? `:${randomUUID()}` : ''}`
    const existing = this.runtimes.get(key)
    if (existing) {
      this.activeRuntimes.set(bindingId, key)
      return existing.runtimeId
    }
    if (version.workspaceId !== this.options.workspace.workspaceId) fail('WORKSPACE_MISMATCH')
    assertEnvironmentRequirements(version.document.requires)
    validateEnvironmentRules(version.document.rules)
    const lease = await this.options.workspace.acquire(installationId, `server:${this.options.serverId}:${this.bootId}`)
    try {
      const descriptor = await this.options.environments.prepareNpm(
        lease.directory,
        {
          policy: {
            profile: executionPolicy === 'peer' || this.options.allowThirdPartyExecution ? 'self-hosted' : 'official',
          },
        },
        { effectPreparation: this.options.allowThirdPartyExecution ? 'compile' : 'prebuilt-only' },
      )
      if (
        executionPolicy === 'server' &&
        !this.options.allowThirdPartyExecution &&
        this.options.environments.hasThirdPartyPackages(descriptor.id)
      ) {
        await this.options.environments.retire(descriptor.id)
        fail('THIRD_PARTY_EXECUTION_FORBIDDEN', 403)
      }
      this.activeRuntimes.set(bindingId, key)
      await lease.release()
      this.runtimes.set(key, { installationId, runtimeId: descriptor.id })
      return descriptor.id
    } catch (error) {
      await lease.release()
      throw error
    }
  }
  private async applyPublication() {
    const rows = await this.bindings()
    const server = await this.options.storage.get<ManagedServer>('servers', this.options.serverId)
    const entries = []
    let defaultRuntimeId: string | undefined
    for (const row of rows) {
      const binding = row.value
      if (binding.condition !== 'available') continue
      const runtime = this.runtimes.get(this.activeRuntimes.get(row.id) ?? '')
      if (!runtime) continue
      const installation = await this.options.workspace.getInstallation(binding.environmentId)
      entries.push({
        runtimeId: runtime.runtimeId,
        environmentId: binding.environmentId,
        environmentName: installation.document.name,
        bindingId: row.id,
        executionPolicy: binding.executionPolicy,
        enabled: binding.enabled,
        public: binding.visibility === 'public',
        matchmaking: binding.matchmakingEnabled,
        rules: installation.document.rules as EnvironmentAdmissionRules | undefined,
      })
      if (row.id === server?.value.defaultBindingId && binding.enabled) defaultRuntimeId = runtime.runtimeId
    }
    this.options.environments.setPublication(entries, defaultRuntimeId)
  }
  async reconcile() {
    return this.exclusive(async () => {
      for (const row of await this.bindings()) await this.reloadBinding(row)
      await this.applyPublication()
    })
  }
  private async reloadBinding(row: StoredRecord<Binding>, force = false) {
    let reason: string | undefined
    try {
      await this.ensureRuntime(row.id, row.value.environmentId, row.value.executionPolicy, force)
    } catch (error) {
      const failure = error as { code?: string; diagnostics?: { code?: string }[] }
      reason = failure?.code ?? failure?.diagnostics?.[0]?.code ?? 'ENVIRONMENT_UNAVAILABLE'
    }
    return this.options.storage.replace('bindings', row.id, row.revision, {
      ...row.value,
      condition: reason ? 'unavailable' : 'available',
      reason,
      observedBootId: this.bootId,
    })
  }
  async capabilities(actor?: ManagementActor): Promise<ManagementCapabilities> {
    return {
      serverId: this.options.serverId,
      workspaceId: this.options.workspace.workspaceId,
      supportedFeatures: [
        'workspace.environments',
        'server.bindings',
        'server.players',
        'server.battles',
        'audit',
        'server.drain',
        'operations',
        'grants',
        'credentials',
        ...(this.accounts.enabled ? ['accounts'] : []),
        ...(this.transfers ? ['workspace.transfers'] : []),
        ...(this.backups ? ['server.backup'] : []),
      ],
      effectivePermissions: actor ? await this.auth.effectivePermissions(actor) : [],
      resourceRestrictions: [],
    }
  }
  private async audit(tx: StorageTransaction, actor: ManagementActor, action: string, target: string) {
    await tx.create('audit', {
      id: randomUUID(),
      scope: managementScopeKey(this.serverScope),
      value: { actor: actor.principalId, action, target, createdAt: Date.now() },
    })
  }
  private async startOperation(
    actor: ManagementActor,
    request: ManagementRequest,
    kind: string,
    scope: ManagementScope,
    input: unknown,
    work: (ctx: OperationContext) => Promise<unknown>,
  ) {
    const idempotencyKey = text(request.headers?.['idempotency-key'], 200)
    const result = await this.operations.submit(
      {
        kind,
        scope: managementScopeKey(scope),
        actor,
        input,
        idempotencyKey,
        ...(request.retryOf ? { retryOf: request.retryOf } : {}),
      },
      work,
    )
    return {
      status: 202,
      body: publicOperation(result),
      headers: { Location: `/api/management/v1/operations/${result.id}` },
    }
  }
  private async authorizeOperation(actor: ManagementActor, id: string): Promise<Operation> {
    const op = await this.operations.get(id)
    const kind = op.scope.startsWith('workspace:') ? 'workspace' : 'server'
    const scope: ManagementScope = { kind, id: op.scope.slice(kind.length + 1) }
    await this.auth.authorize(actor, scope, 'read')
    return op
  }
  private async reload(actor: ManagementActor, request: ManagementRequest, id: string) {
    await this.auth.authorize(actor, this.serverScope, 'publish')
    await this.auth.authorize(actor, this.workspaceScope, 'environment.use')
    const expectedRevision = revision(request)
    return this.startOperation(
      actor,
      request,
      'binding.reload',
      this.serverScope,
      { id, expectedRevision },
      async ctx =>
        this.exclusive(async () => {
          await ctx.checkCurrent()
          await this.auth.authorize(actor, this.serverScope, 'publish')
          await this.auth.authorize(actor, this.workspaceScope, 'environment.use')
          const current = await this.binding(id)
          if (current.revision !== expectedRevision) fail('REVISION_CONFLICT', 412)
          const updated = await this.reloadBinding(current, true)
          await this.applyPublication()
          if (updated.value.condition !== 'available') fail(updated.value.reason ?? 'ENVIRONMENT_UNAVAILABLE', 409)
          return flatten(updated)
        }),
    )
  }
  /** Called only by trusted private IPC; remote requests cannot select this authentication path. */
  async localRequest(request: ManagementRequest): Promise<ManagementResponse> {
    if (!this.localSession || this.localSession.expiresAt <= Date.now() + 60_000) {
      const issued = await this.auth.issueBootstrapCode(this.ownerPermissions, `local-owner:${this.options.serverId}`)
      this.localSession = await this.auth.exchangeBootstrap(issued.code)
    }
    try {
      return await this.request(this.localSession.actor, request)
    } catch (error) {
      return managementFailure(error)
    }
  }
  async request(actor: ManagementActor, request: ManagementRequest): Promise<ManagementResponse> {
    await this.ready()
    if (this.closed) fail('SERVER_STOPPED', 503)
    const path = request.path.replace(/^\/api\/management\/v1/, '').split('?')[0]
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent)
    const method = request.method.toUpperCase()
    const input = request.body === undefined ? {} : object(request.body)
    const ok = (body: unknown, status = 200) => ({ status, body })
    const page = <T>(items: T[], key: (item: T) => string) => {
      const query = new URL(request.path, 'http://management.local').searchParams
      const limit = query.has('limit') ? Number(query.get('limit')) : 100
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) fail('INVALID_PAGE_LIMIT', 422)
      const cursor = query.get('cursor') ?? ''
      if (cursor.length > 200) fail('INVALID_CURSOR', 422)
      const ordered = items
        .filter(item => key(item) > cursor)
        .sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
      const rows = ordered.slice(0, limit)
      return {
        rows,
        ...(ordered.length > limit ? { nextCursor: key(rows[rows.length - 1]) } : {}),
        observedAt: Date.now(),
      }
    }
    if (method === 'GET' && path === '/capabilities') return ok(await this.capabilities(actor))
    if (method === 'GET' && path === '/servers') {
      await this.auth.authorize(actor, this.serverScope, 'read')
      const row = (await this.options.storage.get<ManagedServer>('servers', this.options.serverId))!
      return ok({
        servers: [
          {
            ...flatten(row),
            ...this.options.rooms.managementStatus,
            status: 'running',
            runtimeSettings: this.options.runtimeSettings ?? normalizeServerSettings(),
            listenAddress: this.options.listenAddress?.(),
            ...compareServerSettings(
              row.value.settings ?? this.options.runtimeSettings ?? normalizeServerSettings(),
              this.options.runtimeSettings ?? normalizeServerSettings(),
            ),
          },
        ],
      })
    }
    if (method === 'GET' && path === '/audit') {
      await this.auth.authorize(actor, this.serverScope, 'read')
      const entries = await this.options.storage.list<{
        actor: string
        action: string
        target?: string
        principalId?: string
        grantId?: string
        reason?: string
        createdAt?: number
        at?: number
      }>('audit', managementScopeKey(this.serverScope))
      return ok({
        entries: entries
          .map(row => ({
            id: row.id,
            actor: row.value.actor,
            action: row.value.action,
            target: row.value.target ?? row.value.grantId ?? row.value.principalId ?? this.options.serverId,
            ...(row.value.reason ? { reason: row.value.reason } : {}),
            createdAt: row.value.createdAt ?? row.value.at ?? 0,
          }))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 200),
      })
    }
    if (method === 'GET' && path === '/workspaces') {
      await this.auth.authorize(actor, this.workspaceScope, 'read')
      return ok({ workspaces: [{ id: this.options.workspace.workspaceId, name: this.options.workspace.workspaceId }] })
    }
    if (parts[0] === 'workspaces') {
      if (parts[1] !== this.options.workspace.workspaceId) fail('WORKSPACE_NOT_FOUND', 404)
      if (this.transfers && parts[2] === 'import' && parts.length === 3 && method === 'POST')
        return ok(
          publicOperation(
            await this.transfers.import(actor, input.bundle, {
              ...(input.environmentId ? { environmentId: text(input.environmentId) } : {}),
              ...(input.expectedRevision !== undefined
                ? { expectedRevision: input.expectedRevision === null ? null : text(input.expectedRevision) }
                : {}),
              idempotencyKey: text(request.headers?.['idempotency-key']),
            }),
          ),
          202,
        )
      if (parts[2] === 'installations' && parts.length === 5) {
        if (parts[4] === 'references' && method === 'GET') {
          await this.auth.authorize(actor, this.workspaceScope, 'read')
          return ok(
            this.transfers
              ? await this.transfers.references(actor, parts[3])
              : { references: await this.options.workspace.references(parts[3]) },
          )
        }
        if (this.transfers && parts[4] === 'export' && method === 'POST')
          return ok(
            publicOperation(await this.transfers.export(actor, parts[3], text(request.headers?.['idempotency-key']))),
            202,
          )
      }
      if (parts[2] === 'environments') {
        if (method === 'GET' && parts.length === 3) {
          await this.auth.authorize(actor, this.workspaceScope, 'read')
          const builtinId = await this.builtinEnvironmentId()
          return ok({
            environments: (await this.options.workspace.listDrafts()).map(draft =>
              draft.document.id === builtinId ? { ...draft, requiredPackages: [shippedBasePackage] } : draft,
            ),
            installations: (await this.options.workspace.listInstallations()).map(safeInstallation),
          })
        }
        if (method === 'DELETE' && parts.length === 4) {
          await this.auth.authorize(actor, this.workspaceScope, 'delete')
          if ((await this.bindings()).some(row => row.value.environmentId === parts[3])) fail('ENVIRONMENT_IN_USE', 409)
          await this.options.workspace.deleteDraft({
            environmentId: parts[3],
            expectedRevision: text(request.headers?.['if-match']?.replace(/^"|"$/g, '')),
          })
          return ok({ deleted: true })
        }
        if ((method === 'POST' && parts.length === 3) || (method === 'PATCH' && parts.length === 4)) {
          await this.auth.authorize(actor, this.workspaceScope, 'edit')
          const document = object(input.document)
          if (parts.length === 4 && document.id !== parts[3]) fail('ENVIRONMENT_MISMATCH')
          await this.assertRequiredPackages(document)
          await this.authorizeEnvironmentUpdate(actor, text(document.id))
          const expectedRevision =
            input.expectedRevision === null
              ? null
              : text(input.expectedRevision ?? request.headers?.['if-match']?.replace(/^"|"$/g, ''))
          return ok(await this.options.workspace.saveDraft({ document, expectedRevision }))
        }
        if (method === 'POST' && parts[4] === 'package-state' && parts.length === 5) {
          await this.auth.authorize(actor, this.workspaceScope, 'edit')
          if (typeof input.enabled !== 'boolean' || (input.cascade !== undefined && typeof input.cascade !== 'boolean'))
            fail('INVALID_REQUEST')
          await this.authorizeEnvironmentUpdate(actor, parts[3])
          const name = text(input.name, 214)
          const workspace = this.options.workspace
          const builtin = parts[3] === (await this.builtinEnvironmentId())
          if (builtin && !input.enabled && name === shippedBasePackage)
            fail('DEFAULT_ENVIRONMENT_PACKAGE_REQUIRED', 409)
          return ok(
            await setEnvironmentPackageEnabled(
              builtin
                ? {
                    listDrafts: () => workspace.listDrafts(),
                    listInstallations: () => workspace.listInstallations(),
                    saveDraft: async draft => {
                      await this.assertRequiredPackages(object(draft.document))
                      return workspace.saveDraft(draft)
                    },
                  }
                : workspace,
              {
                environmentId: parts[3],
                expectedRevision: text(input.expectedRevision),
                name,
                enabled: input.enabled as boolean,
                cascade: input.cascade as boolean | undefined,
              },
            ),
          )
        }
        if (method === 'POST' && parts[4] === 'prepare' && parts.length === 5) {
          await this.auth.authorize(actor, this.workspaceScope, 'prepare')
          const environmentId = parts[3],
            expectedRevision = text(input.expectedRevision)
          await this.authorizeEnvironmentUpdate(actor, environmentId)
          return this.startOperation(
            actor,
            request,
            'environment.prepare',
            this.workspaceScope,
            { environmentId, expectedRevision },
            async ctx => {
              await this.auth.authorize(actor, this.workspaceScope, 'prepare')
              const projectDirectory = await this.options.resolveProject?.(environmentId)
              const prepare =
                this.options.prepareEnvironment ??
                this.options.workspace.prepareEnvironment.bind(this.options.workspace)
              const version = await prepare(
                {
                  environmentId,
                  expectedRevision,
                  projectDirectory,
                  signal: ctx.signal,
                  onProgress: progress => ctx.progress(progress),
                  beforeCommit: async () => {
                    await ctx.checkCurrent()
                    await this.auth.authorize(actor, this.workspaceScope, 'prepare')
                    await this.authorizeEnvironmentUpdate(actor, environmentId)
                  },
                },
                this.validator,
              )
              await ctx.checkCurrent()
              await this.auth.authorize(actor, this.workspaceScope, 'prepare')
              await this.reconcile()
              return safeInstallation(version)
            },
          )
        }
      }
      if (parts[2] === 'installations' && parts.length === 4 && method === 'DELETE') {
        await this.auth.authorize(actor, this.workspaceScope, 'delete')
        await this.options.workspace.clearInstallation(parts[3])
        return ok({ deleted: true })
      }
    }
    if (parts[0] === 'servers') {
      if (parts[1] !== this.options.serverId) fail('SERVER_NOT_FOUND', 404)
      if (this.backups && parts.length === 3 && parts[2] === 'backup' && method === 'POST') {
        const op = await this.backups.create(actor, text(request.headers?.['idempotency-key'], 200))
        return {
          status: 202,
          body: publicOperation(op),
          headers: { Location: `/api/management/v1/operations/${op.id}` },
        }
      }
      if (parts[2] === 'players' && parts.length === 3 && method === 'GET') {
        await this.auth.authorize(actor, this.serverScope, 'players.read')
        const { rows, ...metadata } = page(this.options.rooms.managementPlayers(), player => player.seatId)
        return ok({ players: rows, ...metadata })
      }
      if (parts[2] === 'battles') {
        if (method === 'GET' && (parts.length === 3 || parts.length === 4)) {
          await this.auth.authorize(actor, this.serverScope, 'battles.read')
          const battles = this.options.rooms.managementBattles()
          if (parts.length === 3) {
            const { rows, ...metadata } = page(battles, battle => battle.id)
            return ok({ battles: rows, ...metadata })
          }
          const battle = battles.find(battle => battle.id === parts[3])
          if (!battle) fail('BATTLE_NOT_FOUND', 404)
          return ok(battle)
        }
        if (method === 'POST' && parts.length === 5 && parts[4] === 'terminate') {
          await this.auth.authorize(actor, this.serverScope, 'battles.terminate')
          const id = text(parts[3])
          return this.startOperation(actor, request, 'battle.terminate', this.serverScope, { id }, async ctx => {
            await ctx.checkCurrent()
            await this.auth.authorize(actor, this.serverScope, 'battles.terminate')
            return this.options.rooms.terminateManagedBattle(id, async () => {
              await ctx.commit(
                async tx => {
                  await this.auth.authorizeInTransaction(tx, actor, this.serverScope, 'battles.terminate')
                  await tx.create('audit', {
                    id: randomUUID(),
                    scope: managementScopeKey(this.serverScope),
                    value: {
                      actor: actor.principalId,
                      action: 'battle.terminate',
                      target: id,
                      createdAt: Date.now(),
                    },
                  })
                },
                { finalize: false },
              )
            })
          })
        }
      }
      if (parts[2] === 'accounts') {
        if (parts.length === 3 && method === 'GET') {
          const query = new URL(request.path, 'http://management.local').searchParams
          return ok(
            await this.accounts.list(actor, {
              ...(query.has('limit') ? { limit: Number(query.get('limit')) } : {}),
              ...(query.has('cursor') ? { cursor: query.get('cursor')! } : {}),
            }),
          )
        }
        if (parts.length === 4 && method === 'GET') return ok(await this.accounts.status(actor, parts[3]))
        if (parts.length === 5 && parts[4] === 'deactivate' && method === 'POST')
          return ok(await this.accounts.deactivate(actor, parts[3]))
      }
      if (parts.length === 2 && method === 'PATCH') {
        await this.auth.authorize(actor, this.serverScope, 'settings.manage')
        return this.exclusive(async () => {
          const before = (await this.options.storage.get<ManagedServer>('servers', this.options.serverId))!
          const value = { ...before.value }
          if (input.name !== undefined) value.name = text(input.name, 120)
          if (input.settings !== undefined)
            value.settings = patchServerSettings(
              value.settings ?? this.options.runtimeSettings ?? normalizeServerSettings(),
              input.settings,
              this.options.settingsConstraints,
            )
          if (input.defaultBindingId === null) delete value.defaultBindingId
          else if (input.defaultBindingId !== undefined) {
            const binding = await this.binding(text(input.defaultBindingId))
            if (!binding.value.enabled || binding.value.condition !== 'available') fail('BINDING_UNAVAILABLE', 409)
            value.defaultBindingId = binding.id
          }
          const row = await this.options.storage.transaction(async tx => {
            await this.auth.authorizeInTransaction(tx, actor, this.serverScope, 'settings.manage')
            const saved = await tx.replace('servers', before.id, revision(request), value)
            await this.audit(tx, actor, 'server.update', before.id)
            return saved
          })
          await this.applyPublication()
          return ok({
            ...flatten(row),
            runtimeSettings: this.options.runtimeSettings ?? normalizeServerSettings(),
            ...compareServerSettings(
              row.value.settings ?? this.options.runtimeSettings ?? normalizeServerSettings(),
              this.options.runtimeSettings ?? normalizeServerSettings(),
            ),
          })
        })
      }
      if (parts[2] === 'drain' && parts.length === 3 && method === 'POST') {
        await this.auth.authorize(actor, this.serverScope, 'drain')
        if (input.draining !== undefined && typeof input.draining !== 'boolean') fail('INVALID_REQUEST')
        await this.options.rooms.setDraining(input.draining !== false)
        return ok(this.options.rooms.managementStatus)
      }
      if (parts[2] === 'bindings') {
        if (parts.length === 3 && method === 'GET') {
          await this.auth.authorize(actor, this.serverScope, 'read')
          return ok({ bindings: (await this.bindings()).map(flatten) })
        }
        if (parts.length === 3 && method === 'POST') {
          await this.auth.authorize(actor, this.serverScope, 'bindings.manage')
          await this.auth.authorize(actor, this.workspaceScope, 'environment.use')
          if (input.enabled === true || input.visibility === 'public' || input.matchmakingEnabled === true)
            await this.auth.authorize(actor, this.serverScope, 'publish')
          const value: Binding = {
            serverId: this.options.serverId,
            workspaceId: this.options.workspace.workspaceId,
            environmentId: text(input.environmentId),
            executionPolicy: 'server',
            enabled: false,
            visibility: 'private',
            matchmakingEnabled: false,
            condition: 'unavailable',
            observedBootId: this.bootId,
          }
          this.patchBinding(value, input)
          await this.options.workspace.getInstallation(value.environmentId)
          const row = await this.options.storage.transaction(async tx => {
            await this.auth.authorizeInTransaction(tx, actor, this.serverScope, 'bindings.manage')
            await this.auth.authorizeInTransaction(tx, actor, this.workspaceScope, 'environment.use')
            if (value.enabled || value.visibility === 'public' || value.matchmakingEnabled)
              await this.auth.authorizeInTransaction(tx, actor, this.serverScope, 'publish')
            const saved = await tx.create('bindings', {
              id: randomUUID(),
              scope: managementScopeKey(this.serverScope),
              value,
            })
            await this.audit(tx, actor, 'binding.create', saved.id)
            return saved
          })
          await this.options.workspace.retain(value.environmentId, `binding:${row.id}`)
          const loaded = await this.reloadBinding(row)
          await this.applyPublication()
          return ok(flatten(loaded), 201)
        }
        if (parts.length === 4 && method === 'PATCH') {
          await this.auth.authorize(actor, this.serverScope, 'bindings.manage')
          // Enabling or exposing a binding is a publication action, not just configuration editing.
          if (input.enabled === true || input.visibility === 'public' || input.matchmakingEnabled === true) {
            await this.auth.authorize(actor, this.serverScope, 'publish')
            await this.auth.authorize(actor, this.workspaceScope, 'environment.use')
          }
          return this.exclusive(async () => {
            const row = await this.binding(parts[3]),
              value = { ...row.value }
            this.patchBinding(value, input)
            if (!value.enabled) {
              const server = await this.options.storage.get<ManagedServer>('servers', this.options.serverId)
              if (server?.value.defaultBindingId === row.id) fail('DEFAULT_BINDING_REQUIRED', 409)
            }
            const saved = await this.options.storage.transaction(async tx => {
              await this.auth.authorizeInTransaction(tx, actor, this.serverScope, 'bindings.manage')
              if (value.enabled || value.visibility === 'public' || value.matchmakingEnabled) {
                await this.auth.authorizeInTransaction(tx, actor, this.serverScope, 'publish')
                await this.auth.authorizeInTransaction(tx, actor, this.workspaceScope, 'environment.use')
              }
              const result = await tx.replace('bindings', row.id, revision(request), value)
              await this.audit(tx, actor, 'binding.update', row.id)
              return result
            })
            await this.applyPublication()
            return ok(flatten(saved))
          })
        }
        if (parts.length === 5 && parts[4] === 'reload' && method === 'POST')
          return this.reload(actor, request, parts[3])
        if (parts.length === 4 && method === 'DELETE') {
          await this.auth.authorize(actor, this.serverScope, 'bindings.manage')
          return this.exclusive(async () => {
            const row = await this.binding(parts[3])
            const server = (await this.options.storage.get<ManagedServer>('servers', this.options.serverId))!
            if (server.value.defaultBindingId === row.id) fail('DEFAULT_BINDING_REQUIRED', 409)
            await this.options.storage.transaction(async tx => {
              await this.auth.authorizeInTransaction(tx, actor, this.serverScope, 'bindings.manage')
              await tx.delete('bindings', row.id, revision(request))
              await this.audit(tx, actor, 'binding.delete', row.id)
            })
            await this.applyPublication()
            await this.options.workspace.releaseRetention(`binding:${row.id}`)

            return ok({ deleted: true })
          })
        }
      }
    }
    if (this.transfers && parts[0] === 'transfers' && parts.length === 2 && method === 'GET') {
      const download = await this.transfers.download(actor, parts[1])
      try {
        return ok(JSON.parse(await readFile(download.file, 'utf8')))
      } finally {
        await download.release()
      }
    }
    if (this.backups && parts[0] === 'backups' && parts.length === 2 && method === 'GET')
      return ok(await this.backups.download(actor, parts[1]))
    if (parts[0] === 'operations') {
      if (parts.length === 1 && method === 'GET') {
        const permissions = await this.auth.effectivePermissions(actor)
        const scopes = new Set(
          permissions.filter(p => p.actions.includes('read')).map(p => managementScopeKey(p.scope)),
        )
        return ok({
          operations: (await this.operations.list()).filter(op => scopes.has(op.scope)).map(publicOperation),
        })
      }
      const op = await this.authorizeOperation(actor, parts[1])
      if (parts.length === 2 && method === 'GET') return ok(publicOperation(op))
      if (parts.length === 3 && parts[2] === 'retry' && method === 'POST') {
        const original = object(op.input)
        if (this.backups && op.kind === 'server.backup')
          return ok(
            publicOperation(await this.backups.retry(actor, op.id, text(request.headers?.['idempotency-key'], 200))),
            202,
          )
        if (this.transfers && ['environment.export', 'environment.import'].includes(op.kind))
          return ok(
            publicOperation(await this.transfers.retry(actor, op.id, text(request.headers?.['idempotency-key']))),
            202,
          )
        if (op.committed) fail('OPERATION_ALREADY_COMMITTED', 409)
        if (op.kind === 'battle.terminate')
          return this.request(actor, {
            ...request,
            path: `/servers/${encodeURIComponent(this.options.serverId)}/battles/${encodeURIComponent(text(original.id))}/terminate`,
            body: {},
            retryOf: op.id,
          })
        if (op.kind === 'environment.prepare')
          return this.request(actor, {
            ...request,
            path: `/workspaces/${this.options.workspace.workspaceId}/environments/${text(original.environmentId)}/prepare`,
            body: { expectedRevision: text(original.expectedRevision) },
            retryOf: op.id,
          })
        if (op.kind === 'binding.reload')
          return this.reload(
            actor,
            {
              ...request,
              headers: {
                ...request.headers,
                'if-match':
                  typeof original.expectedRevision === 'number'
                    ? String(original.expectedRevision)
                    : fail('INVALID_REVISION'),
              },
              retryOf: op.id,
            },
            text(original.id),
          )
        fail('OPERATION_RETRY_UNSUPPORTED', 409)
      }
      if (parts.length === 3 && parts[2] === 'cancel' && method === 'POST') {
        if (op.kind === 'server.backup') {
          if (!this.backups) fail('BACKUP_NOT_SUPPORTED', 409)
          await this.backups!.authorize(actor)
        } else if (op.kind === 'battle.terminate')
          await this.auth.authorize(actor, this.serverScope, 'battles.terminate')
        else if (op.kind === 'environment.prepare' || op.kind === 'environment.import')
          await this.auth.authorize(actor, this.workspaceScope, 'prepare')
        else if (op.kind === 'environment.export') await this.auth.authorize(actor, this.workspaceScope, 'export')
        else {
          await this.auth.authorize(actor, this.serverScope, 'publish')
          await this.auth.authorize(actor, this.workspaceScope, 'environment.use')
        }
        return ok(publicOperation(await this.operations.cancel(op.id)))
      }
    }
    if (parts[0] === 'grants') {
      if (parts.length === 1 && method === 'GET') {
        const grants = []
        for (const scope of [this.serverScope, this.workspaceScope]) {
          try {
            grants.push(...(await this.auth.listGrants(actor, scope)).map(flatten))
          } catch (error) {
            if ((error as { status?: number }).status !== 403) throw error
          }
        }
        return ok({ grants })
      }
      if (parts.length === 1 && method === 'POST') {
        const scope = object(input.scope) as unknown as ManagementScope
        this.checkOwnedScope(scope)
        return ok(
          flatten(
            await this.auth.grant(
              actor,
              { principalId: text(input.principalId), scope, actions: input.actions as string[] },
              request.headers?.['if-match'] ? revision(request) : undefined,
            ),
          ),
          201,
        )
      }
      if (parts.length === 3 && parts[2] === 'revoke' && method === 'POST') {
        await this.auth.revokeGrant(
          actor,
          parts[1],
          input.revision === undefined ? revision(request) : Number(input.revision),
        )
        return ok({ revoked: true })
      }
    }
    if (path === '/principals' && method === 'POST') {
      const scope = object(input.scope) as unknown as ManagementScope
      this.checkOwnedScope(scope)
      return ok(
        flatten(
          await this.auth.createPrincipal(actor, {
            scope,
            displayName: text(input.displayName),
            ...(input.id ? { id: text(input.id) } : {}),
            ...(input.accountId ? { accountId: text(input.accountId), serverId: this.options.serverId } : {}),
          }),
        ),
        201,
      )
    }
    if (path === '/credentials' && method === 'POST') {
      if (!Array.isArray(input.permissions)) fail('INVALID_PERMISSIONS')
      for (const permission of input.permissions as { scope: ManagementScope }[]) this.checkOwnedScope(permission.scope)
      return ok(await this.auth.createServiceToken(actor, input as never), 201)
    }
    if (path === '/credentials' && method === 'GET') return ok({ credentials: await this.auth.listCredentials(actor) })
    if (parts[0] === 'credentials' && parts.length === 3 && parts[2] === 'revoke' && method === 'POST') {
      await this.auth.revokeCredential(actor, parts[1])
      return ok({ revoked: true })
    }
    return fail('NOT_FOUND', 404)
  }
  private async collectRuntimes() {
    const bindings = new Set((await this.bindings()).map(row => row.id))
    for (const id of this.activeRuntimes.keys()) if (!bindings.has(id)) this.activeRuntimes.delete(id)
    const required = new Set(this.activeRuntimes.values())
    for (const [key, runtime] of this.runtimes) {
      if (required.has(key)) continue
      if (this.options.environments.retainedIds().includes(runtime.runtimeId)) {
        try {
          await this.options.environments.retire(runtime.runtimeId)
        } catch {
          continue
        }
      }
      if (!this.options.environments.retainedIds().includes(runtime.runtimeId)) {
        this.runtimes.delete(key)
      }
    }
  }
  private checkOwnedScope(scope: ManagementScope) {
    if (
      scope.kind === 'server'
        ? scope.id !== this.options.serverId
        : scope.kind !== 'workspace' || scope.id !== this.options.workspace.workspaceId
    )
      fail('SCOPE_NOT_FOUND', 404)
  }
  private patchBinding(value: Binding, input: Record<string, unknown>) {
    if (input.executionPolicy !== undefined) {
      if (!['server', 'peer'].includes(text(input.executionPolicy))) fail('INVALID_EXECUTION_POLICY')
      if (value.condition === 'available' && input.executionPolicy !== value.executionPolicy)
        fail('BINDING_EXECUTION_POLICY_IMMUTABLE', 409)
      value.executionPolicy = input.executionPolicy as 'server' | 'peer'
    }
    if (input.visibility !== undefined) {
      if (typeof input.visibility !== 'string' || !['public', 'private'].includes(input.visibility))
        fail('INVALID_VISIBILITY')
      value.visibility = input.visibility as Binding['visibility']
    }
    for (const key of ['enabled', 'matchmakingEnabled'] as const)
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'boolean') fail('INVALID_REQUEST')
        value[key] = input[key] as boolean
      }
  }
  async beginShutdown() {
    this.closed = true
    clearInterval(this.collector)
    await this.operations.close()
    await this.transfers?.close()
    await this.backups?.close()
  }
  async close() {
    await this.beginShutdown()
    await this.pending
    this.runtimes.clear()
  }
}
