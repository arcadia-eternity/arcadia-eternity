import { Pool } from 'pg'
import { dropTestDatabase } from '../../../bin/__tests__/helpers/postgres'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openStorage, SQLAccountDirectory, type DurableStorage } from '@arcadia-eternity/database'
import { ManagementAuth, type ManagementSession } from '../src/runtime/management/auth'
import { nonAdministratorSession } from './fixtures/management'
const server = { kind: 'server' as const, id: 'server-one' }
const workspace = { kind: 'workspace' as const, id: 'workspace-one' }
const target = { serverId: server.id, workspaceId: workspace.id }
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
for (const driver of ['sqlite', 'postgres'] as const)
  describe.skipIf(driver === 'postgres' && !process.env.TEST_DATABASE_URL)(
    `${driver} server administrator membership`,
    () => {
      let closeDatabase: (() => Promise<void>) | undefined
      let root: string, storage: DurableStorage, auth: ManagementAuth, owner: ManagementSession
      let now: number
      beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'admin-roster-'))
        if (driver === 'postgres') {
          const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
          const name = `admin_roster_${randomUUID().replaceAll('-', '')}`
          await pool.query(`CREATE DATABASE "${name}"`)
          const url = new URL(process.env.TEST_DATABASE_URL!)
          url.pathname = `/${name}`
          storage = openStorage({ driver: 'postgres', connectionString: url.href })
          closeDatabase = async () => {
            try {
              await dropTestDatabase(pool, name)
            } finally {
              await pool.end()
            }
          }
        } else storage = openStorage({ driver: 'sqlite', filename: join(root, 'db.sqlite') })
        await storage.migrate()
        now = Date.now()
        auth = new ManagementAuth(storage, { ...target, now: () => now })
        owner = await auth.exchangeBootstrap((await auth.issueBootstrapCode()).code)
      })
      afterEach(async () => {
        vi.restoreAllMocks()
        await storage.close()
        await closeDatabase?.()
        closeDatabase = undefined
        await rm(root, { recursive: true, force: true })
      })
      async function account(subject = 'admin@example.test') {
        return new SQLAccountDirectory(storage, server.id).resolveOrCreate({
          providerId: 'email',
          issuer: 'mailto',
          subject,
          verifiedAt: now,
        })
      }
      async function add(subject?: string) {
        const user = await account(subject)
        const list = await auth.listAdministrators(owner.actor)
        const added = await auth.addAdministrator(owner.actor, { accountId: user.accountId }, list.revision)
        return { ...added, ...user, session: await auth.exchangeAccount(server.id, user.accountId) }
      }
      it('grants all server and environment operations with one administrator membership', async () => {
        const user = await add()
        for (const scope of [undefined, server, workspace])
          await expect(auth.authorize(user.session.actor, scope)).resolves.toBeUndefined()
        const list = await auth.listAdministrators(owner.actor)
        expect(list.administrators).toHaveLength(2)
        expect(list.administrators.some(row => row.accountId === user.accountId)).toBe(true)
        expect((await storage.list('grants')).length).toBe(1)
      })
      it('does not promote ordinary player accounts', async () => {
        const user = await account()
        await expect(auth.exchangeAccount(server.id, user.accountId)).rejects.toMatchObject({
          code: 'MANAGEMENT_FORBIDDEN',
        })
      })
      it('revokes existing account sessions, service tokens, remembered devices and policy writes', async () => {
        const user = await add()
        const token = await auth.createServiceToken(user.session.actor)
        const device = await auth.rememberDevice(user.session.actor, 'Browser')
        const list = await auth.listAdministrators(owner.actor)
        await auth.removeAdministrator(owner.actor, user.principalId, list.revision)
        for (const value of [user.session.token, token.token])
          await expect(auth.authenticate(value)).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
        await expect(auth.refreshDevice(device.token)).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
        await expect(
          storage.transaction(tx => auth.authorizeInTransaction(tx, user.session.actor)),
        ).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
      })
      it('rejects the last administrator removal and stale concurrent changes', async () => {
        const first = await auth.listAdministrators(owner.actor)
        await expect(
          auth.removeAdministrator(owner.actor, owner.actor.principalId, first.revision),
        ).rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' })
        const user = await add()
        await expect(auth.removeAdministrator(owner.actor, user.principalId, first.revision)).rejects.toMatchObject({
          code: 'REVISION_CONFLICT',
        })
        const list = await auth.listAdministrators(owner.actor)
        const results = await Promise.allSettled([
          auth.removeAdministrator(owner.actor, user.principalId, list.revision),
          auth.removeAdministrator(user.session.actor, owner.actor.principalId, list.revision),
        ])
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        const roster = await storage.get<{ principalIds: string[] }>('grants', `administrators:${server.id}`)
        expect(roster!.value.principalIds).toHaveLength(1)
      })
      it('rolls back the new identity, membership and audit together on failure', async () => {
        const user = await account()
        const before = await storage.exportSnapshot()
        const transaction = storage.transaction.bind(storage)
        vi.spyOn(storage, 'transaction').mockImplementation(work =>
          transaction(tx =>
            work(
              new Proxy(tx, {
                get(object, key) {
                  if (key === 'create')
                    return async (...args: Parameters<typeof tx.create>) => {
                      if (args[0] === 'audit') throw new Error('audit unavailable')
                      return tx.create(...args)
                    }
                  const value = Reflect.get(object, key)
                  return typeof value === 'function' ? value.bind(object) : value
                },
              }),
            ),
          ),
        )
        await expect(auth.addAdministrator(owner.actor, { accountId: user.accountId }, 2)).rejects.toThrow(
          'audit unavailable',
        )
        expect(await storage.exportSnapshot()).toEqual(before)
      })
      it('rejects foreign server and workspace access, including a shared principal recovery login', async () => {
        for (const scope of [
          { ...server, id: 'other' },
          { ...workspace, id: 'other' },
        ])
          await expect(auth.authorize(owner.actor, scope)).rejects.toMatchObject({
            code: 'MANAGEMENT_FORBIDDEN',
          })
        const other = new ManagementAuth(storage, { serverId: 'other', workspaceId: 'other-workspace' })
        const login = await other.exchangeBootstrap((await other.issueBootstrapCode()).code)
        await expect(auth.authenticate(login.token)).rejects.toMatchObject({ code: 'MANAGEMENT_UNAUTHENTICATED' })
      })
      it('rechecks account deactivation on existing sessions', async () => {
        const user = await add()
        await storage.transaction(tx => tx.deactivateAccount(server.id, user.accountId))
        await expect(auth.authenticate(user.session.token)).rejects.toMatchObject({ status: 401 })
      })
      it('stores hashes only, consumes recovery codes once and expires sessions', async () => {
        const issued = await auth.issueBootstrapCode()
        const results = await Promise.allSettled([
          auth.exchangeBootstrap(issued.code),
          auth.exchangeBootstrap(issued.code),
        ])
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
        const snapshot = JSON.stringify(await storage.exportSnapshot())
        for (const secret of [issued.code, owner.token, owner.csrfToken]) expect(snapshot).not.toContain(secret)
        await expect(auth.validateCsrf(owner.actor, 'forged')).rejects.toMatchObject({ code: 'CSRF_REJECTED' })
        await expect(auth.validateCsrf(owner.actor, owner.csrfToken)).resolves.toBeUndefined()
        now += 9 * 3600000
        await expect(auth.authenticate(owner.token)).rejects.toMatchObject({ status: 401 })
      })
      it('lists and revokes service credentials by public handle without leaking secrets', async () => {
        const issued = await auth.createServiceToken(owner.actor)
        const actor = await auth.authenticate(issued.token)
        const list = await auth.listCredentials(owner.actor)
        expect(list).toEqual([
          {
            id: issued.credentialId,
            principalId: owner.actor.principalId,
            createdAt: now,
            expiresAt: issued.expiresAt,
            serverId: server.id,
          },
        ])
        expect(JSON.stringify(list)).not.toContain(actor.credentialId)
        expect(JSON.stringify(list)).not.toContain(issued.token)
        await auth.revokeCredential(owner.actor, issued.credentialId)
        await expect(auth.authenticate(issued.token)).rejects.toMatchObject({ status: 401 })
      })
      it('rejects credentials not issued for this server, including pre-roster scoped credentials', async () => {
        const service = await auth.createServiceToken(owner.actor)
        for (const [token, id] of [
          [owner.token, owner.actor.credentialId],
          [service.token, digest(service.token)],
        ]) {
          const row = (await storage.get<Record<string, unknown>>('credentials', id))!
          await storage.replace('credentials', row.id, row.revision, {
            ...row.value,
            serverId: undefined,
            permissions: [{ scope: server, actions: ['read'] }],
          })
          await expect(auth.authenticate(token)).rejects.toMatchObject({ code: 'MANAGEMENT_UNAUTHENTICATED' })
        }
      })
      it('denies every operation to valid credentials of principals outside the administrator list', async () => {
        const outsider = await nonAdministratorSession(auth, 'outsider')
        await expect(auth.authorize(outsider.actor)).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
        await expect(auth.createServiceToken(outsider.actor)).rejects.toMatchObject({ status: 403 })
        await expect(
          auth.addAdministrator(outsider.actor, { accountId: (await account()).accountId }, 3),
        ).rejects.toMatchObject({ status: 403 })
      })
      it('isolates remembered devices for the same recovery principal on different servers', async () => {
        const other = new ManagementAuth(storage, { serverId: 'other', workspaceId: 'other-workspace' })
        const login = await other.exchangeBootstrap((await other.issueBootstrapCode()).code)
        await other.rememberDevice(login.actor, 'Other browser')
        const methods = await other.loginMethods(login.actor)
        expect(await auth.loginMethods(owner.actor)).toEqual([])
        await expect(auth.revokeLoginMethod(owner.actor, methods[0].id)).rejects.toMatchObject({
          code: 'CREDENTIAL_NOT_FOUND',
        })
        expect(await other.loginMethods(login.actor)).toHaveLength(1)
      })
      it('creates a separate named administrator using a one-time invitation', async () => {
        const list = await auth.listAdministrators(owner.actor)
        const code = await auth.inviteAdministrator(owner.actor, 'Operator', list.revision)
        expect((await auth.listAdministrators(owner.actor)).administrators).toHaveLength(1)
        const login = await auth.exchangeBootstrap(code.code)
        expect(login.actor.principalId).not.toBe(owner.actor.principalId)
        expect(
          (await auth.listAdministrators(owner.actor)).administrators.some(a => a.displayName === 'Operator'),
        ).toBe(true)
        await expect(auth.exchangeBootstrap(code.code)).rejects.toMatchObject({ code: 'INVALID_BOOTSTRAP_CODE' })
      })
      it('rejects pending invitations after the inviting administrator is removed', async () => {
        const user = await add()
        const code = await auth.inviteAdministrator(
          user.session.actor,
          'Invitee',
          (await auth.listAdministrators(owner.actor)).revision,
        )
        await auth.removeAdministrator(
          owner.actor,
          user.principalId,
          (await auth.listAdministrators(owner.actor)).revision,
        )
        await expect(auth.exchangeBootstrap(code.code)).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
      })
      it('guards the last account-backed administrator inside an account-deactivation transaction', async () => {
        const user = await add()
        await auth.removeAdministrator(
          user.session.actor,
          owner.actor.principalId,
          (await auth.listAdministrators(owner.actor)).revision,
        )
        await expect(
          storage.transaction(async tx => {
            await auth.beforeAccountDeactivation(tx, user.principalId, user.accountId)
            await tx.deactivateAccount(server.id, user.accountId)
          }),
        ).rejects.toMatchObject({ code: 'LAST_ADMINISTRATOR' })
        expect(await storage.accountStatus(server.id, user.accountId)).toBe('active')
      })
      it('refuses to create an administrator list for a workspace shared with another server', async () => {
        const roster = (await storage.get('grants', `administrators:${server.id}`))!
        await storage.delete('grants', roster.id, roster.revision)
        await storage.create('servers', {
          id: 'other-server',
          scope: 'server:other-server',
          value: { workspaceId: workspace.id },
        })
        await expect(auth.ready()).rejects.toMatchObject({ code: 'SHARED_WORKSPACE_MIGRATION_REQUIRED' })
        expect(await storage.get('grants', roster.id)).toBeNull()
      })
    },
  )
