import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openStorage, type DurableStorage } from '../../database/src/storage'
import { ContentWorkspace } from '../../content-dev/src/content-workspace.mjs'
import type { EnvironmentVersion, StaticPreparer } from '../../content-dev/src/content-workspace.mjs'
import { workspaceRetentions } from '../../../bin/server-persistence'
import { createSingleProcessApp } from '../src/standalone/app'
import type { Binding, ManagementRequest } from '../src/standalone/management/service'
import type { ManagementActor, ManagementGrant } from '../src/standalone/management/auth'
import type { Operation, OperationValue } from '../src/standalone/management/operations'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-binding-integration-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'project')
  await mkdir(join(source, 'node_modules'), { recursive: true })
  const manifest = { name: 'empty-management-environment', version: '1.0.0', private: true, dependencies: {} }
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
  await writeFile(
    join(source, 'package-lock.json'),
    JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name: manifest.name, version: manifest.version, dependencies: {} } },
    }),
  )
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
          workspace.prepareVersion(input, async materials => {
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
  const owner = await service.auth.exchangeBootstrap(
    (await service.auth.issueBootstrapCode(service.ownerPermissions, 'configured-owner')).code,
  )
  let sequence = 0
  const request = async <T>(input: ManagementRequest, actor?: ManagementActor): Promise<T> => {
    const result = actor ? await service.request(actor, input) : await service.localRequest(input)
    expect(result.status, JSON.stringify(result.body)).toBeLessThan(300)
    return result.body as T
  }
  const environmentsPath = `/workspaces/${workspace.workspaceId}/environments`
  const draft = (name: string, expectedRevision: string | null) =>
    request<{ revision: string }>({
      method: 'POST',
      path: environmentsPath,
      body: { document: { schemaVersion: 1, id: 'shared', name, packages: {}, sources: [] }, expectedRevision },
    })
  const beginPrepare = (expectedRevision: string) =>
    request<{ id: string }>({
      method: 'POST',
      path: `${environmentsPath}/shared/prepare`,
      body: { expectedRevision },
      headers: { 'idempotency-key': `prepare-${++sequence}` },
    })
  const prepare = async (expectedRevision: string) => {
    const started = await beginPrepare(expectedRevision)
    const operation = await terminal(storage, started.id)
    expect(operation.status, JSON.stringify(operation)).toBe('succeeded')
    return operation.result as EnvironmentVersion
  }
  const createBinding = (versionId: string, selection: Binding['selection'] = 'follow-ready') =>
    request<Binding & { id: string; revision: number }>(
      {
        method: 'POST',
        path: '/servers/binding-server/bindings',
        body: {
          environmentId: 'shared',
          versionId,
          selection,
          enabled: true,
          visibility: 'public',
          matchmakingEnabled: true,
        },
      },
      owner.actor,
    )
  const publish = async (bindingId: string, versionId: string) => {
    const row = (await storage.get<Binding>('bindings', bindingId))!
    const result = await request<{ id: string }>({
      method: 'POST',
      path: `/servers/binding-server/bindings/${bindingId}/publish`,
      body: { versionId },
      headers: { 'if-match': String(row.revision), 'idempotency-key': `publish-${++sequence}` },
    })
    return terminal(storage, result.id)
  }
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
    publish,
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

async function effective(storage: DurableStorage, id: string, versionId: string) {
  await expect
    .poll(async () => (await storage.get<Binding>('bindings', id))?.value.effectiveVersionId, { timeout: 20_000 })
    .toBe(versionId)
  // A durable pointer alone is insufficient: wait for the actual publication operation to finish.
  await expect
    .poll(
      async () =>
        (await storage.list<Operation>('operations'))
          .filter(row => row.value.kind === 'binding.publish')
          .every(row => !['queued', 'running'].includes(row.value.status)),
      { timeout: 20_000 },
    )
    .toBe(true)
}

/** The exact durable boundary after pointer intent commits, before the in-memory publication applies. */
async function interruptCommittedPublication(
  env: Awaited<ReturnType<typeof setup>>,
  bindingId: string,
  versionId: string,
) {
  const operationId = 'interrupted-publication'
  await env.storage.transaction(async tx => {
    const before = (await tx.get<Binding>('bindings', bindingId))!
    await tx.replace('bindings', bindingId, before.revision, {
      ...before.value,
      condition: 'applying',
      desiredVersionId: versionId,
    })
    const value: OperationValue = {
      kind: 'binding.publish',
      scope: 'server:binding-server',
      actor: env.owner.actor,
      input: { id: bindingId, versionId, expectedRevision: before.revision },
      inputFingerprint: 'recorded-durable-boundary',
      idempotencyKey: 'crash-publication',
      attempt: 1,
      rootOperationId: operationId,
      ownerId: env.service.operations.ownerId,
      bootId: env.service.bootId,
      status: 'running',
      committed: true,
      cancelRequested: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await tx.create('operations', { id: operationId, scope: value.scope, value })
  })
  await env.workspace.retain(versionId, `binding:${bindingId}:candidate:${operationId}`)
  return operationId
}

describe('durable binding publication with real captured environment artifacts', () => {
  it('advances follow-ready to a matching new draft while keeping pinned bindings on their chosen version', async () => {
    const env = await setup()
    const firstDraft = await env.draft('First', null)
    const first = await env.prepare(firstDraft.revision)
    const following = await env.createBinding(first.versionId)
    const pinned = await env.createBinding(first.versionId, 'pinned')
    expect((await env.publish(following.id, first.versionId)).status).toBe('succeeded')
    expect((await env.publish(pinned.id, first.versionId)).status).toBe('succeeded')
    const secondDraft = await env.draft('Second', firstDraft.revision)
    const second = await env.prepare(secondDraft.revision)
    expect(second.versionId).not.toBe(first.versionId)
    await effective(env.storage, following.id, second.versionId)
    expect((await env.storage.get<Binding>('bindings', pinned.id))?.value.effectiveVersionId).toBe(first.versionId)
    expect((await env.storage.get<Binding>('bindings', following.id))?.value).toMatchObject({
      condition: 'available',
      followPrincipalId: env.owner.actor.principalId,
    })
    expect(env.app.environments.list()).toHaveLength(2)
    expect((await env.workspace.getVersion(first.versionId)).versionId).toBe(first.versionId)
  }, 45_000)

  it('keeps an explicitly configured follow policy after logout but stops after its publish grant is revoked', async () => {
    const env = await setup()
    const firstDraft = await env.draft('First', null)
    const first = await env.prepare(firstDraft.revision)
    const binding = await env.createBinding(first.versionId)
    expect((await env.publish(binding.id, first.versionId)).status).toBe('succeeded')
    const grants = await env.service.auth.listGrants(env.owner.actor, env.service.serverScope)
    const policyGrant = grants.find(grant => grant.value.principalId === env.owner.actor.principalId)!
    await env.service.auth.revokeCredential(env.owner.actor, env.owner.actor.credentialId)
    await expect(env.service.auth.authenticate(env.owner.token)).rejects.toMatchObject({ status: 401 })
    const secondDraft = await env.draft('After logout', firstDraft.revision)
    const second = await env.prepare(secondDraft.revision)
    await effective(env.storage, binding.id, second.versionId)
    await env.request({
      method: 'POST',
      path: `/grants/${policyGrant.id}/revoke`,
      body: { revision: policyGrant.revision },
    })
    const thirdDraft = await env.draft('After revoke', secondDraft.revision)
    await env.prepare(thirdDraft.revision)
    expect((await env.storage.get<Binding>('bindings', binding.id))?.value).toMatchObject({
      effectiveVersionId: second.versionId,
      condition: 'available',
      reason: 'FOLLOW_POLICY_BLOCKED',
    })
    const remaining = await env.storage.get<ManagementGrant>('grants', policyGrant.id)
    expect(remaining).toBeNull()
  }, 45_000)

  it('retains a completed stale preparation without following it after the source draft changed', async () => {
    const env = await setup()
    const firstDraft = await env.draft('First', null)
    const first = await env.prepare(firstDraft.revision)
    const binding = await env.createBinding(first.versionId)
    expect((await env.publish(binding.id, first.versionId)).status).toBe('succeeded')
    const oldDraft = await env.draft('Preparing old draft', firstDraft.revision)
    const entered = deferred(),
      release = deferred()
    env.gatePreparation(async () => {
      entered.resolve()
      await release.promise
    })
    const started = await env.beginPrepare(oldDraft.revision)
    await entered.promise
    try {
      await env.draft('Newer desired draft', oldDraft.revision)
    } finally {
      release.resolve()
    }
    const operation = await terminal(env.storage, started.id)
    expect(operation.status, JSON.stringify(operation)).toBe('succeeded')
    const stale = operation.result as EnvironmentVersion
    expect(stale.draftRevision).toBe(oldDraft.revision)
    expect((await env.workspace.getVersion(stale.versionId)).status).toBe('ready')
    expect((await env.storage.get<Binding>('bindings', binding.id))?.value.effectiveVersionId).toBe(first.versionId)
    expect(
      (await env.storage.list<Operation>('operations')).filter(row => row.value.kind === 'binding.publish'),
    ).toHaveLength(1)
  }, 45_000)

  it('reports a runtime publication failure as a failed operation and an unavailable binding', async () => {
    const env = await setup()
    const draft = await env.draft('Failure case', null)
    const version = await env.prepare(draft.revision)
    const binding = await env.createBinding(version.versionId, 'pinned')
    vi.spyOn(env.app.environments, 'setPublication').mockImplementationOnce(() => {
      throw new Error('injected publication fault')
    })
    const publication = await env.publish(binding.id, version.versionId)
    expect(publication).toMatchObject({ status: 'failed', error: { code: 'RUNTIME_APPLY_FAILED' } })
    expect((await env.storage.get<Binding>('bindings', binding.id))?.value).toMatchObject({
      condition: 'unavailable',
      reason: 'RUNTIME_APPLY_FAILED',
      desiredVersionId: version.versionId,
    })
    expect((await env.storage.get<Binding>('bindings', binding.id))?.value.effectiveVersionId).toBeUndefined()
    expect(env.app.environments.list()).toHaveLength(0)
  }, 45_000)

  it('keeps the last effective version when applying a replacement fails', async () => {
    const env = await setup()
    const firstDraft = await env.draft('Working version', null)
    const first = await env.prepare(firstDraft.revision)
    const binding = await env.createBinding(first.versionId, 'pinned')
    expect((await env.publish(binding.id, first.versionId)).status).toBe('succeeded')
    const previousRuntime = env.app.environments.list()[0].id
    const secondDraft = await env.draft('Failing replacement', firstDraft.revision)
    const second = await env.prepare(secondDraft.revision)
    vi.spyOn(env.app.environments, 'setPublication').mockImplementationOnce(() => {
      throw new Error('injected replacement fault')
    })
    const publication = await env.publish(binding.id, second.versionId)
    expect(publication).toMatchObject({ status: 'failed', error: { code: 'RUNTIME_APPLY_FAILED' } })
    expect((await env.storage.get<Binding>('bindings', binding.id))?.value).toMatchObject({
      condition: 'degraded',
      reason: 'RUNTIME_APPLY_FAILED',
      desiredVersionId: second.versionId,
      effectiveVersionId: first.versionId,
    })
    expect(env.app.environments.list().map(descriptor => descriptor.id)).toEqual([previousRuntime])
  }, 45_000)

  it('reconciles committed publication intent on restart and does not resurrect old gameplay sessions or runtime leases', async () => {
    const env = await setup()
    const firstDraft = await env.draft('Old effective', null)
    const first = await env.prepare(firstDraft.revision)
    const binding = await env.createBinding(first.versionId, 'pinned')
    expect((await env.publish(binding.id, first.versionId)).status).toBe('succeeded')
    const oldRuntime = env.app.environments.list()[0].id
    const oldBoot = env.service.bootId
    const player = await env.app.sessions.create({ id: 'local-profile', name: 'Player before restart' })
    expect(env.app.sessions.authenticate(player.token)).toBeDefined()
    const secondDraft = await env.draft('Committed desired', firstDraft.revision)
    const second = await env.prepare(secondDraft.revision)
    const operationId = await interruptCommittedPublication(env, binding.id, second.versionId)
    await env.restart()
    expect(env.service.bootId).not.toBe(oldBoot)
    const restored = (await env.storage.get<Binding>('bindings', binding.id))!.value
    expect(restored).toMatchObject({
      condition: 'available',
      desiredVersionId: second.versionId,
      effectiveVersionId: second.versionId,
      observedBootId: env.service.bootId,
    })
    const operation = await env.service.operations.get(operationId)
    expect(operation).toMatchObject({
      status: 'succeeded',
      committed: true,
      result: { recovered: true, effectiveVersionId: second.versionId },
    })
    expect(operation.error).toBeUndefined()
    expect(env.app.environments.list()).toHaveLength(1)
    expect(env.app.environments.retainedIds()).not.toContain(oldRuntime)
    expect(env.app.sessions.authenticate(player.token)).toBeUndefined()
    expect(env.app.sessions.size).toBe(0)
    expect((await env.workspace.references(first.versionId)).filter(reference => reference.kind === 'runtime')).toEqual(
      [],
    )
    expect(
      (await env.workspace.references(first.versionId)).some(
        reference => reference.retentionId === `binding:${binding.id}:effective`,
      ),
    ).toBe(false)
    const nextReferences = await env.workspace.references(second.versionId)
    expect(nextReferences.filter(reference => reference.kind === 'runtime')).toHaveLength(1)
    expect(JSON.stringify(nextReferences)).not.toContain(oldBoot)
    expect(JSON.stringify(nextReferences)).not.toContain(`candidate:${operationId}`)
  }, 45_000)

  it('keeps the previous effective version degraded when the committed desired material is missing on restart', async () => {
    const env = await setup()
    const firstDraft = await env.draft('Surviving version', null)
    const first = await env.prepare(firstDraft.revision)
    const binding = await env.createBinding(first.versionId, 'pinned')
    expect((await env.publish(binding.id, first.versionId)).status).toBe('succeeded')
    const secondDraft = await env.draft('Lost committed version', firstDraft.revision)
    const second = await env.prepare(secondDraft.revision)
    const operationId = await interruptCommittedPublication(env, binding.id, second.versionId)
    const captured = await env.workspace.getVersion(second.versionId)
    await rm(join(captured.directory, 'package.json'))
    await env.restart()
    expect((await env.storage.get<Binding>('bindings', binding.id))!.value).toMatchObject({
      condition: 'degraded',
      reason: 'ENVIRONMENT_UNAVAILABLE',
      desiredVersionId: second.versionId,
      effectiveVersionId: first.versionId,
    })
    expect((await env.service.operations.get(operationId)).status).toBe('interrupted')
    expect(env.app.environments.list()).toHaveLength(1)
    expect(
      (await env.workspace.references(second.versionId)).filter(reference => reference.kind === 'runtime'),
    ).toEqual([])
  }, 45_000)
})
