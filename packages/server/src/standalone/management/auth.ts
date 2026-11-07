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
  kind: 'bootstrap' | 'session' | 'service'
  expiresAt: number
  createdAt: number
  csrfHash?: string
  permissions?: ManagementPermission[]
}
export interface ServiceCredentialMetadata {
  id: string
  principalId: string
  createdAt: number
  expiresAt: number
  permissions: ManagementPermission[]
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
function permissions(input: ManagementPermission[]): ManagementPermission[] {
  if (!Array.isArray(input) || !input.length || input.length > 64) fail('INVALID_PERMISSIONS', 422)
  return input.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('INVALID_PERMISSIONS', 422)
    managementScopeKey(item.scope)
    if (
      !Array.isArray(item.actions) ||
      !item.actions.length ||
      item.actions.length > 16 ||
      item.actions.some(action => !(MANAGEMENT_ACTIONS[item.scope.kind] as readonly string[]).includes(action))
    )
      fail('INVALID_ACTION', 422)
    return { scope: { ...item.scope }, actions: [...new Set(item.actions)] }
  })
}
const grantId = (principalId: string, scope: ManagementScope) => hash(`${principalId}\0${managementScopeKey(scope)}`)
const matches = (permission: ManagementPermission, scope: ManagementScope, action: string) =>
  managementScopeKey(permission.scope) === managementScopeKey(scope) && permission.actions.includes(action)

/** Host-issued bootstrap codes and all web/API credentials use the same durable authorization boundary. */
export class ManagementAuth {
  private readonly now: () => number
  private readonly sessionTtlMs: number
  private readonly bootstrapTtlMs: number
  constructor(
    private readonly store: DurableStorage,
    private readonly options: {
      now?: () => number
      sessionTtlMs?: number
      bootstrapTtlMs?: number
    } = {},
  ) {
    this.now = options.now ?? Date.now
    this.sessionTtlMs = options.sessionTtlMs ?? 8 * 60 * 60 * 1000
    this.bootstrapTtlMs = options.bootstrapTtlMs ?? 10 * 60 * 1000
    if (![this.sessionTtlMs, this.bootstrapTtlMs].every(value => Number.isSafeInteger(value) && value > 0))
      fail('INVALID_CREDENTIAL_TTL', 422)
  }

