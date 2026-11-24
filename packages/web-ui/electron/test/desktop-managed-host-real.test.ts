import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateWorkspaceProject } from '@arcadia-eternity/server'
import { ContentLibrary } from '../content-library.ts'
import { LocalBattleHost } from '../local-battle-host.ts'
import { LocalServerController } from '../local-server-controller.ts'
import { startTestPlayerLibraryBridge } from './fixtures/player-library-bridge.ts'
import { connectDesktopInstance } from '@arcadia-eternity/content-sdk/desktop'
import { DesktopWorkspaceOwner } from '../desktop-workspace-owner.ts'
import { runContentCommand } from '../content-projects.ts'
import { openBuiltinEnvironment } from '../builtin-environment.ts'
import {
  ContentWorkspace,
  synchronizeShippedEnvironments,
  readOfficialEnvironments,
} from '../../../content-dev/src/content-workspace.ts'
import { buildEffects } from '@arcadia-eternity/content-sdk/build'
import { parseNpmPackOutput, withShippedCatalogArchive } from '@arcadia-eternity/pack-loader/node'
import { locateDesktopSqliteBinary } from '../../../../scripts/desktop-sqlite-native.mjs'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const cli = process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js')
function defaultArchive(use) {
  const runtimeRequire = createRequire(join(dirname(cli), 'package.json'))
  const root = dirname(runtimeRequire.resolve('@arcadia-eternity/data-pack-base/package.json'))
  return withShippedCatalogArchive(root, process.env.ARCADIA_DESKTOP_NPM_CLI, use)
}
test(
  'real managed desktop host borrows client materials and restores its own persisted binding',
  {
    timeout: 180000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-managed-host-')))
    const databaseRequire = createRequire(join(repository, 'packages/database/package.json'))
    const sourceAddon = await locateDesktopSqliteBinary(dirname(databaseRequire.resolve('better-sqlite3/package.json')))
    assert.ok(sourceAddon, 'development SQLite must expose a native binary')
    const originalAddonDigest = createHash('sha256')
      .update(await readFile(sourceAddon))
      .digest('hex')
    let playerConnection, builtin
    const host = new LocalBattleHost({
      executable: process.env.ARCADIA_DESKTOP_EXECUTABLE ?? process.execPath,
      cli: process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js'),
      npmCliPath: process.env.ARCADIA_DESKTOP_NPM_CLI,
      packsDirectory: process.env.ARCADIA_DESKTOP_PACKS_DIRECTORY,
      webRoot: join(dirname(process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js')), 'web'),
      rendererOrigin: 'http://localhost:5173',
      stateDirectory: join(root, 'server'),
      workspaceRoot: join(root, 'library'),
      attachWorkspace: (child, publishClientEnvironments) => {
        child.on('message', message => {
          if (message?.type === 'arcadia.desktop.workspace.callback.result' && !message.ok)
            t.diagnostic(JSON.stringify(message.error))
        })
        return owner.attach(child, publishClientEnvironments ? () => personal : undefined)
      },
      startupTimeoutMs: 90000,
      shutdownTimeoutMs: 5000,
    })
    const library = new ContentLibrary({
      root: join(root, 'library'),
      host,
      withDefaultArchive: defaultArchive,
      run: (args, signal) => runContentCommand({ ...host, npmCacheDirectory: join(root, 'cache') }, args, signal),
    })
    const controller = new LocalServerController({
      host,
      defaultProject: async () => (await builtin.workspace.getInstallation(builtin.id)).directory,
    })
    const personal = await ContentWorkspace.open(join(root, 'local-environments'), {
      retentions: { list: async () => [] },
    })
    const owner = new DesktopWorkspaceOwner({
      root: join(root, 'library'),
      library,
      openWorkspace: ContentWorkspace.open,
      builtinId: () => builtin?.id,
      synchronize: async workspace => {
        const runtimeRequire = createRequire(join(dirname(cli), 'package.json'))
        builtin = await openBuiltinEnvironment({
          workspace,
          library,
          validate: validateWorkspaceProject,
          catalog: await readOfficialEnvironments(
            dirname(runtimeRequire.resolve('@arcadia-eternity/data-pack-base/package.json')),
            runtimeRequire.resolve,
          ),
          synchronizeShippedEnvironments,
        })
      },
    })
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
      const example = join(repository, 'examples/ugc/slow')
      const fixture = join(root, 'slow')
      await mkdir(fixture)
      // Never reuse an ignored local dist directory: build the tracked example
      // into this test's empty fixture.
      for (const entry of ['package.json', 'content.json', 'src'])
        await cp(join(example, entry), join(fixture, entry), { recursive: true })
      await buildEffects(fixture)
      const fixtureManifest = JSON.parse(await readFile(join(fixture, 'package.json'), 'utf8'))
      assert.ok(
        (await readFile(join(fixture, fixtureManifest.arcadia.effectArtifact))).length,
        'fresh effect artifact exists',
      )
      const packArguments = [
        'pack',
        fixture,
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        root,
        '--cache',
        join(root, 'pack-cache'),
      ]
      const packed = process.env.ARCADIA_DESKTOP_NPM_CLI
        ? await exec(host.executable, [process.env.ARCADIA_DESKTOP_NPM_CLI, ...packArguments], {
            cwd: repository,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          })
        : await exec('npm', packArguments, { cwd: repository })
      const archive = parseNpmPackOutput(packed.stdout)[0]
      assert.ok(
        archive.files.some(file => file.path === fixtureManifest.arcadia.effectArtifact),
        'packed fixture includes the freshly built effect artifact',
      )
      const installed = await library.installFile(join(root, archive.filename), true)
      const { packages, activeIds } = await library.list()
      const base = packages.find(item => item.bundled)
      assert.equal(activeIds, undefined)
      assert.ok(base)
      const local = await library.prepareEnvironmentProject(
        { packages: { [fixtureManifest.name]: fixtureManifest.version }, sources: [] },
        { offline: true },
      )
      try {
        await personal.prepareEnvironment(
          {
            environmentId: 'local-competition',
            expectedRevision: null,
            document: {
              schemaVersion: 2,
              id: 'local-competition',
              name: '本机比赛环境',
              packages: { [fixtureManifest.name]: fixtureManifest.version },
              sources: [],
              rules: { schemaVersion: 1 },
              requires: {},
            },
            projectDirectory: local.directory,
          },
          validateWorkspaceProject,
        )
      } finally {
        await local.release()
      }
      const existingProjects = await readdir(join(root, 'library/projects'))
      await controller.request({
        action: 'start',
        configuration: { name: '好友开服测试', scope: 'local', port: 0 },
      })
      const first = host.status()
      assert.equal(first.status, 'running')
      const { environments } = await (await fetch(first.url + '/api/v1/environments')).json()
      assert.deepEqual(
        environments.find(item => item.environmentId === 'local-competition').packages.map(item => item.name),
        [fixtureManifest.name],
      )
      assert.equal(environments.find(item => item.isDefault).environmentId, builtin.id)
      const capabilities = await request('GET', '/capabilities')
      assert.equal(capabilities.workspaceId, workspace.workspaceId)
      const firstServer = (await request('GET', '/servers')).servers[0]
      assert.equal(firstServer.name, '好友开服测试')
      assert.equal(firstServer.settings.host, '127.0.0.1')
      assert.equal(firstServer.settings.port, 0)
      const firstBindings = (await request('GET', `/servers/${first.serverId}/bindings`)).bindings
      const binding = firstBindings.find(item => item.id === firstServer.defaultBindingId)
      assert.equal(binding.condition, 'available')
      assert.equal(binding.environmentId, builtin.id)
      const version = await workspace.getInstallation(binding.environmentId)
      assert.equal(version.directory, join(workspace.root, 'environments', binding.environmentId))
      assert.equal(
        JSON.parse(await readFile(join(root, 'server/server.json'), 'utf8')).projectDirectory,
        version.directory,
      )
      assert.deepEqual(await readdir(join(root, 'library/projects')), existingProjects)
      const packagesBeforeManagement = (await library.list()).packages.map(item => item.id)
      const preparation = await request(
        'POST',
        `/workspaces/${workspace.workspaceId}/environments/apply`,
        {
          document: {
            schemaVersion: 2,
            id: 'tournament',
            name: '独立比赛环境',
            packages: { [fixtureManifest.name]: fixtureManifest.version },
            sources: [],
            rules: { schemaVersion: 1 },
            requires: {},
          },
          expectedRevision: null,
        },
        { 'idempotency-key': 'apply-tournament' },
      )
      let prepared
      for (let i = 0; i < 1200; i++) {
        prepared = await request('GET', `/operations/${preparation.id}`)
        if (!['queued', 'running'].includes(prepared.status)) break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      assert.equal(prepared.status, 'succeeded', JSON.stringify(prepared.error))
      assert.deepEqual(
        (await library.list()).packages.map(item => item.id),
        packagesBeforeManagement,
        'management preparation leaves shared materials intact',
      )
      assert.equal(
        (await workspace.getInstallation(prepared.result.installationId)).directory,
        join(workspace.root, 'environments/tournament'),
      )
      await library.uninstall(installed)
      assert.equal(
        (await request('GET', `/servers/${first.serverId}/bindings`)).bindings.find(item => item.id === binding.id)
          .environmentId,
        binding.environmentId,
      )
      const anonymous = await fetch(`${first.url}/api/management/v1/servers`)
      assert.equal(anonymous.status, 401)
      playerConnection = await startTestPlayerLibraryBridge({
        home: root,
        profile: root,
        label: 'Test player',
        serverController: controller,
      })
      const connection = await connectDesktopInstance(undefined, { directory: join(root, '.arcadia/player-libraries') })
      const command = action => connection.request({ operation: 'server', action })
      assert.equal((await command('status')).host.serverId, first.serverId)
      assert.equal((await command('stop')).host.status, 'idle')
      await library.collectGarbage()
      assert.ok(
        await readFile(join(version.directory, 'package.json')),
        'persisted server binding retains materials after stop',
      )
      const resumed = await command('start')
      assert.equal(resumed.error, undefined)
      const second = host.status()
      assert.equal(second.serverId, first.serverId)
      const restoredServer = (await request('GET', '/servers')).servers[0]
      assert.equal(restoredServer.defaultBindingId, binding.id)
      assert.equal(restoredServer.name, '好友开服测试')
      assert.equal(restoredServer.settings.host, '127.0.0.1')
      const restored = (await request('GET', `/servers/${second.serverId}/bindings`)).bindings.find(
        item => item.id === binding.id,
      )
      assert.equal(restored.environmentId, binding.environmentId)
      assert.equal(restored.condition, 'available')
      assert.equal((await workspace.listInstallations()).filter(item => item.status === 'ready').length, 3)
    } finally {
      await playerConnection?.close()
      await host.stop()
      await owner.close()
      await personal.close()
      await library.close()
      await rm(root, { recursive: true, force: true })
      assert.equal(
        createHash('sha256')
          .update(await readFile(sourceAddon))
          .digest('hex'),
        originalAddonDigest,
        'packaged host never rebuilds the development SQLite addon',
      )
      const Database = databaseRequire('better-sqlite3')
      const db = new Database(':memory:')
      assert.equal(db.prepare('SELECT 1 AS healthy').get().healthy, 1)
      db.close()
    }
  },
)

test(
  'first launch and saved restart expose ready client environments alongside the managed default',
  {
    timeout: 180000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-official-host-')))
    let browser, builtin
    const host = new LocalBattleHost({
      executable: process.env.ARCADIA_DESKTOP_EXECUTABLE ?? process.execPath,
      cli: process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js'),
      npmCliPath: process.env.ARCADIA_DESKTOP_NPM_CLI,
      packsDirectory: process.env.ARCADIA_DESKTOP_PACKS_DIRECTORY,
      webRoot: join(dirname(process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js')), 'web'),
      rendererOrigin: 'http://localhost:5173',
      stateDirectory: join(root, 'server'),
      workspaceRoot: join(root, 'library'),
      attachWorkspace: (child, publish) => owner.attach(child, publish ? () => personal : undefined),
      startupTimeoutMs: 60000,
      shutdownTimeoutMs: 5000,
    })
    const library = new ContentLibrary({
      root: join(root, 'library'),
      host,
      withDefaultArchive: defaultArchive,
      run: (args, signal) => runContentCommand({ ...host, npmCacheDirectory: join(root, 'cache') }, args, signal),
    })
    const personal = await ContentWorkspace.open(join(root, 'local-environments'), {
      retentions: { list: async () => [] },
    })
    const owner = new DesktopWorkspaceOwner({
      root: join(root, 'library'),
      library,
      openWorkspace: ContentWorkspace.open,
      builtinId: () => builtin?.id,
      synchronize: async workspace => {
        const runtimeRequire = createRequire(join(dirname(cli), 'package.json'))
        builtin = await openBuiltinEnvironment({
          workspace,
          library,
          validate: validateWorkspaceProject,
          catalog: await readOfficialEnvironments(
            dirname(runtimeRequire.resolve('@arcadia-eternity/data-pack-base/package.json')),
            runtimeRequire.resolve,
          ),
          synchronizeShippedEnvironments,
        })
      },
    })
    const controller = new LocalServerController({
      host,
      defaultProject: async () => (await builtin.workspace.getInstallation(builtin.id)).directory,
    })
    try {
      await owner.ready()
      const lease = await library.acquireInitialEnvironment()
      const template = {
        schemaVersion: 2,
        packages: Object.fromEntries(lease.packages.map(pkg => [pkg.name, pkg.version])),
        sources: [],
        requires: {},
      }
      const roomEnvironments = [
        ['duel', '单宠房', 1],
        ['doubles', '双宠房', 2],
      ]
      try {
        for (const [id, name, maxSize] of roomEnvironments) {
          await personal.prepareEnvironment(
            {
              environmentId: id,
              document: { ...template, id, name, rules: { schemaVersion: 1, team: { maxSize } } },
              expectedRevision: null,
              projectDirectory: lease.directory,
            },
            validateWorkspaceProject,
          )
        }
      } finally {
        await lease.release()
      }
      const launched = await controller.request({
        action: 'start',
        configuration: { name: '官方玩法好友服', scope: 'local', port: 0 },
      })
      assert.equal(launched.host.status, 'running', JSON.stringify(launched.error))
      assert.equal(launched.host.projectName, 'builtin-server')
      const { environments } = await (await fetch(launched.host.url + '/api/v1/environments')).json()
      assert.deepEqual(
        environments.find(item => item.isDefault).packages.map(item => item.name),
        ['@arcadia-eternity/data-pack-base'],
      )
      for (const [id, name, maxSize] of roomEnvironments) {
        const published = environments.find(item => item.environmentId === id)
        assert.equal(published?.environmentName, name)
        assert.equal(published.rules.team.maxSize, maxSize)
      }
      const extended = environments.find(item => item.environmentId === 'training-120')
      assert.equal(extended.rules.mechanics.individualValues.max, 120)
      assert.equal(extended.rules.mechanics.secondGenerationNatures, 'species')
      assert.equal(extended.rules.mechanics.enhancement.stages.length, 16)
      assert.ok(extended.matchmakingEnabled)
      assert.ok(!extended.isDefault)
      const homepage = await fetch(launched.host.url)
      assert.equal(homepage.status, 200)
      assert.match(await homepage.text(), /<html/)
      const serverPage = await fetch(launched.host.url + '/servers')
      assert.equal(serverPage.status, 200, 'server management route also survives browser refresh')
      assert.deepEqual(await (await fetch(launched.host.url + '/arcadia-client.json')).json(), {
        schemaVersion: 1,
        backendOrigin: '/',
        autoConnect: true,
      })
      const { chromium } = createRequire(new URL('../../package.json', import.meta.url))('playwright')
      browser = await chromium.launch()
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const failures = []
      page.on('pageerror', error => failures.push(error.message))
      await page.goto(launched.host.url)
      await page
        .getByRole('button', { name: `已连接当前网页的服务器：${launched.host.url}，连接设置`, exact: true })
        .waitFor({ timeout: 30000 })
      await page.goto(launched.host.url + '/servers')
      await page.getByRole('heading', { name: '当前网页的服务器', exact: true }).waitFor()
      assert.equal(await page.getByRole('heading', { name: '官方服务器', exact: true }).count(), 0)
      await page.getByRole('button', { name: '进入大厅', exact: true }).click()
      await page
        .getByRole('button', { name: `已连接当前网页的服务器：${launched.host.url}，连接设置`, exact: true })
        .waitFor({ timeout: 30000 })
      await page.getByTestId('create-private-room-button').click()
      await page.getByTestId('room-environment-select').click()
      await page.getByRole('option', { name: '双宠房', exact: true }).waitFor()
      await page.getByRole('option', { name: extended.environmentName, exact: true }).click()
      await page.getByTestId('confirm-create-private-room-button').click()
      await page.waitForURL(/\/room\/[^/?#]+/)
      await page.goto(launched.host.url + '/servers')
      await page.getByRole('heading', { name: '当前网页的服务器', exact: true }).waitFor()
      assert.deepEqual(failures, [])
      if (process.env.ARCADIA_UX_SCREENSHOT)
        await page.screenshot({ path: process.env.ARCADIA_UX_SCREENSHOT, fullPage: true })
      await browser.close()
      browser = undefined
      const listed = await host.managementRequest({ method: 'GET', path: '/servers' })
      assert.equal(listed.body.servers[0].name, '官方玩法好友服')
      assert.ok(listed.body.servers[0].defaultBindingId)
      const path = `/workspaces/${listed.body.servers[0].workspaceId}/environments`
      const drafts = await host.managementRequest({ method: 'GET', path })
      assert.equal(drafts.status, 200)
      const draft = drafts.body.environments.find(item => item.document.id === builtin.id)
      assert.deepEqual(draft.requiredPackages, ['@arcadia-eternity/data-pack-base'])
      const disabled = await host.managementRequest({
        method: 'POST',
        path: `${path}/${builtin.id}/packages/remove`,
        body: { name: draft.requiredPackages[0], expectedRevision: draft.revision },
      })
      assert.equal(disabled.status, 409)
      const snapshot = await library.list()
      assert.equal(snapshot.activeIds, undefined)
      assert.ok(snapshot.packages.find(item => item.bundled))
      const bindingsPath = `/servers/${launched.host.serverId}/bindings`
      const { body } = await host.managementRequest({ method: 'GET', path: bindingsPath })
      const binding = body.bindings.find(item => item.environmentId === extended.environmentId)
      const removed = await host.managementRequest({
        method: 'DELETE',
        path: bindingsPath + '/' + binding.id,
        headers: { 'if-match': String(binding.revision) },
      })
      assert.equal(removed.status, 200)
      await controller.request({ action: 'stop', force: true })
      await personal.deleteDraft({
        environmentId: 'duel',
        expectedRevision: (await personal.getDraft('duel')).revision,
      })
      const resumed = await controller.request({ action: 'start' })
      assert.equal(resumed.host.status, 'running', JSON.stringify(resumed.error))
      assert.equal(resumed.host.serverId, launched.host.serverId)
      const refreshed = await (await fetch(resumed.host.url + '/api/v1/environments')).json()
      assert.ok(!refreshed.environments.some(item => item.environmentId === extended.environmentId))
      assert.ok(refreshed.environments.some(item => item.environmentId === 'doubles'))
      assert.ok(!refreshed.environments.some(item => item.environmentId === 'duel'))
    } finally {
      await browser?.close()
      controller.close()
      await host.stop()
      await owner.close()
      await personal.close()
      await library.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
