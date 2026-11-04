import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openStorage } from '../../database/src/storage'
import {
  ContentWorkspace,
  type EnvironmentExport,
  type StaticPreparer,
} from '../../content-dev/src/content-workspace.mjs'
import { workspaceRetentions } from '../../../bin/server-persistence'
import { ManagementAuth, MANAGEMENT_ACTIONS } from '../src/standalone/management/auth'
import { OperationService, type Operation, type OperationContext } from '../src/standalone/management/operations'
import { ManagementTransfers } from '../src/standalone/management/transfers'
import { validateWorkspaceProject } from '../src/standalone/management/service'

const removal = vi.hoisted(() => ({ hook: undefined as ((path: unknown) => Promise<void>) | undefined }))
vi.mock('node:fs/promises', async original => {
  const filesystem = await original<typeof import('node:fs/promises')>()
  return {
    ...filesystem,
    rm: async (...args: Parameters<typeof filesystem.rm>) => {
      await removal.hook?.(args[0])
      return filesystem.rm(...args)
    },
  }
})

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  removal.hook = undefined
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}
let currentDriver: 'sqlite' | 'postgres' = 'sqlite'
async function fixture(validator: StaticPreparer = validateWorkspaceProject) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-transfers-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const project = join(root, 'project')
  await mkdir(join(project, 'node_modules'), { recursive: true })
  const manifest = { name: 'export-test', version: '1.0.0', private: true, dependencies: {} }
  await writeFile(join(project, 'package.json'), JSON.stringify(manifest))
  await writeFile(
    join(project, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { '': manifest } }),
  )
  let storage: ReturnType<typeof openStorage>
  if (currentDriver === 'postgres') {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const database = `transfers_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${database}"`)
    cleanups.push(async () => {
      await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`)
      await admin.end()
    })
    const connection = new URL(process.env.TEST_DATABASE_URL!)
    connection.pathname = `/${database}`
    storage = openStorage({ driver: 'postgres', connectionString: connection.href })
  } else storage = openStorage({ driver: 'sqlite', filename: join(root, 'db.sqlite') })
  await storage.migrate()
  cleanups.push(() => storage.close())
  const workspace: ContentWorkspace = await ContentWorkspace.open(join(root, 'workspace'), {
    resolveProject: () => project,
    retentions: workspaceRetentions(storage, () => workspace.workspaceId),
  })
  cleanups.push(() => workspace.close())
  const document = { schemaVersion: 1, id: 'source', name: 'Source', packages: {}, sources: [] }
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  const version = await workspace.prepareVersion(
    { environmentId: 'source', expectedRevision: draft.revision },
    validateWorkspaceProject,
  )
  const auth = new ManagementAuth(storage)
  const scope = { kind: 'workspace' as const, id: workspace.workspaceId }
  const owner = await auth.exchangeBootstrap(
    (await auth.issueBootstrapCode([{ scope, actions: [...MANAGEMENT_ACTIONS.workspace] }], 'export-owner')).code,
  )
  const viewer = await auth.exchangeBootstrap(
    (await auth.issueBootstrapCode([{ scope, actions: ['read'] }], 'viewer')).code,
  )
  const operations = new OperationService(storage, { ownerId: 'transfer-test' })
  await operations.ready()
  cleanups.push(() => operations.close())
  const transferRoot = join(root, 'transfers')
  const directory = join(transferRoot, `owner-${createHash('sha256').update(operations.ownerId).digest('hex')}`)
  let now = Date.now()
  const transfers = new ManagementTransfers({
    storage,
    workspace,
    operations,
    auth,
    directory: transferRoot,
    validate: validator,
    ttlMs: 1000,
    now: () => now,
  })
  await transfers.ready()
  cleanups.push(() => transfers.close())
  return {
    root,
    storage,
    workspace,
    document,
    draft,
    version,
    scope,
    owner,
    viewer,
    operations,
    auth,
    directory,
    transferRoot,
    transfers,
    advance: (ms: number) => {
      now += ms
    },
  }
}
async function complete(operations: OperationService, id: string): Promise<Operation> {
  let operation: Operation
  await expect
    .poll(
      async () => {
        operation = await operations.get(id)
        return operation.status
      },
      { timeout: 10000 },
    )
    .not.toMatch(/^(queued|running)$/)
  return operation!
}

for (const driver of ['sqlite', 'postgres'] as const) {
  describe.skipIf(driver === 'postgres' && !process.env.TEST_DATABASE_URL)(
    `${driver} file-backed managed environment transfer operations`,
    () => {
      beforeEach(() => {
        currentDriver = driver
      })
      it('exports a real immutable environment and downloads only a bounded artifact with no private paths in SQL', async () => {
        const env = await fixture()
        const operation = await env.transfers.export(env.owner.actor, env.version.versionId, 'export-one')
        const finished = await complete(env.operations, operation.id)
        expect(finished.status, JSON.stringify(finished)).toBe('succeeded')
        expect(finished.result).toMatchObject({
          downloadPath: `/api/management/v1/transfers/${operation.id}`,
          filename: 'environment-source.json',
        })
        const download = await env.transfers.download(env.owner.actor, operation.id)
        const bytes = await readFile(download.file)
        const bundle = JSON.parse(bytes.toString('utf8')) as EnvironmentExport
        expect(bundle.format).toBe('arcadia.environment-export/1')
        expect(bundle.document.id).toBe('source')
        expect(download.bytes).toBe(bytes.length)
        expect(bytes.toString('utf8')).not.toContain(env.root)
        const rows = JSON.stringify(await env.storage.list('operations'))
        expect(rows).not.toContain(env.root)
        expect(rows).not.toContain(bundle.files[0].data)
        await download.release()
        const replay = await env.transfers.export(env.owner.actor, env.version.versionId, 'export-one')
        expect(replay.id).toBe(operation.id)
      })

      it('imports the portable bundle as a new fixed version and stores only a digest/reference in task input', async () => {
        const env = await fixture()
        const bundle = await env.workspace.exportVersion(env.version.versionId)
        const started = await env.transfers.import(env.owner.actor, bundle, {
          environmentId: 'copy',
          idempotencyKey: 'import-one',
        })
        const finished = await complete(env.operations, started.id)
        expect(finished.status, JSON.stringify(finished)).toBe('succeeded')
        expect(finished.result).toMatchObject({ environmentId: 'copy', status: 'ready' })
        expect(finished.committed).toBe(true)
        const result = finished.result as { versionId: string }
        expect((await env.workspace.getVersion(result.versionId)).contentRevision).toBe(env.version.contentRevision)
        expect(JSON.stringify(finished)).not.toContain(env.root)
        expect(JSON.stringify(finished.input)).not.toContain(bundle.files[0].data)
        expect((await env.workspace.getDraft('copy')).document.name).toBe('Source')
      })

      it('rejects unprivileged export/import/download and rejects mismatched idempotency input', async () => {
        const env = await fixture()
        const bundle = await env.workspace.exportVersion(env.version.versionId)
        await expect(env.transfers.export(env.viewer.actor, env.version.versionId, 'forbidden')).rejects.toMatchObject({
          status: 403,
        })
        await expect(
          env.transfers.import(env.viewer.actor, bundle, { idempotencyKey: 'forbidden' }),
        ).rejects.toMatchObject({ status: 403 })
        const exported = await env.transfers.export(env.owner.actor, env.version.versionId, 'allowed')
        await complete(env.operations, exported.id)
        await expect(env.transfers.download(env.viewer.actor, exported.id)).rejects.toMatchObject({ status: 403 })
        await expect(env.transfers.download(env.owner.actor, '../outside')).rejects.toMatchObject({ status: 404 })
        await env.transfers.import(env.owner.actor, bundle, { environmentId: 'copy-one', idempotencyKey: 'collision' })
        await expect(
          env.transfers.import(env.owner.actor, bundle, { environmentId: 'copy-two', idempotencyKey: 'collision' }),
        ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
        const pending = (await env.operations.list()).find(op => op.kind === 'environment.import')!
        await complete(env.operations, pending.id)
      })

      it('preserves the original draft and versions when an imported archive contains an escaping file', async () => {
        const env = await fixture()
        const bundle = await env.workspace.exportVersion(env.version.versionId)
        bundle.files.push({ path: '../outside.json', data: Buffer.from('bad').toString('base64') })
        const operation = await env.transfers.import(env.owner.actor, bundle, {
          environmentId: 'source',
          expectedRevision: env.draft.revision,
          idempotencyKey: 'bad-path',
        })
        expect((await complete(env.operations, operation.id)).status).toBe('failed')
        expect((await env.workspace.getDraft('source')).revision).toBe(env.draft.revision)
        expect((await env.workspace.listVersions()).map(version => version.versionId)).toEqual([env.version.versionId])
      })

      it('cancels validation before the import commit without creating the requested draft', async () => {
        const entered = deferred(),
          proceed = deferred()
        const env = await fixture(async input => {
          const result = await validateWorkspaceProject(input)
          entered.resolve()
          await proceed.promise
          return result
        })
        const operation = await env.transfers.import(
          env.owner.actor,
          await env.workspace.exportVersion(env.version.versionId),
          { environmentId: 'cancelled', idempotencyKey: 'cancel-me' },
        )
        await entered.promise
        await env.operations.cancel(operation.id)
        proceed.resolve()
        expect((await complete(env.operations, operation.id)).status).toBe('cancelled')
        await expect(env.workspace.getDraft('cancelled')).rejects.toMatchObject({ code: 'ENOENT' })
        expect((await env.workspace.listVersions()).map(version => version.versionId)).toEqual([env.version.versionId])
        const retry = await env.transfers.retry(env.owner.actor, operation.id, 'retry-cancelled')
        const retried = await complete(env.operations, retry.id)
        expect(retried).toMatchObject({ status: 'succeeded', attempt: 2, rootOperationId: operation.id })
        expect((await env.workspace.getDraft('cancelled')).document.id).toBe('cancelled')
      })

      it('expires downloads, protects already open downloads from GC, and removes expired artifacts', async () => {
        const env = await fixture()
        const operation = await env.transfers.export(env.owner.actor, env.version.versionId, 'expires')
        await complete(env.operations, operation.id)
        const download = await env.transfers.download(env.owner.actor, operation.id)
        env.advance(5000)
        await expect(env.transfers.download(env.owner.actor, operation.id)).rejects.toMatchObject({
          code: 'TRANSFER_EXPIRED',
          status: 410,
        })
        expect((await env.transfers.cleanup()).removed).toBe(0)
        expect((await readFile(download.file)).length).toBe(download.bytes)
        await download.release()
        expect((await env.transfers.cleanup()).removed).toBe(1)
        expect(await readdir(env.directory)).toEqual([])
      })

      it('refuses symlink artifacts and sanitizes version references', async () => {
        const env = await fixture()
        const operation = await env.transfers.export(env.owner.actor, env.version.versionId, 'tamper')
        await complete(env.operations, operation.id)
        const file = join(env.directory, `export-${operation.id}.json`)
        await rm(file)
        await symlink(join(env.root, 'db.sqlite'), file)
        await expect(env.transfers.download(env.owner.actor, operation.id)).rejects.toMatchObject({
          code: 'TRANSFER_ARTIFACT_INVALID',
        })
        await env.workspace.retain(env.version.versionId, 'server:managed:binding:one')
        const references = await env.transfers.references(env.viewer.actor, env.version.versionId)
        expect(references.references).toContainEqual(
          expect.objectContaining({ retentionId: 'server:managed:binding:one' }),
        )
        expect(JSON.stringify(references)).not.toContain(env.root)
        await env.workspace.releaseRetention('server:managed:binding:one')
      })
      it('reopens completed downloads from the same owner after the management service restarts', async () => {
        const env = await fixture()
        const operation = await env.transfers.export(env.owner.actor, env.version.versionId, 'restart')
        await complete(env.operations, operation.id)
        await env.transfers.close()
        await env.operations.close()
        const operations = new OperationService(env.storage, { ownerId: 'transfer-test' })
        await operations.ready()
        cleanups.push(() => operations.close())
        const reopened = new ManagementTransfers({
          storage: env.storage,
          workspace: env.workspace,
          operations,
          auth: env.auth,
          directory: env.transferRoot,
          validate: validateWorkspaceProject,
        })
        cleanups.push(() => reopened.close())
        const download = await reopened.download(env.owner.actor, operation.id)
        expect(JSON.parse(await readFile(download.file, 'utf8')).document.id).toBe('source')
        await download.release()
      })

      it('rechecks authority inside the import commit after a long validation', async () => {
        const entered = deferred(),
          proceed = deferred()
        const env = await fixture(async input => {
          const result = await validateWorkspaceProject(input)
          entered.resolve()
          await proceed.promise
          return result
        })
        const operation = await env.transfers.import(
          env.owner.actor,
          await env.workspace.exportVersion(env.version.versionId),
          { environmentId: 'revoked', idempotencyKey: 'revoke-me' },
        )
        await entered.promise
        const grant = (await env.auth.listGrants(env.owner.actor, env.scope)).find(
          item => item.value.principalId === env.owner.actor.principalId,
        )!
        await env.auth.revokeGrant(env.owner.actor, grant.id, grant.revision)
        proceed.resolve()
        const final = await complete(env.operations, operation.id)
        expect(final.status).toBe('failed')
        expect(final.error?.code).toBe('MANAGEMENT_FORBIDDEN')
        await expect(env.workspace.getDraft('revoked')).rejects.toMatchObject({ code: 'ENOENT' })
        expect((await env.workspace.listVersions()).map(version => version.versionId)).toEqual([env.version.versionId])
      })

      it('preserves a downloadable export when the database commit succeeded but its acknowledgement was lost', async () => {
        const env = await fixture()
        const submit = env.operations.submit.bind(env.operations)
        vi.spyOn(env.operations, 'submit').mockImplementation((input, work) =>
          submit(input, context =>
            work({
              ...context,
              commit: async <T>(action: Parameters<OperationContext['commit']>[0]): Promise<T> => {
                await context.commit(action)
                throw new Error('database connection closed after commit')
              },
            }),
          ),
        )
        const operation = await env.transfers.export(env.owner.actor, env.version.versionId, 'uncertain-commit')
        const finished = await complete(env.operations, operation.id)
        expect(finished.status).toBe('succeeded')
        const download = await env.transfers.download(env.owner.actor, operation.id)
        expect(JSON.parse(await readFile(download.file, 'utf8')).format).toBe('arcadia.environment-export/1')
        await download.release()
      })
      it('serializes a renewed upload behind expiry deletion of the same content artifact', async () => {
        const env = await fixture()
        const bundle = await env.workspace.exportVersion(env.version.versionId)
        const previous = await env.transfers.import(env.owner.actor, bundle, {
          environmentId: 'old-copy',
          idempotencyKey: 'old-upload',
        })
        const completed = await complete(env.operations, previous.id)
        expect(completed.status).toBe('succeeded')
        env.advance(5000)
        const upload = join(env.directory, `upload-${(completed.input as { uploadId: string }).uploadId}.json`)
        const deleting = deferred(),
          proceed = deferred()
        removal.hook = async path => {
          if (typeof path === 'string' && path.endsWith(upload.split('/').at(-1)!)) {
            deleting.resolve()
            await proceed.promise
          }
        }
        const cleanup = env.transfers.cleanup()
        await deleting.promise
        const renewed = env.transfers.import(env.owner.actor, bundle, {
          environmentId: 'new-copy',
          idempotencyKey: 'new-upload',
        })
        proceed.resolve()
        await cleanup
        const operation = await renewed
        expect((await complete(env.operations, operation.id)).status).toBe('succeeded')
        expect((await env.workspace.getDraft('new-copy')).document.id).toBe('new-copy')
      })
      it('retries an export after a transient material read failure with the same task lineage', async () => {
        const env = await fixture()
        vi.spyOn(env.workspace, 'exportVersion').mockRejectedValueOnce(
          Object.assign(new Error('transient read'), { code: 'MATERIAL_BUSY' }),
        )
        const operation = await env.transfers.export(env.owner.actor, env.version.versionId, 'read-failure')
        expect((await complete(env.operations, operation.id)).status).toBe('failed')
        const retried = await env.transfers.retry(env.owner.actor, operation.id, 'retry-export')
        expect(await complete(env.operations, retried.id)).toMatchObject({
          status: 'succeeded',
          attempt: 2,
          rootOperationId: operation.id,
        })
        const download = await env.transfers.download(env.owner.actor, retried.id)
        expect(JSON.parse(await readFile(download.file, 'utf8')).document.id).toBe('source')
        await download.release()
      })
      it('recovers an import after its DB commit succeeds but the caller loses the response', async () => {
        const env = await fixture()
        const bundle = await env.workspace.exportVersion(env.version.versionId)
        const original = env.workspace.importVersion.bind(env.workspace)
        vi.spyOn(env.workspace, 'importVersion').mockImplementationOnce((archive, input, validate) =>
          original(
            archive,
            {
              ...input,
              beforeCommit: async () => {
                await input.beforeCommit?.()
                throw new Error('lost durable commit response')
              },
            },
            validate,
          ),
        )
        const operation = await env.transfers.import(env.owner.actor, bundle, {
          environmentId: 'recover-copy',
          idempotencyKey: 'commit-interrupted',
        })
        expect(await complete(env.operations, operation.id)).toMatchObject({ status: 'failed', committed: true })
        await expect(env.workspace.getDraft('recover-copy')).rejects.toMatchObject({ code: 'ENOENT' })
        const resumed = await env.transfers.retry(env.owner.actor, operation.id, 'resume-commit')
        expect(resumed).toMatchObject({ id: operation.id, status: 'succeeded', committed: true })
        expect((await env.workspace.getDraft('recover-copy')).document.id).toBe('recover-copy')
        await env.transfers.cleanup()
        expect(await env.workspace.listVersions('recover-copy')).toHaveLength(1)
        expect(await readdir(join(env.workspace.root, 'imports'))).toEqual([])
      })
    },
  )
}
