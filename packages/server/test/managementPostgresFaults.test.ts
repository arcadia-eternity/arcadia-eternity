import { randomInt, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dropTestDatabase } from '../../../bin/__tests__/helpers/postgres'
import { openStorage, SQLAccountDirectory, type DurableStorage } from '@arcadia-eternity/database'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import { createSingleProcessApp, type SingleProcessApp } from '../src/runtime/app'
import { ManagementAccounts } from '../src/runtime/management/accounts'
import type { ManagementGrant, ManagementSession } from '../src/runtime/management/auth'
import type { ManagementService } from '../src/runtime/management/service'
import { SessionRegistry } from '../src/runtime/session'

const SERVER = 'postgres-fault-server'
const scope = { kind: 'server' as const, id: SERVER }
const email = (subject: string) => ({ providerId: 'email', issuer: 'mailto', subject, verifiedAt: Date.now() })

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'PostgreSQL management transactions interrupted by backend death',
  () => {
    const cleanups: (() => Promise<unknown>)[] = []
    let storage: DurableStorage, directory: SQLAccountDirectory, app: SingleProcessApp
    let service: ManagementService, owner: ManagementSession, control: pg.Pool, databaseUrl: string

    beforeEach(async () => {
      const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
      cleanups.push(() => admin.end())
      const name = `management_fault_${randomUUID().replaceAll('-', '')}`
      await admin.query(`CREATE DATABASE "${name}"`)
      cleanups.push(() => dropTestDatabase(admin, name))
      const url = new URL(process.env.TEST_DATABASE_URL!)
      url.pathname = `/${name}`
      databaseUrl = url.href
      const root = await mkdtemp(join(tmpdir(), 'arcadia-pg-management-fault-'))
      cleanups.push(() => rm(root, { recursive: true, force: true }))
      control = new pg.Pool({ connectionString: databaseUrl })
      cleanups.push(() => control.end())
      storage = openStorage({ driver: 'postgres', connectionString: databaseUrl })
      cleanups.push(() => storage.close())
      await storage.migrate()
      directory = new SQLAccountDirectory(storage, SERVER)
      const workspace = await ContentWorkspace.open(join(root, 'workspace'))
      cleanups.push(() => workspace.close())
      app = createSingleProcessApp({ serverId: SERVER, management: { storage, workspace } })
      cleanups.push(() => app.stop())
      service = app.management!
      await service.ready()
      owner = await service.auth.exchangeBootstrap(
        (await service.auth.issueBootstrapCode(service.ownerPermissions)).code,
      )
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      // Run every cleanup even when one fails, so a failed assertion cannot leave a live backend behind.
      const errors: unknown[] = []
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          await cleanup()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length) throw new AggregateError(errors, 'PostgreSQL fault fixture cleanup failed')
    })

    async function independentSnapshot() {
      const observer = openStorage({ driver: 'postgres', connectionString: databaseUrl })
      try {
        return await observer.exportSnapshot()
      } finally {
        await observer.close()
      }
    }

    async function interruptBeforeAudit(
      action: 'account.deactivate' | 'binding.create' | 'grant.replace',
      mutation: () => Promise<unknown>,
    ) {
      const namespace = 174281,
        key = randomInt(1, 0x7fffffff)
      const gate = await control.connect()
      let pending: Promise<{ value: unknown } | { error: unknown }> | undefined
      try {
        await gate.query('SELECT pg_advisory_lock($1::integer, $2::integer)', [namespace, key])
        // The production transaction has already written its account/binding/grant when it reaches audit.
        // These constants belong only to this disposable database; no product SQL or callback is replaced.
        await control.query(`
        CREATE FUNCTION public.arcadia_test_audit_gate() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.value::jsonb->>'action' = '${action}' THEN
            PERFORM pg_advisory_xact_lock(${namespace}, ${key});
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER arcadia_test_audit_gate BEFORE INSERT ON public.arcadia_audit
          FOR EACH ROW EXECUTE FUNCTION public.arcadia_test_audit_gate();
      `)
        // Attach the rejection handler immediately: termination is expected, an unhandled rejection is not.
        pending = mutation().then(
          value => ({ value }),
          error => ({ error }),
        )
        let victim: { pid: number; state: string; wait_event: string; backend_xid: string | null } | undefined
        await expect
          .poll(
            async () => {
              const waiting = await control.query<NonNullable<typeof victim>>(
                `SELECT a.pid, a.state, a.wait_event, a.backend_xid
               FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
               WHERE l.locktype = 'advisory' AND NOT l.granted
                 AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
                 AND l.classid = $1::oid AND l.objid = $2::oid AND l.objsubid = 2`,
                [namespace, key],
              )
              victim = waiting.rows.length === 1 ? waiting.rows[0] : undefined
              return waiting.rowCount
            },
            { timeout: 5000 },
          )
          .toBe(1)
        expect(victim).toMatchObject({ state: 'active', wait_event: 'advisory' })
        expect(victim!.backend_xid).not.toBeNull()
        const killed = await control.query<{ terminated: boolean }>('SELECT pg_terminate_backend($1) AS terminated', [
          victim!.pid,
        ])
        expect(killed.rows[0].terminated).toBe(true)
        const result = await pending
        expect(result).toHaveProperty('error')
        if (!('error' in result)) throw new Error('Interrupted management mutation unexpectedly succeeded')
        expect(result.error).toBeInstanceOf(Error)
        // Kysely may report the failed ROLLBACK after the original 57P01; both describe the dead connection.
        expect((result.error as Error).message).toMatch(
          /connection error|connection terminated|terminating connection/i,
        )
        await expect
          .poll(
            async () => (await control.query('SELECT 1 FROM pg_stat_activity WHERE pid = $1', [victim!.pid])).rowCount,
          )
          .toBe(0)
      } finally {
        try {
          await gate.query('SELECT pg_advisory_unlock($1::integer, $2::integer)', [namespace, key])
        } finally {
          // Destroying this test-only connection also releases the gate if explicit unlock fails.
          gate.release(true)
        }
        await pending
        await control.query(
          'DROP TRIGGER IF EXISTS arcadia_test_audit_gate ON public.arcadia_audit; DROP FUNCTION IF EXISTS public.arcadia_test_audit_gate()',
        )
      }
    }

    it('rolls back account deactivation and audit, preserving sessions until a successful retry', async () => {
      const target = await directory.resolveOrCreate(email('interrupted@example.test'))
      const sessions = new SessionRegistry({ serverId: SERVER, accountEnabled: true })
      cleanups.push(async () => sessions.clear())
      const live = sessions.issueVerifiedAccount({ id: 'live-target', name: 'Target' }, target.accountId)
      const revoked: string[] = []
      const accounts = new ManagementAccounts(
        storage,
        {
          serverId: SERVER,
          directory,
          sessions,
          revokeSession: async session => {
            revoked.push(session.token)
          },
        },
        service.auth,
      )
      const principal = await service.auth.createPrincipal(owner.actor, {
        displayName: 'Target manager',
        scope,
        accountId: target.accountId,
        serverId: SERVER,
      })
      await service.auth.grant(owner.actor, { principalId: principal.id, scope, actions: ['read'] })
      const management = await service.auth.exchangeAccount(SERVER, target.accountId)
      const before = await independentSnapshot()

      await interruptBeforeAudit('account.deactivate', () => accounts.deactivate(owner.actor, target.accountId))

      expect(await independentSnapshot()).toEqual(before)
      expect(await directory.getStatus(target.accountId)).toBe('active')
      expect(sessions.authenticate(live.token)).toBeDefined()
      expect(revoked).toEqual([])
      expect(await service.auth.authenticate(management.token)).toEqual(management.actor)
      await expect(accounts.deactivate(owner.actor, target.accountId)).resolves.toMatchObject({ status: 'deactivated' })
      expect(await directory.getStatus(target.accountId)).toBe('deactivated')
      expect(sessions.authenticate(live.token)).toBeUndefined()
      expect(revoked).toEqual([live.token])
      await expect(service.auth.authenticate(management.token)).rejects.toMatchObject({ status: 401 })
    })

    it('rolls back a newly created binding and audit without changing the published catalog', async () => {
      const before = await independentSnapshot()
      const catalog = app.environments.list()
      const create = () =>
        service.request(owner.actor, {
          method: 'POST',
          path: `/servers/${SERVER}/bindings`,
          body: { environmentId: 'private-draft', enabled: false, visibility: 'private', selection: 'pinned' },
        })

      await interruptBeforeAudit('binding.create', create)

      expect(await independentSnapshot()).toEqual(before)
      expect(app.environments.list()).toEqual(catalog)
      await expect(create()).resolves.toMatchObject({ status: 201 })
      expect(await storage.list('bindings')).toHaveLength(1)
      expect(
        (await storage.list<{ action: string }>('audit')).filter(row => row.value.action === 'binding.create'),
      ).toHaveLength(1)
      expect(app.environments.list()).toEqual(catalog)
    })

    it('rolls back a grant replacement and audit, then reuses the surviving storage pool successfully', async () => {
      const principal = await service.auth.createPrincipal(owner.actor, { displayName: 'Viewer', scope })
      const grant = await service.auth.grant(owner.actor, { principalId: principal.id, scope, actions: ['read'] })
      const before = await independentSnapshot()
      const replace = () =>
        service.auth.grant(
          owner.actor,
          {
            principalId: principal.id,
            scope,
            actions: ['read', 'settings.manage'],
          },
          grant.revision,
        )

      await interruptBeforeAudit('grant.replace', replace)

      expect(await independentSnapshot()).toEqual(before)
      expect(await storage.get<ManagementGrant>('grants', grant.id)).toEqual(grant)
      await expect(replace()).resolves.toMatchObject({
        revision: grant.revision + 1,
        value: { actions: ['read', 'settings.manage'] },
      })
      expect(
        (await storage.list<{ action: string }>('audit')).filter(row => row.value.action === 'grant.replace'),
      ).toHaveLength(2)
    })

    it('discards an idle connection after backend termination and reports only a safe diagnostic', async () => {
      const diagnostics = vi.spyOn(console, 'warn')
      const applicationName = `arcadia_idle_fault_${randomUUID()}`
      const url = new URL(databaseUrl)
      url.searchParams.set('application_name', applicationName)
      const idle = openStorage({ driver: 'postgres', connectionString: url.href })
      cleanups.push(() => idle.close())
      const before = await idle.list('servers')
      const backend = await control.query<{ pid: number; state: string }>(
        'SELECT pid, state FROM pg_stat_activity WHERE application_name = $1 AND datname = current_database()',
        [applicationName],
      )
      expect(backend.rows).toHaveLength(1)
      expect(backend.rows[0].state).toBe('idle')
      expect(
        (await control.query('SELECT pg_terminate_backend($1) AS terminated', [backend.rows[0].pid])).rows[0]
          .terminated,
      ).toBe(true)
      await expect.poll(() => diagnostics.mock.calls.length).toBe(1)
      expect(diagnostics.mock.calls[0]).toEqual(['[database] PostgreSQL connection failed', { code: '57P01' }])
      expect(await idle.list('servers')).toEqual(before)
    })

    it('leaves a caller-owned pool and its connection error listeners under caller ownership', async () => {
      const pool = new pg.Pool({ connectionString: databaseUrl })
      cleanups.push(() => pool.end())
      const callerError = () => {}
      pool.on('error', callerError)
      const client = await pool.connect()
      const clientErrors = client.listeners('error')
      client.release()
      const idleErrors = client.listeners('error')
      const poolErrors = pool.listeners('error')
      const connects = pool.listeners('connect')
      const borrowed = openStorage({ driver: 'postgres', pool })
      await borrowed.list('servers')
      await borrowed.close()
      expect(pool.listeners('error')).toEqual(poolErrors)
      expect(pool.listeners('connect')).toEqual(connects)
      expect(client.listeners('error')).toEqual(idleErrors)
      const reacquired = await pool.connect()
      try {
        expect(reacquired).toBe(client)
        expect(reacquired.listeners('error')).toEqual(clientErrors)
        expect((await reacquired.query('SELECT 1 AS alive')).rows).toEqual([{ alive: 1 }])
      } finally {
        reacquired.release()
      }
    })
  },
)
