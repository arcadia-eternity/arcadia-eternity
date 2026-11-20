import { randomUUID } from 'node:crypto'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { openStorage } from '@arcadia-eternity/database'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import type { ServerEnvironmentDescriptor, ServerSession } from '@arcadia-eternity/protocol'
import { afterEach, expect, it } from 'vitest'

const execute = promisify(execFile)
const cli = resolve('dist/cli.js')
const directories: string[] = []
const children = new Set<ChildProcess>()
type Reply = { status: 'SUCCESS'; data: unknown } | { status: 'ERROR'; code: string }
interface TestSocket {
  once(event: 'connect', listener: () => void): void
  once(event: 'connect_error', listener: (error: Error) => void): void
  disconnect(): void
  timeout(ms: number): { emitWithAck(event: string, ...data: unknown[]): Promise<Reply> }
}
// The protocol fixture uses the socket client declared by the server package.
const { io } = createRequire(new URL('../../packages/server/package.json', import.meta.url))('socket.io-client') as {
  io(origin: string, options: { auth: { token: string }; transports: string[]; reconnection: boolean }): TestSocket
}
const sockets = new Set<TestSocket>()
const adminOrigin = 'http://admin.test'
type Server = { id: string; revision: number; workspaceId: string; defaultBindingId?: string }
type Binding = {
  id: string
  revision: number
  environmentId: string
  enabled: boolean
  visibility: 'public' | 'private'
  matchmakingEnabled: boolean
  condition: string
}
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  SystemRoot: process.env.SystemRoot,
  ACCOUNT_MODE: 'guest',
  STORAGE_DRIVER: 'sqlite',
  DOTENV_CONFIG_PATH: '/dev/null',
}
async function command(args: string[]) {
  const { stdout } = await execute(process.execPath, [cli, 'server', ...args], { env, timeout: 60_000 })
  return JSON.parse(stdout.trim())
}
async function start(directory: string, extra: string[] = []) {
  const child = spawn(
    process.execPath,
    [
      cli,
      'server',
      '--headless',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--data-dir',
      directory,
      '--cors-origin',
      adminOrigin,
      ...extra,
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  children.add(child)
  return new Promise<{ child: ChildProcess; origin: string }>((resolve, reject) => {
    let output = '',
      errors = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Server startup timed out: ' + errors))
    }, 60_000)
    child.stderr!.on('data', chunk => {
      errors += chunk.toString()
    })
    child.stdout!.on('data', chunk => {
      output += chunk.toString()
      const port = output.match(/listening on port (\d+)/)?.[1]
      if (port) {
        clearTimeout(timer)
        resolve({ child, origin: 'http://127.0.0.1:' + port })
      }
    })
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      children.delete(child)
      reject(new Error('Server exited: ' + code + ' ' + errors))
    })
  })
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('Server failed graceful shutdown'))
    }, 10_000)
    child.once('exit', () => {
      clearTimeout(timer)
      children.delete(child)
      resolve()
    })
    child.kill('SIGTERM')
  })
}
afterEach(async () => {
  for (const socket of sockets) socket.disconnect()
  sockets.clear()
  await Promise.all([...children].map(stop))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function administrator(origin: string, directory: string) {
  const login = await command(['admin', 'login-code', '--data-dir', directory])
  const response = await fetch(origin + '/api/management/v1/session/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: adminOrigin },
    body: JSON.stringify({ code: login.code }),
  })
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')!.split(';')[0]
  const { csrfToken } = (await response.json()) as { csrfToken: string }
  return async <T>(
    path: string,
    method = 'GET',
    body?: unknown,
    revision?: number | string,
    status = 200,
  ): Promise<T> => {
    const result = await fetch(origin + '/api/management/v1' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: adminOrigin,
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        'Idempotency-Key': randomUUID(),
        ...(revision === undefined ? {} : { 'If-Match': String(revision) }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    expect(result.status, `${method} ${path}`).toBe(status)
    return (await result.json()) as T
  }
}

async function guest(origin: string) {
  const response = await fetch(origin + '/api/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: { id: 'local-cli-fixture', name: 'Guest' } }),
  })
  expect(response.status).toBe(201)
  const session = (await response.json()) as ServerSession
  const socket = io(origin, { auth: { token: session.token }, transports: ['websocket'], reconnection: false })
  sockets.add(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
  return socket
}

async function accepted<T = unknown>(socket: TestSocket, event: string, ...data: unknown[]): Promise<T> {
  const result = await socket.timeout(10_000).emitWithAck(event, ...data)
  expect(result.status, result.status === 'ERROR' ? result.code : event).toBe('SUCCESS')
  if (result.status !== 'SUCCESS') throw new Error(result.code)
  return result.data as T
}

async function catalog(origin: string) {
  const response = await fetch(origin + '/api/v1/environments')
  expect(response.status).toBe(200)
  return ((await response.json()) as { environments: ServerEnvironmentDescriptor[] }).environments
}

async function getBindings(request: Awaited<ReturnType<typeof administrator>>, server: Server) {
  return (await request<{ bindings: Binding[] }>(`/servers/${server.id}/bindings`)).bindings
}

it('bootstraps playable builtin content once and preserves administrator removal across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-cli-first-publication-'))
  directories.push(directory)
  let running = await start(directory)
  let request = await administrator(running.origin, directory)
  let server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  let binding = (await getBindings(request, server)).find(item => item.id === server.defaultBindingId)!
  expect(binding).toMatchObject({
    enabled: true,
    visibility: 'public',
    matchmakingEnabled: true,
    condition: 'available',
  })
  expect(binding.environmentId).toBeTruthy()
  expect(server.defaultBindingId).toBe(binding.id)
  const initial = {
    serverId: server.id,
    workspaceId: server.workspaceId,
    bindingId: binding.id,
    installationId: binding.environmentId,
  }
  const environments = await catalog(running.origin)
  expect(environments).toHaveLength(2)
  const base = '@arcadia-eternity/data-pack-base'
  expect(environments.every(item => item.packages.some(pkg => pkg.name === base))).toBe(true)
  const draftsPath = `/workspaces/${server.workspaceId}/environments`
  const { environments: drafts } = await request<{
    environments: {
      document: { id: string; packages: Record<string, string> }
      revision: string
      requiredPackages: string[]
      builtin?: boolean
    }[]
  }>(draftsPath)
  const draft = drafts.find(item => item.document.id === binding.environmentId)!
  expect(draft.requiredPackages).toEqual([base])
  const extended = drafts.find(item => item.builtin && item.document.id !== draft.document.id)!
  const published120 = environments.find(item => item.environmentId === extended.document.id)
  expect(published120?.environmentId).toBe('training-120')
  expect(extended.document).toMatchObject({
    id: 'training-120',
    name: '120 资质 · 神魔化与二代',
    rules: {
      include: ['base:classic'],
      mechanics: { individualValues: { max: 120 }, enhancement: { mode: 'active' } },
    },
  })
  await request(draftsPath + '/' + extended.document.id, 'DELETE', undefined, extended.revision, 409)
  const draftPath = `${draftsPath}/${draft.document.id}`
  await request(
    draftPath + '/packages/remove',
    'POST',
    { name: base, cascade: true, expectedRevision: draft.revision },
    undefined,
    409,
  )
  await request(
    draftsPath + '/apply',
    'POST',
    { document: { ...draft.document, packages: {} }, expectedRevision: draft.revision },
    undefined,
    409,
  )
  const socket = await guest(running.origin)
  const room = await accepted<{ roomCode: string }>(socket, 'createPrivateRoom', { config: { battleMode: 'server' } })
  expect(room.roomCode).toBeTruthy()
  await accepted(socket, 'leavePrivateRoom')
  const input = JSON.parse(
    await readFile(resolve('packages/battle/test/fixtures/official-switch.input.json'), 'utf8'),
  ) as {
    teams: { team: Record<string, unknown>[] }[]
  }
  const team = input.teams[1].team.map(({ maxHp: _maxHp, ...pet }) => ({
    ...pet,
    skills: ['skill_paida', 'skill_shuipao'],
  }))
  const environment = environments.find(item => item.isDefault)!
  await accepted(socket, 'joinMatchmaking', {
    playerSchema: { team },
    environmentId: environment.id,
    environment: {
      environmentId: environment.id,
      protocolVersion: 1,
      gameplayRevision: environment.gameplayRevision,
      resourceRevision: environment.resourceRevision,
      resourcesReady: true,
    },
  })
  expect(await accepted(socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1 })
  await accepted(socket, 'cancelMatchmaking')
  expect(await accepted(socket, 'getServerState')).toMatchObject({ matchmakingQueue: 0 })
  socket.disconnect()
  sockets.delete(socket)
  await stop(running.child)

  running = await start(directory)
  request = await administrator(running.origin, directory)
  server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  binding = (await getBindings(request, server)).find(item => item.id === server.defaultBindingId)!
  expect({
    serverId: server.id,
    workspaceId: server.workspaceId,
    bindingId: binding.id,
    installationId: binding.environmentId,
  }).toEqual(initial)
  expect(server.defaultBindingId).toBe(binding.id)
  const restartedEnvironments = await catalog(running.origin)
  expect(restartedEnvironments).toHaveLength(2)
  expect(restartedEnvironments.find(item => item.isDefault)).toMatchObject({
    runtime: environment.runtime,
    packages: environment.packages,
    resourceRevision: environment.resourceRevision,
    executionPolicy: environment.executionPolicy,
  })

  const extra = (await getBindings(request, server)).find(item => item.environmentId === extended.document.id)!
  expect(restartedEnvironments.find(item => item.environmentId === extra.environmentId)).toMatchObject({
    matchmakingEnabled: true,
    rules: {
      mechanics: {
        individualValues: { max: 120 },
        enhancement: { mode: 'active' },
        secondGenerationNatures: 'species',
      },
    },
  })
  await request(`/servers/${server.id}/bindings/${extra.id}`, 'DELETE', undefined, extra.revision)
  await request(`/servers/${server.id}`, 'PATCH', { defaultBindingId: null }, server.revision)
  await stop(running.child)
  running = await start(directory)
  request = await administrator(running.origin, directory)
  server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  expect(server.defaultBindingId).toBeUndefined()
  binding = (await getBindings(request, server)).find(item => item.id === initial.bindingId)!
  await request(`/servers/${server.id}/bindings/${binding.id}`, 'PATCH', { enabled: false }, binding.revision)
  await stop(running.child)

  running = await start(directory)
  request = await administrator(running.origin, directory)
  server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  binding = (await getBindings(request, server)).find(item => item.id === initial.bindingId)!
  expect(server.defaultBindingId).toBeUndefined()
  expect(binding.enabled).toBe(false)
  expect(await catalog(running.origin)).toEqual([])
  const denied = await guest(running.origin)
  expect(await denied.timeout(10_000).emitWithAck('createPrivateRoom', { config: {} })).toMatchObject({
    status: 'ERROR',
    code: 'ENVIRONMENT_NOT_PUBLISHED',
  })
  denied.disconnect()
  sockets.delete(denied)
  await request(`/servers/${server.id}/bindings/${binding.id}`, 'DELETE', undefined, binding.revision)
  await stop(running.child)

  running = await start(directory)
  request = await administrator(running.origin, directory)
  server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  expect(server.defaultBindingId).toBeUndefined()
  expect((await request<{ bindings: Binding[] }>(`/servers/${server.id}/bindings`)).bindings).toEqual([])
  expect(await catalog(running.origin)).toEqual([])
}, 120_000)

