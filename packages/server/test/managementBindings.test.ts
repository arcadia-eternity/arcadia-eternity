import { legacySession } from './fixtures/management'
import { shippedCatalogMembers, stageShippedCatalog } from './fixtures/npm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { openStorage, type DurableStorage } from '@arcadia-eternity/database'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import type { EnvironmentInstallation, StaticPreparer } from '@arcadia-eternity/content-sdk/management-workspace'
import { workspaceRetentions } from '../../../bin/server-persistence'
import { createSingleProcessApp } from '../src/runtime/app'
import type { Binding, ManagementRequest } from '../src/runtime/management/service'
import type { ManagementActor } from '../src/runtime/management/auth'
import type { Operation } from '../src/runtime/management/operations'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
}, 30_000)

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-binding-integration-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const source = await stageShippedCatalog(directory)
  await writeFile(
    join(source, 'arcadia-admission.json'),
    JSON.stringify({
      format: 'arcadia.npm-admission',
      version: 2,
      profile: 'official',
    }),
  )
  const storage = openStorage({ driver: 'sqlite', filename: join(directory, 'server.sqlite') })
  await storage.migrate()
  cleanups.push(() => storage.close())
  const workspace: ContentWorkspace = await ContentWorkspace.open(join(directory, 'workspace'), {
    resolveProject: () => source,
    retentions: workspaceRetentions(storage, () => workspace.workspaceId),
  })
  cleanups.push(() => workspace.close())
  let afterStaticPreparation: (() => Promise<void>) | undefined
  const createApp = () =>
    createSingleProcessApp({
      host: '127.0.0.1',
      port: 0,
      serverId: 'binding-server',
      management: {
        storage,
        workspace,
        prepareEnvironment: (input, validator: StaticPreparer) =>
          workspace.prepareEnvironment(input, async materials => {
            const result = await validator(materials)
            await afterStaticPreparation?.()
            return result
          }),
      },
    })
  let app = createApp()
  cleanups.push(() => app.stop())
  let service = app.management!
  await service.ready()
  const owner = await service.auth.exchangeBootstrap((await service.auth.issueBootstrapCode('configured-owner')).code)
  let sequence = 0
  const request = async <T>(input: ManagementRequest, actor?: ManagementActor): Promise<T> => {
    const result = actor ? await service.request(actor, input) : await service.localRequest(input)
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300)
    return result.body as T
  }
  const environmentsPath = `/workspaces/${workspace.workspaceId}/environments`
  const draft = (name: string, expectedRevision: string | null) =>
    workspace.saveDraft({
      document: { schemaVersion: 1, id: 'shared', name, packages: shippedCatalogMembers, sources: [] },
      expectedRevision,
    })
  const beginPrepare = async (expectedRevision: string) =>
    request<{ id: string }>({
      method: 'POST',
      path: `${environmentsPath}/apply`,
      body: { document: (await workspace.getDraft('shared')).document, expectedRevision },
      headers: { 'idempotency-key': `apply-${++sequence}` },
    })
  const prepare = async (expectedRevision: string) => {
    const started = await beginPrepare(expectedRevision)
    const operation = await terminal(storage, started.id)
    expect(operation.status, JSON.stringify(operation)).toBe('succeeded')
    return operation.result as EnvironmentInstallation
  }
  const createBinding = () =>
    request<Binding & { id: string; revision: number }>(
      {
        method: 'POST',
        path: '/servers/binding-server/bindings',
        body: {
          environmentId: 'shared',
          enabled: true,
          visibility: 'public',
          matchmakingEnabled: true,
        },
      },
      owner.actor,
    )
  return {
    get app() {
      return app
    },
    get service() {
      return service
    },
    storage,
    workspace,
    owner,
    request,
    draft,
    beginPrepare,
    prepare,
    createBinding,
    async restart() {
      await app.stop()
      app = createApp()
      service = app.management!
      await service.ready()
    },
    gatePreparation(fn: (() => Promise<void>) | undefined) {
      afterStaticPreparation = fn
    },
  }
}

async function terminal(storage: DurableStorage, id: string) {
  let operation!: Operation
  await expect
    .poll(
      async () => {
        const record = await storage.get<Operation>('operations', id)
        operation = { ...record!.value, id: record!.id, revision: record!.revision }
        return operation.status
      },
      { timeout: 20_000 },
    )
    .not.toMatch(/^(queued|running)$/)
  return operation
}

