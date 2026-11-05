import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openStorage, type DurableStorage } from '../../database/src/storage'
import { dropTestDatabase } from '../../../bin/__tests__/helpers/postgres'
import { SQLAccountDirectory } from '../../database/src/accounts'
import { ManagementAccounts } from '../src/standalone/management/accounts'
import { ManagementAuth, MANAGEMENT_ACTIONS, type ManagementSession } from '../src/standalone/management/auth'
import type { ServerSession } from '@arcadia-eternity/protocol'
import { SessionRegistry } from '../src/standalone/session'

const SERVER = 'account-admin-server'
const scope = { kind: 'server' as const, id: SERVER }
const email = (subject: string) => ({ providerId: 'email', issuer: 'mailto', subject, verifiedAt: Date.now() })

for (const driver of ['sqlite', 'postgres'] as const)
  describe.skipIf(driver === 'postgres' && !process.env.TEST_DATABASE_URL)(
    `${driver} management account administration and real sessions`,
    () => {
      let root: string, storage: DurableStorage, directory: SQLAccountDirectory, auth: ManagementAuth
      let closeDatabase: (() => Promise<void>) | undefined
      let sessions: SessionRegistry, owner: ManagementSession, accounts: ManagementAccounts
      const revokeSession = vi.fn(async (_session: ServerSession) => {})
      beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'arcadia-management-accounts-'))
        if (driver === 'postgres') {
          const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
          const name = `management_accounts_${randomUUID().replaceAll('-', '')}`
          await admin.query(`CREATE DATABASE "${name}"`)
          closeDatabase = async () => {
            try {
              await dropTestDatabase(admin, name)
            } finally {
              await admin.end()
            }
          }
          const url = new URL(process.env.TEST_DATABASE_URL!)
          url.pathname = `/${name}`
          storage = openStorage({ driver: 'postgres', connectionString: url.href })
        } else storage = openStorage({ driver: 'sqlite', filename: join(root, 'state.sqlite') })
        await storage.migrate()
        directory = new SQLAccountDirectory(storage, SERVER)
        auth = new ManagementAuth(storage)
        owner = await auth.exchangeBootstrap(
          (await auth.issueBootstrapCode([{ scope, actions: [...MANAGEMENT_ACTIONS.server] }])).code,
        )
        sessions = new SessionRegistry({ serverId: SERVER, accountEnabled: true })
        revokeSession.mockReset()
        revokeSession.mockImplementation(async () => {})
        accounts = new ManagementAccounts(storage, { serverId: SERVER, directory, sessions, revokeSession }, auth)
      })
      afterEach(async () => {
        sessions.clear()
        await storage.close()
        await closeDatabase?.()
        closeDatabase = undefined
        await rm(root, { recursive: true, force: true })
      })

      it('gates guest-only deployments and rejects mismatched runtime scope', async () => {
        const guest = new ManagementAccounts(storage, { serverId: SERVER, sessions, revokeSession }, auth)
        expect(guest.enabled).toBe(false)
        await expect(guest.list(owner.actor)).rejects.toMatchObject({ code: 'ACCOUNTS_UNAVAILABLE' })
        expect(
          () => new ManagementAccounts(storage, { serverId: 'other', directory, sessions, revokeSession }, auth),
        ).toThrow('ACCOUNT_SESSION_SCOPE_MISMATCH')
      })

      it('lists bounded stable pages without leaking identities or another server accounts', async () => {
        const created = []
        for (const subject of ['one@example.test', 'two@example.test', 'three@example.test'])
          created.push(await directory.resolveOrCreate(email(subject)))
        await new SQLAccountDirectory(storage, 'other-server').resolveOrCreate(email('foreign@example.test'))
        const first = await accounts.list(owner.actor, { limit: 2 })
        const second = await accounts.list(owner.actor, { limit: 2, cursor: first.nextCursor })
        expect(first.accounts).toHaveLength(2)
        expect(second.accounts).toHaveLength(1)
        expect([...first.accounts, ...second.accounts].map(account => account.accountId)).toEqual(
          created.map(account => account.accountId).sort(),
        )
        for (const account of [...first.accounts, ...second.accounts]) {
          expect(account).toMatchObject({ status: 'active', deactivatedAt: null })
          expect(Number.isSafeInteger(account.createdAt)).toBe(true)
          expect(Object.keys(account).sort()).toEqual(['accountId', 'createdAt', 'deactivatedAt', 'status'])
        }
        expect(JSON.stringify(first)).not.toContain('@example.test')
        await expect(accounts.list(owner.actor, { limit: 101 })).rejects.toMatchObject({ code: 'INVALID_PAGE_LIMIT' })
        await expect(accounts.list(owner.actor, { cursor: 'invalid' })).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_FOUND',
        })
      })

      it('requires accounts.manage and target-server authority even for read-only listings', async () => {
        const account = await directory.resolveOrCreate(email('target@example.test'))
        const viewer = await auth.exchangeBootstrap(
          (await auth.issueBootstrapCode([{ scope, actions: ['read'] }], 'viewer')).code,
        )
        const foreign = await auth.exchangeBootstrap(
          (
            await auth.issueBootstrapCode(
              [{ scope: { ...scope, id: 'other-server' }, actions: ['accounts.manage'] }],
              'foreign',
            )
          ).code,
        )
        for (const actor of [viewer.actor, foreign.actor]) {
          await expect(accounts.list(actor)).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
          await expect(accounts.status(actor, account.accountId)).rejects.toMatchObject({
            code: 'MANAGEMENT_FORBIDDEN',
          })
          await expect(accounts.deactivate(actor, account.accountId)).rejects.toMatchObject({
            code: 'MANAGEMENT_FORBIDDEN',
          })
        }
        expect(await directory.getStatus(account.accountId)).toBe('active')
      })

      it('deactivates durably, preserves identity history, invalidates every live game session and management access', async () => {
        const target = await directory.resolveOrCreate(email('target@example.test'))
        const other = await directory.resolveOrCreate(email('other@example.test'))
        const first = sessions.issueVerifiedAccount({ id: 'local-a', name: 'A' }, target.accountId)
        const second = sessions.issueVerifiedAccount({ id: 'local-b', name: 'B' }, target.accountId)
        const unrelated = sessions.issueVerifiedAccount({ id: 'other', name: 'Other' }, other.accountId)
        const linked = await auth.createPrincipal(owner.actor, {
          displayName: 'Target manager',
          scope,
          accountId: target.accountId,
          serverId: SERVER,
        })
        await auth.grant(owner.actor, { principalId: linked.id, scope, actions: ['read'] })
        const managementSession = await auth.exchangeAccount(SERVER, target.accountId)
        expect(await auth.authenticate(managementSession.token)).toEqual(managementSession.actor)

        expect(await accounts.deactivate(owner.actor, target.accountId)).toEqual({
          accountId: target.accountId,
          status: 'deactivated',
        })
        expect(await directory.getStatus(target.accountId)).toBe('deactivated')
        expect((await accounts.status(owner.actor, target.accountId)).deactivatedAt).toEqual(expect.any(Number))
        expect(sessions.authenticate(first.token)).toBeUndefined()
        expect(sessions.authenticate(second.token)).toBeUndefined()
        expect(sessions.authenticate(unrelated.token)).toBeDefined()
        expect(revokeSession.mock.calls.map(([session]) => session.token).sort()).toEqual(
          [first.token, second.token].sort(),
        )
        await expect(auth.authenticate(managementSession.token)).rejects.toMatchObject({
          code: 'MANAGEMENT_UNAUTHENTICATED',
          status: 401,
        })
        await expect(directory.resolveOrCreate(email('target@example.test'))).rejects.toMatchObject({
          code: 'ACCOUNT_DEACTIVATED',
        })
        expect(
          (await storage.exportSnapshot()).identities.some(identity => identity.account_id === target.accountId),
        ).toBe(true)
        expect(
          (await storage.list<{ action: string }>('audit')).some(row => row.value.action === 'account.deactivate'),
        ).toBe(true)
        await expect(accounts.deactivate(owner.actor, target.accountId)).resolves.toMatchObject({
          status: 'deactivated',
        })
      })

      it('cannot deactivate an account belonging to another server or using a forged identifier', async () => {
        const foreign = await new SQLAccountDirectory(storage, 'other-server').resolveOrCreate(
          email('foreign@example.test'),
        )
        await expect(accounts.deactivate(owner.actor, foreign.accountId)).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_FOUND',
        })
        await expect(accounts.deactivate(owner.actor, '../outside')).rejects.toMatchObject({
          code: 'ACCOUNT_NOT_FOUND',
        })
        expect(await new SQLAccountDirectory(storage, 'other-server').getStatus(foreign.accountId)).toBe('active')
      })

      it('checks revoked administrator authority inside the mutation transaction', async () => {
        const target = await directory.resolveOrCreate(email('target@example.test'))
        await auth.revokeCredential(owner.actor, owner.actor.credentialId)
        await expect(accounts.deactivate(owner.actor, target.accountId)).rejects.toMatchObject({ status: 401 })
        expect(await directory.getStatus(target.accountId)).toBe('active')
      })

      it('keeps the account denied when room cleanup fails after the durable transition', async () => {
        const target = await directory.resolveOrCreate(email('target@example.test'))
        const live = sessions.issueVerifiedAccount({ id: 'local', name: 'Target' }, target.accountId)
        revokeSession.mockRejectedValueOnce(new Error('socket shutdown failed'))
        await expect(accounts.deactivate(owner.actor, target.accountId)).rejects.toMatchObject({
          code: 'ACCOUNT_REVOCATION_FAILED',
          status: 503,
        })
        expect(await directory.getStatus(target.accountId)).toBe('deactivated')
        expect(sessions.authenticate(live.token)).toBeUndefined()
        expect(() => sessions.issueVerifiedAccount({ id: 'again', name: 'Again' }, target.accountId)).toThrow(
          'ACCOUNT_DEACTIVATED',
        )
        await expect(accounts.deactivate(owner.actor, target.accountId)).resolves.toMatchObject({
          status: 'deactivated',
        })
        expect(revokeSession).toHaveBeenCalledTimes(2)
        expect(revokeSession.mock.calls[1][0].token).toBe(live.token)
      })
    },
  )
