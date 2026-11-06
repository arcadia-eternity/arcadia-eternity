import { test } from 'node:test'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContentWorkspace } from '../../../content-dev/src/content-workspace.mjs'
import { DesktopWorkspaceOwner } from '../desktop-workspace-owner.mjs'
import { ContentLibrary } from '../content-library.mjs'
import { LocalBattleHost } from '../local-battle-host.mjs'
import { runContentCommand } from '../content-projects.mjs'

const exec = promisify(execFile)
const { io } = createRequire(new URL('../../../server/package.json', import.meta.url))('socket.io-client')
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
test(
  'real local selection and hosted environment remain independent without reinstalling content',
  {
    timeout: 120000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-library-real-'))
    let owner
    const host = new LocalBattleHost({
      executable: process.execPath,
      cli: resolve(repository, 'dist/cli.js'),
      rendererOrigin: 'http://localhost:5173',
      workspaceRoot: join(root, 'library'),
      attachWorkspace: child => owner.attach(child),
      startupTimeoutMs: 40000,
      shutdownTimeoutMs: 3000,
    })
    const runtime = { ...host, npmCacheDirectory: join(root, 'npm-cache') }
    const library = new ContentLibrary({
      root: join(root, 'library'),
      host,
      run: (args, signal) => runContentCommand(runtime, args, signal),
    })
    owner = new DesktopWorkspaceOwner({ root: join(root, 'library'), library, openWorkspace: ContentWorkspace.open })
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
      assert.deepEqual((await library.list()).desiredIds, [])
      await library.setSelection([id], true)
      const installed = await settled()
      assert.deepEqual(installed.desiredIds, [id])
      assert.deepEqual(installed.activeIds, [id])
      assert.equal(host.status().status, 'idle')
      const localProject = await library.acquireProject()
      await library.start() // User explicitly chooses to host the same already installed material.
      assert.equal(host.projectDirectory(), localProject.directory)
      await localProject.release()
      const ready = host.status()
      assert.equal(ready.status, 'running')
      const customDirectory = host.projectDirectory()
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
      assert.ok((await host.retainedProjectDirectories()).includes(customDirectory))
      assert.ok(await readFile(join(customDirectory, 'package.json')))
      const second = await connect(ready.url)
      await ack(second, 'createPrivateRoom', { config: { battleMode: 'server' } })
      assert.equal((await ack(second, 'getCurrentPrivateRoom')).environment.id, custom.id)
      assert.ok((await catalogue()).some(env => env.id === custom.id))
      assert.equal(host.projectDirectory(), customDirectory)
      await library.uninstall(id)
      assert.ok(await readFile(tarball))
      await ack(first, 'leavePrivateRoom')
      assert.equal((await fetch(ready.url + '/api/v1/environments/' + custom.id + '/content')).status, 200)
      await ack(second, 'leavePrivateRoom')
      await library.collectGarbage()
      assert.ok(await readFile(join(customDirectory, 'package.json')))
      await host.stop()
      assert.deepEqual(await host.retainedProjectDirectories(), [])
      await library.collectGarbage()
      assert.ok(
        await readFile(join(customDirectory, 'package.json')),
        'fixed workspace versions retain materials after the server stops',
      )
      t.diagnostic(
        'Local selection became official-only while both old and new server rooms retained custom content; fixed versions retained materials after server shutdown',
      )
    } finally {
      for (const socket of sockets) socket.disconnect()
      await host.stop()
      await owner.close()
      await library.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