it('refreshes stale builtin content after a release without changing administrator policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-cli-builtin-refresh-'))
  directories.push(directory)
  let running = await start(directory)
  let request = await administrator(running.origin, directory)
  let server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  let binding = (await getBindings(request, server)).find(item => item.id === server.defaultBindingId)!
  expect(binding.condition).toBe('available')
  const previousVersionId = binding.environmentId
  await stop(running.child)

  const manifestFile = join(directory, 'workspace', 'environments', binding.environmentId, 'package.json')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  manifest.arcadiaEnvironment.rules = { schemaVersion: 1 }
  manifest.dependencies['@arcadia-eternity/data-pack-base'] = '0.0.0-stale'
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n')

  running = await start(directory)
  const environments = await catalog(running.origin)
  expect(environments).toHaveLength(2)
  const info = (await (await fetch(running.origin + '/api/v1/server-info')).json()) as {
    runtime: { contentRevision: string }
  }
  expect(environments.find(item => item.isDefault)!.runtime.contentRevision).toBe(info.runtime.contentRevision)
  expect(environments.find(item => item.isDefault)!.rules?.mechanics?.inheritance?.eligible).toBe('species')
  expect(JSON.parse(await readFile(manifestFile, 'utf8')).arcadiaEnvironment.rules).toEqual({
    schemaVersion: 2,
    include: ['base:classic'],
  })

  request = await administrator(running.origin, directory)
  server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  binding = (await getBindings(request, server)).find(item => item.id === server.defaultBindingId)!
  expect(binding).toMatchObject({
    enabled: true,
    visibility: 'public',
    matchmakingEnabled: true,
    condition: 'available',
  })
  expect(binding.environmentId).toBe(previousVersionId)
  expect(server.defaultBindingId).toBe(binding.id)
}, 120_000)

