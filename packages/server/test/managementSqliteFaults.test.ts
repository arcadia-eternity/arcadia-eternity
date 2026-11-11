import { shippedCatalogMembers, stageShippedCatalog } from './fixtures/npm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openStorage, SQLAccountDirectory, type DurableStorage } from '@arcadia-eternity/database'
import { exhaustSqlitePages, holdSqliteWriter } from '../../database/test/helpers/sqlite-faults'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import { workspaceRetentions } from '../../../bin/server-persistence'
import { createSingleProcessApp } from '../src/runtime/app'
import { ManagementAccounts } from '../src/runtime/management/accounts'
import type { Binding, ManagementRequest } from '../src/runtime/management/service'
import type { Operation } from '../src/runtime/management/operations'
import { SessionRegistry } from '../src/runtime/session'

const SERVER = 'sqlite-fault-server'
const cleanups: (() => Promise<unknown> | void)[] = []
afterEach(async () => {
  const errors: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try {
      await cleanup()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw new AggregateError(errors, 'SQLite fault fixture cleanup failed')
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-management-sqlite-faults-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const filename = join(directory, 'server.sqlite')
  const storage = openStorage({ driver: 'sqlite', filename, busyTimeout: 25 })
  cleanups.push(() => storage.close())
  await storage.migrate()
  const project = await stageShippedCatalog(directory)
  await writeFile(
    join(project, 'arcadia-admission.json'),
    JSON.stringify({ format: 'arcadia.npm-admission', version: 2, profile: 'official' }),
  )
  const workspace: ContentWorkspace = await ContentWorkspace.open(join(directory, 'workspace'), {
    resolveProject: () => project,
    retentions: workspaceRetentions(storage, () => workspace.workspaceId),
  })
  cleanups.push(() => workspace.close())
  const app = createSingleProcessApp({
    serverId: SERVER,
    host: '127.0.0.1',
    port: 0,
    management: { storage, workspace },
  })
  cleanups.push(() => app.stop())
  const service = app.management!
  await service.ready()
  const owner = await service.auth.exchangeBootstrap(
    (await service.auth.issueBootstrapCode(service.ownerPermissions)).code,
  )
  const request = async <T>(input: ManagementRequest): Promise<T> => {
    const result = await service.request(owner.actor, input)
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300)
    return result.body as T
  }
  const base = `/workspaces/${workspace.workspaceId}/environments`
  const draft = await request<{ revision: string }>({
    method: 'POST',
    path: base,
    body: {
      document: { schemaVersion: 1, id: 'shared', name: 'Shared', packages: shippedCatalogMembers, sources: [] },
      expectedRevision: null,
    },
  })
  const started = await request<{ id: string }>({
    method: 'POST',
    path: `${base}/shared/prepare`,
    body: { expectedRevision: draft.revision },
    headers: { 'idempotency-key': 'prepare' },
  })
  const prepared = await terminal(storage, started.id)
  const versionId = (prepared.result as { versionId: string }).versionId
  const created = await request<Binding & { id: string; revision: number }>({
    method: 'POST',
    path: `/servers/${SERVER}/bindings`,
    body: { environmentId: 'shared', versionId, enabled: true, visibility: 'public', matchmakingEnabled: true },
  })
  const publication = await request<{ id: string }>({
    method: 'POST',
    path: `/servers/${SERVER}/bindings/${created.id}/publish`,
    body: { versionId },
    headers: { 'if-match': String(created.revision), 'idempotency-key': 'publish' },
  })
  await terminal(storage, publication.id)
  expect(app.environments.list()).toHaveLength(1)
  const binding = (await storage.get<Binding>('bindings', created.id))!

  const accounts = new SQLAccountDirectory(storage, SERVER)
  const account = await accounts.resolveOrCreate(identity('existing@example.test'))
  const sessions = new SessionRegistry({ serverId: SERVER, accountEnabled: true })
  cleanups.push(() => sessions.clear())
  const session = sessions.issueVerifiedAccount({ id: 'player', name: 'Player' }, account.accountId)
  const revoked: string[] = []
  const administration = new ManagementAccounts(
    storage,
    {
      serverId: SERVER,
      directory: accounts,
      sessions,
      async revokeSession(value) {
        revoked.push(value.token)
      },
    },
    service.auth,
  )
  const principal = await service.auth.createPrincipal(owner.actor, {
    displayName: 'Viewer',
    scope: service.serverScope,
  })
  const grant = await service.auth.grant(owner.actor, {
    principalId: principal.id,
    scope: service.serverScope,
    actions: ['read'],
  })
  const mutations = [
    { name: 'first login', run: () => accounts.resolveOrCreate(identity('new@example.test')) },
    { name: 'account deactivation', run: () => administration.deactivate(owner.actor, account.accountId) },
    {
      name: 'grant expansion',
      run: () =>
        service.auth.grant(owner.actor, { ...grant.value, actions: ['read', 'settings.manage'] }, grant.revision),
    },
    {
      name: 'binding visibility',
      run: () =>
        service.request(owner.actor, {
          method: 'PATCH',
          path: `/servers/${SERVER}/bindings/${binding.id}`,
          body: { visibility: 'private' },
          headers: { 'if-match': String(binding.revision) },
        }),
    },
  ]
  return { storage, filename, app, accounts, account, sessions, session, revoked, grant, mutations }
}

function identity(subject: string) {
  return { providerId: 'email', issuer: 'mailto', subject, verifiedAt: Date.now() }
}

async function terminal(storage: DurableStorage, id: string) {
  let operation!: Operation
  await expect
    .poll(
      async () => {
        operation = (await storage.get<Operation>('operations', id))!.value
        return operation.status
      },
      { timeout: 10_000 },
    )
    .not.toMatch(/^(queued|running)$/)
  expect(operation.status, JSON.stringify(operation)).toBe('succeeded')
  return operation
}

describe('management survives actual SQLite write failures', { timeout: 30_000 }, () => {
  for (const fault of ['SQLITE_BUSY', 'SQLITE_FULL'] as const) {
    it(`${fault} preserves accounts, grants, binding publication and audit, then permits a clean retry`, async () => {
      const env = await setup()
      const before = await env.storage.exportSnapshot()
      const published = env.app.environments.list()
      const restorePages = fault === 'SQLITE_FULL' ? await exhaustSqlitePages(env.storage) : undefined
      try {
        for (const mutation of env.mutations) {
          const releaseWriter = fault === 'SQLITE_BUSY' ? holdSqliteWriter(env.filename) : undefined
          try {
            await expect(mutation.run(), mutation.name).rejects.toMatchObject({ code: fault })
          } finally {
            releaseWriter?.()
          }
          // exportSnapshot also reserves the writer, so release the competing connection first.
          expect(await env.storage.exportSnapshot(), mutation.name).toEqual(before)
          expect(env.app.environments.list(), mutation.name).toEqual(published)
          expect(env.sessions.authenticate(env.session.token), mutation.name).toBeDefined()
          expect(env.revoked, mutation.name).toEqual([])
        }
      } finally {
        await restorePages?.()
      }
      for (const mutation of env.mutations) await mutation.run()
      expect(await env.accounts.getStatus(env.account.accountId)).toBe('deactivated')
      expect(env.sessions.authenticate(env.session.token)).toBeUndefined()
      expect(env.revoked).toEqual([env.session.token])
      expect((await env.storage.get('grants', env.grant.id))?.revision).toBe(env.grant.revision + 1)
      expect(env.app.environments.list()).toEqual([])
      const after = await env.storage.exportSnapshot()
      expect(after.accounts).toHaveLength(before.accounts.length + 1)
      expect(after.identities).toHaveLength(before.identities.length + 1)
      expect(after.records.audit).toHaveLength(before.records.audit.length + 3)
    })
  }
})
