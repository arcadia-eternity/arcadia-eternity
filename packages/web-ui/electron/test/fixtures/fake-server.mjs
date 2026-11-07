import { createServer } from 'node:http'
import { basename } from 'node:path'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
const project = basename(option('--npm-project'))
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
  await writeFile(join(option('--npm-project'), 'cache-marker'), process.env.ARCADIA_DESKTOP_TEMP)
  if (project === 'runtime-paths')
    await writeFile(
      join(option('--npm-project'), 'runtime-paths.json'),
      JSON.stringify({
        npmCliPath: process.env.ARCADIA_NPM_CLI,
        packsDirectory: process.env.ARCADIA_PACKS_DIR,
      }),
    )
  process.once('exit', () => writeFileSync(join(option('--npm-project'), 'clean-exit'), 'yes'))
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ serverId }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  if (managed)
    process.send({ type: 'arcadia.desktop.listener', serverId, host: '127.0.0.1', port: server.address().port })
  console.log(`Battle server ${serverId} listening on port ${server.address().port}`)
  let current = { id: 'initial', packages: [{ name: 'test' }] }
  const environments = new Map([
    [current.id, current],
    ['base', { id: 'base', packages: [] }],
  ])
  process.on('message', async message => {
    if (message?.type !== 'arcadia.desktop.content') return
    const reply = (ok, value) => {
      if (process.connected) process.send({ type: 'arcadia.desktop.content.result', id: message.id, ok, value })
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
      environments.set(value.id, value)
      return reply(true, value)
    }
    if (message.action === 'select' && environments.has(message.environmentId)) {
      const previous = current
      current = environments.get(message.environmentId)
      return reply(true, previous)
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
