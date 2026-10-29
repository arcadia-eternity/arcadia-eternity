import { test } from 'node:test'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContentLibrary } from '../content-library.mjs'
import { LocalBattleHost } from '../local-battle-host.mjs'
import { runContentCommand } from '../content-projects.mjs'

const exec = promisify(execFile)
const { io } = createRequire(new URL('../../../server/package.json', import.meta.url))('socket.io-client')
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
test(
  'real package choices converge without restart while existing rooms keep their runtime',
  {
    timeout: 120000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-library-real-'))
    const host = new LocalBattleHost({
      executable: process.execPath,
      cli: resolve(repository, 'dist/cli.js'),
      rendererOrigin: 'http://localhost:5173',
      startupTimeoutMs: 40000,
      shutdownTimeoutMs: 3000,
    })
    const runtime = { ...host, npmCacheDirectory: join(root, 'npm-cache') }
    const library = new ContentLibrary({
      root: join(root, 'library'),
      host,
      run: (args, signal) => runContentCommand(runtime, args, signal),
    })
    const sockets = []
    const ack = (socket, event, data) =>
      new Promise((resolve, reject) => {
        const done = (error, reply) => {
          if (error) reject(error)
          else if (reply.status !== 'SUCCESS') reject(new Error(reply.code))
          else resolve(reply.data)
        }
        if (data === undefined) socket.timeout(5000).emit(event, done)
        else socket.timeout(5000).emit(event, data, done)
      })
    const settled = async () => {
      for (let i = 0; i < 600; i++) {
        const snapshot = await library.list()
        if (snapshot.selection.status === 'failed') throw new Error(snapshot.selection.message)
        if (snapshot.selection.status === 'ready') return snapshot
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Content did not become ready')
    }
    const connect = async url => {
      const response = await fetch(url + '/api/v1/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { id: 'local-test', name: 'local-test' } }),
      })
      assert.equal(response.status, 201)
      const session = await response.json()
      const socket = io(url, {
        auth: { token: session.token },
        transports: ['websocket'],
        reconnection: false,
        autoConnect: false,
      })
      sockets.push(socket)
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('connect_error', reject)
        socket.connect()
      })
      return socket
    }
    try {
      const packed = await exec(
        'npm',
        ['pack', './examples/ugc/slow', '--json', '--ignore-scripts', '--pack-destination', root],
        { cwd: repository },
      )
      const tarball = join(root, JSON.parse(packed.stdout)[0].filename)
      const id = await library.installFile(tarball, true)
      const installed = await settled()
      assert.deepEqual(installed.desiredIds, [id])
      assert.deepEqual(installed.activeIds, [id])
      const ready = host.status()
      assert.equal(ready.status, 'running')
      const catalogue = async () => (await (await fetch(ready.url + '/api/v1/environments')).json()).environments
      const custom = (await catalogue()).find(env => env.packages.some(pkg => pkg.name === '@arcadia-example/slow'))
      assert.ok(custom)
      const content = await (await fetch(ready.url + '/api/v1/environments/' + custom.id + '/content')).json()
      assert.ok(content.species.some(pet => pet.id === 'example-slow:pet'))
      const first = await connect(ready.url)
      await ack(first, 'createPrivateRoom', { config: { battleMode: 'server' } })
      assert.equal((await ack(first, 'getCurrentPrivateRoom')).environment.id, custom.id)
      t.diagnostic('Real tarball was inspected, admitted, composed, validated and served')
      await library.setSelection([], true)
      const official = await settled()
      assert.deepEqual(official.activeIds, [])
      assert.equal(host.status().serverId, ready.serverId)
      assert.equal(host.status().url, ready.url)
      assert.equal(official.serviceNeedsRestart, false)
      assert.equal((await ack(first, 'getCurrentPrivateRoom')).environment.id, custom.id)
      assert.equal((await fetch(ready.url + '/api/v1/environments/' + custom.id + '/content')).status, 200)
      const second = await connect(ready.url)
      await ack(second, 'createPrivateRoom', { config: { battleMode: 'server' } })
      assert.equal((await ack(second, 'getCurrentPrivateRoom')).environment.packages.length, 0)
      assert.ok((await catalogue()).every(env => !env.packages.some(pkg => pkg.name === '@arcadia-example/slow')))
      await library.uninstall(id)
      assert.ok(await readFile(tarball))
      await ack(first, 'leavePrivateRoom')
      assert.equal((await fetch(ready.url + '/api/v1/environments/' + custom.id + '/content')).status, 404)
      t.diagnostic(
        'Same process and URL; old room retained custom content and a new room received official-only content',
      )
    } finally {
      for (const socket of sockets) socket.disconnect()
      await library.close()
      await host.stop()
      await rm(root, { recursive: true, force: true })
    }
  },
)
