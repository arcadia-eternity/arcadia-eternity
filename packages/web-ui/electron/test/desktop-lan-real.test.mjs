import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { networkInterfaces, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { parseNpmPackOutput } from '@arcadia-eternity/pack-loader/node'
import { ContentLibrary } from '../content-library.mjs'
import { LocalBattleHost } from '../local-battle-host.mjs'
import { DesktopWorkspaceOwner } from '../desktop-workspace-owner.mjs'
import { runContentCommand } from '../content-projects.mjs'
import { ContentWorkspace } from '../../../content-dev/src/content-workspace.ts'

const { io } = createRequire(new URL('../../../server/package.json', import.meta.url))('socket.io-client')
const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const rendererOrigin = 'arcadia-client://app'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function lanInterface() {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    addresses
      .filter(address => address.family === 'IPv4' && !address.internal && !address.address.startsWith('127.'))
      .map(address => ({ name, address: address.address })),
  )
  // Prefer a physical network to a VPN/tunnel, but never substitute loopback.
  candidates.sort(
    (a, b) => Number(/^(utun|tun|tap|docker|veth)/.test(a.name)) - Number(/^(utun|tun|tap|docker|veth)/.test(b.name)),
  )
  const requested = process.env.ARCADIA_DESKTOP_LAN_ADDRESS
  if (requested) {
    const found = candidates.find(candidate => candidate.address === requested)
    assert.ok(found, 'ARCADIA_DESKTOP_LAN_ADDRESS must name an actual nonloopback IPv4 interface')
    return found
  }
  return candidates[0]
}

function ack(socket, event, data) {
  return new Promise((resolve, reject) => {
    const handler = (error, response) => (error ? reject(new Error(`${event}: ${error.message}`)) : resolve(response))
    const timeout = event === 'startPrivateRoomBattle' ? 30000 : 5000
    if (data === undefined) socket.timeout(timeout).emit(event, handler)
    else socket.timeout(timeout).emit(event, data, handler)
  })
}

async function success(socket, event, data) {
  const response = await ack(socket, event, data)
  assert.equal(response.status, 'SUCCESS', `${event}: ${JSON.stringify(response)}`)
  return response.data
}

