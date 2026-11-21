import { constants, type Stats } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { errorCode, isRecord } from './types.ts'
import { desktopHelp as usage } from './command-discovery.ts'

const instanceId = /^[a-f0-9]{32}$/
const registryProtocol = 'arcadia.player-library/v1'
type Instance = { id: string; label: string; pid: number; port: number; token: string }
type Operation = { operation: 'describe' | 'list' | 'install'; [key: string]: unknown }
type Transport = (instance: Instance, input: Operation) => Promise<{ status: number; payload: unknown }>
interface Options {
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

async function postToOwner(instance: Instance, input: Operation) {
  const timeout = { describe: 2500, list: 30_000, install: 15 * 60_000 }[input.operation]
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
        signal: AbortSignal.timeout(timeout),
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

async function request(instance: Instance, input: Operation, transport: Transport) {
  const { status, payload } = await transport(instance, input)
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === 'string') {
    const message = typeof payload.error.message === 'string' ? ': ' + payload.error.message : ''
    throw new Error(payload.error.code + message)
  }
  if (status < 200 || status >= 300 || !isRecord(payload) || !isRecord(payload.result))
    throw new Error('The desktop instance returned an invalid response.')
  return payload.result
}

async function liveInstances(directory: string, requested: string | undefined, transport: Transport) {
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
        const result = await request(entry, { operation: 'describe' }, transport)
        if (result.id === id && result.label === entry.label) return entry
      } catch {
        // A descriptor can outlive an application that exited unexpectedly.
      }
    }),
  )
  return live.filter((instance): instance is Instance => instance !== undefined)
}

async function installSource(value: string, kind: 'pack' | 'environment') {
  // A valid npm prerelease or build tag may itself end in .tgz or .zip.
  const { parseAuthorEnvironmentNpmSpec } = await import('./author-environment-source.ts')
  try {
    parseAuthorEnvironmentNpmSpec(value)
    return { kind: 'npm', spec: value }
  } catch (error) {
    if (!/\.(?:tgz|zip)$/i.test(value)) throw error
  }
  if (kind === 'environment' && /\.zip$/i.test(value)) throw new Error('Select a .tgz environment archive.')
  const file = resolve(value)
  if (!(await lstat(file)).isFile()) throw new Error('Select a regular archive file.')
  return { kind: 'archive', file }
}

export async function desktopCommand(
  args: string[],
  { directory = join(homedir(), '.arcadia', 'player-libraries'), transport = postToOwner }: Options = {},
) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      instance: { type: 'string' },
      id: { type: 'string' },
      'allow-download': { type: 'boolean' },
    },
  })
  const [group, operation, source] = positionals
  const discovery = group === 'instances' && positionals.length === 1 && Object.keys(values).length === 0
  const installing = operation === 'install'
  if (
    !discovery &&
    ((group !== 'packages' && group !== 'environments') ||
      (installing ? positionals.length !== 3 : operation !== 'list' || positionals.length !== 2) ||
      (values.id !== undefined &&
        (!installing ||
          group !== 'environments' ||
          !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(values.id) ||
          values.id === 'default')) ||
      (!installing && values['allow-download']) ||
      (values.instance !== undefined && !instanceId.test(values.instance)))
  )
    throw new Error(usage)
  const entries = await liveInstances(directory, values.instance, transport)
  if (discovery) return { instances: entries.map(({ id, label }) => ({ id, label })) }
  if (!entries.length)
    throw new Error('No matching running desktop instance. Start the player and run arcadia-content desktop instances.')
  if (entries.length !== 1)
    throw new Error(
      'Multiple desktop instances are running. Choose one with --instance <id> from arcadia-content desktop instances.',
    )
  const [instance] = entries
  const kind = group === 'packages' ? 'pack' : 'environment'
  if (!installing) {
    const result = await request(instance, { operation: 'list', kind }, transport)
    if (!Array.isArray(result[group])) throw new Error('The desktop instance returned an invalid library listing.')
    return group === 'packages'
      ? { packages: result.packages }
      : { environments: result.environments, selectedEnvironmentId: result.selectedEnvironmentId }
  }
  return request(
    instance,
    {
      operation: 'install',
      kind,
      source: await installSource(source, kind),
      offline: !values['allow-download'],
      ...(values.id && { environmentId: values.id }),
    },
    transport,
  )
}

export async function desktopCli(args: string[]) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) console.log(usage)
  else console.log(JSON.stringify(await desktopCommand(args)))
}
