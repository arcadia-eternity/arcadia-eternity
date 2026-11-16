import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import { ManagedProjects } from '@arcadia-eternity/content-sdk/managed-projects'
import { withShippedCatalogArchive, withShippedEnvironmentProject } from '@arcadia-eternity/pack-loader/node'
import { validateWorkspaceProject } from '@arcadia-eternity/server'
import { ContentLibrary } from '../content-library.mjs'
import { DesktopWorkspaceOwner } from '../desktop-workspace-owner.mjs'
import { LocalEnvironments } from '../local-environments.mjs'
import { runContentCommand } from '../content-projects.mjs'

test(
  'client startup refreshes its library, local environments and desktop-owned environments',
  { timeout: 120000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'client-bundled-update-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const base = '@arcadia-eternity/data-pack-base'
    const bundled = join(root, 'bundled')
    await withShippedEnvironmentProject(resolve('packs/base'), directory =>
      cp(join(directory, 'node_modules', base), bundled, { recursive: true }),
    )
    const manifest = JSON.parse(await readFile(join(bundled, 'package.json'), 'utf8'))
    manifest.version = '1.0.0'
    await writeFile(join(bundled, 'package.json'), JSON.stringify(manifest))
    let rejectApproval = false
    const makeLibrary = () =>
      new ContentLibrary({
        root: join(root, 'library'),
        prepare: async () => {},
        selected: () => {},
        host: { status: () => ({ status: 'idle' }), retainedProjectDirectories: async () => [] },
        withDefaultArchive: use => withShippedCatalogArchive(bundled, undefined, use),
        createManagedProjects: (directory, options) =>
          new ManagedProjects(directory, { ...options, bundledPackageRoot: bundled }),
        run: (args, signal) => {
          if (rejectApproval && args[2] === 'approve') throw new Error('reject bundled update')
          return runContentCommand(
            { executable: process.execPath, cli: resolve('dist/cli.js'), npmCacheDirectory: join(root, 'cache') },
            args,
            signal,
          )
        },
      })
    let library = makeLibrary()
    const initial = await library.list()
    assert.equal(initial.packages.find(item => item.bundled).version, '1.0.0')
    const helper = join(root, 'helper')
    await mkdir(helper)
    await writeFile(
      join(helper, 'package.json'),
      JSON.stringify({
        name: 'helper',
        version: '1.0.0',
        arcadia: { formatVersion: 1, projectId: 'helper', namespace: 'helper', content: 'content.json' },
      }),
    )
    await writeFile(
      join(helper, 'content.json'),
      JSON.stringify({ data: { species: [], skills: [], marks: [], behaviors: [] } }),
    )
    const packed = await promisify(execFile)(
      'npm',
      ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', root],
      { cwd: helper },
    )
    const helperId = await library.installFile(join(root, JSON.parse(packed.stdout)[0].filename), true)
    await library.setSelection([initial.activeIds[0], helperId], true)
    for (let i = 0; i < 600; i++) {
      const snapshot = await library.list()
      if (snapshot.selection.status === 'failed') throw new Error(snapshot.selection.message)
      if (snapshot.selection.status === 'ready') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal((await library.list()).selection.status, 'ready')
    await rm(helper, { recursive: true })

    const openLocal = () => ContentWorkspace.open(join(root, 'local'))
    const makeOwner = () =>
      new DesktopWorkspaceOwner({ root: join(root, 'managed'), openWorkspace: ContentWorkspace.open, library })
    let owner = makeOwner()
    let local = new LocalEnvironments({ openWorkspace: openLocal, library, validate: validateWorkspaceProject })
    const installer = new ManagedProjects(join(root, 'installer'), { bundledPackageRoot: bundled, offline: true })
    for (const workspace of [await owner.ready(), await local.ready()])
      await installer.prepareEnvironment(
        workspace,
        {
          environmentId: 'existing',
          expectedRevision: null,
          document: {
            schemaVersion: 2,
            id: 'existing',
            name: 'Keep my settings',
            packages: { [base]: '0.0.1' },
            sources: [],
            rules: { schemaVersion: 1 },
            requires: {},
          },
        },
        validateWorkspaceProject,
      )
    await installer.close()
    await local.close()
    await owner.close()
    await library.close()
    manifest.version = '2.0.0'
    await writeFile(join(bundled, 'package.json'), JSON.stringify(manifest))
    library = makeLibrary()
    owner = makeOwner()
    local = new LocalEnvironments({ openWorkspace: openLocal, library, validate: validateWorkspaceProject })
    try {
      const originalState = await readFile(join(root, 'library/library.json'))
      rejectApproval = true
      await assert.rejects(library.resume(), /reject bundled update/)
      assert.deepEqual(await readFile(join(root, 'library/library.json')), originalState)
      rejectApproval = false
      await library.resume()
      const updated = await library.list()
      assert.equal(updated.packages.find(item => item.bundled).version, '2.0.0')
      assert.notEqual(updated.activeIds[0], initial.activeIds[0])
      assert.equal(updated.activeIds[1], helperId)
      assert.equal(updated.packages.find(item => item.id === helperId).version, '1.0.0')
      for (const workspace of [await owner.ready(), await local.ready()]) {
        const draft = await workspace.getDraft('existing')
        assert.equal(draft.document.name, 'Keep my settings')
        assert.equal(draft.document.packages[base], '2.0.0')
        const installation = await workspace.getInstallation('existing')
        assert.equal(
          JSON.parse(await readFile(join(installation.directory, 'node_modules', base, 'package.json'), 'utf8'))
            .version,
          '2.0.0',
        )
      }
      const active = await library.acquireProject()
      assert.equal(
        JSON.parse(await readFile(join(active.directory, 'node_modules', base, 'package.json'), 'utf8')).version,
        '2.0.0',
      )
      assert.equal(
        JSON.parse(await readFile(join(active.directory, 'node_modules/helper/package.json'), 'utf8')).version,
        '1.0.0',
      )
      await active.release()
      await library.close()
      library = makeLibrary()
      rejectApproval = true
      assert.deepEqual((await library.list()).activeIds, updated.activeIds)
    } finally {
      await local.close()
      await owner.close()
      await library.close()
    }
  },
)
