import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { DurableStorage, StorageTransaction, StoredRecord } from '@arcadia-eternity/database'

export interface ManagementScope {
  kind: 'workspace' | 'server'
  id: string
}
export interface ManagementPermission {
  scope: ManagementScope
  actions: string[]
}
export interface ManagementActor {
  principalId: string
  credentialId: string
  kind: 'session' | 'service'
}
export interface ManagementPrincipal {
  displayName: string
  status: 'active' | 'disabled'
  accountId?: string
  serverId?: string
}
export interface ManagementGrant extends ManagementPermission {
  principalId: string
}
interface Credential {
  /** Public management handle; storage keys remain token digests and never leave this module. */
  publicId?: string
  principalId: string
  kind: 'bootstrap' | 'session' | 'service' | 'passkey' | 'device'
  expiresAt: number
  createdAt: number
  parentId?: string
  label?: string
  secretHash?: string
  passkey?: { id: string; publicKey: string; counter: number; rpId: string }
  csrfHash?: string
  permissions?: ManagementPermission[]
  serverId?: string
  displayName?: string
  issuerPrincipalId?: string
}
export interface ServiceCredentialMetadata {
  id: string
  principalId: string
  createdAt: number
  expiresAt: number
  serverId: string
  legacyRestricted: boolean
}
export interface ManagementSession {
  token: string
  csrfToken: string
  expiresAt: number
  actor: ManagementActor
}
export class ManagementAuthError extends Error {
  constructor(
    readonly code: string,
    readonly status = 403,
  ) {
    super(code)
  }
}
export const MANAGEMENT_ACTIONS = {
  workspace: ['read', 'environment.use', 'edit', 'prepare', 'delete', 'export', 'grants.manage'],
  server: [
    'read',
    'bindings.manage',
    'publish',
    'settings.manage',
    'drain',
    'accounts.manage',
    'players.read',
    'battles.read',
    'battles.terminate',
    'grants.manage',
    'backup',
  ],
} as const

const fail = (code: string, status = 403): never => {
  throw new ManagementAuthError(code, status)
}
const secret = () => `ae_mgt_${randomBytes(32).toString('base64url')}`
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const sessionCsrf = (token: string) => hash(`arcadia-management-csrf\0${token}`)
const validText = (value: unknown, max = 128): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  value.trim() === value &&
  !/\p{Cc}/u.test(value)
export const managementScopeKey = (scope: ManagementScope): string => {
  if (!scope || !['server', 'workspace'].includes(scope.kind) || !validText(scope.id)) fail('INVALID_SCOPE', 422)
  return `${scope.kind}:${scope.id}`
}
// Only used to read pre-administrator credentials and migration records.
const matches = (permission: ManagementPermission, scope: ManagementScope, action: string) =>
  managementScopeKey(permission.scope) === managementScopeKey(scope) && permission.actions.includes(action)
interface AdministratorRoster {
  format: 'arcadia.administrators/1'
  workspaceId: string
  principalIds: string[]
}
export interface Administrator {
  principalId: string
  displayName: string
  accountId?: string
}

/** Host-issued bootstrap codes and all web/API credentials use the same durable authorization boundary. */
export class ManagementAuth {
  private readonly now: () => number
  private readonly sessionTtlMs: number
  private readonly bootstrapTtlMs: number
  constructor(
    private readonly store: DurableStorage,
    private readonly options: {
      serverId: string
      workspaceId: string
      now?: () => number
      sessionTtlMs?: number
      bootstrapTtlMs?: number
    },
  ) {
    if (!validText(options.serverId) || !validText(options.workspaceId)) fail('INVALID_SCOPE', 422)
    this.now = options.now ?? Date.now
    this.sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000
    this.bootstrapTtlMs = options.bootstrapTtlMs ?? 10 * 60 * 1000
    if (![this.sessionTtlMs, this.bootstrapTtlMs].every(value => Number.isSafeInteger(value) && value > 0))
      fail('INVALID_CREDENTIAL_TTL', 422)
  }