it('migrates a legacy 120 binding in place and keeps a removed default unpublished', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-cli-legacy-120-'))
  directories.push(directory)
  await command(['db', 'migrate', '--data-dir', directory])
  const { serverId } = JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8'))
  const root = join(directory, 'workspace')
  const workspace = await ContentWorkspace.open(root)
  const oldId = 'builtin-' + randomUUID()
  const bindingId = randomUUID()
  const scope = 'server:' + serverId
  const storage = openStorage({ driver: 'sqlite', filename: join(directory, 'server.sqlite') })
  try {
    const { workspaceId } = workspace
    const metadata = JSON.parse(await readFile(join(root, 'workspace.json'), 'utf8'))
    await writeFile(
      join(root, 'workspace.json'),
      JSON.stringify({
        ...metadata,
        builtinEnvironmentIds: { 'builtin-server': 'builtin-server', 'training-120': oldId },
      }),
    )
    await storage.create('servers', {
      id: serverId,
      scope,
      value: {
        name: 'Legacy',
        workspaceId,
        defaultBindingId: bindingId,
        initialization: { kind: 'builtin', environmentId: 'builtin-server', state: 'completed' },
        initializedBuiltinEnvironmentIds: ['builtin-server', oldId],
      },
    })
    await storage.create('bindings', {
      id: bindingId,
      scope,
      value: {
        serverId,
        workspaceId,
        environmentId: oldId,
        enabled: true,
        visibility: 'public',
        executionPolicy: 'server',
        matchmakingEnabled: false,
      },
    })
    await storage.create('retentions', {
      id: 'workspace:' + workspaceId + ':binding:' + bindingId,
      scope: 'workspace:' + workspaceId,
      value: { installationId: oldId, retentionId: 'binding:' + bindingId },
    })
  } finally {
    await workspace.close()
    await storage.close()
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const running = await start(directory)
    const request = await administrator(running.origin, directory)
    const [server] = (await request<{ servers: Server[] }>('/servers')).servers
    expect(server.defaultBindingId).toBe(bindingId)
    expect(await getBindings(request, server)).toEqual([
      expect.objectContaining({
        id: bindingId,
        environmentId: 'training-120',
        matchmakingEnabled: false,
        condition: 'available',
      }),
    ])
    expect(await catalog(running.origin)).toEqual([
      expect.objectContaining({ environmentId: 'training-120', previousEnvironmentIds: [oldId], isDefault: true }),
    ])
    await stop(running.child)
  }
}, 90_000)