it('binds the current npm environment without publishing a snapshot', async () => {
  const f = await setup()
  const draft = await f.draft('Shared', null)
  const installation = await f.prepare(draft.revision)
  const binding = await f.createBinding()
  expect(binding.condition).toBe('available')
  expect(installation.installationId).toBe('shared')
  expect(binding).not.toHaveProperty('desiredVersionId')
  expect(binding).not.toHaveProperty('effectiveInstallationId')
  expect(f.app.environments.list()).toHaveLength(1)
  await f.restart()
  expect((await f.storage.get<Binding>('bindings', binding.id))?.value.condition).toBe('available')
  expect(f.app.environments.list()).toHaveLength(1)
}, 30_000)

it('preparing an edited environment updates its binding without a second publication', async () => {
  const f = await setup()
  const draft = await f.draft('First', null)
  await f.prepare(draft.revision)
  const binding = await f.createBinding()
  const current = await f.workspace.getDraft('shared')
  const edited = await f.draft('Updated', current.revision)
  await f.prepare(edited.revision)
  expect(await f.workspace.listInstallations()).toHaveLength(1)
  const row = await f.storage.get<Binding>('bindings', binding.id)
  expect(row?.value).toMatchObject({
    environmentId: 'shared',
    condition: 'available',
    enabled: true,
    matchmakingEnabled: true,
  })
  expect((await f.workspace.getDraft('shared')).document.name).toBe('Updated')
}, 30_000)

it('failed preparation preserves the usable installation and binding', async () => {
  const f = await setup()
  const draft = await f.draft('Shared', null)
  const installed = await f.prepare(draft.revision)
  const binding = await f.createBinding()
  f.gatePreparation(async () => {
    throw new Error('invalid content')
  })
  const current = await f.workspace.getDraft('shared')
  const op = await f.beginPrepare(current.revision)
  expect((await terminal(f.storage, op.id)).status).toBe('failed')
  expect((await f.workspace.getInstallation('shared')).createdAt).toBe(installed.createdAt)
  expect((await f.storage.get<Binding>('bindings', binding.id))?.value.condition).toBe('available')
  expect(f.app.environments.list()).toHaveLength(1)
}, 30_000)

it('removes snapshot publication and requires permission to activate a binding', async () => {
  const f = await setup()
  const draft = await f.draft('Shared', null)
  await f.prepare(draft.revision)
  const binding = await f.createBinding()
  const result = await f.service.localRequest({
    method: 'POST',
    path: `/servers/binding-server/bindings/${binding.id}/publish`,
    body: {},
  })
  expect(result.status).toBe(404)
  const viewer = await legacySession(
    f.service.auth,
    [{ scope: { kind: 'server', id: 'binding-server' }, actions: ['read'] }],
    'viewer',
  )
  await expect(
    f.service.request(viewer.actor, {
      method: 'POST',
      path: '/servers/binding-server/bindings',
      body: { environmentId: 'shared', enabled: true },
    }),
  ).rejects.toThrow()
}, 30_000)

it('preparing a bound environment requires publish permission before replacement', async () => {
  const f = await setup()
  const draft = await f.draft('Shared', null)
  await f.prepare(draft.revision)
  await f.createBinding()
  const editor = await legacySession(
    f.service.auth,
    [
      {
        scope: { kind: 'workspace', id: f.workspace.workspaceId },
        actions: ['read', 'edit', 'prepare', 'environment.use'],
      },
    ],
    'workspace-editor',
  )
  const current = await f.workspace.getDraft('shared')
  await expect(
    f.service.request(editor.actor, {
      method: 'POST',
      path: `/workspaces/${f.workspace.workspaceId}/environments/apply`,
      body: { document: current.document, expectedRevision: current.revision },
      headers: { 'idempotency-key': 'forbidden-bound-update' },
    }),
  ).rejects.toThrow()
  expect((await f.workspace.getDraft('shared')).revision).toBe(current.revision)
}, 30_000)