  private get rosterId() {
    return `administrators:${this.options.serverId}`
  }
  private ownedScope(scope: ManagementScope) {
    managementScopeKey(scope)
    if (scope.id !== (scope.kind === 'server' ? this.options.serverId : this.options.workspaceId))
      fail('MANAGEMENT_FORBIDDEN')
  }
  private fullLegacyPermissions(allowed: ManagementPermission[] = []) {
    return (['server', 'workspace'] as const).every(kind => {
      const scope = { kind, id: kind === 'server' ? this.options.serverId : this.options.workspaceId }
      return MANAGEMENT_ACTIONS[kind].every(action => allowed.some(p => matches(p, scope, action)))
    })
  }
  private async roster(tx: StorageTransaction) {
    const existing = await tx.get<AdministratorRoster>('grants', this.rosterId)
    if (existing) {
      if (
        existing.value.format !== 'arcadia.administrators/1' ||
        existing.value.workspaceId !== this.options.workspaceId
      )
        fail('SERVER_WORKSPACE_MISMATCH', 409)
      return existing
    }
    const servers = await tx.list<{ workspaceId: string }>('servers')
    if (servers.some(row => row.id !== this.options.serverId && row.value.workspaceId === this.options.workspaceId))
      fail('SHARED_WORKSPACE_MIGRATION_REQUIRED', 409)
    const legacy = (await tx.list<ManagementGrant>('grants')).filter(
      row => row.value.scope && Array.isArray(row.value.actions),
    )
    const candidates = [
      ...new Set(
        legacy
          .filter(row => row.value.scope.kind === 'server' && row.value.scope.id === this.options.serverId)
          .map(row => row.value.principalId),
      ),
    ]
    const principalIds: string[] = []
    for (const id of candidates) {
      const principal = await tx.get<ManagementPrincipal>('principals', id)
      if (
        principal?.value.status === 'active' &&
        (!principal.value.accountId ||
          (!!principal.value.serverId &&
            (await tx.accountStatus(principal.value.serverId, principal.value.accountId)) === 'active')) &&
        this.fullLegacyPermissions(legacy.filter(row => row.value.principalId === id).map(row => row.value))
      )
        principalIds.push(id)
    }
    // Reuse the existing document collection: old grants remain inert migration evidence.
    const result = await tx.create<AdministratorRoster>('grants', {
      id: this.rosterId,
      scope: `server:${this.options.serverId}`,
      value: { format: 'arcadia.administrators/1', workspaceId: this.options.workspaceId, principalIds },
    })
    await this.audit(tx, 'host', 'administrators.migrate', `server:${this.options.serverId}`, {
      principalIds,
      excludedPrincipalIds: candidates.filter(id => !principalIds.includes(id)),
    })
    return result
  }
  async ready() {
    await this.store.transaction(tx => this.roster(tx))
  }
  private async requireMember(tx: StorageTransaction, principalId: string) {
    await this.activePrincipal(tx, principalId)
    if (!(await this.roster(tx)).value.principalIds.includes(principalId)) fail('MANAGEMENT_FORBIDDEN')
  }
  /** Trusted host/CLI recovery, never an HTTP endpoint. */
  async issueBootstrapCode(ownerId = 'owner', displayName = 'Owner') {
    if (!validText(ownerId) || !validText(displayName, 80)) fail('INVALID_PRINCIPAL', 422)
    const code = secret(),
      expiresAt = this.now() + this.bootstrapTtlMs
    await this.store.transaction(async tx => {
      await this.roster(tx)
      await tx.create<Credential>('credentials', {
        id: hash(code),
        scope: ownerId,
        value: {
          principalId: ownerId,
          kind: 'bootstrap',
          expiresAt,
          createdAt: this.now(),
          serverId: this.options.serverId,
          displayName,
        },
      })
      await this.audit(tx, 'host', 'bootstrap.issue', `server:${this.options.serverId}`, {
        principalId: ownerId,
        expiresAt,
      })
    })
    return { code, expiresAt, principalId: ownerId }
  }

  async exchangeBootstrap(code: string): Promise<ManagementSession> {
    if (!validText(code, 256)) fail('INVALID_BOOTSTRAP_CODE', 401)
    const token = secret(),
      csrfToken = sessionCsrf(token),
      expiresAt = this.now() + this.sessionTtlMs
    return this.store.transaction(async tx => {
      const existing = await tx.get<Credential>('credentials', hash(code))
      if (!existing || existing.value.kind !== 'bootstrap' || existing.value.expiresAt <= this.now())
        return fail('INVALID_BOOTSTRAP_CODE', 401)
      if (existing.value.issuerPrincipalId) await this.requireMember(tx, existing.value.issuerPrincipalId)
      const principalId = existing.value.principalId
      await tx.delete('credentials', existing.id, existing.revision)
      const principal = await tx.get<ManagementPrincipal>('principals', principalId)
      if (!principal)
        await tx.create<ManagementPrincipal>('principals', {
          id: principalId,
          scope: 'management',
          value: { displayName: existing.value.displayName ?? 'Owner', status: 'active' },
        })
      else if (principal.value.status !== 'active')
        await tx.replace('principals', principal.id, principal.revision, {
          ...principal.value,
          status: 'active',
        })
      if (
        existing.value.serverId !== this.options.serverId &&
        (existing.value.serverId || !this.fullLegacyPermissions(existing.value.permissions))
      )
        fail('INVALID_BOOTSTRAP_CODE', 401)
      const roster = await this.roster(tx)
      if (!roster.value.principalIds.includes(principalId))
        await tx.replace('grants', roster.id, roster.revision, {
          ...roster.value,
          principalIds: [...roster.value.principalIds, principalId],
        })
      const credentialId = hash(token)
      await tx.create<Credential>('credentials', {
        id: credentialId,
        scope: principalId,
        value: {
          principalId,
          kind: 'session',
          expiresAt,
          createdAt: this.now(),
          csrfHash: hash(csrfToken),
          serverId: this.options.serverId,
        },
      })
      await this.audit(tx, principalId, 'bootstrap.exchange', 'management', { principalId })
      return { token, csrfToken, expiresAt, actor: { principalId, credentialId, kind: 'session' } }
    })
  }

