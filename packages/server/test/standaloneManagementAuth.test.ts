import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openStorage, type DurableStorage } from '../../database/src/storage'
import {
  MANAGEMENT_ACTIONS,
  ManagementAuth,
  type ManagementPermission,
  type ManagementSession,
} from '../src/standalone/management/auth'

const server = { kind: 'server' as const, id: 'server-one' }
const workspace = { kind: 'workspace' as const, id: 'workspace-one' }
const ownerPermissions: ManagementPermission[] = [
  { scope: server, actions: [...MANAGEMENT_ACTIONS.server] },
  { scope: workspace, actions: [...MANAGEMENT_ACTIONS.workspace] },
]

describe('durable management authentication and scoped delegation', () => {
  let directory: string, filename: string, storage: DurableStorage, auth: ManagementAuth, owner: ManagementSession
  let now = 1_790_000_000_000
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'arcadia-management-auth-'))
    filename = join(directory, 'management.sqlite')
    storage = openStorage({ driver: 'sqlite', filename })
    await storage.migrate()
    auth = new ManagementAuth(storage, { now: () => now })
    owner = await auth.exchangeBootstrap((await auth.issueBootstrapCode(ownerPermissions)).code)
  })
  afterEach(async () => {
    await storage.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('stores only credential digests and audit metadata, never bootstrap/session/CSRF secrets', async () => {
    const issued = await auth.issueBootstrapCode(ownerPermissions)
    const rows = JSON.stringify(await storage.exportSnapshot())
    for (const secret of [issued.code, owner.token, owner.csrfToken]) expect(rows).not.toContain(secret)
    await expect(auth.authenticate(issued.code)).rejects.toMatchObject({ code: 'MANAGEMENT_UNAUTHENTICATED' })
    expect(await auth.authenticate(owner.token)).toEqual(owner.actor)
    await expect(auth.authorize(owner.actor, server, 'publish')).resolves.toBeUndefined()
    await expect(auth.authorize(owner.actor, { ...server, id: 'other-server' }, 'publish')).rejects.toMatchObject({
      status: 403,
    })
  })

  it('consumes a bootstrap code once even with concurrent exchanges', async () => {
    const { code } = await auth.issueBootstrapCode(ownerPermissions)
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => auth.exchangeBootstrap(code)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    await expect(auth.exchangeBootstrap(code)).rejects.toMatchObject({ code: 'INVALID_BOOTSTRAP_CODE' })
  })

  it('expires bootstrap codes and sessions independently', async () => {
    const { code } = await auth.issueBootstrapCode(ownerPermissions)
    now += 11 * 60 * 1000
    await expect(auth.exchangeBootstrap(code)).rejects.toMatchObject({ code: 'INVALID_BOOTSTRAP_CODE' })
    await expect(auth.authenticate(owner.token)).resolves.toEqual(owner.actor)
    now += 8 * 60 * 60 * 1000
    await expect(auth.authenticate(owner.token)).rejects.toMatchObject({ status: 401 })
  })

  it('recovers a session and CSRF token after reopening the database', async () => {
    await storage.close()
    storage = openStorage({ driver: 'sqlite', filename })
    await storage.checkSchema()
    auth = new ManagementAuth(storage, { now: () => now })
    expect(await auth.sessionInfo(owner.token)).toEqual({
      actor: owner.actor,
      csrfToken: owner.csrfToken,
      expiresAt: owner.expiresAt,
    })
    await expect(auth.validateCsrf(owner.actor, owner.csrfToken)).resolves.toBeUndefined()
    await expect(auth.validateCsrf(owner.actor, 'forged')).rejects.toMatchObject({ code: 'CSRF_REJECTED' })
    await expect(auth.validateCsrf(owner.actor, undefined)).rejects.toMatchObject({ code: 'CSRF_REJECTED' })
  })

  it('grants only explicit scope permissions and prevents delegation of unheld actions', async () => {
    const delegate = await auth.createPrincipal(owner.actor, { id: 'delegate', displayName: 'Delegate', scope: server })
    await auth.grant(owner.actor, { principalId: delegate.id, scope: server, actions: ['read', 'grants.manage'] })
    const credential = await auth.createServiceToken(owner.actor, {
      principalId: delegate.id,
      permissions: [{ scope: server, actions: ['read', 'grants.manage', 'publish'] }],
    })
    const actor = await auth.authenticate(credential.token)
    await expect(auth.authorize(actor, server, 'read')).resolves.toBeUndefined()
    await expect(auth.authorize(actor, server, 'publish')).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
    await expect(
      auth.grant(actor, { principalId: delegate.id, scope: server, actions: ['publish'] }),
    ).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
    await expect(
      auth.grant(actor, { principalId: delegate.id, scope: workspace, actions: ['delete'] }),
    ).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
    await expect(
      auth.createServiceToken(actor, { permissions: [{ scope: server, actions: ['publish'] }] }),
    ).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
  })

  it('intersects service credential limits with current grants on every operation', async () => {
    const service = await auth.createServiceToken(owner.actor, { permissions: [{ scope: server, actions: ['read'] }] })
    const actor = await auth.authenticate(service.token)
    expect(await auth.effectivePermissions(actor)).toEqual([{ scope: server, actions: ['read'] }])
    await expect(auth.authorize(actor, server, 'publish')).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
    await expect(auth.authorize(actor, workspace, 'read')).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
    await expect(auth.sessionInfo(service.token)).rejects.toMatchObject({ code: 'SESSION_REQUIRED' })
    await auth.revokeCredential(owner.actor, service.credentialId)
    await expect(auth.authorize(actor, server, 'read')).rejects.toMatchObject({ status: 401 })
    await expect(auth.authenticate(service.token)).rejects.toMatchObject({ status: 401 })
  })

  it('revokes grants without relying on cached session permissions', async () => {
    const principal = await auth.createPrincipal(owner.actor, { displayName: 'Reader', scope: server })
    const grant = await auth.grant(owner.actor, { principalId: principal.id, scope: server, actions: ['read'] })
    const token = await auth.createServiceToken(owner.actor, {
      principalId: principal.id,
      permissions: [{ scope: server, actions: ['read'] }],
    })
    const actor = await auth.authenticate(token.token)
    await auth.authorize(actor, server, 'read')
    await auth.revokeGrant(owner.actor, grant.id, grant.revision)
    await expect(auth.authorize(actor, server, 'read')).rejects.toMatchObject({ status: 403 })
  })

  it('requires revision matches when revoking a grant and rolls back audits on conflict', async () => {
    const principal = await auth.createPrincipal(owner.actor, { displayName: 'Reader', scope: server })
    const first = await auth.grant(owner.actor, { principalId: principal.id, scope: server, actions: ['read'] })
    const second = await auth.grant(
      owner.actor,
      { principalId: principal.id, scope: server, actions: ['read', 'drain'] },
      first.revision,
    )
    const auditCount = (await storage.list('audit')).length
    await expect(auth.revokeGrant(owner.actor, first.id, first.revision)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    })
    expect((await storage.get('grants', second.id))?.revision).toBe(second.revision)
    expect((await storage.list('audit')).length).toBe(auditCount)
  })

  it('does not accept a forged actor with a different principal or credential kind', async () => {
    await expect(auth.authorize({ ...owner.actor, principalId: 'someone-else' }, server, 'read')).rejects.toMatchObject(
      { status: 401 },
    )
    await expect(auth.authorize({ ...owner.actor, kind: 'service' }, server, 'read')).rejects.toMatchObject({
      status: 401,
    })
    await auth.revokeCredential(owner.actor, owner.actor.credentialId)
    await expect(auth.authenticate(owner.token)).rejects.toMatchObject({ status: 401 })
  })

  it('rejects malformed permissions before persistence', async () => {
    await expect(auth.issueBootstrapCode([{ scope: server, actions: ['*'] }])).rejects.toMatchObject({
      code: 'INVALID_ACTION',
    })
    await expect(auth.issueBootstrapCode([{ scope: { ...server, id: '' }, actions: ['read'] }])).rejects.toMatchObject({
      code: 'INVALID_SCOPE',
    })
    await expect(
      auth.createPrincipal(owner.actor, {
        displayName: 'Forged account',
        scope: server,
        accountId: 'account',
        serverId: 'other',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_SCOPE' })
  })

  it('requires explicit account grants and rechecks account deactivation inside management transactions', async () => {
    const accountId = 'a3e240de-e3a9-4e32-94eb-3d47767f2911'
    await storage
      .accountDatabase()
      .insertInto('accounts')
      .values({
        server_id: server.id,
        account_id: accountId,
        status: 'active',
        created_at: now,
        deactivated_at: null,
      })
      .execute()
    await expect(auth.exchangeAccount(server.id, accountId)).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
    const principal = await auth.createPrincipal(owner.actor, {
      displayName: 'Account admin',
      scope: server,
      serverId: server.id,
      accountId,
    })
    await expect(auth.exchangeAccount(server.id, accountId)).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
    await auth.grant(owner.actor, { principalId: principal.id, scope: server, actions: ['read', 'grants.manage'] })
    const session = await auth.exchangeAccount(server.id, accountId)
    await auth.authorize(session.actor, server, 'read')
    await expect(
      auth.createPrincipal(owner.actor, { displayName: 'Duplicate', scope: server, serverId: server.id, accountId }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_PRINCIPAL_EXISTS' })
    await storage
      .accountDatabase()
      .updateTable('accounts')
      .set({ status: 'deactivated', deactivated_at: now })
      .where('server_id', '=', server.id)
      .where('account_id', '=', accountId)
      .execute()
    await expect(auth.authorize(session.actor, server, 'read')).rejects.toMatchObject({ status: 401 })
    await expect(
      auth.createPrincipal(session.actor, { displayName: 'No longer allowed', scope: server }),
    ).rejects.toMatchObject({ status: 401 })
    await expect(auth.exchangeAccount(server.id, accountId)).rejects.toMatchObject({ status: 401 })
  })

  it('requires the current revision when replacing a grant', async () => {
    const principal = await auth.createPrincipal(owner.actor, { displayName: 'Reader', scope: server })
    const grant = await auth.grant(owner.actor, { principalId: principal.id, scope: server, actions: ['read'] })
    await expect(
      auth.grant(owner.actor, { principalId: principal.id, scope: server, actions: ['read', 'drain'] }),
    ).rejects.toMatchObject({ status: 412 })
    expect((await storage.get('grants', grant.id))?.revision).toBe(grant.revision)
  })

  it('bounds each bootstrap session to its code scope even when an owner has other grants', async () => {
    const other = { kind: 'server' as const, id: 'server-two' }
    const session = await auth.exchangeBootstrap(
      (await auth.issueBootstrapCode([{ scope: other, actions: [...MANAGEMENT_ACTIONS.server] }])).code,
    )
    await auth.authorize(session.actor, other, 'publish')
    await expect(auth.authorize(session.actor, server, 'publish')).rejects.toMatchObject({ status: 403 })
    await expect(auth.authorize(owner.actor, other, 'publish')).rejects.toMatchObject({ status: 403 })
    await expect(
      auth.createServiceToken(session.actor, { permissions: [{ scope: server, actions: ['read'] }] }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('checks revocation inside the protected write transaction rather than trusting an earlier check', async () => {
    const principal = await auth.createPrincipal(owner.actor, { displayName: 'Publisher', scope: server })
    const grant = await auth.grant(owner.actor, { principalId: principal.id, scope: server, actions: ['publish'] })
    const service = await auth.createServiceToken(owner.actor, {
      principalId: principal.id,
      permissions: [{ scope: server, actions: ['publish'] }],
    })
    const actor = await auth.authenticate(service.token)
    await auth.authorize(actor, server, 'publish')
    await auth.revokeGrant(owner.actor, grant.id, grant.revision)
    await expect(
      storage.transaction(async tx => {
        await auth.authorizeInTransaction(tx, actor, server, 'publish')
        await tx.create('bindings', { id: 'forbidden-write', scope: 'server:server-one', value: {} })
      }),
    ).rejects.toMatchObject({ status: 403 })
    expect(await storage.get('bindings', 'forbidden-write')).toBeNull()
  })

  it('continues a configured policy after its configuring credential expires but stops when grants are revoked', async () => {
    const principal = await auth.createPrincipal(owner.actor, { displayName: 'Policy owner', scope: server })
    const grant = await auth.grant(owner.actor, { principalId: principal.id, scope: server, actions: ['publish'] })
    await auth.grant(owner.actor, { principalId: principal.id, scope: workspace, actions: ['environment.use'] })
    const token = await auth.createServiceToken(owner.actor, {
      principalId: principal.id,
      expiresAt: now + 1000,
      permissions: [
        { scope: server, actions: ['publish'] },
        { scope: workspace, actions: ['environment.use'] },
      ],
    })
    const actor = await auth.authenticate(token.token)
    await auth.authorize(actor, server, 'publish')
    now += 2000
    await expect(auth.authorize(actor, server, 'publish')).rejects.toMatchObject({ status: 401 })
    await storage.transaction(async tx => {
      await auth.authorizePolicyInTransaction(tx, principal.id, server, 'publish')
      await auth.authorizePolicyInTransaction(tx, principal.id, workspace, 'environment.use')
    })
    await expect(
      storage.transaction(tx => auth.authorizePolicyInTransaction(tx, principal.id, server, 'settings.manage')),
    ).rejects.toMatchObject({ status: 403 })
    await auth.revokeGrant(owner.actor, grant.id, grant.revision)
    await expect(
      storage.transaction(tx => auth.authorizePolicyInTransaction(tx, principal.id, server, 'publish')),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('stops durable policies when the linked account is deactivated or the principal is disabled', async () => {
    const accountId = 'b311b1b6-41b2-456b-ae4f-3e2c46adf1f0'
    await storage
      .accountDatabase()
      .insertInto('accounts')
      .values({
        server_id: server.id,
        account_id: accountId,
        status: 'active',
        created_at: now,
        deactivated_at: null,
      })
      .execute()
    const principal = await auth.createPrincipal(owner.actor, {
      displayName: 'Account policy owner',
      scope: server,
      accountId,
      serverId: server.id,
    })
    await auth.grant(owner.actor, { principalId: principal.id, scope: server, actions: ['publish'] })
    await storage.transaction(tx => auth.authorizePolicyInTransaction(tx, principal.id, server, 'publish'))
    const disabled = await storage.replace('principals', principal.id, principal.revision, {
      ...principal.value,
      status: 'disabled',
    })
    await expect(
      storage.transaction(tx => auth.authorizePolicyInTransaction(tx, principal.id, server, 'publish')),
    ).rejects.toMatchObject({ status: 401 })
    await storage.replace('principals', principal.id, disabled.revision, principal.value)
    await storage
      .accountDatabase()
      .updateTable('accounts')
      .set({ status: 'deactivated', deactivated_at: now })
      .where('server_id', '=', server.id)
      .where('account_id', '=', accountId)
      .execute()
    await expect(
      storage.transaction(tx => auth.authorizePolicyInTransaction(tx, principal.id, server, 'publish')),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('lists reloadable service credential metadata without secrets or storage hashes', async () => {
    const service = await auth.createServiceToken(owner.actor, { permissions: [{ scope: server, actions: ['read'] }] })
    const issued = await auth.issueBootstrapCode(ownerPermissions)
    const serviceActor = await auth.authenticate(service.token)
    const listed = await auth.listCredentials(owner.actor)
    expect(listed).toEqual([
      {
        id: service.credentialId,
        principalId: owner.actor.principalId,
        createdAt: now,
        expiresAt: service.expiresAt,
        permissions: [{ scope: server, actions: ['read'] }],
      },
    ])
    expect(listed[0].id).not.toBe(serviceActor.credentialId)
    const serialized = JSON.stringify(listed)
    for (const value of [
      service.token,
      serviceActor.credentialId,
      owner.token,
      owner.actor.credentialId,
      owner.csrfToken,
      issued.code,
    ])
      expect(serialized).not.toContain(value)
    await storage.close()
    storage = openStorage({ driver: 'sqlite', filename })
    await storage.checkSchema()
    auth = new ManagementAuth(storage, { now: () => now })
    expect(await auth.listCredentials(owner.actor)).toEqual(listed)
    await auth.revokeCredential(owner.actor, listed[0].id)
    expect(await auth.listCredentials(owner.actor)).toEqual([])
    await expect(auth.authenticate(service.token)).rejects.toMatchObject({ status: 401 })
  })

  it('limits credential discovery and revocation to delegated scope even for the same principal', async () => {
    const serverToken = await auth.createServiceToken(owner.actor, {
      permissions: [{ scope: server, actions: ['read'] }],
    })
    const workspaceToken = await auth.createServiceToken(owner.actor, {
      permissions: [{ scope: workspace, actions: ['read'] }],
    })
    const serverManagerToken = await auth.createServiceToken(owner.actor, {
      permissions: [{ scope: server, actions: ['read', 'grants.manage'] }],
    })
    const serverManager = await auth.authenticate(serverManagerToken.token)
    expect((await auth.listCredentials(serverManager)).map(item => item.id).sort()).toEqual(
      [serverToken.credentialId, serverManagerToken.credentialId].sort(),
    )
    await expect(auth.revokeCredential(serverManager, workspaceToken.credentialId)).rejects.toMatchObject({
      status: 403,
    })
    const reader = await auth.authenticate(serverToken.token)
    expect((await auth.listCredentials(reader)).map(item => item.id)).toEqual([serverToken.credentialId])
    await expect(auth.revokeCredential(reader, serverManagerToken.credentialId)).rejects.toMatchObject({ status: 403 })
    await auth.revokeCredential(reader, serverToken.credentialId)
    await expect(auth.authenticate(serverToken.token)).rejects.toMatchObject({ status: 401 })
    await expect(auth.authenticate(workspaceToken.token)).resolves.toBeDefined()
  })
})
