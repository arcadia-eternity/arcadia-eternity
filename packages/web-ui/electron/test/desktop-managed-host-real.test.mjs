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
import { ContentLibrary } from '../content-library.mjs'
import { LocalBattleHost } from '../local-battle-host.mjs'
import { LocalServerController } from '../local-server-controller.mjs'
import { DesktopWorkspaceOwner } from '../desktop-workspace-owner.mjs'
import { runContentCommand } from '../content-projects.mjs'
import { ContentWorkspace } from '../../../content-dev/src/content-workspace.mjs'

const exec = promisify(execFile)
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
test(
  'real managed desktop host borrows client materials and restores its own persisted binding',
  {
    timeout: 180000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-managed-host-')))
    const databaseRequire = createRequire(join(repository, 'packages/database/package.json'))
    const sourceAddon = join(
      dirname(databaseRequire.resolve('better-sqlite3/package.json')),
      'build/Release/better_sqlite3.node',
    )
    const originalAddonDigest = createHash('sha256')
      .update(await readFile(sourceAddon))
      .digest('hex')
    let owner
    const host = new LocalBattleHost({
      executable: process.env.ARCADIA_DESKTOP_EXECUTABLE ?? process.execPath,
      cli: process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js'),
      npmCliPath: process.env.ARCADIA_DESKTOP_NPM_CLI,
      packsDirectory: process.env.ARCADIA_DESKTOP_PACKS_DIRECTORY,
      webRoot: join(dirname(process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js')), 'web'),
      rendererOrigin: 'http://localhost:5173',
      stateDirectory: join(root, 'server'),
      workspaceRoot: join(root, 'library'),
      attachWorkspace: child => {
        child.on('message', message => {
          if (message?.type === 'arcadia.desktop.workspace.callback.result' && !message.ok)
            t.diagnostic(JSON.stringify(message.error))
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
    const controller = new LocalServerController({ host, library: () => library })
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
    const settle = async () => {
      for (let i = 0; i < 1200; i++) {
        const state = await library.list()
        if (state.selection.status === 'failed') throw new Error(state.selection.message)
        if (state.selection.status === 'ready') return state
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('CONTENT_NOT_READY')
    }
    try {
      const workspace = await owner.ready()
      const example = join(repository, 'examples/ugc/slow')
      const fixture = join(root, 'slow')
      await mkdir(fixture)
      // Never reuse an ignored local dist directory: build the tracked example
      // into this test's empty fixture. Keep its config in the repository so
      // TypeScript resolves the already-built workspace SDK without an install.
      for (const entry of ['package.json', 'content.json', 'src'])
        await cp(join(example, entry), join(fixture, entry), { recursive: true })
      const compiler = createRequire(join(repository, 'package.json')).resolve('typescript/bin/tsc')
      await exec(
        process.execPath,
        [compiler, '--project', join(example, 'tsconfig.json'), '--outDir', join(fixture, 'dist'), '--noEmitOnError'],
        { cwd: repository, maxBuffer: 4 * 1024 * 1024 },
      )
      const fixtureManifest = JSON.parse(await readFile(join(fixture, 'package.json'), 'utf8'))
      assert.ok((await readFile(join(fixture, fixtureManifest.arcadia.effects))).length, 'fresh compiled effect exists')
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
      const archive = JSON.parse(packed.stdout)[0]
      assert.ok(
        archive.files.some(file => file.path === fixtureManifest.arcadia.effects),
        'packed fixture includes the freshly compiled effect entry',
      )
      const installed = await library.installFile(join(root, archive.filename), true)
      assert.deepEqual((await library.list()).activeIds, [])
      await library.setSelection([installed], true)
      await settle()
      const local = await library.acquireProject()
      const existingProjects = await readdir(join(root, 'library/projects'))
      const launched = await controller.request({
        action: 'start',
        configuration: { name: '好友开服测试', content: 'current', scope: 'local', port: 0 },
      })
      assert.equal(launched.error, undefined)
      const first = host.status()
      assert.equal(first.status, 'running')
      const capabilities = await request('GET', '/capabilities')
      assert.equal(capabilities.workspaceId, workspace.workspaceId)
      const firstServer = (await request('GET', '/servers')).servers[0]
      assert.equal(firstServer.name, '好友开服测试')
      assert.equal(firstServer.settings.host, '127.0.0.1')
      assert.equal(firstServer.settings.port, 0)
      const firstBindings = (await request('GET', `/servers/${first.serverId}/bindings`)).bindings
      const binding = firstBindings.find(item => item.id === firstServer.defaultBindingId)
      assert.equal(binding.condition, 'available')
      const version = await workspace.getVersion(binding.effectiveVersionId)
      assert.equal(version.directory, local.directory, 'same client project, not another installation/copy')
      assert.equal(version.adopted, true)
      assert.deepEqual(await readdir(join(root, 'library/projects')), existingProjects)
      await local.release()
      const selectedBeforeManagement = (await library.list()).activeIds
      const tournament = await request('POST', `/workspaces/${workspace.workspaceId}/environments`, {
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
      })
      const preparation = await request(
        'POST',
        `/workspaces/${workspace.workspaceId}/environments/tournament/prepare`,
        { expectedRevision: tournament.revision },
        { 'idempotency-key': 'prepare-tournament' },
      )
      let prepared
      for (let i = 0; i < 1200; i++) {
        prepared = await request('GET', `/operations/${preparation.id}`)
        if (!['queued', 'running'].includes(prepared.status)) break
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      assert.equal(prepared.status, 'succeeded', JSON.stringify(prepared.error))
      assert.deepEqual(
        (await library.list()).activeIds,
        selectedBeforeManagement,
        'management preparation leaves local selection intact',
      )
      assert.equal((await workspace.getVersion(prepared.result.versionId)).adopted, true)
      await library.setSelection([], true)
      await settle()
      assert.equal(
        (await request('GET', `/servers/${first.serverId}/bindings`)).bindings[0].effectiveVersionId,
        binding.effectiveVersionId,
      )
      const anonymous = await fetch(`${first.url}/api/management/v1/servers`)
      assert.equal(anonymous.status, 401)
      await request('POST', `/servers/${first.serverId}/drain`, { draining: true })
      await host.stop()
      await library.collectGarbage()
      assert.ok(
        await readFile(join(version.directory, 'package.json')),
        'persisted server binding retains materials after stop',
      )
      const resumed = await controller.request({ action: 'start' })
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
      assert.equal(restored.effectiveVersionId, binding.effectiveVersionId)
      assert.equal(restored.condition, 'available')
      assert.equal((await workspace.listVersions()).filter(item => item.status === 'ready').length, 2)
    } finally {
      await host.stop()
      await owner.close()
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
  'clean first launch prepares official content without a project picker or local-play selection',
  {
    timeout: 90000,
    skip: process.env.ARCADIA_DESKTOP_REAL_HOST !== '1',
  },
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-official-host-')))
    let owner, browser
    const host = new LocalBattleHost({
      executable: process.env.ARCADIA_DESKTOP_EXECUTABLE ?? process.execPath,
      cli: process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js'),
      npmCliPath: process.env.ARCADIA_DESKTOP_NPM_CLI,
      packsDirectory: process.env.ARCADIA_DESKTOP_PACKS_DIRECTORY,
      webRoot: join(dirname(process.env.ARCADIA_DESKTOP_CLI ?? resolve(repository, 'dist/cli.js')), 'web'),
      rendererOrigin: 'http://localhost:5173',
      stateDirectory: join(root, 'server'),
      workspaceRoot: join(root, 'library'),
      attachWorkspace: child => owner.attach(child),
      startupTimeoutMs: 60000,
      shutdownTimeoutMs: 5000,
    })
    const library = new ContentLibrary({
      root: join(root, 'library'),
      host,
      run: (args, signal) => runContentCommand({ ...host, npmCacheDirectory: join(root, 'cache') }, args, signal),
    })
    owner = new DesktopWorkspaceOwner({ root: join(root, 'library'), library, openWorkspace: ContentWorkspace.open })
    const controller = new LocalServerController({ host, library: () => library })
    try {
      await owner.ready()
      const launched = await controller.request({
        action: 'start',
        configuration: { name: '官方玩法好友服', content: 'official', scope: 'local', port: 0 },
      })
      assert.equal(launched.host.status, 'running', JSON.stringify(launched.error))
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
      await page.getByRole('button', { name: '服务器', exact: true }).click()
      await page.getByRole('heading', { name: '当前网页的服务器', exact: true }).waitFor()
      assert.deepEqual(failures, [])
      if (process.env.ARCADIA_UX_SCREENSHOT)
        await page.screenshot({ path: process.env.ARCADIA_UX_SCREENSHOT, fullPage: true })
      await browser.close()
      browser = undefined
      const listed = await host.managementRequest({ method: 'GET', path: '/servers' })
      assert.equal(listed.body.servers[0].name, '官方玩法好友服')
      assert.ok(listed.body.servers[0].defaultBindingId)
      assert.deepEqual((await library.list()).activeIds, [], 'hosting does not change local-play content')
      await controller.request({ action: 'stop' })
      const resumed = await controller.request({ action: 'start' })
      assert.equal(resumed.host.status, 'running', JSON.stringify(resumed.error))
      assert.equal(resumed.host.serverId, launched.host.serverId)
    } finally {
      await browser?.close()
      controller.close()
      await host.stop()
      await owner.close()
      await library.close()
      await rm(root, { recursive: true, force: true })
    }
  },
)