  /** The host must obtain both IDs from an already verified player session, never from HTTP input. */
  async exchangeAccount(serverId: string, accountId: string): Promise<ManagementSession> {
    if (!validText(serverId) || !validText(accountId)) fail('INVALID_ACCOUNT', 422)
    const token = secret(),
      csrfToken = sessionCsrf(token),
      expiresAt = this.now() + this.sessionTtlMs
    return this.store.transaction(async tx => {
      if ((await tx.accountStatus(serverId, accountId)) !== 'active') fail('ACCOUNT_NOT_ACTIVE', 401)
      const principals = (await tx.list<ManagementPrincipal>('principals')).filter(
        row => row.value.serverId === serverId && row.value.accountId === accountId && row.value.status === 'active',
      )
      if (principals.length !== 1) return fail('MANAGEMENT_FORBIDDEN')
      const principalId = principals[0].id
      if (serverId !== this.options.serverId) fail('MANAGEMENT_FORBIDDEN')
      await this.requireMember(tx, principalId)
      const credentialId = hash(token)
      await tx.create<Credential>('credentials', {
        id: credentialId,
        scope: principalId,
        value: { principalId, kind: 'session', expiresAt, createdAt: this.now(), csrfHash: hash(csrfToken), serverId },
      })
      await this.audit(tx, principalId, 'account.session', `server:${serverId}`, { principalId })
      return { token, csrfToken, expiresAt, actor: { principalId, credentialId, kind: 'session' } }
    })
  }

  private async credential(tx: StorageTransaction, actor: ManagementActor) {
    if (
      !actor ||
      !validText(actor.principalId) ||
      !validText(actor.credentialId) ||
      !['session', 'service'].includes(actor.kind)
    )
      return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    const credential = await tx.get<Credential>('credentials', actor.credentialId)
    if (
      !credential ||
      credential.value.principalId !== actor.principalId ||
      credential.value.kind !== actor.kind ||
      credential.value.expiresAt <= this.now()
    )
      return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    await this.validateParent(tx, credential.value)
    await this.requireMember(tx, actor.principalId)
    if (credential.value.serverId !== undefined && credential.value.serverId !== this.options.serverId)
      fail('MANAGEMENT_FORBIDDEN')
    if (
      !credential.value.serverId &&
      credential.value.kind === 'session' &&
      !this.fullLegacyPermissions(credential.value.permissions)
    )
      fail('ADMIN_LOGIN_REQUIRED', 401)
    return credential
  }

  private async activePrincipal(tx: StorageTransaction, principalId: string) {
    if (!validText(principalId)) return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    const principal = await tx.get<ManagementPrincipal>('principals', principalId)
    if (!principal || principal.value.status !== 'active') return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    if (
      principal.value.accountId &&
      (!principal.value.serverId ||
        (await tx.accountStatus(principal.value.serverId, principal.value.accountId)) !== 'active')
    )
      return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    return principal
  }

  async authenticate(token: string | undefined): Promise<ManagementActor> {
    if (!validText(token, 256)) return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    const credentialId = hash(token)
    const credential = await this.store.get<Credential>('credentials', credentialId)
    if (!credential || !['session', 'service'].includes(credential.value.kind))
      return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    const actor: ManagementActor = {
      principalId: credential.value.principalId,
      credentialId,
      kind: credential.value.kind as ManagementActor['kind'],
    }
    await this.credential(this.store, actor)
    return actor
  }

  async sessionInfo(token: string): Promise<Omit<ManagementSession, 'token'>> {
    const actor = await this.authenticate(token)
    const credential = await this.credential(this.store, actor)
    if (actor.kind !== 'session') fail('SESSION_REQUIRED', 401)
    return { actor, csrfToken: sessionCsrf(token), expiresAt: credential.value.expiresAt }
  }

