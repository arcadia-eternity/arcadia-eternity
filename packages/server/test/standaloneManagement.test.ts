import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { openStorage, type DurableStorage } from '../../database/src/storage'
import { ContentWorkspace } from '../../content-dev/src/content-workspace.mjs'
import { createSingleProcessApp } from '../src/standalone/app'
import { createNpmFixture } from './fixtures/npm'
import type { Binding } from '../src/standalone/management/service'
import { workspaceRetentions } from '../../../bin/server-persistence'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function portableFixture(prebuilt = false) {
  const fixture = await createNpmFixture({ prebuilt })
  const manifest = JSON.parse(await readFile(join(fixture.directory, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(fixture.directory, 'package-lock.json'), 'utf8'))
  await mkdir(join(fixture.directory, 'candidates'))
  for (const [name, source] of Object.entries(manifest.dependencies as Record<string, string>)) {
    const file = source.slice(5)
    const path = 'candidates/content.tgz'
    await cp(file, join(fixture.directory, path))
    manifest.dependencies[name] = `file:${path}`
    lock.packages[''].dependencies[name] = `file:${path}`
    lock.packages[`node_modules/${name}`].resolved = `file:${path}`
  }
  await writeFile(join(fixture.directory, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(fixture.directory, 'package-lock.json'), JSON.stringify(lock))
  await promisify(execFile)('npm', ['ci', '--offline', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: fixture.directory,
  })
  return fixture
}
async function setup(project?: string, allowThirdPartyExecution = true) {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-management-api-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const storage = openStorage({ driver: 'sqlite', filename: join(directory, 'server.sqlite') })
  await storage.migrate()
  cleanups.push(() => storage.close())
  const workspace: ContentWorkspace = await ContentWorkspace.open(join(directory, 'workspace'), {
    retentions: workspaceRetentions(storage, () => workspace.workspaceId),
    resolveProject: () => project,
  })
  cleanups.push(() => workspace.close())
  const make = () =>
    createSingleProcessApp({
      port: 0,
      host: '127.0.0.1',
      serverId: 'managed-test',
      corsOrigins: ['http://admin.test'],
      management: {
        storage,
        workspace,
        secureCookies: false,
        allowThirdPartyExecution,
        transferDirectory: join(directory, 'transfers'),
      },
    })
  let app = make()
  await app.start()
  cleanups.push(async () => {
    await app.stop()
  })
  let url = `http://127.0.0.1:${app.address!.port}/api/management/v1`
  let cookie = '',
    csrf = ''
  const request = async (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://admin.test',
        ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { response, body: await response.json() }
  }
  const login = async () => {
    const code = await app.management!.auth.issueBootstrapCode(app.management!.ownerPermissions)
    const response = await request('/session/bootstrap', 'POST', { code: code.code })
    expect(response.response.status).toBe(200)
    cookie = response.response.headers.get('set-cookie')!.split(';')[0]
    csrf = response.body.csrfToken
    return code.code
  }
  await login()
  return {
    get app() {
      return app
    },
    get url() {
      return url
    },
    storage,
    workspace,
    request,
    login,
    async restart() {
      await app.stop()
      app = make()
      await app.start()
      url = `http://127.0.0.1:${app.address!.port}/api/management/v1`
    },
  }
}
async function completed(storage: DurableStorage, id: string) {
  let result: { status: string; result?: unknown; error?: unknown } | undefined
  await expect
    .poll(
      async () => {
        result = (await storage.get<{ status: string; result?: unknown; error?: unknown }>('operations', id))!.value
        return result.status
      },
      { timeout: 15000 },
    )
    .not.toMatch(/^(queued|running)$/)
  return result!
}

describe('unified management HTTP and durable environment publication', () => {
  it('keeps operational metadata behind separate permissions and reports the actual listening port', async () => {
    const env = await setup()
    const servers = await env.request('/servers')
    expect(servers.body.servers[0].listenAddress.port).toBe(env.app.address!.port)
    expect(servers.body.servers[0].listenAddress.port).not.toBe(0)
    const guest = await fetch(env.url.replace('/api/management/v1', '/api/v1/sessions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { id: 'private-profile', name: 'Visitor' } }),
    }).then(response => response.json())
    const players = await env.request('/servers/managed-test/players')
    expect(players.body.players).toHaveLength(1)
    expect(players.body.players[0]).toMatchObject({ name: 'Visitor', kind: 'guest', connected: false })
    expect(JSON.stringify(players.body)).not.toContain('private-profile')
    expect(JSON.stringify(players.body)).not.toContain(guest.token)
    await fetch(env.url.replace('/api/management/v1', '/api/v1/sessions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { id: 'second-private-profile', name: 'Second visitor' } }),
    })
    const firstPage = await env.request('/servers/managed-test/players?limit=1')
    expect(firstPage.body.players).toHaveLength(1)
    const secondPage = await env.request(
      '/servers/managed-test/players?limit=1&cursor=' + encodeURIComponent(firstPage.body.nextCursor),
    )
    expect(secondPage.body.players).toHaveLength(1)
    expect(secondPage.body.players[0].seatId).not.toBe(firstPage.body.players[0].seatId)
    expect((await env.request('/servers/managed-test/players?limit=10000')).response.status).toBe(422)
    const code = await env.app.management!.auth.issueBootstrapCode(
      [{ scope: { kind: 'server', id: 'managed-test' }, actions: ['read'] }],
      'viewer',
    )
    const viewer = await env.app.management!.auth.exchangeBootstrap(code.code)
    for (const path of ['/servers/managed-test/players', '/servers/managed-test/battles']) {
      await expect(env.app.management!.request(viewer.actor, { method: 'GET', path })).rejects.toMatchObject({
        code: 'MANAGEMENT_FORBIDDEN',
      })
    }
    await expect(
      env.app.management!.request(viewer.actor, {
        method: 'POST',
        path: '/servers/managed-test/battles/unknown/terminate',
        body: { reason: 'test' },
        headers: { 'idempotency-key': 'denied' },
      }),
    ).rejects.toMatchObject({ code: 'MANAGEMENT_FORBIDDEN' })
    expect((await env.request('/servers/managed-test/battles')).body.battles).toEqual([])
  })
  it('deletes only revision-matching drafts and treats repeated termination of an ended match as one operation', async () => {
    const env = await setup()
    const path = `/workspaces/${env.workspace.workspaceId}/environments`
    const draft = await env.request(path, 'POST', {
      document: {
        schemaVersion: 2,
        id: 'unused',
        name: 'Unused',
        packages: {},
        sources: [],
        rules: { schemaVersion: 1 },
        requires: {},
      },
      expectedRevision: null,
    })
    expect(draft.response.status).toBe(200)
    expect((await env.request(path + '/unused', 'DELETE', undefined, { 'If-Match': 'stale' })).response.status).toBe(
      412,
    )
    expect(
      (await env.request(path + '/unused', 'DELETE', undefined, { 'If-Match': draft.body.revision })).response.status,
    ).toBe(200)
    const route = '/servers/managed-test/battles/ended/terminate'
    expect(
      (await env.request(route, 'POST', { reason: '' }, { 'Idempotency-Key': 'empty-reason' })).response.status,
    ).toBe(422)
    const first = await env.request(route, 'POST', { reason: '已结束' }, { 'Idempotency-Key': 'one-ended-match' })
    expect(first.response.status).toBe(202)
    const result = await completed(env.storage, first.body.id)
    expect(result).toMatchObject({ status: 'succeeded', result: { terminated: false, status: 'already-ended' } })
    const repeated = await env.request(route, 'POST', { reason: '已结束' }, { 'Idempotency-Key': 'one-ended-match' })
    expect(repeated.body.id).toBe(first.body.id)
  })
  it('keeps guest gameplay independent from authenticated management, enforces CSRF and scope', async () => {
    const env = await setup()
    const anonymous = await fetch(env.url + '/servers')
    expect(anonymous.status).toBe(401)
    const capabilities = await fetch(env.url + '/capabilities').then(r => r.json())
    expect(capabilities.effectivePermissions).toEqual([])
    expect((await env.request('/servers')).body.servers[0].id).toBe('managed-test')
    expect((await env.request('/servers/other/drain', 'POST')).response.status).toBe(404)
    expect(
      (await env.request('/servers/managed-test/drain', 'POST', {}, { 'X-CSRF-Token': 'forged' })).response.status,
    ).toBe(403)
    expect(
      (await env.request('/servers/managed-test/drain', 'POST', {}, { Origin: 'https://evil.test' })).response.status,
    ).toBe(403)
    expect((await env.request('/session')).body.csrfToken).toBeTruthy()
    expect((await env.request('/servers/managed-test/drain', 'POST')).body.draining).toBe(true)
    expect((await env.request('/servers/managed-test/drain', 'POST', { draining: false })).body.draining).toBe(false)
    const code = await env.login()
    expect((await env.request('/session/bootstrap', 'POST', { code })).response.status).toBe(401)
    expect((await env.request('/session/logout', 'POST')).response.status).toBe(200)
    expect((await env.request('/servers')).response.status).toBe(401)
  })

  it('prepares actual captured npm materials, publishes only explicitly, survives restart, and preserves versions', async () => {
    const source = await portableFixture()
    cleanups.push(() => source.dispose())
    const env = await setup(source.directory)
    const base = `/workspaces/${env.workspace.workspaceId}/environments`
    const draft = await env.request(base, 'POST', {
      document: { schemaVersion: 1, id: 'community', name: 'Community', packages: {}, sources: [] },
      expectedRevision: null,
    })
    expect(draft.response.status).toBe(200)
    const prepared = await env.request(
      base + '/community/prepare',
      'POST',
      { expectedRevision: draft.body.revision },
      { 'Idempotency-Key': 'prepare-1' },
    )
    expect(prepared.response.status).toBe(202)
    const preparation = await completed(env.storage, prepared.body.id)
    expect(preparation.status, JSON.stringify(preparation)).toBe('succeeded')
    const version = preparation.result as { versionId: string }
    expect(JSON.stringify(preparation.result)).not.toContain(source.directory)
    expect(env.app.environments.list()).toHaveLength(0)
    const created = await env.request('/servers/managed-test/bindings', 'POST', {
      environmentId: 'community',
      versionId: version.versionId,
      enabled: true,
      visibility: 'public',
      matchmakingEnabled: true,
    })
    expect(created.response.status).toBe(201)
    const path = `/servers/managed-test/bindings/${created.body.id}`
    const publication = await env.request(
      path + '/publish',
      'POST',
      { versionId: version.versionId },
      { 'If-Match': String(created.body.revision), 'Idempotency-Key': 'publish-1' },
    )
    expect(publication.response.status).toBe(202)
    expect((await completed(env.storage, publication.body.id)).status).toBe('succeeded')
    await expect.poll(() => env.app.environments.list().length).toBe(1)
    const replay = await env.request(
      path + '/publish',
      'POST',
      { versionId: version.versionId },
      { 'If-Match': String(created.body.revision), 'Idempotency-Key': 'publish-1' },
    )
    expect(replay.response.status).toBe(202)
    expect(replay.body.id).toBe(publication.body.id)
    const previousRuntime = env.app.environments.list()[0].id
    const lease = env.app.environments.acquire(previousRuntime)
    const binding = (await env.storage.get<Binding>('bindings', created.body.id))!
    expect((await env.request(path, 'PATCH', { visibility: 'private' }, { 'If-Match': '1' })).response.status).toBe(412)
    expect(
      (await env.request(path, 'PATCH', { visibility: 'private' }, { 'If-Match': String(binding.revision) })).response
        .status,
    ).toBe(200)
    expect(env.app.environments.list()).toHaveLength(0)
    expect(lease.descriptor.id).toBe(previousRuntime)
    await expect(env.workspace.deleteVersion(version.versionId)).rejects.toMatchObject({ code: 'ENVIRONMENT_IN_USE' })
    await lease.release()
    await env.restart()
    const restored = (await env.request('/servers/managed-test/bindings')).body.bindings[0]
    expect(restored.effectiveVersionId).toBe(version.versionId)
    expect(restored.condition).toBe('available')
    expect(restored.observedBootId).toBe(env.app.management!.bootId)
  }, 30000)

  it('exports and imports actual environment bundles through authenticated HTTP without exposing host paths', async () => {
    const project = await mkdtemp(join(tmpdir(), 'arcadia-management-empty-'))
    cleanups.push(() => rm(project, { recursive: true, force: true }))
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'empty', version: '1.0.0', private: true, dependencies: {} }),
    )
    await writeFile(
      join(project, 'package-lock.json'),
      JSON.stringify({
        name: 'empty',
        version: '1.0.0',
        lockfileVersion: 3,
        packages: { '': { name: 'empty', version: '1.0.0' } },
      }),
    )
    const env = await setup(project)
    const base = `/workspaces/${env.workspace.workspaceId}`
    const draft = await env.request(base + '/environments', 'POST', {
      document: { schemaVersion: 1, id: 'exported', name: 'Exported', packages: {}, sources: [] },
      expectedRevision: null,
    })
    const prepared = await env.request(
      base + '/environments/exported/prepare',
      'POST',
      { expectedRevision: draft.body.revision },
      { 'Idempotency-Key': 'export-prepare' },
    )
    const preparation = await completed(env.storage, prepared.body.id)
    expect(preparation.status).toBe('succeeded')
    const versionId = (preparation.result as { versionId: string }).versionId
    const exported = await env.request(
      `${base}/versions/${versionId}/export`,
      'POST',
      {},
      { 'Idempotency-Key': 'export-file' },
    )
    expect(exported.response.status).toBe(202)
    expect(exported.body).not.toHaveProperty('actor')
    const exportOperation = await completed(env.storage, exported.body.id)
    expect(exportOperation.status).toBe('succeeded')
    const path = (exportOperation.result as { downloadPath: string }).downloadPath.replace('/api/management/v1', '')
    const downloaded = await env.request(path)
    expect(downloaded.response.status).toBe(200)
    expect(downloaded.response.headers.get('content-disposition')).toContain('attachment')
    expect(JSON.stringify(downloaded.body)).not.toContain(project)
    const imported = await env.request(
      base + '/import',
      'POST',
      { bundle: downloaded.body, environmentId: 'copied' },
      { 'Idempotency-Key': 'import-file' },
    )
    expect(imported.response.status).toBe(202)
    const importOperation = await completed(env.storage, imported.body.id)
    expect(importOperation.status, JSON.stringify(importOperation)).toBe('succeeded')
    expect((importOperation.result as { environmentId: string }).environmentId).toBe('copied')
    expect((await env.request(`${base}/versions/${versionId}/references`)).body.references).toEqual([])
  }, 30000)

  it('keeps unauthorized tokens out of mutation and refuses content publication on an official-policy host', async () => {
    const source = await portableFixture(true)
    cleanups.push(() => source.dispose())
    const env = await setup(source.directory, false)
    const local = env.app.management!
    const issued = await local.auth.issueBootstrapCode(local.ownerPermissions)
    const owner = await local.auth.exchangeBootstrap(issued.code)
    const limited = await local.auth.createServiceToken(owner.actor, {
      permissions: [{ scope: local.serverScope, actions: ['read'] }],
    })
    const response = await fetch(env.url + '/servers/managed-test/drain', {
      method: 'POST',
      headers: { Authorization: `Bearer ${limited.token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(response.status).toBe(403)
    const draft = await env.workspace.saveDraft({
      document: { schemaVersion: 1, id: 'private', name: 'Private', packages: {}, sources: [] },
      expectedRevision: null,
    })
    const prepared = await local.localRequest({
      method: 'POST',
      path: `/workspaces/${env.workspace.workspaceId}/environments/private/prepare`,
      body: { expectedRevision: draft.revision },
      headers: { 'idempotency-key': 'p' },
    })
    const task = await completed(env.storage, (prepared.body as { id: string }).id)
    expect(task.status).toBe('succeeded')
    const version = task.result as { versionId: string }
    const created = await env.request('/servers/managed-test/bindings', 'POST', {
      environmentId: 'private',
      versionId: version.versionId,
      enabled: true,
      visibility: 'public',
    })
    const publication = await env.request(
      `/servers/managed-test/bindings/${created.body.id}/publish`,
      'POST',
      { versionId: version.versionId },
      { 'If-Match': String(created.body.revision), 'Idempotency-Key': 'official-deny' },
    )
    expect((await completed(env.storage, publication.body.id)).status).toBe('failed')
    expect(env.app.environments.list()).toHaveLength(0)
  }, 30000)
})