it('publishes shipped environments on upgrade without resetting the server default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-cli-existing-publication-'))
  directories.push(directory)
  await command(['db', 'migrate', '--data-dir', directory])
  const identity = JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8')) as { serverId: string }
  const storage = openStorage({ driver: 'sqlite', filename: join(directory, 'server.sqlite') })
  const workspace = await ContentWorkspace.open(join(directory, 'workspace'))
  try {
    // This is the durable shape written before one-time host initialization existed.
    await storage.create('servers', {
      id: identity.serverId,
      scope: 'server:' + identity.serverId,
      value: { name: 'Existing managed server', workspaceId: workspace.workspaceId },
    })
  } finally {
    await workspace.close()
    await storage.close()
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const running = await start(directory)
    const request = await administrator(running.origin, directory)
    const server = (await request<{ servers: Server[] }>('/servers')).servers[0]
    expect(server.id).toBe(identity.serverId)
    expect(server.defaultBindingId).toBeUndefined()
    expect(await getBindings(request, server)).toHaveLength(2)
    expect(await catalog(running.origin)).toHaveLength(2)
    await stop(running.child)
  }
}, 60_000)

it('runs guest management with SQLite, one-use owner login, restart identity, and offline backup/clone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-management-cli-'))
  directories.push(root)
  const directory = join(root, 'server')
  const first = await start(directory)
  const identity = JSON.parse(await readFile(join(directory, 'identity.json'), 'utf8')).serverId
  expect((await (await fetch(first.origin + '/api/v1/server-info')).json()).serverId).toBe(identity)
  expect((await fetch(first.origin + '/api/management/v1/servers')).status).toBe(401)
  const login = await command(['admin', 'login-code', '--data-dir', directory])
  expect(login.serverId).toBe(identity)
  const exchange = () =>
    fetch(first.origin + '/api/management/v1/session/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: login.code }),
    })
  const response = await exchange()
  expect(response.status).toBe(200)
  expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  expect((await exchange()).status).toBe(401)
  await stop(first.child)
  const second = await start(directory)
  expect((await (await fetch(second.origin + '/api/v1/server-info')).json()).serverId).toBe(identity)
  const originalRequest = await administrator(second.origin, directory)
  const originalServer = (await originalRequest<{ servers: Server[] }>('/servers')).servers[0]
  const originalBinding = (await getBindings(originalRequest, originalServer)).find(
    item => item.id === originalServer.defaultBindingId,
  )!
  const getBuiltins = async (request: typeof originalRequest, workspaceId: string) => {
    const { environments } = await request<{ environments: { builtin?: boolean; document: { id: string } }[] }>(
      `/workspaces/${workspaceId}/environments`,
    )
    return environments
      .filter(item => item.builtin)
      .map(item => item.document.id)
      .sort()
  }
  const originalBuiltinIds = await getBuiltins(originalRequest, originalServer.workspaceId)
  expect(originalBuiltinIds).toHaveLength(2)
  await stop(second.child)
  const backup = join(root, 'backup.json')
  await command(['backup', 'create', '--data-dir', directory, '--file', backup])
  const clone = await command(['backup', 'clone', '--file', backup, '--target', join(root, 'clone')])
  expect(clone.serverId).not.toBe(identity)
  const restored = await command(['backup', 'restore', '--file', backup, '--target', join(root, 'restored')])
  expect(restored.serverId).toBe(identity)
  for (const [mode, result] of [
    ['clone', clone],
    ['restored', restored],
  ] as const) {
    const target = join(root, mode)
    const running = await start(target)
    const request = await administrator(running.origin, target)
    const server = (await request<{ servers: Server[] }>('/servers')).servers[0]
    const bindings = (await request<{ bindings: Binding[] }>(`/servers/${server.id}/bindings`)).bindings
    expect(await getBuiltins(request, server.workspaceId)).toEqual(originalBuiltinIds)
    expect(server.id).toBe(result.serverId)
    expect(bindings.map(item => item.environmentId).sort()).toEqual(originalBuiltinIds)
    const defaultBinding = bindings.find(item => item.id === server.defaultBindingId)!
    expect(defaultBinding).toMatchObject({
      enabled: true,
      visibility: 'public',
      matchmakingEnabled: true,
      condition: 'available',
    })
    if (mode === 'clone') {
      expect(server.workspaceId).not.toBe(originalServer.workspaceId)
      expect(defaultBinding.id).not.toBe(originalBinding.id)
      expect(defaultBinding.environmentId).toBe(originalBinding.environmentId)
    } else {
      expect(server.workspaceId).toBe(originalServer.workspaceId)
      expect(defaultBinding.id).toBe(originalBinding.id)
      expect(defaultBinding.environmentId).toBe(originalBinding.environmentId)
    }
    expect(await catalog(running.origin)).toHaveLength(2)
    await stop(running.child)
  }
}, 150_000)