  private async authorizeIn(tx: StorageTransaction, actor: ManagementActor, scope: ManagementScope, action: string) {
    managementScopeKey(scope)
    const credential = await this.credential(tx, actor)
    if (
      credential.value.kind === 'service' &&
      credential.value.permissions &&
      !credential.value.permissions.some(permission => matches(permission, scope, action))
    )
      fail('MANAGEMENT_FORBIDDEN')
    this.ownedScope(scope)
  }

  async authorize(actor: ManagementActor, scope: ManagementScope, action: string): Promise<void> {
    await this.authorizeIn(this.store, actor, scope, action)
  }
  async authorizeInTransaction(tx: StorageTransaction, actor: ManagementActor, scope: ManagementScope, action: string) {
    await this.authorizeIn(tx, actor, scope, action)
  }
  async authorizePolicyInTransaction(
    tx: StorageTransaction,
    principalId: string,
    scope: ManagementScope,
    _action: string,
  ) {
    this.ownedScope(scope)
    await this.requireMember(tx, principalId)
  }
  async isAdministrator(actor: ManagementActor) {
    await this.credential(this.store, actor)
    return true
  }

  async validateCsrf(actor: ManagementActor, csrfToken: string | undefined): Promise<void> {
    const credential = await this.credential(this.store, actor)
    if (
      actor.kind !== 'session' ||
      !validText(csrfToken, 256) ||
      !credential.value.csrfHash ||
      !timingSafeEqual(Buffer.from(hash(csrfToken), 'hex'), Buffer.from(credential.value.csrfHash, 'hex'))
    )
      fail('CSRF_REJECTED')
  }

