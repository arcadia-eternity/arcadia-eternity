import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pg from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { openStorage } from '@arcadia-eternity/database'
import { dropTestDatabase } from '../../../bin/__tests__/helpers/postgres'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import { createSingleProcessApp } from '../src/runtime/app'
import { ManagementBackups } from '../src/runtime/management/backups'
import type { ManagementSession } from '../src/runtime/management/auth'
import type { OperationService, Operation } from '../src/runtime/management/operations'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}
async function complete(operations: OperationService, id: string) {
  let operation!: Operation
  await expect
    .poll(
      async () => {
        operation = await operations.get(id)
        return operation.status
      },
      { timeout: 10000 },
    )
    .not.toMatch(/^(queued|running)$/)
  return operation
}
async function fixture(driver: 'sqlite' | 'postgres', enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-online-backup-api-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  let storage: ReturnType<typeof openStorage>
  if (driver === 'postgres') {
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const database = `backup_api_${randomUUID().replaceAll('-', '')}`
    await admin.query(`CREATE DATABASE "${database}"`)
    cleanups.push(async () => {
      try {
        await dropTestDatabase(admin, database)
      } finally {
        await admin.end()
      }
    })
    const url = new URL(process.env.TEST_DATABASE_URL!)
    url.pathname = `/${database}`
    storage = openStorage({ driver, connectionString: url.href })
  } else storage = openStorage({ driver, filename: join(root, 'server.sqlite') })
  await storage.migrate()
  cleanups.push(() => storage.close())
  const workspace = await ContentWorkspace.open(join(root, 'workspace'))
  cleanups.push(() => workspace.close())
  const serverId = 'backup-server'
  const archive = async (additionalServers: string[] = []) => ({
    format: 'arcadia.server-backup/1',
    schemaVersion: 1,
    createdAt: Date.now(),
    serverId,
    workspace: { format: 'arcadia.workspace-snapshot/1', workspaceId: workspace.workspaceId, drafts: [], versions: [] },
    storage: {
      formatVersion: 1,
      schemaVersion: 1,
      records: {
        servers: await Promise.all([serverId, ...additionalServers].map(id => storage.get('servers', id))),
        credentials: [],
        sessions: [],
      },
      accounts: [{ server_id: serverId, account_id: 'retained-account' }],
      identities: [{ server_id: serverId, subject: 'private-player@example.test' }],
    },
  })
  let capture: (signal: AbortSignal) => Promise<unknown> = () => archive()
  let captures = 0
  const app = createSingleProcessApp({
    port: 0,
    host: '127.0.0.1',
    serverId,
    corsOrigins: ['http://backup.test'],
    management: {
      storage,
      workspace,
      transferDirectory: join(root, 'transfers'),
      secureCookies: false,
      ...(enabled
        ? {
            createServerBackup: async (signal: AbortSignal) => {
              captures++
              return capture(signal)
            },
          }
        : {}),
    },
  })
  cleanups.push(() => app.stop())
  await app.start()
  const management = app.management!
  const owner = await management.auth.exchangeBootstrap(
    (await management.auth.issueBootstrapCode(management.ownerPermissions, 'backup-owner')).code,
  )
  const viewer = await management.auth.exchangeBootstrap(
    (
      await management.auth.issueBootstrapCode(
        [
          { scope: management.serverScope, actions: ['read'] },
          { scope: management.workspaceScope, actions: ['read', 'export'] },
        ],
        'viewer',
      )
    ).code,
  )
  const serverOnly = await management.auth.exchangeBootstrap(
    (
      await management.auth.issueBootstrapCode(
        [{ scope: management.serverScope, actions: ['read', 'backup'] }],
        'server-only',
      )
    ).code,
  )
  const base = `http://127.0.0.1:${app.address!.port}/api/management/v1`
  const request = async (
    path: string,
    method = 'GET',
    body?: unknown,
    session: ManagementSession | null = owner,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://backup.test',
        ...(session ? { Cookie: `arcadia_management=${session.token}`, 'X-CSRF-Token': session.csrfToken } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { response, body: await response.json() }
  }
  const post = (key: string, session: ManagementSession | null = owner) =>
    request(`/servers/${serverId}/backup`, 'POST', {}, session, { 'Idempotency-Key': key })
  const directory = join(
    root,
    'transfers',
    `backup-owner-${createHash('sha256').update(management.operations.ownerId).digest('hex')}`,
  )
  return {
    root,
    directory,
    storage,
    workspace,
    serverId,
    archive,
    app,
    management,
    owner,
    viewer,
    serverOnly,
    request,
    post,
    setCapture: (next: typeof capture) => {
      capture = next
    },
    captures: () => captures,
  }
}

for (const driver of ['sqlite', 'postgres'] as const)
  describe.skipIf(driver === 'postgres' && !process.env.TEST_DATABASE_URL)(
    `${driver} online server backup management API`,
    () => {
      it('creates a durable private artifact and returns identical HTTP/IPC JSON without storing archive data in the task', async () => {
        const env = await fixture(driver)
        expect((await env.request('/capabilities')).body.supportedFeatures).toContain('server.backup')
        const started = await env.post('one')
        expect(started.response.status).toBe(202)
        const operation = await complete(env.management.operations, started.body.id)
        expect(operation.status, JSON.stringify(operation)).toBe('succeeded')
        expect(operation.result).toMatchObject({ downloadPath: `/api/management/v1/backups/${operation.id}` })
        expect(JSON.stringify(operation)).not.toContain('private-player')
        expect(JSON.stringify(operation)).not.toContain(env.root)
        const artifact = join(env.directory, `backup-${operation.id}.json`)
        expect((await lstat(artifact)).mode & 0o777).toBe(0o600)
        const remote = await env.request(`/backups/${operation.id}`)
        expect(remote.response.status).toBe(200)
        expect(remote.body.storage.identities[0].subject).toBe('private-player@example.test')
        const local = await env.management.request(env.owner.actor, { method: 'GET', path: `/backups/${operation.id}` })
        expect(local.body).toEqual(remote.body)
        expect((await env.post('one')).body.id).toBe(operation.id)
        expect(env.captures()).toBe(1)
      })
      it('requires both backup and workspace export, rechecks downloads, and rejects another server or missing credentials', async () => {
        const env = await fixture(driver)
        expect((await env.post('anonymous', null)).response.status).toBe(401)
        expect((await env.post('viewer', env.viewer)).response.status).toBe(403)
        expect((await env.post('server-only', env.serverOnly)).response.status).toBe(403)
        expect(
          (await env.request('/servers/another/backup', 'POST', {}, env.owner, { 'Idempotency-Key': 'other' })).response
            .status,
        ).toBe(404)
        const started = await env.post('authorized')
        await complete(env.management.operations, started.body.id)
        expect((await env.request(`/backups/${started.body.id}`, 'GET', undefined, env.viewer)).response.status).toBe(
          403,
        )
        expect(
          (await env.request(`/backups/${started.body.id}`, 'GET', undefined, env.serverOnly)).response.status,
        ).toBe(403)
        await env.management.auth.revokeCredential(env.owner.actor, env.owner.actor.credentialId)
        expect((await env.request(`/backups/${started.body.id}`)).response.status).toBe(401)
      })
      it('deduplicates concurrent submissions and cancels an in-flight capture without leaving an accessible artifact', async () => {
        const env = await fixture(driver),
          entered = deferred(),
          release = deferred()
        let signal: AbortSignal | undefined
        env.setCapture(async value => {
          signal = value
          entered.resolve()
          await release.promise
          return env.archive()
        })
        const [a, b] = await Promise.all([env.post('concurrent'), env.post('concurrent')])
        expect(a.body.id).toBe(b.body.id)
        await entered.promise
        expect(env.captures()).toBe(1)
        expect((await env.request(`/operations/${a.body.id}/cancel`, 'POST', {}, env.viewer)).response.status).toBe(403)
        expect((await env.request(`/operations/${a.body.id}/cancel`, 'POST')).response.status).toBe(200)
        expect(signal?.aborted).toBe(true)
        release.resolve()
        expect((await complete(env.management.operations, a.body.id)).status).toBe('cancelled')
        expect((await env.request(`/backups/${a.body.id}`)).response.status).toBe(409)
        expect(await readdir(env.directory)).toEqual([])
      })
      it('rechecks authorization after capture, and retries a failed capture with a fresh authorized attempt', async () => {
        const env = await fixture(driver),
          entered = deferred(),
          release = deferred()
        env.setCapture(async () => {
          entered.resolve()
          await release.promise
          return env.archive()
        })

        const started = await env.post('revoke-during-capture')
        await entered.promise
        await env.management.auth.revokeCredential(env.owner.actor, env.owner.actor.credentialId)
        release.resolve()
        expect((await complete(env.management.operations, started.body.id)).status).toBe('failed')
        expect(await readdir(env.directory)).toEqual([])
        const renewed = await env.management.auth.exchangeBootstrap(
          (await env.management.auth.issueBootstrapCode(env.management.ownerPermissions, 'backup-owner')).code,
        )
        env.setCapture(() => env.archive())
        const retry = await env.request(`/operations/${started.body.id}/retry`, 'POST', {}, renewed, {
          'Idempotency-Key': 'retry',
        })
        expect(retry.response.status).toBe(202)
        expect(await complete(env.management.operations, retry.body.id)).toMatchObject({
          status: 'succeeded',
          attempt: 2,
          rootOperationId: started.body.id,
        })
      })
      it('serializes different backup requests so large snapshots do not accumulate concurrently', async () => {
        const env = await fixture(driver),
          entered = deferred(),
          release = deferred()
        let active = 0,
          maximum = 0
        env.setCapture(async () => {
          active++
          maximum = Math.max(maximum, active)
          try {
            entered.resolve()
            await release.promise
            return await env.archive()
          } finally {
            active--
          }
        })
        const first = await env.post('serial-first')
        await entered.promise
        const second = await env.post('serial-second')
        expect(second.response.status).toBe(202)
        expect(env.captures()).toBe(1)
        release.resolve()
        expect((await complete(env.management.operations, first.body.id)).status).toBe('succeeded')
        expect((await complete(env.management.operations, second.body.id)).status).toBe('succeeded')
        expect(maximum).toBe(1)
      })
      it('does not export other servers in a shared archive without their backup permissions', async () => {
        const env = await fixture(driver)
        await env.storage.create('servers', {
          id: 'another',
          scope: 'server:another',
          value: { workspaceId: env.workspace.workspaceId },
        })
        env.setCapture(() => env.archive(['another']))
        const started = await env.post('shared-workspace')
        expect((await complete(env.management.operations, started.body.id)).status).toBe('failed')
        expect(await readdir(env.directory)).toEqual([])
      })
      it('bounds artifacts, expires downloads, and cleans expired/orphan files without racing an active capture', async () => {
        const env = await fixture(driver)
        let now = Date.now()
        const directory = join(env.root, 'short-lived')
        let capture: (signal: AbortSignal) => Promise<unknown> = () => env.archive()
        const backups = new ManagementBackups({
          storage: env.storage,
          auth: env.management.auth,
          operations: env.management.operations,
          serverId: env.serverId,
          workspaceId: env.workspace.workspaceId,
          directory,
          maxBytes: 2048,
          ttlMs: 1000,
          now: () => now,
          createServerBackup: signal => capture(signal),
        })
        cleanups.push(() => backups.close())
        const first = await backups.create(env.owner.actor, 'short-lived')
        expect((await complete(env.management.operations, first.id)).status).toBe('succeeded')
        const root = join(
          directory,
          `backup-owner-${createHash('sha256').update(env.management.operations.ownerId).digest('hex')}`,
        )
        const orphan = join(root, `backup-${'a'.repeat(64)}.json`)
        await writeFile(orphan, '{}', { mode: 0o600 })
        await utimes(orphan, new Date(now - 5000), new Date(now - 5000))
        expect(await backups.cleanup()).toEqual({ removed: 1 })
        now += 1001
        await expect(backups.download(env.owner.actor, first.id)).rejects.toMatchObject({ code: 'BACKUP_EXPIRED' })
        expect(await backups.cleanup()).toEqual({ removed: 1 })
        capture = async () => ({ ...(await env.archive()), padding: 'x'.repeat(3000) })
        const huge = await backups.create(env.owner.actor, 'oversized')
        expect(await complete(env.management.operations, huge.id)).toMatchObject({
          status: 'failed',
          error: { code: 'BACKUP_TOO_LARGE' },
        })
        expect(await readdir(root)).toEqual([])
        const entered = deferred(),
          release = deferred()
        capture = async () => {
          entered.resolve()
          await release.promise
          return env.archive()
        }
        const active = await backups.create(env.owner.actor, 'shutdown')
        await entered.promise
        now += 5000
        expect(await backups.cleanup()).toEqual({ removed: 0 })
        await backups.close()
        release.resolve()
        expect((await complete(env.management.operations, active.id)).status).toBe('failed')
        expect(await readdir(root)).toEqual([])
      })
      it('does not advertise or expose online backup without the host capture capability', async () => {
        const env = await fixture(driver, false)
        expect((await env.request('/capabilities')).body.supportedFeatures).not.toContain('server.backup')
        expect((await env.post('unsupported')).response.status).toBe(404)
      })
    },
  )
