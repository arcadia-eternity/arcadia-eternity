import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { ContentWorkspace, type StaticPreparer } from '@arcadia-eternity/content-dev/management-workspace'
import { openStorage, SQLAccountDirectory } from '@arcadia-eternity/database'
import { dropTestDatabase } from './helpers/postgres'
import {
  createServerBackup,
  createOnlineServerBackup,
  inspectServerBackup,
  restoreServerBackup,
  ServerBackupError,
} from '../server-backup'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})
const validate: StaticPreparer = async ({ directory }) => ({
  contentRevision: createHash('sha256')
    .update(await readFile(join(directory, 'package.json')))
    .digest('hex'),
  packages: [],
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-backup-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'project')
  await mkdir(source)
  await writeFile(join(source, 'package.json'), JSON.stringify({ name: '@example/fixture', version: '1.0.0' }))
  await writeFile(
    join(source, 'package-lock.json'),
    JSON.stringify({ name: '@example/fixture', lockfileVersion: 3, packages: {} }),
  )
  await mkdir(join(source, 'node_modules', 'fixture'), { recursive: true })
  await writeFile(join(source, 'node_modules', 'fixture', 'content.txt'), 'immutable material')
  const workspace = await ContentWorkspace.open(join(root, 'workspace'), { retentions: { list: async () => [] } })
  cleanups.push(() => workspace.close())
  const draft = await workspace.saveDraft({
    document: {
      schemaVersion: 2,
      id: 'test-env',
      name: 'Test',
      packages: {},
      sources: [],
      rules: { schemaVersion: 1 },
      requires: {},
    },
    expectedRevision: null,
  })
  const version = await workspace.prepareVersion(
    { environmentId: draft.document.id, expectedRevision: draft.revision, projectDirectory: source },
    validate,
  )
  const storage = openStorage({ driver: 'sqlite', filename: join(root, 'source.sqlite') })
  cleanups.push(() => storage.close())
  await storage.migrate()
  const serverId = 'stable-source-server',
    bindingId = randomUUID()
  await storage.create('servers', {
    id: serverId,
    scope: 'server:' + serverId,
    value: { name: 'Source', workspaceId: workspace.workspaceId, defaultBindingId: bindingId },
  })
  await storage.create('bindings', {
    id: bindingId,
    scope: 'server:' + serverId,
    value: {
      serverId,
      workspaceId: workspace.workspaceId,
      environmentId: 'test-env',
      selection: 'pinned',
      desiredVersionId: version.versionId,
      effectiveVersionId: version.versionId,
      enabled: true,
      visibility: 'public',
      matchmakingEnabled: true,
      condition: 'available',
      observedBootId: 'old-boot',
    },
  })
  const account = await new SQLAccountDirectory(storage, serverId).resolveOrCreate({
    providerId: 'email',
    issuer: 'https://example.test',
    subject: 'someone@example.test',
    verifiedAt: Date.now(),
  })
  await storage.create('principals', {
    id: 'owner',
    scope: 'management',
    value: { displayName: 'Owner', status: 'active', serverId, accountId: account.accountId },
  })
  await storage.create('grants', {
    id: 'grant',
    scope: 'server:' + serverId,
    value: { principalId: 'owner', scope: { kind: 'server', id: serverId }, actions: ['read'] },
  })
  await storage.create('credentials', {
    id: 'old-credential-hash',
    scope: 'owner',
    value: { kind: 'session', principalId: 'owner', expiresAt: Date.now() + 100000 },
  })
  await storage.create('sessions', { id: 'old-session', scope: 'owner', value: { old: true } })
  await storage.create('operations', {
    id: 'operation',
    scope: 'server:' + serverId,
    value: { status: 'running', bootId: 'old-boot' },
  })
  const backup = await createServerBackup({ storage, workspace, serverId, maintenance: work => work() })
  return { root, storage, workspace, backup, account, version, bindingId, serverId }
}
async function openRestored(directory: string) {
  const storage = openStorage({ driver: 'sqlite', filename: join(directory, 'server.sqlite') })
  await storage.checkSchema()
  cleanups.push(() => storage.close())
  const workspace = await ContentWorkspace.open(join(directory, 'workspace'), { retentions: { list: async () => [] } })
  cleanups.push(() => workspace.close())
  return { storage, workspace }
}