  async listAdministrators(actor: ManagementActor) {
    await this.requireFullAdministrator(this.store, actor)
    const roster = await this.roster(this.store)
    const administrators: Administrator[] = []
    for (const principalId of roster.value.principalIds) {
      const row = await this.store.get<ManagementPrincipal>('principals', principalId)
      if (row) administrators.push({ principalId, displayName: row.value.displayName, accountId: row.value.accountId })
    }
    return { revision: roster.revision, administrators }
  }
  private async requireFullAdministrator(tx: StorageTransaction, actor: ManagementActor) {
    const credential = await this.credential(tx, actor)
    if (
      credential.value.permissions &&
      credential.value.kind === 'service' &&
      !this.fullLegacyPermissions(credential.value.permissions)
    )
      fail('MANAGEMENT_FORBIDDEN')
  }
  async inviteAdministrator(actor: ManagementActor, displayName: string, revision: number) {
    if (!validText(displayName, 80)) fail('INVALID_PRINCIPAL', 422)
    const code = secret(),
      expiresAt = this.now() + this.bootstrapTtlMs
    await this.store.transaction(async tx => {
      await this.requireFullAdministrator(tx, actor)
      const roster = await this.roster(tx)
      if (roster.revision !== revision) fail('REVISION_CONFLICT', 412)
      // Serializes invitation creation with concurrent removal of the issuer.
      await tx.replace('grants', roster.id, roster.revision, roster.value)
      await tx.create<Credential>('credentials', {
        id: hash(code),
        scope: `server:${this.options.serverId}`,
        value: {
          principalId: randomUUID(),
          kind: 'bootstrap',
          serverId: this.options.serverId,
          displayName,
          issuerPrincipalId: actor.principalId,
          createdAt: this.now(),
          expiresAt,
        },
      })
      await this.audit(tx, actor.principalId, 'administrator.invite', `server:${this.options.serverId}`, {
        displayName,
        expiresAt,
      })
    })
    return { code, expiresAt }
  }
  /** Read-only host preflight. Old rows are retained for inspection and rollback. */
  async migrationReport() {
    const roster = await this.store.get<AdministratorRoster>('grants', this.rosterId)
    const principals = await this.store.list<ManagementPrincipal>('principals')
    const legacy = (await this.store.list<ManagementGrant>('grants')).filter(
      row => row.value.scope && Array.isArray(row.value.actions),
    )
    const credentials = await this.store.list<Credential>('credentials')
    return {
      serverId: this.options.serverId,
      workspaceId: this.options.workspaceId,
      migrated: !!roster,
      sharedServers: (await this.store.list<{ workspaceId: string }>('servers'))
        .filter(row => row.id !== this.options.serverId && row.value.workspaceId === this.options.workspaceId)
        .map(row => row.id),
      identities: await Promise.all(
        principals
          .filter(
            row =>
              roster?.value.principalIds.includes(row.id) ||
              legacy.some(
                grant =>
                  grant.value.principalId === row.id &&
                  grant.value.scope.kind === 'server' &&
                  grant.value.scope.id === this.options.serverId,
              ),
          )
          .map(async row => {
            const permissions = legacy
              .filter(grant => grant.value.principalId === row.id)
              .map(grant => ({ scope: grant.value.scope, actions: grant.value.actions }))
            return {
              principalId: row.id,
              displayName: row.value.displayName,
              accountId: row.value.accountId,
              administrator: roster
                ? roster.value.principalIds.includes(row.id)
                : row.value.status === 'active' &&
                  (!row.value.accountId ||
                    (!!row.value.serverId &&
                      (await this.store.accountStatus(row.value.serverId, row.value.accountId)) === 'active')) &&
                  this.fullLegacyPermissions(permissions),
              legacyPermissions: permissions,
              credentials: credentials
                .filter(
                  c =>
                    c.value.principalId === row.id &&
                    (this.ownsCredential(c.value) ||
                      (!c.value.serverId && row.value.serverId === this.options.serverId)),
                )
                .map(c => ({
                  kind: c.value.kind,
                  expiresAt: c.value.expiresAt,
                  disposition:
                    c.value.serverId || this.fullLegacyPermissions(c.value.permissions)
                      ? 'current-membership'
                      : c.value.kind === 'service'
                        ? 'retain-ceiling'
                        : 'reauthenticate',
                })),
            }
          }),
      ),
    }
  }
  async addAdministrator(actor: ManagementActor, input: { accountId: string }, revision: number) {
    if (!validText(input.accountId)) fail('INVALID_ACCOUNT', 422)
    return this.store.transaction(async tx => {
      await this.requireFullAdministrator(tx, actor)
      const roster = await this.roster(tx)
      if (roster.revision !== revision) fail('REVISION_CONFLICT', 412)
      if ((await tx.accountStatus(this.options.serverId, input.accountId)) !== 'active') fail('ACCOUNT_NOT_ACTIVE', 422)
      const existing = (await tx.list<ManagementPrincipal>('principals')).find(
        row => row.value.serverId === this.options.serverId && row.value.accountId === input.accountId,
      )
      const principalId = existing?.id ?? randomUUID()
      if (roster.value.principalIds.includes(principalId)) fail('ADMINISTRATOR_EXISTS', 409)
      if (existing && existing.value.status !== 'active') fail('PRINCIPAL_DISABLED', 409)
      if (!existing)
        await tx.create<ManagementPrincipal>('principals', {
          id: principalId,
          scope: `server:${this.options.serverId}`,
          value: {
            displayName: input.accountId,
            status: 'active',
            accountId: input.accountId,
            serverId: this.options.serverId,
          },
        })
      await tx.replace('grants', roster.id, roster.revision, {
        ...roster.value,
        principalIds: [...roster.value.principalIds, principalId],
      })
      await this.audit(tx, actor.principalId, 'administrator.add', `server:${this.options.serverId}`, { principalId })
      return { principalId }
    })
  }
  private async removeMember(tx: StorageTransaction, principalId: string, revision?: number) {
    const roster = await this.roster(tx)
    if (revision !== undefined && roster.revision !== revision) fail('REVISION_CONFLICT', 412)
    if (!roster.value.principalIds.includes(principalId)) fail('ADMINISTRATOR_NOT_FOUND', 404)
    const remaining = roster.value.principalIds.filter(id => id !== principalId)
    let active = false
    for (const id of remaining) {
      try {
        await this.activePrincipal(tx, id)
        active = true
      } catch (error) {
        if (!(error instanceof ManagementAuthError)) throw error
      }
    }
    if (!active) fail('LAST_ADMINISTRATOR', 409)
    await tx.replace('grants', roster.id, roster.revision, { ...roster.value, principalIds: remaining })
  }
  async removeAdministrator(actor: ManagementActor, principalId: string, revision: number) {
    await this.store.transaction(async tx => {
      await this.requireFullAdministrator(tx, actor)
      await this.removeMember(tx, principalId, revision)
      await this.audit(tx, actor.principalId, 'administrator.remove', `server:${this.options.serverId}`, {
        principalId,
      })
    })
  }
  async beforeAccountDeactivation(tx: StorageTransaction, actorId: string, accountId: string) {
    const principal = (await tx.list<ManagementPrincipal>('principals')).find(
      row => row.value.serverId === this.options.serverId && row.value.accountId === accountId,
    )
    if (!principal || !(await this.roster(tx)).value.principalIds.includes(principal.id)) return
    await this.removeMember(tx, principal.id)
    await this.audit(tx, actorId, 'administrator.remove', `server:${this.options.serverId}`, {
      principalId: principal.id,
    })
  }

