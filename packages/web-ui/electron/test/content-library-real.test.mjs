import { test } from 'node:test'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseNpmPackOutput } from '@arcadia-eternity/pack-loader/node'
import { ContentWorkspace } from '../../../content-dev/src/content-workspace.ts'
import { DesktopWorkspaceOwner } from '../desktop-workspace-owner.mjs'
import { ContentLibrary } from '../content-library.mjs'
import { LocalEnvironments } from '../local-environments.mjs'
import { LocalBattleHost } from '../local-battle-host.mjs'
import { runContentCommand } from '../content-projects.mjs'

const exec = promisify(execFile)
const { io } = createRequire(new URL('../../../server/package.json', import.meta.url))('socket.io-client')
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
test(
  'real environment preparation and hosted copies remain independent of package installation',
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
      const tarball = join(root, parseNpmPackOutput(packed.stdout)[0].filename)
      const id = await library.installFile(tarball, true)
      assert.equal((await library.list()).desiredIds, undefined)
      const installed = (await library.list()).packages.find(pkg => pkg.id === id)
      assert.equal(host.status().status, 'idle')
      const localProject = await library.prepareEnvironmentProject(
        { packages: { [installed.name]: installed.version }, sources: [] },
        { offline: true },
      )
      await host.start(localProject.directory)
      assert.equal(host.projectDirectory(), localProject.directory)
      await localProject.release()
      const ready = host.status()
      assert.equal(ready.status, 'running')
      const customDirectory = host.projectDirectory()
      const persisted = (await (await owner.ready()).listInstallations()).find(
        version => version.status === 'ready' && Object.hasOwn(version.document.packages, installed.name),
      )
      assert.ok(persisted)
      assert.notEqual(persisted.directory, customDirectory)
      const catalogue = async () => (await (await fetch(ready.url + '/api/v1/environments')).json()).environments
      const custom = (await catalogue()).find(env => env.packages.some(pkg => pkg.name === '@arcadia-example/slow'))
      assert.ok(custom)
      const content = await (await fetch(ready.url + '/api/v1/environments/' + custom.id + '/content')).json()
      assert.ok(content.species.some(pet => pet.id === 'example-slow:pet'))
      const first = await connect(ready.url)
      await ack(first, 'createPrivateRoom', { config: { battleMode: 'server' } })
      assert.equal((await ack(first, 'getCurrentPrivateRoom')).environment.id, custom.id)
      t.diagnostic('Real tarball was inspected, admitted, composed, validated and served')
      const alternative = await library.prepareEnvironmentProject({ packages: {}, sources: [] }, { offline: true })
      await alternative.release()
      const official = await library.list()
      assert.equal(official.activeIds, undefined)
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
        await readFile(join(persisted.directory, 'package.json')),
        'the independent server installation retains materials after the borrowed source is collected',
      )
      t.diagnostic(
        'Preparing another environment and uninstalling its library source leave server rooms and persisted server materials intact',
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

test(
  'an active sandbox battle keeps its original package while the consumer installs and applies a new release',
  { timeout: 120000, skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1' },
  async t => {
    const { createSourceProject } = await import('@arcadia-eternity/content-sdk/workspace')
    const { createNodeBattleWorkerManager } = await import('@arcadia-eternity/battle/sandbox/node')
    const { createLocalContentSessions } = await import('../local-content-sessions.mjs')
    const { emptyNpmContentHost, prepareNpmProject } = await import('@arcadia-eternity/pack-loader/node')
    const { gameplayRevision, buildDisplayCatalog, buildDisplayLocales } =
      await import('@arcadia-eternity/pack-loader/native')
    const { writeFile } = await import('node:fs/promises')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-consumer-update-')),
      project = join(root, 'author')
    const runtime = {
      executable: process.execPath,
      cli: resolve(repository, 'dist/cli.js'),
      npmCacheDirectory: join(root, 'cache'),
    }
    const approvals = [],
      reviews = []
    const library = new ContentLibrary({
      root: join(root, 'consumer'),
      run: (args, signal) => runContentCommand(runtime, args, signal),
      host: { status: () => ({ status: 'idle' }), retainedProjectDirectories: async () => [] },
      reviewInstall: pkg => {
        reviews.push(pkg.version)
        return true
      },
      authorizeEnvironment: (_document, effects) => {
        approvals.push(effects.map(pkg => pkg.version))
        return true
      },
    })
    const name = '@arcadia-local/consumer-test'
    let selected = '0.1.0'
    const sessions = createLocalContentSessions({
      library: {
        acquireProject: async () => {
          const document = { id: 'local', name: 'Local', packages: { [name]: selected }, sources: [] }
          return { ...(await library.prepareEnvironmentProject(document, { offline: true })), document }
        },
      },
      load: async () => ({
        host: emptyNpmContentHost,
        prepareNpmProject,
        gameplayRevision,
        buildDisplayCatalog,
        buildDisplayLocales,
      }),
      assetUrl: (token, hash) => 'http://localhost/' + token + '/' + hash,
    })
    const workers = createNodeBattleWorkerManager()
    t.after(async () => {
      await workers.dispose()
      await sessions.close()
      await library.close()
      await rm(root, { recursive: true, force: true })
    })
    await createSourceProject(project, 'consumer-test')
    async function installRelease() {
      await exec(process.execPath, [join(repository, 'packages/content-dev/dist/cli.js'), 'pack', '--release'], {
        cwd: project,
      })
      await library.installFile(join(project, 'arcadia-local-consumer-test-' + selected + '.tgz'), true)
    }
    await installRelease()
    assert.deepEqual(approvals, [])
    const first = await sessions.prepare()
    const power = view => view.content.skills.find(skill => skill.id === 'consumer-test:strike').power
    assert.equal(power(first), 40)
    const battle = await workers.create({
      environment: first.environment,
      players: [0, 1].map(side => ({
        id: String(side).repeat(21),
        name: 'Player ' + side,
        team: [
          {
            id: String(side + 2).repeat(21),
            name: 'Pet',
            species: 'consumer-test:pet',
            level: 100,
            nature: 'Hardy',
            skills: ['consumer-test:strike'],
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          },
        ],
      })),
      options: { timerConfig: { enabled: false } },
    })
    await battle.ready()
    const pending = await battle.waitForPendingDecision()
    const before = await battle.getState(undefined, true)
    selected = '0.2.0'
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
    manifest.version = selected
    await writeFile(join(project, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
    const skill = join(project, 'data/skills/strike.yaml')
    await writeFile(skill, (await readFile(skill, 'utf8')).replace('power: 40', 'power: 90'))
    await installRelease()
    assert.deepEqual(approvals, [['0.1.0']])
    const second = await sessions.prepare()
    assert.deepEqual(reviews, ['0.1.0', '0.2.0'])
    assert.deepEqual(approvals, [['0.1.0'], ['0.2.0']])
    assert.equal(power(second), 90)
    assert.notEqual(first.environment.revision, second.environment.revision)
    assert.deepEqual(await battle.getState(undefined, true), before)
    for (const actions of pending.selections)
      await battle.submitAction(actions.find(action => action.type === 'use-skill'))
    await battle.waitForPendingDecision()
    const after = await battle.getState(undefined, true)
    assert.ok(after.players[0].team[0].stats.spe < before.players[0].team[0].stats.spe)
    await battle.cleanup()
    await sessions.release(first.token)
    await sessions.release(second.token)
  },
)

test(
  'a portable recipe applies offline through the desktop owner and remains selectable after restart',
  { timeout: 120000, skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1' },
  async t => {
    const { acquireAuthorEnvironment } = await import('@arcadia-eternity/content-sdk/management-workspace')
    const { validateWorkspaceProject } = await import('@arcadia-eternity/server')
    const root = await mkdtemp(join(tmpdir(), 'arcadia-desktop-recipe-'))
    const recipe = join(root, 'recipe')
    const candidates = join(recipe, 'candidates')
    await mkdir(candidates, { recursive: true })
    let owner, library
    t.after(async () => {
      await owner?.close()
      await library?.close()
      await rm(root, { recursive: true, force: true })
    })
    const pack = async (project, output) => {
      const packed = await exec(
        'npm',
        [
          'pack',
          '--ignore-scripts',
          '--json',
          '--offline',
          '--cache',
          join(root, 'pack-cache'),
          '--pack-destination',
          output,
        ],
        { cwd: project },
      )
      return join(output, parseNpmPackOutput(packed.stdout)[0].filename)
    }
    const name = '@arcadia-example/slow'
    await rename(await pack(join(repository, 'examples/ugc/slow'), candidates), join(candidates, 'slow.tgz'))
    const declaration = {
      schemaVersion: 2,
      id: 'desktop-league',
      name: '桌面联赛',
      sources: [],
      rules: { schemaVersion: 1 },
      requires: {},
    }
    await writeFile(
      join(recipe, 'package.json'),
      JSON.stringify({
        name: '@fixture/desktop-league',
        version: '1.0.0',
        dependencies: { [name]: 'file:candidates/slow.tgz' },
        arcadiaEnvironment: declaration,
        scripts: { postinstall: 'exit 1' },
      }),
    )
    const archive = await pack(recipe, root)
    const approvals = []
    let allowEffects = false
    const runtime = {
      executable: process.execPath,
      cli: join(repository, 'dist/cli.js'),
      npmCacheDirectory: join(root, 'cli-cache'),
    }
    library = new ContentLibrary({
      root: join(root, 'library'),
      run: (args, signal) => runContentCommand(runtime, args, signal),
      host: { status: () => ({ status: 'idle' }), retainedProjectDirectories: async () => [] },
      authorizeEnvironment: (_document, effects) => {
        approvals.push(effects.map(pkg => pkg.name))
        return allowEffects
      },
    })
    const openOwner = () =>
      new LocalEnvironments({
        openWorkspace: () => ContentWorkspace.open(join(root, 'personal')),
        library: { prepareEnvironmentProject: library.prepareEnvironmentProject.bind(library) },
        acquireRecipe: acquireAuthorEnvironment,
        validate: validateWorkspaceProject,
      })
    owner = openOwner()
    async function complete(input, hostOptions) {
      const { operationId } = await owner.request(input, hostOptions)
      for (;;) {
        const job = (await owner.snapshot()).operations.find(job => job.id === operationId)
        if (!['queued', 'running'].includes(job.status)) return job
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    const blocked = await complete(
      { action: 'install-recipe', source: { kind: 'file' } },
      { chooseRecipeArchive: async () => archive },
    )
    assert.match(blocked.error?.message ?? '', /未授权/)
    assert.equal((await owner.snapshot()).environments.length, 0)
    allowEffects = true
    const installed = await complete({ action: 'retry', operationId: blocked.id })
    assert.equal(installed.status, 'succeeded', JSON.stringify(installed.error))
    assert.deepEqual(approvals, [[name], [name]])
    assert.equal(installed.result.environmentId, declaration.id)
    const selected = await complete({ action: 'select', environmentId: declaration.id })
    assert.equal(selected.status, 'succeeded', JSON.stringify(selected.error))
    await owner.close()
    await rm(recipe, { recursive: true })
    await rm(archive)
    owner = openOwner()
    const snapshot = await owner.snapshot()
    assert.equal(snapshot.selectedEnvironmentId, declaration.id)
    assert.ok(snapshot.installations[0].contentCatalog.species.some(pet => pet.id === 'example-slow:pet'))
    const lease = await owner.acquireProject()
    try {
      const member = JSON.parse(await readFile(join(lease.directory, 'node_modules', name, 'package.json'), 'utf8'))
      assert.equal(member.name, name)
      assert.equal(lease.document.name, declaration.name)
    } finally {
      await lease.release()
    }
  },
)