  /** Trusted host/CLI only. Never expose code issuance as an unauthenticated HTTP endpoint. */
  async issueBootstrapCode(input: ManagementPermission[], ownerId = 'owner') {
    if (!validText(ownerId)) fail('INVALID_PRINCIPAL', 422)
    const allowed = permissions(input)
    const code = secret(),
      expiresAt = this.now() + this.bootstrapTtlMs
    await this.store.transaction(async tx => {
      await tx.create<Credential>('credentials', {
        id: hash(code),
        scope: ownerId,
        value: { principalId: ownerId, kind: 'bootstrap', expiresAt, createdAt: this.now(), permissions: allowed },
      })
      await this.audit(tx, 'host', 'bootstrap.issue', 'management', { principalId: ownerId, expiresAt })
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
      const principalId = existing.value.principalId
      await tx.delete('credentials', existing.id, existing.revision)
      const principal = await tx.get<ManagementPrincipal>('principals', principalId)
      if (!principal)
        await tx.create<ManagementPrincipal>('principals', {
          id: principalId,
          scope: 'management',
          value: { displayName: 'Owner', status: 'active' },
        })
      else if (principal.value.status !== 'active')
        await tx.replace('principals', principal.id, principal.revision, {
          ...principal.value,
          status: 'active',
        })
      for (const permission of existing.value.permissions ?? []) {
        const id = grantId(principalId, permission.scope)
        const grant = await tx.get<ManagementGrant>('grants', id)
        const value = {
          ...permission,
          principalId,
          actions: [...new Set([...(grant?.value.actions ?? []), ...permission.actions])],
        }
        if (grant) await tx.replace('grants', id, grant.revision, value)
        else await tx.create('grants', { id, scope: managementScopeKey(permission.scope), value })
      }
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
          // A recovery code for one scope cannot inherit this owner's other deployments.
          permissions: existing.value.permissions,
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
      if (
        !(await tx.list<ManagementGrant>('grants')).some(
          grant => grant.value.principalId === principalId && grant.value.actions.length,
        )
      )
        fail('MANAGEMENT_FORBIDDEN')
      const credentialId = hash(token)
      await tx.create<Credential>('credentials', {
        id: credentialId,
        scope: principalId,
        value: { principalId, kind: 'session', expiresAt, createdAt: this.now(), csrfHash: hash(csrfToken) },
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
    await this.activePrincipal(tx, actor.principalId)
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
    if (!credential || credential.value.kind === 'bootstrap') return fail('MANAGEMENT_UNAUTHENTICATED', 401)
    const actor: ManagementActor = {
      principalId: credential.value.principalId,
      credentialId,
      kind: credential.value.kind,
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
    if (!(MANAGEMENT_ACTIONS[scope.kind] as readonly string[]).includes(action)) fail('INVALID_ACTION', 422)
    const credential = await this.credential(tx, actor)
    if (
      credential.value.permissions &&
      !credential.value.permissions.some(permission => matches(permission, scope, action))
    )
      fail('MANAGEMENT_FORBIDDEN')
    const grant = await tx.get<ManagementGrant>('grants', grantId(actor.principalId, scope))
    if (!grant || !grant.value.actions.includes(action)) fail('MANAGEMENT_FORBIDDEN')
  }

  async authorize(actor: ManagementActor, scope: ManagementScope, action: string): Promise<void> {
    await this.authorizeIn(this.store, actor, scope, action)
  }

  /** Check revocation and authorization in the same transaction as the protected domain write. */
  async authorizeInTransaction(
    tx: StorageTransaction,
    actor: ManagementActor,
    scope: ManagementScope,
    action: string,
  ): Promise<void> {
    await this.authorizeIn(tx, actor, scope, action)
  }

  /**
   * Trusted policy runner only. Its persisted policy must have been created using
   * credential authorization and must fix the resource and permitted action.
   * Never use a request-supplied principal here: this deliberately survives the
   * configuring session's expiry/logout, but still observes principal/grant revocation.
   */
  async authorizePolicyInTransaction(
    tx: StorageTransaction,
    principalId: string,
    scope: ManagementScope,
    action: string,
  ): Promise<void> {
    managementScopeKey(scope)
    if (!(MANAGEMENT_ACTIONS[scope.kind] as readonly string[]).includes(action)) fail('INVALID_ACTION', 422)
    await this.activePrincipal(tx, principalId)
    const grant = await tx.get<ManagementGrant>('grants', grantId(principalId, scope))
    if (!grant || !grant.value.actions.includes(action)) fail('MANAGEMENT_FORBIDDEN')
  }

  async effectivePermissions(actor: ManagementActor): Promise<ManagementPermission[]> {
    const credential = await this.credential(this.store, actor)
    const grants = await this.store.list<ManagementGrant>('grants')
    return grants
      .filter(grant => grant.value.principalId === actor.principalId)
      .map(({ value }) => ({
        scope: value.scope,
        actions: value.actions.filter(
          action =>
            !credential.value.permissions ||
            credential.value.permissions.some(permission => matches(permission, value.scope, action)),
        ),
      }))
      .filter(permission => permission.actions.length > 0)
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

  async createPrincipal(
    actor: ManagementActor,
    input: {
      id?: string
      displayName: string
      scope: ManagementScope
      accountId?: string
      serverId?: string
    },
  ): Promise<StoredRecord<ManagementPrincipal>> {
    const id = input.id ?? randomUUID()
    if (
      !validText(id) ||
      !validText(input.displayName, 80) ||
      !!input.accountId !== !!input.serverId ||
      (input.accountId && (!validText(input.accountId) || !validText(input.serverId)))
    )
      fail('INVALID_PRINCIPAL', 422)
    if (input.accountId && (input.scope.kind !== 'server' || input.scope.id !== input.serverId))
      fail('INVALID_ACCOUNT_SCOPE', 422)
    return this.store.transaction(async tx => {
      await this.authorizeIn(tx, actor, input.scope, 'grants.manage')
      if (input.accountId && (await tx.accountStatus(input.serverId!, input.accountId)) !== 'active')
        fail('ACCOUNT_NOT_ACTIVE', 422)
      if (
        input.accountId &&
        (await tx.list<ManagementPrincipal>('principals')).some(
          row => row.value.accountId === input.accountId && row.value.serverId === input.serverId,
        )
      )
        fail('ACCOUNT_PRINCIPAL_EXISTS', 409)
      const principal = await tx.create<ManagementPrincipal>('principals', {
        id,
        scope: managementScopeKey(input.scope),
        value: {
          displayName: input.displayName,
          status: 'active',
          ...(input.accountId ? { accountId: input.accountId, serverId: input.serverId } : {}),
        },
      })
      await this.audit(tx, actor.principalId, 'principal.create', managementScopeKey(input.scope), { principalId: id })
      return principal
    })
  }

  async grant(
    actor: ManagementActor,
    input: ManagementGrant,
    expectedRevision?: number,
  ): Promise<StoredRecord<ManagementGrant>> {
    const permission = permissions([input])[0]
    if (!validText(input.principalId)) fail('INVALID_PRINCIPAL', 422)
    return this.store.transaction(async tx => {
      await this.authorizeIn(tx, actor, input.scope, 'grants.manage')
      for (const action of permission.actions) await this.authorizeIn(tx, actor, input.scope, action)
      const principal = await tx.get<ManagementPrincipal>('principals', input.principalId)
      if (!principal || principal.value.status !== 'active') fail('PRINCIPAL_NOT_FOUND', 404)
      const id = grantId(input.principalId, input.scope),
        value = { ...permission, principalId: input.principalId }
      const existing = await tx.get<ManagementGrant>('grants', id)
      if (existing && expectedRevision !== existing.revision) fail('REVISION_CONFLICT', 412)
      if (!existing && expectedRevision !== undefined) fail('REVISION_CONFLICT', 412)
      const saved = existing
        ? await tx.replace('grants', id, existing.revision, value)
        : await tx.create('grants', { id, scope: managementScopeKey(input.scope), value })
      await this.audit(tx, actor.principalId, 'grant.replace', managementScopeKey(input.scope), {
        grantId: id,
        principalId: input.principalId,
        actions: permission.actions,
      })
      return saved
    })
  }

  async listGrants(actor: ManagementActor, scope: ManagementScope): Promise<StoredRecord<ManagementGrant>[]> {
    await this.authorize(actor, scope, 'grants.manage')
    return this.store.list<ManagementGrant>('grants', managementScopeKey(scope))
  }

  async revokeGrant(actor: ManagementActor, id: string, revision: number): Promise<void> {
    await this.store.transaction(async tx => {
      const grant = await tx.get<ManagementGrant>('grants', id)
      if (!grant) return fail('GRANT_NOT_FOUND', 404)
      await this.authorizeIn(tx, actor, grant.value.scope, 'grants.manage')
      for (const action of grant.value.actions) await this.authorizeIn(tx, actor, grant.value.scope, action)
      await tx.delete('grants', id, revision)
      await this.audit(tx, actor.principalId, 'grant.revoke', managementScopeKey(grant.value.scope), { grantId: id })
    })
  }

  async createServiceToken(
    actor: ManagementActor,
    input: {
      principalId?: string
      permissions: ManagementPermission[]
      expiresAt?: number
    },
  ) {
    const allowed = permissions(input.permissions),
      principalId = input.principalId ?? actor.principalId
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
      for (const permission of allowed) {
        await this.authorizeIn(tx, actor, permission.scope, 'grants.manage')
        for (const action of permission.actions) await this.authorizeIn(tx, actor, permission.scope, action)
      }
      const principal = await tx.get<ManagementPrincipal>('principals', principalId)
      if (!principal || principal.value.status !== 'active') fail('PRINCIPAL_NOT_FOUND', 404)
      // The credential only narrows existing grants; it does not grant permissions to its subject.
      await tx.create<Credential>('credentials', {
        id: storageId,
        scope: principalId,
        value: {
          publicId: credentialId,
          principalId,
          kind: 'service',
          expiresAt,
          createdAt: this.now(),
          permissions: allowed,
        },
      })
      await this.audit(tx, actor.principalId, 'credential.create', principalId, { credentialId, principalId })
    })
    return { token, credentialId, expiresAt }
  }

  private async authorizeCredentialManagement(
    tx: StorageTransaction,
    actor: ManagementActor,
    credential: StoredRecord<Credential>,
  ) {
    // A credential may always revoke itself. Shared principal identity does not
    // let an attenuated service token manage that principal's broader tokens.
    if (credential.id === actor.credentialId) return
    const targetPermissions =
      credential.value.permissions ??
      (await tx.list<ManagementGrant>('grants'))
        .filter(grant => grant.value.principalId === credential.value.principalId)
        .map(grant => grant.value)
    if (!targetPermissions.length) fail('MANAGEMENT_FORBIDDEN')
    for (const permission of targetPermissions) {
      await this.authorizeIn(tx, actor, permission.scope, 'grants.manage')
      for (const action of permission.actions) await this.authorizeIn(tx, actor, permission.scope, action)
    }
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
          permissions: structuredClone(credential.value.permissions ?? []),
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

  private async audit(tx: StorageTransaction, actor: string, action: string, scope: string, details: object) {
    await tx.create('audit', { id: randomUUID(), scope, value: { actor, action, at: this.now(), ...details } })
  }
}