  async createServiceToken(actor: ManagementActor, input: { expiresAt?: number } = {}) {
    const principalId = actor.principalId
    const expiresAt = input.expiresAt ?? this.now() + 30 * 24 * 60 * 60 * 1000
    if (
      !validText(principalId) ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= this.now() ||
      expiresAt > this.now() + 365 * 24 * 60 * 60 * 1000
    )
      fail('INVALID_CREDENTIAL', 422)
    const token = secret(),
      storageId = hash(token),
      credentialId = randomUUID()
    await this.store.transaction(async tx => {
      await this.requireFullAdministrator(tx, actor)
      await tx.create<Credential>('credentials', {
        id: storageId,
        scope: principalId,
        value: {
          publicId: credentialId,
          principalId,
          kind: 'service',
          expiresAt,
          createdAt: this.now(),
          serverId: this.options.serverId,
        },
      })
      await this.audit(tx, actor.principalId, 'credential.create', principalId, { credentialId, principalId })
    })
    return { token, credentialId, expiresAt }
  }

  private ownsCredential(value: Credential) {
    return (
      value.serverId === this.options.serverId ||
      (!value.serverId &&
        !!value.permissions?.length &&
        value.permissions.every(
          p => p.scope.id === (p.scope.kind === 'server' ? this.options.serverId : this.options.workspaceId),
        ))
    )
  }
  private async authorizeCredentialManagement(
    tx: StorageTransaction,
    actor: ManagementActor,
    credential: StoredRecord<Credential>,
  ) {
    // A credential may always revoke itself. Shared principal identity does not
    // let an attenuated service token manage that principal's broader tokens.
    if (credential.id === actor.credentialId) return
    await this.requireFullAdministrator(tx, actor)
    if (!this.ownsCredential(credential.value)) fail('MANAGEMENT_FORBIDDEN')
  }

  /** Only service tokens manageable by this actor are returned; no storage digests or secrets. */
  async listCredentials(actor: ManagementActor): Promise<ServiceCredentialMetadata[]> {
    return this.store.transaction(async tx => {
      await this.credential(tx, actor)
      const result: ServiceCredentialMetadata[] = []
      for (const credential of await tx.list<Credential>('credentials')) {
        if (credential.value.kind !== 'service') continue
        try {
          await this.authorizeCredentialManagement(tx, actor, credential)
        } catch (error) {
          if (error instanceof ManagementAuthError && error.status === 403) continue
          throw error
        }
        // Upgrade prerelease records lazily without exposing their digest as an API handle.
        const id = credential.value.publicId ?? randomUUID()
        if (!credential.value.publicId)
          await tx.replace('credentials', credential.id, credential.revision, { ...credential.value, publicId: id })
        result.push({
          id,
          principalId: credential.value.principalId,
          createdAt: credential.value.createdAt,
          expiresAt: credential.value.expiresAt,
          serverId: this.options.serverId,
          legacyRestricted: !credential.value.serverId && !this.fullLegacyPermissions(credential.value.permissions),
        })
      }
      return result.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    })
  }

  async revokeCredential(actor: ManagementActor, id: string): Promise<void> {
    await this.store.transaction(async tx => {
      await this.credential(tx, actor)
      const credential =
        (await tx.get<Credential>('credentials', id)) ??
        (await tx.list<Credential>('credentials')).find(
          row => row.value.kind === 'service' && row.value.publicId === id,
        )
      if (!credential) return fail('CREDENTIAL_NOT_FOUND', 404)
      await this.authorizeCredentialManagement(tx, actor, credential)
      await tx.delete('credentials', credential.id, credential.revision)
      await this.audit(tx, actor.principalId, 'credential.revoke', credential.value.principalId, {
        credentialId: credential.value.publicId ?? id,
      })
    })
  }

  private readonly challenges = new Map<
    string,
    { challenge: string; origin: string; rpId: string; expiresAt: number; actor?: ManagementActor }
  >()

  private async validateParent(tx: StorageTransaction, value: Credential, depth = 0): Promise<void> {
    if (!value.parentId) return
    if (depth > 2) fail('MANAGEMENT_UNAUTHENTICATED', 401)
    const parent = await tx.get<Credential>('credentials', value.parentId)
    if (
      !parent ||
      parent.value.principalId !== value.principalId ||
      parent.value.expiresAt <= this.now() ||
      !['device', 'passkey'].includes(parent.value.kind)
    )
      fail('MANAGEMENT_UNAUTHENTICATED', 401)
    await this.validateParent(tx, parent!.value, depth + 1)
  }