async function postgresTarget() {
  const admin = new pg.Pool({ connectionString: process.env.TEST_BACKUP_DATABASE_URL })
  const name = 'arcadia_backup_' + randomUUID().replaceAll('-', '')
  await admin.query('CREATE DATABASE "' + name + '"')
  cleanups.push(async () => {
    try {
      await dropTestDatabase(admin, name)
    } finally {
      await admin.end()
    }
  })
  const url = new URL(process.env.TEST_BACKUP_DATABASE_URL!)
  url.pathname = '/' + name
  return url.toString()
}

describe('server backup, restore and clone', () => {
  it('captures portable materials and durable identity while invalidating runtime credentials', async () => {
    const { backup, version } = await fixture()
    expect(inspectServerBackup(backup)).toMatchObject({ servers: 1, versions: 1, environments: 1, accounts: 1 })
    expect(backup.storage.records.credentials).toEqual([])
    expect(backup.storage.records.sessions).toEqual([])
    expect(backup.storage.records.operations[0]?.value).toMatchObject({ status: 'interrupted', bootId: '' })
    expect(backup.storage.records.bindings[0]?.value).toMatchObject({ condition: 'unavailable', observedBootId: '' })
    expect(backup.workspace.versions[0]?.version.versionId).toBe(version.versionId)
    expect(JSON.stringify(backup)).not.toContain('materialDirectory')
    expect(JSON.stringify(backup)).not.toContain('old-credential-hash')
  })

  it('restores a real SQLite database and materials with original server, account and version IDs', async () => {
    const { root, backup, account, version, bindingId, serverId } = await fixture()
    const target = join(root, 'restored')
    const result = await restoreServerBackup({ backup, targetDirectory: target, mode: 'restore', preparer: validate })
    expect(result).toMatchObject({ serverId, workspaceId: backup.workspace.workspaceId, storageDriver: 'sqlite' })
    expect(JSON.parse(await readFile(join(target, 'identity.json'), 'utf8')).serverId).toBe(serverId)
    const restored = await openRestored(target)
    expect((await restored.storage.get('bindings', bindingId))?.id).toBe(bindingId)
    expect(await new SQLAccountDirectory(restored.storage, serverId).getStatus(account.accountId)).toBe('active')
    const restoredVersion = await restored.workspace.getVersion(version.versionId)
    expect(await readFile(join(restoredVersion.directory, 'node_modules', 'fixture', 'content.txt'), 'utf8')).toBe(
      'immutable material',
    )
    expect(await restored.storage.list('credentials')).toEqual([])
    expect(await readdir(target)).not.toContain('restore-intent.json')
  })

  it('clones content/configuration with remapped IDs and no inherited accounts or management grants', async () => {
    const { root, backup, version, serverId, bindingId } = await fixture()
    const target = join(root, 'cloned')
    const result = await restoreServerBackup({ backup, targetDirectory: target, mode: 'clone', preparer: validate })
    expect(result.serverId).not.toBe(serverId)
    expect(result.workspaceId).not.toBe(backup.workspace.workspaceId)
    const cloned = await openRestored(target)
    const snapshot = await cloned.storage.exportSnapshot()
    expect(snapshot.accounts).toEqual([])
    expect(snapshot.identities).toEqual([])
    for (const collection of ['principals', 'grants', 'credentials', 'operations', 'audit', 'sessions'] as const)
      expect(snapshot.records[collection]).toEqual([])
    const binding = snapshot.records.bindings[0]!
    expect(binding.id).not.toBe(bindingId)
    expect(binding.value).toMatchObject({ serverId: result.serverId, workspaceId: result.workspaceId })
    const effectiveVersionId = (binding.value as { effectiveVersionId: string }).effectiveVersionId
    expect(effectiveVersionId).not.toBe(version.versionId)
    expect((await cloned.workspace.getVersion(effectiveVersionId)).contentRevision).toBe(version.contentRevision)
    expect((snapshot.records.servers[0]?.value as { defaultBindingId: string }).defaultBindingId).toBe(binding.id)
    expect(snapshot.records.retentions).toHaveLength(2)
  })

  it('rejects invalid domain references before creating any target or touching the source', async () => {
    const { root, backup, storage, serverId } = await fixture()
    const broken = structuredClone(backup)
    ;(broken.storage.records.servers[0]!.value as { defaultBindingId: string }).defaultBindingId = 'missing'
    await expect(
      restoreServerBackup({
        backup: broken,
        targetDirectory: join(root, 'target'),
        mode: 'restore',
        preparer: validate,
      }),
    ).rejects.toThrow('BACKUP_DEFAULT_BINDING_INVALID')
    expect(await readdir(root)).not.toContain('target')
    expect(await storage.get('servers', serverId)).not.toBeNull()
  })

  it('validates archive paths and static material identity; failed staged restore leaves no partial server', async () => {
    const { root, backup } = await fixture()
    const escaped = structuredClone(backup)
    escaped.workspace.versions[0]!.files.push({ path: '../outside', data: 'eA==' })
    expect(() => inspectServerBackup(escaped)).toThrow('BACKUP_MATERIAL_PATH_INVALID')
    const mismatched = structuredClone(backup)
    mismatched.workspace.versions[0]!.version.contentRevision = 'wrong'
    await expect(
      restoreServerBackup({
        backup: mismatched,
        targetDirectory: join(root, 'target'),
        mode: 'restore',
        preparer: validate,
      }),
    ).rejects.toThrow('ENVIRONMENT_IMPORT_MISMATCH')
    expect((await readdir(root)).filter(name => name.includes('restore-') || name === 'target')).toEqual([])
  })

  it('never overwrites an existing target deployment', async () => {
    const { root, backup } = await fixture()
    const target = join(root, 'existing')
    await mkdir(target)
    await writeFile(join(target, 'keep'), 'unchanged')
    await expect(
      restoreServerBackup({ backup, targetDirectory: target, mode: 'restore', preparer: validate }),
    ).rejects.toThrow('RESTORE_TARGET_EXISTS')
    expect(await readFile(join(target, 'keep'), 'utf8')).toBe('unchanged')
  })

  it.skipIf(!process.env.TEST_BACKUP_DATABASE_URL)(
    'roundtrips real SQLite → PostgreSQL → SQLite with stable identity and references',
    async () => {
      const { root, backup, serverId, account, version } = await fixture()
      const connectionString = await postgresTarget()
      const pgDirectory = join(root, 'postgres-restored')
      await restoreServerBackup({
        backup,
        targetDirectory: pgDirectory,
        mode: 'restore',
        postgres: { connectionString },
        preparer: validate,
      })
      const storage = openStorage({ driver: 'postgres', connectionString })
      cleanups.push(() => storage.close())
      const workspace = await ContentWorkspace.open(join(pgDirectory, 'workspace'), {
        retentions: { list: async () => [] },
      })
      cleanups.push(() => workspace.close())
      const pgBackup = await createServerBackup({ storage, workspace, serverId, maintenance: work => work() })
      expect(pgBackup.storage.accounts).toEqual(backup.storage.accounts)
      expect(pgBackup.storage.identities).toEqual(backup.storage.identities)
      expect(pgBackup.storage.records.bindings).toEqual(backup.storage.records.bindings)
      const sqliteDirectory = join(root, 'sqlite-again')
      await restoreServerBackup({
        backup: pgBackup,
        targetDirectory: sqliteDirectory,
        mode: 'restore',
        preparer: validate,
      })
      const restored = await openRestored(sqliteDirectory)
      expect(await new SQLAccountDirectory(restored.storage, serverId).getStatus(account.accountId)).toBe('active')
      expect((await restored.workspace.getVersion(version.versionId)).contentRevision).toBe(version.contentRevision)
    },
  )

  it.skipIf(!process.env.TEST_BACKUP_DATABASE_URL)(
    'keeps recoverable files and imported PostgreSQL data if final publication conflicts',
    async () => {
      const { root, backup, serverId } = await fixture()
      const connectionString = await postgresTarget()
      const target = join(root, 'publication-conflict')
      let failure: unknown
      try {
        await restoreServerBackup({
          backup,
          targetDirectory: target,
          mode: 'restore',
          postgres: { connectionString },
          preparer: async input => {
            await mkdir(target, { recursive: true })
            await writeFile(join(target, 'operator-file'), 'keep')
            return validate(input)
          },
        })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(ServerBackupError)
      const error = failure as ServerBackupError
      expect(error.code).toBe('RESTORE_REQUIRES_RECOVERY')
      expect(error.recoveryDirectory).toBeTruthy()
      const intent = JSON.parse(await readFile(join(error.recoveryDirectory!, 'restore-intent.json'), 'utf8'))
      expect(intent.phase).toBe('database-imported')
      expect(await readFile(join(target, 'operator-file'), 'utf8')).toBe('keep')
      const storage = openStorage({ driver: 'postgres', connectionString })
      cleanups.push(() => storage.close())
      expect(await storage.get('servers', serverId)).not.toBeNull()
      expect((await storage.exportSnapshot()).accounts).toHaveLength(1)
    },
  )
})

for (const driver of ['sqlite', 'postgres'] as const) {
  describe.skipIf(driver === 'postgres' && !process.env.TEST_BACKUP_DATABASE_URL)(
    `online consistent backup (${driver})`,
    () => {
      async function onlineFixture() {
        const source = await fixture()
        if (driver === 'sqlite') return source
        const connectionString = await postgresTarget()
        const storage = openStorage({ driver: 'postgres', connectionString })
        cleanups.push(() => storage.close())
        await storage.migrate()
        await storage.importSnapshot(await source.storage.exportSnapshot())
        return { ...source, storage }
      }
      function barrier() {
        let resolve!: () => void
        const promise = new Promise<void>(done => {
          resolve = done
        })
        return { promise, resolve }
      }
      it('retries a prepare/publication crossing the DB capture and includes consistent account/config/job state', async () => {
        const { storage, workspace, serverId, bindingId, root } = await onlineFixture()
        const entered = barrier(),
          resume = barrier()
        let exports = 0,
          attempts = 0
        const pending = createOnlineServerBackup({
          storage: {
            exportSnapshot: async () => {
              if (++exports === 1) {
                entered.resolve()
                await resume.promise
              }
              return storage.exportSnapshot()
            },
          },
          workspace,
          serverId,
          onAttempt: () => {
            attempts++
          },
        })
        await entered.promise
        let newVersionId: string, newAccountId: string
        try {
          const draft = await workspace.getDraft('test-env')
          const changed = await workspace.saveDraft({
            document: { ...draft.document, name: 'Published during capture' },
            expectedRevision: draft.revision,
          })
          const version = await workspace.prepareVersion(
            { environmentId: 'test-env', expectedRevision: changed.revision, projectDirectory: join(root, 'project') },
            validate,
          )
          newVersionId = version.versionId
          await storage.transaction(async tx => {
            const binding = (await tx.get<Record<string, unknown>>('bindings', bindingId))!
            await tx.replace('bindings', bindingId, binding.revision, {
              ...binding.value,
              desiredVersionId: newVersionId,
              effectiveVersionId: newVersionId,
            })
            const server = (await tx.get<Record<string, unknown>>('servers', serverId))!
            await tx.replace('servers', serverId, server.revision, { ...server.value, name: 'Published' })
            await tx.create('operations', {
              id: 'publish-concurrent',
              scope: 'server:' + serverId,
              value: { status: 'succeeded', committed: true },
            })
          })
          const account = await new SQLAccountDirectory(storage, serverId).resolveOrCreate({
            providerId: 'email',
            issuer: 'https://example.test',
            subject: 'new-during-capture@example.test',
            verifiedAt: Date.now(),
          })
          newAccountId = account.accountId
        } finally {
          resume.resolve()
        }
        const backup = await pending
        expect(attempts).toBe(2)
        expect(backup.workspace.versions.some(entry => entry.version.versionId === newVersionId!)).toBe(true)
        expect(backup.storage.records.bindings[0]!.value).toMatchObject({ effectiveVersionId: newVersionId! })
        expect(backup.storage.records.servers[0]!.value).toMatchObject({ name: 'Published' })
        expect(backup.storage.accounts.some(account => account.account_id === newAccountId!)).toBe(true)
        expect(backup.storage.records.operations.find(op => op.id === 'publish-concurrent')?.value).toMatchObject({
          status: 'succeeded',
        })
        expect(backup.storage.records.credentials).toEqual([])
        expect(() => inspectServerBackup(backup)).not.toThrow()
      })
      it('retries GC occurring after the DB snapshot instead of returning mismatched files', async () => {
        const { storage, workspace, serverId, root } = await onlineFixture()
        const draft = await workspace.getDraft('test-env')
        const unused = await workspace.prepareVersion(
          { environmentId: 'test-env', expectedRevision: draft.revision, projectDirectory: join(root, 'project') },
          validate,
        )
        const entered = barrier(),
          resume = barrier()
        let exports = 0
        const pending = createOnlineServerBackup({
          storage: {
            exportSnapshot: async () => {
              const snapshot = await storage.exportSnapshot()
              if (++exports === 1) {
                entered.resolve()
                await resume.promise
              }
              return snapshot
            },
          },
          workspace,
          serverId,
        })
        await entered.promise
        try {
          await workspace.deleteVersion(unused.versionId)
        } finally {
          resume.resolve()
        }
        const backup = await pending
        expect(exports).toBe(2)
        expect(backup.workspace.versions.some(entry => entry.version.versionId === unused.versionId)).toBe(false)
        expect(() => inspectServerBackup(backup)).not.toThrow()
      })
      it('bounds retries under continuous changes and consumes observations on cancellation', async () => {
        const { storage, workspace, serverId } = await onlineFixture()
        let exports = 0
        await expect(
          createOnlineServerBackup({
            storage: {
              exportSnapshot: async () => {
                exports++
                const draft = await workspace.getDraft('test-env')
                await workspace.saveDraft({
                  document: { ...draft.document, name: 'Changed ' + exports },
                  expectedRevision: draft.revision,
                })
                return storage.exportSnapshot()
              },
            },
            workspace,
            serverId,
            maxAttempts: 2,
          }),
        ).rejects.toThrow('BACKUP_BUSY')
        expect(exports).toBe(2)
        const controller = new AbortController()
        let capture: Awaited<ReturnType<ContentWorkspace['captureSnapshot']>> | undefined
        await expect(
          createOnlineServerBackup({
            workspace: {
              captureSnapshot: async () => {
                capture = await workspace.captureSnapshot()
                return capture
              },
              isSnapshotCurrent: stamp => workspace.isSnapshotCurrent(stamp),
            },
            storage: {
              exportSnapshot: async () => {
                controller.abort(new Error('caller cancelled'))
                return storage.exportSnapshot()
              },
            },
            serverId,
            signal: controller.signal,
          }),
        ).rejects.toThrow('caller cancelled')
        expect(await workspace.isSnapshotCurrent(capture!.stamp)).toBe(false)
      })
    },
  )
}