it('applies the bundled base from local files even when the registry is unreachable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-cli-local-base-'))
  directories.push(directory)
  const running = await start(directory, ['--npm-registry', 'https://127.0.0.1:1'])
  const request = await administrator(running.origin, directory)
  const server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  const path = `/workspaces/${server.workspaceId}/environments`
  const before = await request<{ environments: { builtin?: boolean; document: { id: string }; revision: string }[] }>(
    path,
  )
  const builtin = before.environments.find(env => env.builtin)!
  const custom = { ...builtin.document, id: 'local-base', name: '本地基础包' }
  const rejected = await request(
    path + '/apply',
    'POST',
    { document: { ...builtin.document, name: custom.name }, expectedRevision: builtin.revision },
    undefined,
    409,
  )
  expect(rejected).toMatchObject({ error: { code: 'BUILTIN_ENVIRONMENT_READ_ONLY' } })
  const operation = await request<{ id: string }>(
    path + '/apply',
    'POST',
    {
      document: custom,
      expectedRevision: null,
    },
    undefined,
    202,
  )
  await expect
    .poll(async () => (await request<{ status: string }>(`/operations/${operation.id}`)).status, { timeout: 30_000 })
    .toBe('succeeded')
  const after = await request<typeof before>(path)
  expect(after.environments).toContainEqual(builtin)
  expect(after.environments.find(env => env.document.id === custom.id)?.document).toEqual(custom)
  expect(await catalog(running.origin)).toHaveLength(2)
}, 90_000)