  private async loginSession(tx: StorageTransaction, principalId: string, source: Credential, parentId?: string) {
    await this.requireMember(tx, principalId)
    if (
      source.serverId !== this.options.serverId &&
      (source.serverId || !this.fullLegacyPermissions(source.permissions))
    )
      fail('ADMIN_LOGIN_REQUIRED', 401)
    const token = secret(),
      csrfToken = sessionCsrf(token),
      expiresAt = this.now() + this.sessionTtlMs
    const actor: ManagementActor = { principalId, credentialId: hash(token), kind: 'session' }
    await tx.create<Credential>('credentials', {
      id: actor.credentialId,
      scope: principalId,
      value: {
        principalId,
        kind: 'session',
        createdAt: this.now(),
        expiresAt,
        csrfHash: hash(csrfToken),
        serverId: this.options.serverId,
        parentId,
      },
    })
    return { token, csrfToken, expiresAt, actor }
  }

  private challenge(origin: string, challenge: string, actor?: ManagementActor) {
    for (const [id, value] of this.challenges) if (value.expiresAt <= this.now()) this.challenges.delete(id)
    if (this.challenges.size >= 4096) fail('LOGIN_RATE_LIMITED', 429)
    const id = randomUUID()
    this.challenges.set(id, {
      origin,
      rpId: new URL(origin).hostname,
      challenge,
      actor,
      expiresAt: this.now() + 300_000,
    })
    return id
  }

  private takeChallenge(id: string, origin: string, actor?: ManagementActor) {
    const value = this.challenges.get(id)
    this.challenges.delete(id)
    if (
      !value ||
      value.expiresAt <= this.now() ||
      value.origin !== origin ||
      value.actor?.credentialId !== actor?.credentialId
    )
      return fail('PASSKEY_CHALLENGE_INVALID', 401)
    return value
  }

  async passkeyRegistrationOptions(actor: ManagementActor, origin: string) {
    await this.credential(this.store, actor)
    if (actor.kind !== 'session') fail('SESSION_REQUIRED', 403)
    const principal = await this.activePrincipal(this.store, actor.principalId)
    const options = await generateRegistrationOptions({
      rpName: 'Arcadia 管理后台',
      rpID: new URL(origin).hostname,
      userName: principal!.value.displayName,
      userID: Buffer.from(hash(actor.principalId), 'hex'),
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: (await this.store.list<Credential>('credentials', actor.principalId))
        .filter(
          row =>
            this.ownsCredential(row.value) &&
            row.value.kind === 'passkey' &&
            row.value.passkey?.rpId === new URL(origin).hostname,
        )
        .map(row => ({ id: row.value.passkey!.id })),
    })
    return { options, challengeId: this.challenge(origin, options.challenge, actor) }
  }

