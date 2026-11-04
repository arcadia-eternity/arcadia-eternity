import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContentLibrary } from '../content-library.mjs'
import { LocalBattleHost } from '../local-battle-host.mjs'
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
      const packArguments = ['pack', './examples/ugc/slow', '--json', '--ignore-scripts', '--pack-destination', root]
      const packed = process.env.ARCADIA_DESKTOP_NPM_CLI
        ? await exec(host.executable, [process.env.ARCADIA_DESKTOP_NPM_CLI, ...packArguments], {
            cwd: repository,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          })
        : await exec('npm', packArguments, { cwd: repository })
      await library.installFile(join(root, JSON.parse(packed.stdout)[0].filename), true)
      await settle()
      const local = await library.acquireProject()
      const existingProjects = await readdir(join(root, 'library/projects'))
      await library.start()
      const first = host.status()
      assert.equal(first.status, 'running')
      const capabilities = await request('GET', '/capabilities')
      assert.equal(capabilities.workspaceId, workspace.workspaceId)
      const firstServer = (await request('GET', '/servers')).servers[0]
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
          packages: {},
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
      await library.start()
      const second = host.status()
      assert.equal(second.serverId, first.serverId)
      const restoredServer = (await request('GET', '/servers')).servers[0]
      assert.equal(restoredServer.defaultBindingId, binding.id)
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