it('synchronizes old base installations in existing custom environments on restart without applying', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-cli-base-upgrade-'))
  directories.push(directory)
  let running = await start(directory, ['--npm-registry', 'https://127.0.0.1:1'])
  let request = await administrator(running.origin, directory)
  const server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  const path = `/workspaces/${server.workspaceId}/environments`
  const before = await request<{
    environments: { document: { id: string; packages: Record<string, string> }; revision: string }[]
  }>(path)
  const document = before.environments[0].document
  const base = '@arcadia-eternity/data-pack-base'
  const currentVersion = document.packages[base]
  const operation = await request<{ id: string }>(
    path + '/apply',
    'POST',
    {
      document: { ...document, id: 'custom', name: 'Keep this environment', packages: { [base]: '0.0.1' } },
      expectedRevision: null,
    },
    undefined,
    202,
  )
  await expect
    .poll(async () => (await request<{ status: string }>(`/operations/${operation.id}`)).status, { timeout: 30_000 })
    .toBe('succeeded')
  await stop(running.child)
  for (const id of [document.id, 'custom']) {
    const project = join(directory, 'workspace/environments', id)
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'))
    const pkg = JSON.parse(await readFile(join(project, 'node_modules', base, 'package.json'), 'utf8'))
    manifest.dependencies[base] = '0.0.1'
    lock.packages[''].dependencies[base] = '0.0.1'
    lock.packages['node_modules/' + base].version = '0.0.1'
    pkg.version = '0.0.1'
    await writeFile(join(project, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(project, 'package-lock.json'), JSON.stringify(lock))
    await writeFile(join(project, 'node_modules', base, 'package.json'), JSON.stringify(pkg))
  }
  running = await start(directory, ['--npm-registry', 'https://127.0.0.1:1'])
  request = await administrator(running.origin, directory)
  const after = await request<{
    environments: { document: { id: string; name: string; packages: Record<string, string> } }[]
  }>(path)
  expect(after.environments.map(item => item.document.id).sort()).toEqual(
    [...before.environments.map(item => item.document.id), 'custom'].sort(),
  )
  expect(after.environments.find(item => item.document.id === 'custom')?.document.name).toBe('Keep this environment')
  for (const { document: env } of after.environments) expect(env.packages[base]).toBe(currentVersion)
  expect(await catalog(running.origin)).toHaveLength(2)
}, 90_000)

it('replaces an old base from an external startup project without changing that source', async () => {
  const { cp } = await import('node:fs/promises')
  const { withShippedEnvironmentProject } = await import('@arcadia-eternity/pack-loader/node')
  const root = await mkdtemp(join(tmpdir(), 'arcadia-external-base-upgrade-'))
  directories.push(root)
  const project = join(root, 'project')
  await withShippedEnvironmentProject(resolve('packs/base'), source => cp(source, project, { recursive: true }))
  const base = '@arcadia-eternity/data-pack-base'
  const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'))
  const pkg = JSON.parse(await readFile(join(project, 'node_modules', base, 'package.json'), 'utf8'))
  const version = pkg.version
  manifest.dependencies[base] = '0.0.1'
  lock.packages[''].dependencies[base] = '0.0.1'
  lock.packages['node_modules/' + base].version = '0.0.1'
  pkg.version = '0.0.1'
  await writeFile(join(project, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(project, 'package-lock.json'), JSON.stringify(lock))
  await writeFile(join(project, 'node_modules', base, 'package.json'), JSON.stringify(pkg))
  const running = await start(join(root, 'server'), ['--npm-project', project, '--npm-registry', 'https://127.0.0.1:1'])
  expect(
    (await catalog(running.origin)).find(item => item.isDefault)!.packages.find(item => item.name === base)?.version,
  ).toBe(version)
  expect(JSON.parse(await readFile(join(project, 'package.json'), 'utf8')).dependencies[base]).toBe('0.0.1')
}, 60_000)
