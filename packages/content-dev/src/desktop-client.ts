import { constants, type Stats } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { errorCode, isRecord } from './types.ts'

const instanceId = /^[a-f0-9]{32}$/
const registryProtocol = 'arcadia.player-library/v1'
type Instance = { id: string; label: string; pid: number; port: number; token: string }
export type DesktopServerConfiguration = {
  name: string
  scope: 'local' | 'lan' | 'public'
  port: number
  publicOrigin?: string
}
export type DesktopOperation =
  | { operation: 'describe' }
  | { operation: 'list'; kind: 'pack' | 'environment' }
  | {
      operation: 'install'
      kind: 'pack' | 'environment'
      source: { kind: 'archive'; file: string } | { kind: 'npm'; spec: string }
      offline?: boolean
      environmentId?: string
    }
  | { operation: 'server'; action: 'status' | 'restart' }
  | { operation: 'server'; action: 'stop'; force?: boolean }
  | { operation: 'server'; action: 'start'; configuration?: DesktopServerConfiguration }
  | { operation: 'battle-environment-acquire'; environmentId: string }
  | { operation: 'battle-environment-release'; leaseId: string }
  | { operation: 'workshop'; action: 'registries' }
  | { operation: 'workshop'; action: 'view' | 'refresh'; registry?: string }
  | {
      operation: 'workshop'
      action: 'install'
      registry?: string
      npm: string
      version: string
      environmentId?: string
    }

type Transport = (
  instance: Instance,
  input: DesktopOperation,
  signal?: AbortSignal,
) => Promise<{ status: number; payload: unknown }>
export interface DesktopConnectionOptions {
  signal?: AbortSignal
  directory?: string
  transport?: Transport
}

function privateToUser(info: Stats) {
  return process.platform === 'win32' || (info.uid === process.getuid?.() && (info.mode & 0o077) === 0)
}

async function readInstance(directory: string, id: string): Promise<Instance | undefined> {
  const path = join(directory, id + '.json')
  try {
    const info = await lstat(path)
    if (!info.isFile() || !privateToUser(info)) return
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const current = await handle.stat()
      if (!current.isFile() || !privateToUser(current) || current.size > 8192) return
      const data: unknown = JSON.parse(await handle.readFile('utf8'))
      if (
        !isRecord(data) ||
        data.protocol !== registryProtocol ||
        data.id !== id ||
        typeof data.label !== 'string' ||
        !data.label ||
        data.label.length > 512 ||
        typeof data.port !== 'number' ||
        !Number.isInteger(data.port) ||
        data.port < 1 ||
        data.port > 65535 ||
        typeof data.pid !== 'number' ||
        !Number.isSafeInteger(data.pid) ||
        data.pid < 1 ||
        data.pid > 0x7fffffff ||
        typeof data.token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(data.token)
      )
        return
      try {
        process.kill(data.pid, 0)
      } catch (error) {
        if (errorCode(error) !== 'EPERM') throw error
      }
      return { id, label: data.label, port: data.port, pid: data.pid, token: data.token }
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      ['ENOENT', 'ELOOP', 'ESRCH', 'EPERM', 'EACCES'].includes(errorCode(error) ?? '')
    )
      return
    throw error
  }
}

async function postToOwner(instance: Instance, input: DesktopOperation, signal?: AbortSignal) {
  const timeout = {
    describe: 2500,
    list: 30_000,
    install: 15 * 60_000,
    server: input.operation === 'server' && input.action === 'status' ? 30_000 : undefined,
    'battle-environment-acquire': 120_000,
    'battle-environment-release': 10_000,
    workshop: input.operation === 'workshop' && input.action === 'install' ? 15 * 60_000 : 90_000,
  }[input.operation]
  const deadline = timeout === undefined ? signal : AbortSignal.timeout(timeout)

  const response = await new Promise<IncomingMessage>((accept, reject) => {
    // A fresh direct connection keeps local credentials out of HTTP proxy settings.
    const outgoing = httpRequest(
      {
        hostname: '127.0.0.1',
        port: instance.port,
        path: '/v1/player-library',
        method: 'POST',
        agent: false,
        headers: { Authorization: 'Bearer ' + instance.token, 'Content-Type': 'application/json' },
        signal: signal && deadline && deadline !== signal ? AbortSignal.any([signal, deadline]) : deadline,
      },
      accept,
    )
    outgoing.once('error', reject)
    outgoing.end(JSON.stringify(input))
  })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    size += chunk.length
    if (size > 8 * 1024 * 1024) throw new Error('The desktop library response exceeds 8 MiB.')
    chunks.push(chunk)
  }
  return {
    status: response.statusCode ?? 500,
    payload: JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as unknown,
  }
}

async function request(instance: Instance, input: DesktopOperation, transport: Transport, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const { status, payload } = await transport(instance, input, signal)
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === 'string') {
    const message = typeof payload.error.message === 'string' ? ': ' + payload.error.message : ''
    throw Object.assign(new Error(payload.error.code + message), { code: payload.error.code })
  }
  if (status < 200 || status >= 300 || !isRecord(payload) || !isRecord(payload.result))
    throw new Error('The desktop instance returned an invalid response.')
  return payload.result
}

async function liveInstances(
  requested: string | undefined,
  {
    directory = join(homedir(), '.arcadia', 'player-libraries'),
    transport = postToOwner,
    signal,
  }: DesktopConnectionOptions,
) {
  signal?.throwIfAborted()
  if (requested !== undefined && !instanceId.test(requested))
    throw Object.assign(new Error('Invalid desktop instance id.'), { code: 'DESKTOP_INSTANCE_INVALID' })
  const info = await lstat(directory).catch(error => {
    if (errorCode(error) !== 'ENOENT') throw error
  })
  if (!info) return []
  if (!info.isDirectory() || !privateToUser(info))
    throw new Error('The desktop instance directory must be private to your user.')
  const ids = requested
    ? [requested]
    : (await readdir(directory))
        .filter(name => /^[a-f0-9]{32}\.json$/.test(name))
        .map(name => name.slice(0, -5))
        .sort()
  const live = await Promise.all(
    ids.map(async id => {
      const entry = await readInstance(directory, id)
      if (!entry) return
      try {
        const result = await request(entry, { operation: 'describe' }, transport, signal)
        if (result.id === id && result.label === entry.label) return entry
      } catch {
        // A descriptor can outlive an application that exited unexpectedly.
      }
    }),
  )
  signal?.throwIfAborted()
  return live.filter((instance): instance is Instance => instance !== undefined)
}

/** Discover responsive players without exposing their private connection credentials. */
export async function listDesktopInstances(options: DesktopConnectionOptions = {}) {
  return (await liveInstances(undefined, options)).map(({ id, label }) => ({ id, label }))
}

/** Bind each request to one running player. The captured credential never leaves the client. */
export async function connectDesktopInstance(id?: string, options: DesktopConnectionOptions = {}) {
  const instances = await liveInstances(id, options)
  if (!instances.length)
    throw Object.assign(
      new Error('No matching running desktop instance. Start the player and list desktop instances.'),
      { code: 'DESKTOP_INSTANCE_NOT_FOUND' },
    )
  if (instances.length !== 1)
    throw Object.assign(new Error('Multiple desktop instances are running. Choose one with --instance <id>.'), {
      code: 'DESKTOP_INSTANCE_AMBIGUOUS',
    })
  const [instance] = instances
  return {
    id: instance.id,
    label: instance.label,
    request: (operation: DesktopOperation, { signal = options.signal }: { signal?: AbortSignal } = {}) =>
      request(instance, operation, options.transport ?? postToOwner, signal),
  }
}