it('saves and applies in one operation, preserving both the manifest and installation on failure', async () => {
  const f = await setup()
  const path = `/workspaces/${f.workspace.workspaceId}/environments/apply`
  expect(
    (
      await f.service.localRequest({
        method: 'POST',
        path: `/workspaces/${f.workspace.workspaceId}/environments/shared/prepare`,
        body: {},
      })
    ).status,
  ).toBe(404)
  const document = {
    schemaVersion: 2,
    id: 'shared',
    name: 'Applied',
    packages: shippedCatalogMembers,
    sources: [],
    rules: { schemaVersion: 1 },
    requires: {},
  }
  const first = await f.request<{ id: string }>({
    method: 'POST',
    path,
    body: { document, expectedRevision: null },
    headers: { 'idempotency-key': 'apply-new' },
  })
  expect((await terminal(f.storage, first.id)).status).toBe('succeeded')
  const original = await f.workspace.getDraft('shared')
  const installation = await f.workspace.getInstallation('shared')
  await f.createBinding()
  f.gatePreparation(async () => {
    throw new Error('invalid replacement')
  })
  const failed = await f.request<{ id: string }>({
    method: 'POST',
    path,
    body: { document: { ...original.document, name: 'Rejected' }, expectedRevision: original.revision },
    headers: { 'idempotency-key': 'apply-bad' },
  })
  expect((await terminal(f.storage, failed.id)).status).toBe('failed')
  expect(await f.workspace.getDraft('shared')).toEqual(original)
  expect((await f.workspace.getInstallation('shared')).createdAt).toBe(installation.createdAt)
  f.gatePreparation(undefined)
  const next = await f.request<{ id: string }>({
    method: 'POST',
    path,
    body: { document: { ...original.document, name: 'Updated' }, expectedRevision: original.revision },
    headers: { 'idempotency-key': 'apply-good' },
  })
  expect((await terminal(f.storage, next.id)).status).toBe('succeeded')
  expect((await f.workspace.getDraft('shared')).document.name).toBe('Updated')
}, 30_000)

it('rejects repeated and concurrent additions and allows adding again after removal', async () => {
  const f = await setup()
  const draft = await f.draft('Shared', null)
  await f.prepare(draft.revision)
  const results = await Promise.allSettled([f.createBinding(), f.createBinding()])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find(result => result.status === 'rejected')).toMatchObject({
    reason: { code: 'ENVIRONMENT_ALREADY_BOUND' },
  })
  const rows = await f.storage.list<Binding>('bindings')
  expect(rows).toHaveLength(1)
  await expect(
    f.service.request(f.owner.actor, {
      method: 'POST',
      path: '/servers/binding-server/bindings',
      body: { environmentId: 'shared', executionPolicy: 'peer' },
    }),
  ).rejects.toMatchObject({ code: 'ENVIRONMENT_ALREADY_BOUND' })
  await f.request(
    {
      method: 'DELETE',
      path: `/servers/binding-server/bindings/${rows[0].id}`,
      headers: { 'if-match': String(rows[0].revision) },
    },
    f.owner.actor,
  )
  expect(await f.storage.list('bindings')).toHaveLength(0)
  await f.createBinding()
  expect(await f.storage.list('bindings')).toHaveLength(1)
}, 30_000)

it('changes execution mode on the existing binding without creating another one', async () => {
  const f = await setup()
  const draft = await f.draft('Shared', null)
  await f.prepare(draft.revision)
  let binding = await f.createBinding()
  const original = f.app.environments.list()[0]
  const lease = f.app.environments.acquire(original.id)
  cleanups.push(() => lease.release())
  for (const executionPolicy of ['peer', 'server'] as const) {
    binding = await f.request(
      {
        method: 'PATCH',
        path: `/servers/binding-server/bindings/${binding.id}`,
        headers: { 'if-match': String(binding.revision) },
        body: { executionPolicy },
      },
      f.owner.actor,
    )
    expect(binding).toMatchObject({ executionPolicy, condition: 'available' })
    expect(await f.storage.list('bindings')).toHaveLength(1)
    expect(lease.executionPolicy).toBe('server')
    expect(f.app.environments.content(original.id)).toBeDefined()
    if (executionPolicy === 'peer') {
      await expect
        .poll(
          () => {
            try {
              f.app.environments.selectDefault(original.id)
              return false
            } catch (error) {
              return (error as Error).message === 'ENVIRONMENT_RETIRED'
            }
          },
          { timeout: 5000 },
        )
        .toBe(true)
    }
  }
}, 30_000)
