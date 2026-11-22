import { createHash, randomUUID } from 'node:crypto'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { openStorage } from '@arcadia-eternity/database'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import type { ServerEnvironmentDescriptor, ServerSession } from '@arcadia-eternity/protocol'
import { afterEach, expect, it, vi } from 'vitest'

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
  ARCADIA_BASE_PACK_AUTO_UPDATE: '0',
  STORAGE_DRIVER: 'sqlite',
  DOTENV_CONFIG_PATH: '/dev/null',
}
async function command(args: string[]) {
  const { stdout } = await execute(process.execPath, [cli, 'server', ...args], { env, timeout: 60_000 })
  return JSON.parse(stdout.trim())
}
async function start(directory: string, extra: string[] = [], preload?: string) {
  const child = spawn(
    process.execPath,
    [
      ...(preload ? ['--import', preload] : []),
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
    {
      env: preload ? { ...env, ARCADIA_BASE_PACK_AUTO_UPDATE: '1' } : env,
      stdio: preload ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    },
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
  for (const id of [binding.environmentId, 'training-120']) {
    const project = join(directory, 'workspace', 'environments', id)
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    const receipt = JSON.parse(await readFile(join(project, '.arcadia-prepared.json'), 'utf8'))
    manifest.arcadiaEnvironment.rules = receipt.document.rules = { schemaVersion: 2, include: ['base:classic'] }
    manifest.dependencies['@arcadia-eternity/data-pack-base'] = '0.0.0-stale'
    await writeFile(join(project, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    await writeFile(join(project, '.arcadia-prepared.json'), JSON.stringify(receipt))
  }

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
    mechanics: {
      individualValues: { max: 31 },
      inheritance: { eligible: 'species' },
      secondGenerationNatures: 'species',
    },
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

it('repairs official installations on restart and preserves a custom base pin offline', async () => {
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
      document: { ...document, id: 'custom', name: 'Keep this environment', packages: { [base]: currentVersion } },
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
  for (const { document: env } of after.environments)
    expect(env.packages[base]).toBe(env.id === 'custom' ? '0.0.1' : currentVersion)
  expect(await catalog(running.origin)).toHaveLength(2)
}, 90_000)

it('starts the exact base in an external npm project offline', async () => {
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
  ).toBe('0.0.1')
  expect(JSON.parse(await readFile(join(project, 'package.json'), 'utf8')).dependencies[base]).toBe('0.0.1')
}, 60_000)

async function officialReleaseFixture() {
  const { withShippedCatalogArchive, withShippedEnvironmentProject } =
    await import('@arcadia-eternity/pack-loader/node')
  const root = await mkdtemp(join(tmpdir(), 'arcadia-server-pack-update-'))
  directories.push(root)
  const name = '@arcadia-eternity/data-pack-base'
  const version = '90.0.0'
  const url = 'https://registry.npmjs.org/' + name + '/-/data-pack-base-' + version + '.tgz'
  const source = join(root, 'source')
  await withShippedEnvironmentProject(resolve('packs/base'), project =>
    cp(join(project, 'node_modules', name), source, { recursive: true }),
  )
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  const shipped = manifest.version
  manifest.version = version
  manifest.engines = { arcadia: '*' }
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest))
  const recipes: Record<string, unknown> = {}
  for (const suffix of ['default', 'training-120']) {
    const recipe = JSON.parse(await readFile(resolve('packs/environment-' + suffix, 'package.json'), 'utf8'))
    recipe.version = version
    recipe.dependencies = { [name]: version }
    if (suffix === 'training-120') recipe.arcadiaEnvironment.name = '120 联动发行测试'
    recipes['https://registry.npmjs.org/' + encodeURIComponent(recipe.name) + '/' + version] = recipe
  }
  const effectsFile = join(source, manifest.arcadia.effectArtifact)
  const artifact = JSON.parse(await readFile(effectsFile, 'utf8'))
  artifact.source += '\n// independent official release\n'
  await writeFile(effectsFile, JSON.stringify(artifact))
  const bytes = await withShippedCatalogArchive(source, undefined, file => readFile(file))
  const archive = join(root, 'package.tgz')
  await writeFile(archive, bytes)
  const metadata = {
    name,
    'dist-tags': { latest: version },
    versions: {
      [version]: {
        version,
        engines: manifest.engines,
        dist: { tarball: url, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') },
      },
    },
  }
  return { root, name, source, manifest, artifact, shipped, version, url, bytes, archive, metadata, recipes }
}

it('requires both same-version environment manifests and restarts from the complete cached release offline', async () => {
  const { root, name, version, url, bytes, metadata, recipes } = await officialReleaseFixture()
  const { serverBase, serverOfficialEnvironments, shippedBaseRoot, updateRunningServerBase } =
    await import('../server-base-pack')
  const data = join(root, 'state')
  const initial = await serverBase(data)
  const signal = AbortSignal.timeout(60000)
  const trainingUrl = Object.keys(recipes).find(url => url.includes('training-120'))!
  let wrongVersion = true
  const registry = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const request = String(input)
    if (request === url) return new Response(new Uint8Array(bytes))
    if (wrongVersion && request === trainingUrl)
      return Response.json({ name: '@arcadia-eternity/environment-training-120', version: '1.0.0' })
    return Response.json(recipes[request] ?? metadata)
  })
  const activate = vi.fn(async (directory: string) => {
    await serverOfficialEnvironments(directory)
  })
  try {
    await expect(updateRunningServerBase(data, initial, activate, signal)).rejects.toThrow(
      'OFFICIAL_ENVIRONMENT_PACKAGE_MISMATCH',
    )
    expect(activate).not.toHaveBeenCalled()
    expect((await serverBase(data)).directory).toBe(shippedBaseRoot())
    wrongVersion = false
    await updateRunningServerBase(data, initial, activate, signal)
    registry.mockImplementation(async () => {
      throw new Error('registry offline')
    })
    const selection = await serverBase(data)
    expect(selection.version).toBe(version)
    const { environments } = await serverOfficialEnvironments(selection.directory)
    expect(environments.map(doc => doc.packages[name])).toEqual([version, version])
    expect(environments.find(doc => doc.id === 'training-120')?.name).toBe('120 联动发行测试')
  } finally {
    registry.mockRestore()
  }
}, 60000)

it('restores the previous official base when live activation fails and keeps the failed version out of startup selection', async () => {
  const { root, shipped, version, url, bytes, metadata, recipes } = await officialReleaseFixture()
  const { serverBase, shippedBaseRoot, updateRunningServerBase } = await import('../server-base-pack')
  const data = join(root, 'state')
  const registry = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async input =>
      String(input) === url ? new Response(new Uint8Array(bytes)) : Response.json(recipes[String(input)] ?? metadata),
    )
  const activated: string[] = []
  try {
    await expect(
      updateRunningServerBase(
        data,
        { directory: shippedBaseRoot(), version: shipped },
        async directory => {
          const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
          activated.push(pkg.version)
          if (pkg.version === version) throw new Error('second binding unavailable')
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('second binding unavailable')
    expect(activated).toEqual([version, shipped])
    expect((await serverBase(data)).version).toBe(shipped)
  } finally {
    registry.mockRestore()
  }
}, 60000)

it('hot-updates both official presets in the background, preserves a live room, and respects offline and pinned starts', async () => {
  const { root, name, source, manifest, artifact, shipped, version, url, bytes, archive, metadata, recipes } =
    await officialReleaseFixture()
  const data = join(root, 'state')
  const preload = join(root, 'registry.mjs')
  await writeFile(
    preload,
    `
    import { readFile, appendFile } from 'node:fs/promises'
    import { once } from 'node:events'
    globalThis.fetch = async url => {
      if (process.env.ARCADIA_BASE_PACK_AUTO_UPDATE === '1') {
        const gate = String(url) === ${JSON.stringify(url)} ? once(process, 'message') : undefined
        await appendFile(${JSON.stringify(join(root, 'requests'))}, String(url) + '\\n')
        await gate
      }
      const recipes = ${JSON.stringify(recipes)}
      if (Object.hasOwn(recipes, String(url))) return Response.json(recipes[String(url)])
      if (String(url) === ${JSON.stringify(url)}) return new Response(await readFile(${JSON.stringify(archive)}))
      if (String(url) === ${JSON.stringify('https://registry.npmjs.org/' + encodeURIComponent(name))}) return Response.json(${JSON.stringify(metadata)})
      throw new Error('Unexpected request: ' + url)
    }
  `,
  )
  const update = (action: string) =>
    execute(process.execPath, ['--import', preload, cli, 'server', 'base-pack', action, '--data-dir', data], { env })
  expect(JSON.parse((await update('check')).stdout)).toMatchObject({
    installedVersion: shipped,
    availableVersion: version,
  })
  await writeFile(archive, 'incomplete')
  await expect(update('update')).rejects.toThrow(/SOURCE_INTEGRITY_MISMATCH/)
  let running = await start(data, [], preload)
  await vi.waitFor(
    async () => {
      expect((await readFile(join(root, 'requests'), 'utf8')).trim().split('\n')).toContain(url)
    },
    { timeout: 30000, interval: 100 },
  )
  const initial = await catalog(running.origin)
  expect(initial.map(item => item.packages[0].version)).toEqual([shipped, shipped])
  const socket = await guest(running.origin)
  const room = await accepted<{ roomCode: string }>(socket, 'createPrivateRoom', { config: { battleMode: 'server' } })
  await writeFile(archive, bytes)
  running.child.send('complete-download')
  await vi.waitFor(
    async () => {
      const published = await catalog(running.origin)
      expect(published.map(item => item.packages[0].version)).toEqual([version, version])
    },
    { timeout: 40000, interval: 200 },
  )
  expect(await accepted(socket, 'getPrivateRoomInfo', { roomCode: room.roomCode })).toMatchObject({
    environment: { id: initial.find(item => item.isDefault)!.id },
  })
  await accepted(socket, 'leavePrivateRoom')
  await vi.waitFor(() => readFile(join(data, 'official-base', version, '.arcadia-release-digest')), { timeout: 10000 })
  await stop(running.child)
  expect(JSON.parse((await update('update')).stdout)).toMatchObject({
    installedVersion: version,
    availableVersion: null,
  })
  running = await start(data, ['--offline-content'], preload)
  const environments = await catalog(running.origin)
  expect(environments.length).toBe(2)
  expect(environments.find(item => item.environmentId === 'training-120')).toMatchObject({
    environmentName: '120 联动发行测试',
  })
  expect(environments.every(item => item.packages.some(pkg => pkg.name === name && pkg.version === version))).toBe(true)
  await stop(running.child)
  const requests = await readFile(join(root, 'requests'), 'utf8')
  running = await start(data, ['--base-pack-version', 'bundled'], preload)
  expect((await catalog(running.origin)).map(item => item.packages[0].version)).toEqual([shipped, shipped])
  expect(await readFile(join(root, 'requests'), 'utf8')).toBe(requests)
  const { serverOfficialMaterials, shippedBaseRoot } = await import('../server-base-pack')
  const { ServerEnvironmentRegistry } = await import('@arcadia-eternity/server')
  const { withShippedEnvironmentProject } = await import('@arcadia-eternity/pack-loader/node')
  const registry = new ServerEnvironmentRegistry(undefined, await serverOfficialMaterials(data, shippedBaseRoot()))
  try {
    await withShippedEnvironmentProject(source, async project => {
      const approve = { policy: { profile: 'official' as const } }
      expect((await registry.prepareNpm(project, approve)).packages[0]?.version).toBe(version)
      const file = join(project, 'node_modules', name, manifest.arcadia.effectArtifact)
      artifact.source += '\n// unrecognized same-version materials\n'
      await writeFile(file, JSON.stringify(artifact))
      await expect(registry.prepareNpm(project, approve)).rejects.toThrow('THIRD_PARTY_EXECUTION_FORBIDDEN')
    })
  } finally {
    await registry.stop()
  }
}, 120_000)