  async registerPasskey(
    actor: ManagementActor,
    origin: string,
    input: { challengeId: string; response: RegistrationResponseJSON; label: string },
  ) {
    const challenge = this.takeChallenge(input.challengeId, origin, actor)
    if (!validText(input.label, 80)) fail('INVALID_CREDENTIAL', 422)
    let verification
    try {
      verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: challenge.rpId,
        requireUserVerification: true,
      })
    } catch {
      return fail('PASSKEY_INVALID', 401)
    }
    if (!verification.verified || !verification.registrationInfo) return fail('PASSKEY_INVALID', 401)
    const key = verification.registrationInfo.credential
    await this.store.transaction(async tx => {
      await this.credential(tx, actor)
      if (actor.kind !== 'session') fail('SESSION_REQUIRED', 403)
      // Human credentials identify this server; current membership supplies authority.
      await tx.create<Credential>('credentials', {
        id: `passkey:${hash(key.id)}`,
        scope: actor.principalId,
        value: {
          publicId: randomUUID(),
          principalId: actor.principalId,
          kind: 'passkey',
          label: input.label,
          createdAt: this.now(),
          expiresAt: Number.MAX_SAFE_INTEGER,
          serverId: this.options.serverId,
          passkey: {
            id: key.id,
            publicKey: Buffer.from(key.publicKey).toString('base64url'),
            counter: key.counter,
            rpId: challenge.rpId,
          },
        },
      })
      await this.audit(tx, actor.principalId, 'passkey.create', 'management', { label: input.label })
    })
  }

  async passkeyLoginOptions(origin: string) {
    const options = await generateAuthenticationOptions({
      rpID: new URL(origin).hostname,
      userVerification: 'required',
    })
    return { options, challengeId: this.challenge(origin, options.challenge) }
  }

  async loginPasskey(origin: string, input: { challengeId: string; response: AuthenticationResponseJSON }) {
    const challenge = this.takeChallenge(input.challengeId, origin)
    if (!input.response || !validText(input.response.id, 2048)) return fail('PASSKEY_INVALID', 401)
    const id = `passkey:${hash(input.response.id)}`
    const row = await this.store.get<Credential>('credentials', id)
    const key = row?.value.passkey
    if (!row || row.value.kind !== 'passkey' || !key || key.rpId !== challenge.rpId) return fail('PASSKEY_INVALID', 401)
    let verification
    try {
      verification = await verifyAuthenticationResponse({
        response: input.response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: challenge.rpId,
        requireUserVerification: true,
        credential: {
          id: key.id,
          publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')),
          counter: key.counter,
        },
      })
    } catch {
      return fail('PASSKEY_INVALID', 401)
    }
    if (!verification.verified) return fail('PASSKEY_INVALID', 401)
    return this.store.transaction(async tx => {
      await tx.replace('credentials', row.id, row.revision, {
        ...row.value,
        passkey: { ...key, counter: verification.authenticationInfo.newCounter },
      })
      const session = await this.loginSession(tx, row.value.principalId, row.value, id)
      await this.audit(tx, row.value.principalId, 'passkey.login', 'management', {})
      return session
    })
  }

  async rememberDevice(actor: ManagementActor, label: string) {
    if (!validText(label, 80)) fail('INVALID_CREDENTIAL', 422)
    return this.store.transaction(async tx => {
      const current = await this.credential(tx, actor)
      if (actor.kind !== 'session') fail('SESSION_REQUIRED', 403)
      const id = randomUUID(),
        token = `${id}.${secret()}`,
        expiresAt = this.now() + 30 * 86400_000
      await tx.create<Credential>('credentials', {
        id: `device:${id}`,
        scope: actor.principalId,
        value: {
          publicId: id,
          principalId: actor.principalId,
          kind: 'device',
          label,
          createdAt: this.now(),
          expiresAt,
          secretHash: hash(token),
          serverId: this.options.serverId,
          parentId: current.value.parentId,
        },
      })
      await tx.replace('credentials', current.id, current.revision, { ...current.value, parentId: `device:${id}` })
      await this.audit(tx, actor.principalId, 'device.remember', 'management', { deviceId: id })
      return { token, expiresAt }
    })
  }

  async refreshDevice(token: string) {
    if (!validText(token, 256)) return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    const id = `device:${token.split('.')[0]}`
    return this.store.transaction(async tx => {
      const row = await tx.get<Credential>('credentials', id)
      if (
        !row ||
        row.value.kind !== 'device' ||
        row.value.expiresAt <= this.now() ||
        row.value.secretHash !== hash(token)
      )
        return fail('MANAGEMENT_UNAUTHENTICATED', 401)
      await this.validateParent(tx, row.value)
      const rotated = `${row.value.publicId}.${secret()}`
      await tx.replace('credentials', id, row.revision, { ...row.value, secretHash: hash(rotated) })
      const session = await this.loginSession(tx, row.value.principalId, row.value, id)
      return { session, token: rotated, expiresAt: row.value.expiresAt }
    })
  }

  async loginMethods(actor: ManagementActor) {
    await this.credential(this.store, actor)
    if (actor.kind !== 'session') fail('SESSION_REQUIRED', 403)
    return (await this.store.list<Credential>('credentials', actor.principalId))
      .filter(
        row =>
          this.ownsCredential(row.value) &&
          ['device', 'passkey'].includes(row.value.kind) &&
          row.value.expiresAt > this.now(),
      )
      .map(row => ({
        id: row.value.publicId!,
        kind: row.value.kind,
        label: row.value.label,
        createdAt: row.value.createdAt,
        expiresAt: row.value.kind === 'device' ? row.value.expiresAt : undefined,
      }))
  }

  async revokeLoginMethod(actor: ManagementActor, publicId: string) {
    await this.store.transaction(async tx => {
      await this.credential(tx, actor)
      if (actor.kind !== 'session') fail('SESSION_REQUIRED', 403)
      const row = (await tx.list<Credential>('credentials', actor.principalId)).find(
        row =>
          this.ownsCredential(row.value) &&
          ['device', 'passkey'].includes(row.value.kind) &&
          row.value.publicId === publicId,
      )
      if (!row) return fail('CREDENTIAL_NOT_FOUND', 404)
      await tx.delete('credentials', row.id, row.revision)
      await this.audit(tx, actor.principalId, 'login-method.revoke', 'management', { credentialId: publicId })
    })
  }

  async logoutSession(actor: ManagementActor) {
    await this.store.transaction(async tx => {
      const row = await this.credential(tx, actor)
      if (actor.kind !== 'session') fail('SESSION_REQUIRED', 403)
      const parent = row.value.parentId ? await tx.get<Credential>('credentials', row.value.parentId) : undefined
      if (parent?.value.kind === 'device') await tx.delete('credentials', parent.id, parent.revision)
      await tx.delete('credentials', row.id, row.revision)
    })
  }

  private async audit(tx: StorageTransaction, actor: string, action: string, scope: string, details: object) {
    await tx.create('audit', { id: randomUUID(), scope, value: { actor, action, at: this.now(), ...details } })
  }
}
