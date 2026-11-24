import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { basename, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'

type ContentCommand = { type: 'arcadia.desktop.content'; id: string } & (
  | { action: 'management'; request: { path: string } }
  | { action: 'prepare'; directory?: string; builtinOnly?: boolean }
  | { action: 'select' | 'retire'; environmentId: string }
  | { action: 'retained' | 'describe' }
)

const args = process.argv.slice(2)
const option = (name: string) => args[args.indexOf(name) + 1]
const [{ directory }] = await once(process, 'message')
const project = basename(directory)
const managed = args.includes('--desktop-managed-network')
if (
  args[0] !== 'server' ||
  (managed ? !args.includes('--desktop-origin') : option('--host') !== '127.0.0.1' || option('--port') !== '0')
)
  throw new Error('invalid listener')
if (process.env.DESKTOP_TEST_SECRET || process.env.NODE_OPTIONS || !process.env.npm_config_userconfig)
  throw new Error('credentials leaked')
if (project === 'refuse') {
  console.error('secret data that must not be returned')
  process.exit(8)
}
if (project === 'occupied-listener' && managed && !args.includes('--host')) {
  console.error('Error: EADDRINUSE private listener path')
  process.exit(8)
}
if (project === 'unapproved') {
  console.error('private path: Expected an explicit npm project approval')
  process.exitCode = 8
} else {
  if (project === 'slow') await new Promise(resolve => setTimeout(resolve, 5000))
  const serverId = option('--server-id')
  const cache = process.env.ARCADIA_DESKTOP_TEMP
  assert.ok(cache)
  await writeFile(join(directory, 'cache-marker'), cache)
  if (project === 'runtime-paths')
    await writeFile(
      join(directory, 'runtime-paths.json'),
      JSON.stringify({
        npmCliPath: process.env.ARCADIA_NPM_CLI,
        packsDirectory: process.env.ARCADIA_PACKS_DIR,
      }),
    )
  process.once('exit', () => writeFileSync(join(directory, 'clean-exit'), 'yes'))
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ serverId }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  if (managed) process.send?.({ type: 'arcadia.desktop.listener', serverId, host: '127.0.0.1', port: address.port })
  console.log(`Battle server ${serverId} listening on port ${address.port}`)
  let current = { id: 'initial', packages: [{ name: 'test' }] }
  const environments = new Map([
    [current.id, current],
    ['base', { id: 'base', packages: [] }],
  ])
  process.on('message', async (message: ContentCommand | undefined) => {
    if (message?.type !== 'arcadia.desktop.content') return
    const reply = (ok: boolean, value?: unknown) => {
      if (process.connected) process.send?.({ type: 'arcadia.desktop.content.result', id: message.id, ok, value })
    }
    if (message.action === 'retained') return reply(true, [...environments.keys()])
    if (message.action === 'management' && message.request.path.endsWith('/drain'))
      return reply(true, { status: 200, body: { draining: true, activeBattles: project === 'active-battle' ? 1 : 0 } })
    if (message.action === 'management')
      return reply(true, { status: 200, body: { serverId, request: message.request } })
    if (message.action === 'describe') return reply(true, current)
    if (message.action === 'prepare') {
      if (message.directory?.endsWith('bad-control')) return reply(false)
      if (message.directory?.endsWith('held-control')) await new Promise(resolve => setTimeout(resolve, 2000).unref())
      const value = message.builtinOnly
        ? environments.get('base')
        : { id: message.directory?.includes('reuse-id-') ? 'reused' : message.directory, packages: [{ name: 'next' }] }
      assert.ok(value && value.id !== undefined)
      const { id, packages } = value
      environments.set(id, { id, packages })
      return reply(true, value)
    }
    if (message.action === 'select') {
      const selected = environments.get(message.environmentId)
      if (selected) {
        const previous = current
        current = selected
        return reply(true, previous)
      }
    }
    if (message.action === 'retire' && message.environmentId !== current.id) {
      environments.delete(message.environmentId)
      return reply(true, null)
    }
    reply(false)
  })
  if (project === 'crash') setTimeout(() => process.exit(7), 100)
  process.once('SIGTERM', () => server.close())
}