async function guest(url, name, sockets) {
  const response = await fetch(`${url}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: rendererOrigin },
    body: JSON.stringify({ profile: { id: 'same-local-profile', name } }),
    signal: AbortSignal.timeout(10000),
  })
  assert.equal(response.status, 201)
  const session = await response.json()
  const socket = io(url, {
    auth: { token: session.token, playerId: 'forged-seat' },
    extraHeaders: { Origin: rendererOrigin },
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    autoConnect: false,
    timeout: 10000,
  })
  sockets.push(socket)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
    socket.connect()
  })
  return { session, socket }
}

test(
  'desktop owner publishes one existing environment on a real network interface while LAN guests complete a battle',
  { timeout: 180000, skip: process.env.ARCADIA_DESKTOP_REAL_LAN !== '1' },
  async t => {
    const network = lanInterface()
    if (!network) return t.skip('No nonloopback IPv4 interface is available; loopback is not LAN evidence')
    t.diagnostic(
      `Using actual ${network.name} interface ${network.address}; clients are independent connections on this machine`,
    )
    const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-desktop-lan-')))
    const sockets = []
    let owner
    const host = new LocalBattleHost({
      executable: process.execPath,
      cli: resolve(repository, 'dist/cli.js'),
      rendererOrigin,
      stateDirectory: join(root, 'server'),
      workspaceRoot: join(root, 'library'),
      attachWorkspace: child => {
        child.on('message', message => {
          if (message?.type === 'arcadia.desktop.listener')
            t.diagnostic(`Private listener ready: ${JSON.stringify(message)}`)
        })
        return owner.attach(child)
      },
      startupTimeoutMs: 90000,
      shutdownTimeoutMs: 5000,
    })
    const library = new ContentLibrary({
      root: join(root, 'library'),
      host,
      run: (args, signal) => runContentCommand({ ...host, npmCacheDirectory: join(root, 'cache') }, args, signal),
    })
    owner = new DesktopWorkspaceOwner({ root: join(root, 'library'), library, openWorkspace: ContentWorkspace.open })
    const request = async (method, path, body, headers) => {
      const response = await host.managementRequest({
        method,
        path,
        ...(body === undefined ? {} : { body }),
        ...(headers ? { headers } : {}),
      })
      assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response))
      return response.body
    }
    try {
      const workspace = await owner.ready()
      const packed = await exec(
        'npm',
        ['pack', './examples/ugc/slow', '--json', '--ignore-scripts', '--pack-destination', root],
        {
          cwd: repository,
          env: { ...process.env, npm_config_cache: join(root, 'cache') },
        },
      )
      await library.installFile(join(root, parseNpmPackOutput(packed.stdout)[0].filename), true)
      for (let attempt = 0; ; attempt++) {
        const state = await library.list()
        if (state.selection.status === 'failed') throw new Error(state.selection.message)
        if (state.selection.status === 'ready') break
        assert.ok(attempt < 1200, 'Content preparation timed out')
        await sleep(50)
      }
      const projects = await readdir(join(root, 'library/projects'))
      t.diagnostic('Starting the default loopback host')
      await library.start()
      const local = host.status()
      assert.equal(local.status, 'running')
      assert.equal(new URL(local.url).hostname, '127.0.0.1')
      assert.equal(local.network.scope, 'local')
      assert.deepEqual(local.network.inviteUrls, [])
      assert.equal((await fetch(`${local.url}/api/management/v1/servers`)).status, 401)
      const before = (await request('GET', '/servers')).servers[0]
      const binding = (await request('GET', `/servers/${local.serverId}/bindings`)).bindings.find(
        item => item.id === before.defaultBindingId,
      )
      const version = await workspace.getVersion(binding.effectiveVersionId)
      assert.equal(version.adopted, true)
      assert.ok(version.directory.startsWith(join(root, 'library/projects') + '/'))
      const port = Number(new URL(local.url).port)
      const lanUrl = `http://${network.address}:${port}`
      const desired = await request(
        'PATCH',
        `/servers/${local.serverId}`,
        {
          settings: {
            host: network.address,
            port,
            publicOrigin: lanUrl,
            corsOrigins: [rendererOrigin, 'https://lan-client.example'],
            battleCapacity: { maxConcurrentBattles: 2, maxIdleWorkers: 0, maxQueuedBattles: 2 },
          },
        },
        { 'if-match': String(before.revision) },
      )
      assert.equal(desired.requiresRestart, true)
      for (const key of ['host', 'port', 'publicOrigin', 'corsOrigins'])
        assert.ok(desired.pendingRestart.includes(key), key)
      assert.equal(desired.runtimeSettings.host, '127.0.0.1')
      assert.equal(host.status().url, local.url, 'saving desired settings must not move the running listener')
      await host.stop()
      t.diagnostic('Restarting with the saved nonloopback listener')
      await library.start()
      const hosted = host.status()
      assert.equal(hosted.status, 'running')
      assert.equal(hosted.serverId, local.serverId)
      assert.equal(hosted.url, lanUrl)
      assert.deepEqual(hosted.network, {
        host: network.address,
        port,
        publicOrigin: lanUrl,
        scope: 'network',
        inviteUrls: [lanUrl],
      })
      assert.ok(hosted.network.inviteUrls.every(value => !['0.0.0.0', '[::]'].includes(new URL(value).hostname)))
      const after = (await request('GET', '/servers')).servers[0]
      assert.equal(after.requiresRestart, false)
      assert.deepEqual(after.pendingRestart, [])
      assert.equal(after.runtimeSettings.host, network.address)
      assert.equal(after.runtimeSettings.port, port)
      assert.equal(after.runtimeSettings.battleCapacity.maxConcurrentBattles, 2)
      assert.equal(after.defaultBindingId, binding.id)
      assert.deepEqual(
        await readdir(join(root, 'library/projects')),
        projects,
        'LAN hosting reuses client materials without another installation',
      )

      const info = await fetch(`${lanUrl}/api/v1/server-info`, { signal: AbortSignal.timeout(10000) })
      assert.equal(info.status, 200)
      assert.equal((await info.json()).serverId, hosted.serverId)
      for (const origin of [rendererOrigin, 'https://lan-client.example', lanUrl]) {
        const response = await fetch(`${lanUrl}/api/v1/environments`, { headers: { Origin: origin } })
        assert.equal(response.headers.get('access-control-allow-origin'), origin)
      }
      for (const origin of ['null', 'https://foreign.example']) {
        const response = await fetch(`${lanUrl}/api/v1/environments`, { headers: { Origin: origin } })
        assert.equal(response.headers.get('access-control-allow-origin'), null)
      }
      for (const headers of [
        {},
        { 'X-Forwarded-Proto': 'https', 'X-Arcadia-Desktop-Control': '1', Authorization: 'Bearer forged-owner' },
      ]) {
        const response = await fetch(`${lanUrl}/api/management/v1/servers`, { headers })
        assert.equal(response.status, 403)
        assert.equal((await response.json()).error.code, 'MANAGEMENT_TLS_REQUIRED')
      }
      const forgedOwner = await fetch(`${lanUrl}/api/management/v1/servers/${hosted.serverId}/drain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: rendererOrigin, 'X-Forwarded-Proto': 'https' },
        body: JSON.stringify({
          type: 'arcadia.desktop.content',
          action: 'management',
          request: { method: 'POST', path: `/servers/${hosted.serverId}/drain` },
        }),
      })
      assert.equal(forgedOwner.status, 403, 'the private owner IPC envelope confers no HTTP authority')
      assert.equal((await request('GET', '/capabilities')).workspaceId, workspace.workspaceId)
      const catalog = await (await fetch(`${lanUrl}/api/v1/environments`)).json()
      const environment = catalog.environments.find(item =>
        item.packages.some(pkg => pkg.name === '@arcadia-example/slow'),
      )
      assert.ok(environment, 'LAN catalog publishes the selected client environment')
      const content = await (await fetch(`${lanUrl}/api/v1/environments/${environment.id}/content`)).json()
      assert.ok(content.species.some(item => item.id === 'example-slow:pet'))
      for (const privateValue of [root, version.directory, 'arcadia-admission', 'createEffects', 'filesDigest']) {
        assert.ok(!JSON.stringify({ catalog, content }).includes(privateValue), `Public content leaked ${privateValue}`)
      }

      const [a, b] = await Promise.all([guest(lanUrl, 'LAN A', sockets), guest(lanUrl, 'LAN B', sockets)])
      assert.notEqual(a.session.token, b.session.token)
      assert.notEqual(a.session.seatId, b.session.seatId)
      assert.notEqual(a.socket.io, b.socket.io)
      const fixture = JSON.parse(
        await readFile(resolve(repository, 'packages/battle/test/fixtures/official-switch.input.json'), 'utf8'),
      )
      const { maxHp: _maxHp, ...draft } = fixture.teams[1].team[0]
      const team = [
        {
          ...draft,
          species: 'example-slow:pet',
          skills: ['example-slow:strike'],
          ability: undefined,
          emblem: undefined,
        },
      ]
      const acceptance = {
        environmentId: environment.id,
        protocolVersion: 1,
        resourceRevision: environment.resourceRevision,
        resourcesReady: true,
      }
      const { roomCode } = await success(a.socket, 'createPrivateRoom', {
        environmentId: environment.id,
        config: { battleMode: 'server', timerConfig: { enabled: false } },
      })
      await success(b.socket, 'joinPrivateRoom', { roomCode })
      await success(b.socket, 'togglePrivateRoomReady', { team, environment: acceptance })
      await success(a.socket, 'startPrivateRoomBattle', { hostTeam: team, environment: acceptance })
      await success(a.socket, 'ready')
      await success(b.socket, 'ready')
      const state = await success(a.socket, 'getState')
      assert.equal(state.players[0].team[0].speciesID, 'example-slow:pet')
      for (const [player, id] of [
        [a, 'lan-a-turn'],
        [b, 'lan-b-turn'],
      ]) {
        const action = (await success(player.socket, 'getAvailableSelection')).find(
          selection => selection.type === 'use-skill',
        )
        assert.ok(action)
        await success(player.socket, 'submitPlayerSelection', {
          ...action,
          requestId: id,
          expectedTurn: state.currentTurn,
        })
      }
      const next = await success(a.socket, 'getState')
      assert.ok(next.currentTurn > state.currentTurn)
      await assert.rejects(host.stopHosting(), { code: 'HOST_DRAINING' })
      assert.equal(host.status().status, 'running', 'ordinary stop preserves the active LAN battle')
      const drained = await request('POST', `/servers/${hosted.serverId}/drain`, { draining: true })
      assert.equal(drained.draining, true)
      assert.equal(drained.activeBattles, 1)
      const visitor = await guest(lanUrl, 'LAN visitor', sockets)
      assert.deepEqual(await ack(visitor.socket, 'createPrivateRoom', { config: {} }), {
        status: 'ERROR',
        code: 'SERVER_DRAINING',
      })
      const finished = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('LAN battle did not finish')), 10000)
        const listener = event => {
          if (event.type !== 'battleFinished') return
          clearTimeout(timeout)
          b.socket.off('privateRoomEvent', listener)
          resolve(event)
        }
        b.socket.on('privateRoomEvent', listener)
      })
      await Promise.all([
        finished,
        success(a.socket, 'submitPlayerSelection', {
          type: 'surrender',
          player: a.session.seatId,
          requestId: 'lan-finish',
          expectedTurn: next.currentTurn,
        }),
      ])
      const completed = await success(b.socket, 'getCurrentPrivateRoom')
      assert.equal(completed.status, 'waiting')
      assert.equal(completed.lastBattleResult.winner, b.session.seatId)
      assert.ok(completed.players.every(player => !player.isReady))
      t.diagnostic(
        `Two independent guest clients completed a native UGC battle over ${lanUrl}; drain preserved the active battle`,
      )
      await request('POST', `/servers/${hosted.serverId}/drain`, { draining: false })
      await success(visitor.socket, 'createPrivateRoom', { config: {} })
      await host.stopHosting()
      assert.equal(host.status().status, 'idle')
      await assert.rejects(
        fetch(`${lanUrl}/api/v1/server-info`, { signal: AbortSignal.timeout(2000) }),
        'Stop releases the nonloopback listener',
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
