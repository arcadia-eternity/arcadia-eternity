import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const execute = promisify(execFile)
const cli = resolve('dist/cli.js')
const directories: string[] = []
const children = new Set<ChildProcess>()
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
    [cli, 'server', '--headless', '--host', '127.0.0.1', '--port', '0', '--data-dir', directory],
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
  await Promise.all([...children].map(stop))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

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
  await stop(second.child)
  const backup = join(root, 'backup.json')
  await command(['backup', 'create', '--data-dir', directory, '--file', backup])
  const clone = await command(['backup', 'clone', '--file', backup, '--target', join(root, 'clone')])
  expect(clone.serverId).not.toBe(identity)
  const restored = await command(['backup', 'restore', '--file', backup, '--target', join(root, 'restored')])
  expect(restored.serverId).toBe(identity)
}, 90_000)
