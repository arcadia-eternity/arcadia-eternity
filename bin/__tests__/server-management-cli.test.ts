import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { openStorage } from '@arcadia-eternity/database'
import { ContentWorkspace } from '@arcadia-eternity/content-dev/management-workspace'
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
  effectiveVersionId?: string
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
  const { stdout } = await execute(process.execPath, [cli, 'server', ...args], { env, timeout: 20_000 })
  return JSON.parse(stdout.trim())
}
async function start(directory: string) {
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
    }, 20_000)
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
  return async <T>(path: string, method = 'GET', body?: unknown, revision?: number): Promise<T> => {
    const result = await fetch(origin + '/api/management/v1' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: adminOrigin,
        Cookie: cookie,
        'X-CSRF-Token': csrfToken,
        ...(revision === undefined ? {} : { 'If-Match': String(revision) }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    expect(result.status, `${method} ${path}`).toBe(200)
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

it('bootstraps playable builtin content once and preserves administrator removal across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-cli-first-publication-'))
  directories.push(directory)
  let running = await start(directory)
  let request = await administrator(running.origin, directory)
  let server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  let binding = (await request<{ bindings: Binding[] }>(`/servers/${server.id}/bindings`)).bindings[0]
  expect(binding).toMatchObject({
    enabled: true,
    visibility: 'public',
    matchmakingEnabled: true,
    condition: 'available',
  })
  expect(binding.effectiveVersionId).toBeTruthy()
  expect(server.defaultBindingId).toBe(binding.id)
  const initial = {
    serverId: server.id,
    workspaceId: server.workspaceId,
    bindingId: binding.id,
    versionId: binding.effectiveVersionId,
  }
  const environments = await catalog(running.origin)
  expect(environments).toHaveLength(1)
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
  await accepted(socket, 'joinMatchmaking', { playerSchema: { team } })
  expect(await accepted(socket, 'getServerState')).toMatchObject({ matchmakingQueue: 1 })
  await accepted(socket, 'cancelMatchmaking')
  expect(await accepted(socket, 'getServerState')).toMatchObject({ matchmakingQueue: 0 })
  socket.disconnect()
  sockets.delete(socket)
  await stop(running.child)

  running = await start(directory)
  request = await administrator(running.origin, directory)
  server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  binding = (await request<{ bindings: Binding[] }>(`/servers/${server.id}/bindings`)).bindings[0]
  expect({
    serverId: server.id,
    workspaceId: server.workspaceId,
    bindingId: binding.id,
    versionId: binding.effectiveVersionId,
  }).toEqual(initial)
  expect(server.defaultBindingId).toBe(binding.id)
  const restartedEnvironments = await catalog(running.origin)
  expect(restartedEnvironments).toHaveLength(1)
  expect(restartedEnvironments[0]).toMatchObject({
    runtime: environments[0].runtime,
    packages: environments[0].packages,
    resourceRevision: environments[0].resourceRevision,
    executionPolicy: environments[0].executionPolicy,
  })

  await request(`/servers/${server.id}`, 'PATCH', { defaultBindingId: null }, server.revision)
  await stop(running.child)
  running = await start(directory)
  request = await administrator(running.origin, directory)
  server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  expect(server.defaultBindingId).toBeUndefined()
  binding = (await request<{ bindings: Binding[] }>(`/servers/${server.id}/bindings`)).bindings[0]
  await request(`/servers/${server.id}/bindings/${binding.id}`, 'PATCH', { enabled: false }, binding.revision)
  await stop(running.child)

  running = await start(directory)
  request = await administrator(running.origin, directory)
  server = (await request<{ servers: Server[] }>('/servers')).servers[0]
  binding = (await request<{ bindings: Binding[] }>(`/servers/${server.id}/bindings`)).bindings[0]
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

it('does not auto-publish an existing managed server without bootstrap provenance', async () => {
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
    expect((await request<{ bindings: Binding[] }>(`/servers/${server.id}/bindings`)).bindings).toEqual([])
    expect(await catalog(running.origin)).toEqual([])
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
  const originalBinding = (await originalRequest<{ bindings: Binding[] }>(`/servers/${identity}/bindings`)).bindings[0]
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
    expect(server.id).toBe(result.serverId)
    expect(bindings).toHaveLength(1)
    expect(server.defaultBindingId).toBe(bindings[0].id)
    expect(bindings[0]).toMatchObject({
      enabled: true,
      visibility: 'public',
      matchmakingEnabled: true,
      condition: 'available',
    })
    if (mode === 'clone') {
      expect(server.workspaceId).not.toBe(originalServer.workspaceId)
      expect(bindings[0].id).not.toBe(originalBinding.id)
      expect(bindings[0].effectiveVersionId).not.toBe(originalBinding.effectiveVersionId)
    } else {
      expect(server.workspaceId).toBe(originalServer.workspaceId)
      expect(bindings[0].id).toBe(originalBinding.id)
      expect(bindings[0].effectiveVersionId).toBe(originalBinding.effectiveVersionId)
    }
    expect(await catalog(running.origin)).toHaveLength(1)
    await stop(running.child)
  }
}, 90_000)
