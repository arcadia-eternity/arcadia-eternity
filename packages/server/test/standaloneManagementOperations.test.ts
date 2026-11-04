import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openStorage, type DurableStorage, type StorageOptions } from '@arcadia-eternity/database'
import {
  OperationService,
  type Operation,
  type OperationContext,
  type OperationValue,
} from '../src/standalone/management/operations'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

for (const driver of ['sqlite', 'postgres'] as const) {
  describe.skipIf(driver === 'postgres' && !process.env.TEST_DATABASE_URL)(
    `${driver} durable management operations`,
    () => {
      let directory: string
      let storage: DurableStorage
      let operations: OperationService
      let storageOptions: StorageOptions
      let admin: pg.Pool | undefined
      let schemaName: string | undefined
      const actor = { principalId: 'owner', credentialId: 'session-a', kind: 'session' }
      const command = (idempotencyKey: string, input: unknown = { versionId: 'v1' }) => ({
        kind: 'publish',
        scope: 'server:test',
        actor,
        idempotencyKey,
        input,
      })
      const settle = async (id: string): Promise<Operation> => {
        let result!: Operation
        await expect
          .poll(async () => {
            result = await operations.get(id)
            return ['queued', 'running'].includes(result.status)
          })
          .toBe(false)
        return result
      }

      beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'arcadia-operations-'))
        if (driver === 'postgres') {
          admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
          schemaName = `operations_${randomUUID().replaceAll('-', '')}`
          await admin.query(`CREATE DATABASE "${schemaName}"`)
          const connection = new URL(process.env.TEST_DATABASE_URL!)
          connection.pathname = `/${schemaName}`
          storageOptions = { driver, connectionString: connection.href }
        } else storageOptions = { driver, filename: join(directory, 'state.sqlite') }
        storage = openStorage(storageOptions)
        await storage.migrate()
        operations = new OperationService(storage)
        await operations.ready()
      })
      afterEach(async () => {
        await operations?.close()
        await storage?.close()
        if (admin && schemaName) {
          await admin.query(`DROP DATABASE "${schemaName}" WITH (FORCE)`)
          await admin.end()
          admin = undefined
          schemaName = undefined
        }
        await rm(directory, { recursive: true, force: true })
      })

      it('runs one durable task for concurrent duplicate requests and rejects key reuse with different input', async () => {
        const release = deferred()
        let executions = 0
        const work = async (context: OperationContext) => {
          executions++
          await context.progress({ stage: 'capturing', completed: 1, total: 2 })
          await release.promise
          return { versionId: 'v1' }
        }
        const [a, b] = await Promise.all([
          operations.submit(command('duplicate'), work),
          operations.submit(command('duplicate', { versionId: 'v1' }), work),
        ])
        expect(a.id).toBe(b.id)
        await expect(operations.submit(command('duplicate', { versionId: 'v2' }), work)).rejects.toMatchObject({
          code: 'IDEMPOTENCY_CONFLICT',
        })
        await expect.poll(() => executions).toBe(1)
        release.resolve()
        expect(await settle(a.id)).toMatchObject({ status: 'succeeded', result: { versionId: 'v1' } })
        const audits = await storage.list<{ operationId: string; action: string }>('audit', 'server:test')
        expect(
          audits
            .filter(row => row.value.operationId === a.id)
            .map(row => row.value.action)
            .sort(),
        ).toEqual(['running', 'submitted', 'succeeded'])
      })

      it('deduplicates the same principal across sessions, while isolating different scopes and principals', async () => {
        const first = await operations.submit(command('scoped'), async () => 1)
        const samePrincipal = await operations.submit(
          { ...command('scoped'), actor: { ...actor, credentialId: 'session-b' } },
          async () => 2,
        )
        const otherPrincipal = await operations.submit(
          { ...command('scoped'), actor: { ...actor, principalId: 'another-owner' } },
          async () => 3,
        )
        const otherScope = await operations.submit({ ...command('scoped'), scope: 'server:other' }, async () => 4)
        expect(samePrincipal.id).toBe(first.id)
        expect(new Set([first.id, otherPrincipal.id, otherScope.id]).size).toBe(3)
        await Promise.all([first, otherPrincipal, otherScope].map(item => settle(item.id)))
        expect((await operations.list('server:other')).map(item => item.id)).toEqual([otherScope.id])
      })

      it('cancels an in-flight task and prevents its late durable effect', async () => {
        const entered = deferred()
        const release = deferred()
        const operation = await operations.submit(command('cancel'), async context => {
          entered.resolve()
          await release.promise
          return context.commit(async tx => {
            await tx.create('bindings', { id: 'must-not-exist', scope: 'server:test', value: { version: 'v1' } })
            return { published: true }
          })
        })
        await entered.promise
        expect(await operations.cancel(operation.id)).toMatchObject({ status: 'running', cancelRequested: true })
        release.resolve()
        expect(await settle(operation.id)).toMatchObject({ status: 'cancelled' })
        expect(await storage.get('bindings', 'must-not-exist')).toBeNull()
      })

      it('commits publication and successful operation atomically, and never reports late cancellation as rollback', async () => {
        const committed = deferred()
        const finish = deferred()
        const operation = await operations.submit(command('commit'), async context => {
          const result = await context.commit(async tx => {
            await tx.create('bindings', { id: 'published', scope: 'server:test', value: { version: 'v1' } })
            return { bindingId: 'published' }
          })
          committed.resolve()
          await finish.promise
          return result
        })
        await committed.promise
        expect(await operations.cancel(operation.id)).toMatchObject({ status: 'succeeded', cancelRequested: false })
        expect(await storage.get('bindings', 'published')).toMatchObject({ value: { version: 'v1' } })
        finish.resolve()
        expect(await settle(operation.id)).toMatchObject({ status: 'succeeded', result: { bindingId: 'published' } })
      })

      it('rolls back both a domain write and task completion when the commit callback fails', async () => {
        const operation = await operations.submit(command('rollback'), context =>
          context.commit(async tx => {
            await tx.create('bindings', { id: 'partial', scope: 'server:test', value: {} })
            throw new Error('postgres://private:secret@localhost/internal')
          }),
        )
        const failed = await settle(operation.id)
        expect(failed).toMatchObject({
          status: 'failed',
          error: { code: 'OPERATION_FAILED', message: 'OPERATION_FAILED' },
        })
        expect(JSON.stringify(failed)).not.toContain('secret')
        expect(await storage.get('bindings', 'partial')).toBeNull()
      })

      it('keeps committed publication running until runtime application finishes and refuses late cancellation', async () => {
        const committed = deferred()
        const apply = deferred()
        let signal: AbortSignal | undefined
        const operation = await operations.submit(command('deferred-finalize'), async context => {
          signal = context.signal
          const result = await context.commit(
            async tx => {
              await tx.create('bindings', { id: 'applying', scope: 'server:test', value: { version: 'v1' } })
              return { bindingId: 'applying' }
            },
            { finalize: false },
          )
          committed.resolve()
          await apply.promise
          return { ...result, applied: true }
        })
        await committed.promise
        expect(await operations.get(operation.id)).toMatchObject({
          status: 'running',
          committed: true,
          result: { bindingId: 'applying' },
        })
        expect(await operations.cancel(operation.id)).toMatchObject({
          status: 'running',
          committed: true,
          cancelRequested: false,
        })
        expect(signal?.aborted).toBe(false)
        expect(await storage.get('bindings', 'applying')).toMatchObject({ value: { version: 'v1' } })
        apply.resolve()
        expect(await settle(operation.id)).toMatchObject({
          status: 'succeeded',
          committed: true,
          result: { bindingId: 'applying', applied: true },
        })
      })

      it('reports runtime application failure without losing the committed domain effect or claiming success', async () => {
        const operation = await operations.submit(command('runtime-apply-failed'), async context => {
          await context.commit(
            async tx => {
              await tx.create('bindings', { id: 'unavailable', scope: 'server:test', value: { version: 'v1' } })
              return { bindingId: 'unavailable' }
            },
            { finalize: false },
          )
          throw Object.assign(new Error('private runtime detail'), { code: 'RUNTIME_APPLY_FAILED' })
        })
        expect(await settle(operation.id)).toMatchObject({
          status: 'failed',
          committed: true,
          result: { bindingId: 'unavailable' },
          error: { code: 'RUNTIME_APPLY_FAILED', message: 'RUNTIME_APPLY_FAILED' },
        })
        expect(await storage.get('bindings', 'unavailable')).toMatchObject({ value: { version: 'v1' } })
        expect(await operations.cancel(operation.id)).toMatchObject({ status: 'failed', cancelRequested: false })
      })

      it('records rejected promises without an Error value as failures', async () => {
        const operation = await operations.submit(command('non-error-rejection'), () => Promise.reject(undefined))
        expect(await settle(operation.id)).toMatchObject({
          status: 'failed',
          error: { code: 'OPERATION_FAILED', message: 'OPERATION_FAILED' },
        })
      })

      it('marks previous-owner work interrupted on restart and preserves historical outcomes', async () => {
        const completed = await operations.submit(command('complete-before-restart'), async () => ({ ok: true }))
        await settle(completed.id)
        const old: OperationValue = {
          kind: 'prepare',
          scope: 'workspace:w',
          actor,
          input: {},
          inputFingerprint: 'test',
          idempotencyKey: 'old',
          attempt: 1,
          rootOperationId: 'orphan',
          ownerId: operations.ownerId,
          bootId: 'old-boot',
          status: 'running',
          cancelRequested: false,
          committed: true,
          result: { bindingId: 'reconcile-after-restart' },
          createdAt: 1,
          updatedAt: 2,
        }
        await storage.create('operations', { id: 'orphan', scope: 'workspace:w', value: old })
        await operations.close()
        await storage.close()
        storage = openStorage(storageOptions)
        await storage.checkSchema()
        operations = new OperationService(storage)
        await operations.ready()
        expect(await operations.get('orphan')).toMatchObject({
          status: 'interrupted',
          committed: true,
          result: { bindingId: 'reconcile-after-restart' },
          error: { code: 'OWNER_RESTARTED' },
        })
        expect(await operations.get(completed.id)).toMatchObject({ status: 'succeeded', result: { ok: true } })
      })

      it('fences callbacks after owner close and records an explicit retry lineage', async () => {
        const entered = deferred()
        const release = deferred()
        const late = deferred()
        const operation = await operations.submit(command('stopped'), async context => {
          entered.resolve()
          await release.promise
          try {
            await context.commit(async tx => tx.create('bindings', { id: 'late', scope: 'server:test', value: {} }))
          } finally {
            late.resolve()
          }
        })
        await entered.promise
        await operations.close()
        expect(await operations.get(operation.id)).toMatchObject({ status: 'interrupted' })
        release.resolve()
        await late.promise
        operations = new OperationService(storage)
        await operations.ready()
        const retry = await operations.submit({ ...command('stopped-retry'), retryOf: operation.id }, async () => ({
          ok: true,
        }))
        expect(retry).toMatchObject({ attempt: 2, rootOperationId: operation.id, retryOf: operation.id })
        expect(await settle(retry.id)).toMatchObject({ status: 'succeeded' })
        expect(await storage.get('bindings', 'late')).toBeNull()
        await expect(
          operations.submit(
            { ...command('wrong-input', { versionId: 'other' }), retryOf: operation.id },
            async () => {},
          ),
        ).rejects.toMatchObject({ code: 'OPERATION_RETRY_MISMATCH' })
      })

      it('does not interrupt, inspect or cancel another owner sharing the same database', async () => {
        const entered = deferred()
        const release = deferred()
        const operation = await operations.submit(command('other-owner'), async () => {
          entered.resolve()
          await release.promise
          return { ok: true }
        })
        await entered.promise
        const independent = new OperationService(storage, { ownerId: 'independent' })
        await independent.ready()
        expect(await operations.get(operation.id)).toMatchObject({ status: 'running' })
        await expect(independent.get(operation.id)).rejects.toMatchObject({ code: 'OPERATION_NOT_FOUND' })
        await expect(independent.cancel(operation.id)).rejects.toMatchObject({ code: 'OPERATION_NOT_FOUND' })
        expect(await independent.list()).toEqual([])
        await independent.close()
        expect(await operations.get(operation.id)).toMatchObject({ status: 'running' })
        release.resolve()
        expect(await settle(operation.id)).toMatchObject({ status: 'succeeded' })
      })
    },
  )
}
