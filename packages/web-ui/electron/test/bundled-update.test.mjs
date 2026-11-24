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
import { LocalBattleHost } from '../local-battle-host.mjs'
import { runContentCommand } from '../content-projects.mjs'

test(
  'client upgrade changes the official base and keeps private environment locks and installations',
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
    await rm(helper, { recursive: true })

    const openLocal = () => ContentWorkspace.open(join(root, 'local'))
    const makeOwner = () =>
      new DesktopWorkspaceOwner({ root: join(root, 'managed'), openWorkspace: ContentWorkspace.open, library })
    let owner = makeOwner()
    let local = new LocalEnvironments({ openWorkspace: openLocal, library, validate: validateWorkspaceProject })
    const operation = await local.request({
      action: 'apply',
      expectedRevision: null,
      document: {
        schemaVersion: 2,
        id: 'with-helper',
        name: 'With helper',
        packages: { [base]: '1.0.0', helper: '1.0.0' },
        sources: [],
        rules: { schemaVersion: 1 },
        requires: {},
      },
    })
    const finish = async (api, id) => {
      for (let i = 0; i < 1200; i++) {
        const job = (await api.snapshot()).operations.find(job => job.id === id)
        if (!['queued', 'running'].includes(job.status)) {
          assert.equal(job.status, 'succeeded', JSON.stringify(job.error))
          return
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('environment operation timed out')
    }
    await finish(local, operation.operationId)
    await finish(local, (await local.request({ action: 'select', environmentId: 'with-helper' })).operationId)
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
            packages: { [base]: '1.0.0' },
            sources: [],
            rules: { schemaVersion: 1 },
            requires: {},
          },
        },
        validateWorkspaceProject,
      )
    const originals = []
    for (const workspace of [await owner.ready(), await local.ready()]) {
      const installation = await workspace.getInstallation('existing')
      originals.push({
        revision: installation.contentRevision,
        lock: await readFile(join(installation.directory, 'package-lock.json')),
      })
    }
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
      assert.notEqual(updated.packages.find(pkg => pkg.bundled).id, initial.packages.find(pkg => pkg.bundled).id)
      assert.equal(updated.activeIds, undefined)
      assert.equal(updated.packages.find(item => item.id === helperId).version, '1.0.0')
      for (const workspace of [await owner.ready(), await local.ready()]) {
        const draft = await workspace.getDraft('existing')
        assert.equal(draft.document.name, 'Keep my settings')
        assert.equal(draft.document.packages[base], '1.0.0')
        const installation = await workspace.getInstallation('existing')
        const original = originals.shift()
        assert.equal(installation.contentRevision, original.revision)
        assert.deepEqual(await readFile(join(installation.directory, 'package-lock.json')), original.lock)
        assert.equal(
          JSON.parse(await readFile(join(installation.directory, 'node_modules', base, 'package.json'), 'utf8'))
            .version,
          '1.0.0',
        )
      }
      const active = await local.acquireProject()
      assert.equal(
        JSON.parse(await readFile(join(active.directory, 'node_modules', base, 'package.json'), 'utf8')).version,
        '1.0.0',
      )
      assert.equal(
        JSON.parse(await readFile(join(active.directory, 'node_modules/helper/package.json'), 'utf8')).version,
        '1.0.0',
      )
      await active.release()
      const customWorkspace = await local.ready()
      const beforeEdit = await customWorkspace.getDraft('with-helper')
      const edit = await local.request({
        action: 'apply',
        expectedRevision: beforeEdit.revision,
        document: { ...beforeEdit.document, name: 'Renamed after upgrade' },
      })
      await finish(local, edit.operationId)
      const edited = await customWorkspace.getInstallation('with-helper')
      assert.equal(
        JSON.parse(await readFile(join(edited.directory, 'node_modules', base, 'package.json'))).version,
        '1.0.0',
      )
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

test(
  'a compatible npm base updates the official environment while existing leases keep their revision',
  { timeout: 120000 },
  async t => {
    const { withOfficialUpdateArchive } = await import('@arcadia-eternity/content-sdk/managed-projects')
    const { activateOfficialEnvironments, createOfficialContentUpdater, openBuiltinEnvironment } =
      await import('../builtin-environment.mjs')
    const {
      synchronizeShippedEnvironments,
      readOfficialEnvironments,
      readInstalledOfficialEnvironments,
      stageBundledOfficialEnvironmentPackages,
    } = await import('@arcadia-eternity/content-sdk/management-workspace')
    const { createHash } = await import('node:crypto')
    const root = await mkdtemp(join(tmpdir(), 'independent-base-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const name = '@arcadia-eternity/data-pack-base'
    const bundled = join(root, 'bundled')
    await withShippedEnvironmentProject(resolve('packs/base'), project =>
      cp(join(project, 'node_modules', name), bundled, { recursive: true }),
    )
    const manifest = JSON.parse(await readFile(join(bundled, 'package.json')))
    manifest.version = '3.0.0'
    manifest.engines = { arcadia: '^4.0.0' }
    await writeFile(join(bundled, 'package.json'), JSON.stringify(manifest))
    const effectFile = join(bundled, manifest.arcadia.effectArtifact)
    const originalEffect = await readFile(effectFile, 'utf8')
    const effect = JSON.parse(originalEffect)
    effect.source += '\n// independent official effect revision\n'
    await writeFile(effectFile, JSON.stringify(effect))
    const bytes = await withShippedCatalogArchive(bundled, undefined, file => readFile(file))
    await writeFile(effectFile, originalEffect)
    manifest.version = '2.0.0'
    manifest.engines = { arcadia: '*' }
    await writeFile(join(bundled, 'package.json'), JSON.stringify(manifest))
    const candidate = {
      name,
      version: '3.0.0',
      range: '^4.0.0',
      url: 'https://registry.npmjs.org/@arcadia-eternity/data-pack-base/-/data-pack-base-3.0.0.tgz',
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    }
    const fetchFromHost = globalThis.fetch
    let damaged = true
    let offline = true
    let archiveRequests = 0
    t.mock.method(globalThis, 'fetch', async url => {
      if (String(url) !== candidate.url) {
        for (const suffix of ['default', 'training-120']) {
          const recipe = JSON.parse(await readFile(resolve('packs/environment-' + suffix, 'package.json'), 'utf8'))
          if (
            String(url) ===
            'https://registry.npmjs.org/' + encodeURIComponent(recipe.name) + '/' + candidate.version
          ) {
            recipe.version = candidate.version
            recipe.dependencies = { [name]: candidate.version }
            recipe.arcadiaEnvironment.name += ' (updated)'
            return Response.json(recipe)
          }
        }
        assert.fail('unexpected registry URL: ' + url)
      }
      archiveRequests++
      const duringDownload = await library.acquireDefaultProject()
      await duringDownload.release()
      return new Response(damaged ? Buffer.from('partial download') : bytes)
    })
    const shippedRecipes = join(root, 'recipes')
    await mkdir(shippedRecipes)
    const resolveRecipe = specifier => join(shippedRecipes, specifier.split('/')[1] + '.json')
    async function stageRecipes(version, updated = false) {
      for (const suffix of ['default', 'training-120']) {
        const recipe = JSON.parse(await readFile(resolve('packs/environment-' + suffix, 'package.json'), 'utf8'))
        recipe.version = version
        if (updated) recipe.arcadiaEnvironment.name += ' (updated)'
        await writeFile(resolveRecipe(recipe.name + '/package.json'), JSON.stringify(recipe))
      }
    }
    await stageRecipes(manifest.version)
    let library, owner, defaultId
    const host = new LocalBattleHost({
      executable: process.execPath,
      cli: resolve('dist/cli.js'),
      rendererOrigin: 'http://localhost:5173',
      stateDirectory: join(root, 'server'),
      workspaceRoot: join(root, 'workspace'),
      officialBaseRoot: () => library.officialPackageRoot,
      builtinId: () => defaultId,
      attachWorkspace: child => owner.attach(child),
      startupTimeoutMs: 60000,
      shutdownTimeoutMs: 5000,
    })
    const options = {
      root: join(root, 'library'),
      host,
      withDefaultArchive: use => withShippedCatalogArchive(bundled, undefined, use),
      packageUpdates: {
        shippedRoot: bundled,
        shippedCatalog: () => readOfficialEnvironments(bundled, resolveRecipe),
        stageShippedEnvironments: (directory, version) =>
          stageBundledOfficialEnvironmentPackages(version, directory, resolveRecipe),
        readEnvironments: directory =>
          readInstalledOfficialEnvironments(join(directory, 'node_modules', name), directory),
        clientVersion: '4.11.0',
        find: async (pkg, version) => {
          assert.equal(pkg, name)
          if (offline) throw new Error('registry offline')
          return version === candidate.version ? null : candidate
        },
        withArchive: (update, signal, use) => withOfficialUpdateArchive(update, undefined, signal, use),
        validate: (directory, signal) =>
          validateWorkspaceProject({ directory, signal }, { effectPreparation: 'prebuilt-only' }),
      },
      run: (args, signal) =>
        runContentCommand(
          { executable: process.execPath, cli: resolve('dist/cli.js'), npmCacheDirectory: join(root, 'cache') },
          args,
          signal,
        ),
    }
    library = new ContentLibrary(options)
    owner = new DesktopWorkspaceOwner({
      root: join(root, 'workspace'),
      openWorkspace: ContentWorkspace.open,
      library,
      builtinId: () => defaultId,
    })
    const workspace = await owner.ready()
    const synchronize = async (validate = validateWorkspaceProject) => {
      const catalog = await library.officialEnvironmentCatalog()
      await openBuiltinEnvironment({
        workspace,
        library,
        catalog,
        synchronizeShippedEnvironments,
        validate,
      })
      await host.refreshBuiltinBindings()
      return catalog.defaultEnvironment
    }
    try {
      const previous = (await library.list()).packages.find(item => item.bundled)
      const envId = await synchronize()
      defaultId = envId
      const startup = await library.acquireDefaultProject()
      const launched = await host.start(startup.directory, {
        launch: { name: '更新测试', host: '127.0.0.1', port: 0, publicOrigin: null, officialContent: true },
      })
      await startup.release()
      const liveVersions = async () => {
        const response = await fetchFromHost(launched.url + '/api/v1/environments')
        return (await response.json()).environments.map(env => env.packages.find(pkg => pkg.name === name).version)
      }
      assert.deepEqual(await liveVersions(), [previous.version, previous.version])
      const prior = await workspace.getInstallation(envId)
      const personal = { ...prior.document, id: 'personal-pinned', name: '固定版本' }
      await workspace.prepareEnvironment(
        { environmentId: personal.id, expectedRevision: null, document: personal, projectDirectory: prior.directory },
        validateWorkspaceProject,
      )
      const locked = await workspace.acquire(prior.installationId)
      const update = createOfficialContentUpdater(library, () =>
        activateOfficialEnvironments(library, synchronize, true),
      )
      try {
        await assert.rejects(update(), /registry offline/)
        assert.equal(archiveRequests, 0)
        assert.deepEqual(await liveVersions(), [previous.version, previous.version])
        offline = false
        await assert.rejects(update(), /SOURCE_INTEGRITY_MISMATCH/)
        assert.equal((await library.list()).packages[0].id, previous.id)
        damaged = false
        const rollbackManifest = join(
          library.officialPackageRoot,
          '../../../environment-packages/@arcadia-eternity/environment-default/package.json',
        )
        const failedActivation = await library.updatePackage(previous.id, candidate.version)
        assert.equal(library.pendingOfficialUpdateId, failedActivation)
        const savedManifest = await readFile(rollbackManifest)
        await rm(rollbackManifest)
        try {
          const activationError = new Error('official activation failed')
          await assert.rejects(
            activateOfficialEnvironments(library, async () => {
              throw activationError
            }),
            error => error === activationError,
          )
          assert.equal(library.pendingOfficialUpdateId, failedActivation)
        } finally {
          await writeFile(rollbackManifest, savedManifest)
        }
        let prepared = 0
        await assert.rejects(
          activateOfficialEnvironments(
            library,
            async () => {
              await synchronize(async input => {
                if (++prepared === 2) throw new Error('second preset failed')
                return validateWorkspaceProject(input)
              })
            },
            true,
          ),
          /second preset failed/,
        )
        assert.equal((await workspace.getInstallation(envId)).document.packages[name], previous.version)
        assert.equal((await library.list()).packages[0].id, previous.id)
        const [updatedId, manualId] = await Promise.all([update(), update({ expectedVersion: candidate.version })])
        assert.equal(manualId, updatedId)
        assert.equal(await update(), null)
        assert.equal(archiveRequests, 3)
        assert.deepEqual(await liveVersions(), [candidate.version, candidate.version])
        await host.stop()
        const pinned = await workspace.getInstallation(personal.id)
        assert.equal(pinned.document.packages[name], previous.version)
        const current = await workspace.getInstallation(envId)
        assert.equal(current.document.name, prior.document.name + ' (updated)')
        assert.notEqual(current.contentRevision, prior.contentRevision)
        for (const [item, version] of [
          [locked, previous.version],
          [current, candidate.version],
        ])
          assert.equal(
            JSON.parse(await readFile(join(item.directory, 'node_modules', name, 'package.json'))).version,
            version,
          )
        const restart = async (version, host, range) => {
          await stageRecipes(version, version === candidate.version)
          manifest.version = version
          manifest.engines = { arcadia: range }
          await writeFile(join(bundled, 'package.json'), JSON.stringify(manifest))
          await library.close()
          options.packageUpdates.clientVersion = host
          library = new ContentLibrary(options)
          await library.resume()
          return (await library.list()).packages.find(item => item.bundled)
        }
        // A future host can still run the older, previously verified v2 held locally.
        assert.equal((await restart('1.0.0', '5.0.0', '*')).id, previous.id)
        await activateOfficialEnvironments(library, synchronize)
        assert.equal((await restart('2.0.0', '4.11.0', '*')).id, updatedId)
        await activateOfficialEnvironments(library, synchronize)
        await writeFile(effectFile, JSON.stringify(effect))
        manifest.description = 'packaging metadata only'
        assert.equal((await restart('3.0.0', '4.11.0', '^4.0.0')).id, updatedId)
        const pinnedSame = { ...current.document, id: 'same-version-pin' }
        await workspace.prepareEnvironment(
          {
            environmentId: pinnedSame.id,
            expectedRevision: null,
            document: pinnedSame,
            projectDirectory: current.directory,
          },
          validateWorkspaceProject,
        )
        const file = manifest.arcadia.catalog
        const original = await readFile(join(bundled, file), 'utf8')
        await writeFile(join(bundled, file), original + '\n')
        const selected = await restart('3.0.0', '4.11.0', '^4.0.0')
        assert.notEqual(selected.id, updatedId)
        let failOnce = true
        await activateOfficialEnvironments(library, async () => {
          if (failOnce) {
            failOnce = false
            throw new Error('failed to activate shipped replacement')
          }
          await synchronize()
        })
        assert.equal((await library.list()).packages.find(item => item.bundled).id, updatedId)
        await restart('3.0.0', '4.11.0', '^4.0.0')
        await activateOfficialEnvironments(library, synchronize)
        for (const [id, expected] of [
          [envId, original + '\n'],
          [pinnedSame.id, original],
        ]) {
          const installation = await workspace.getInstallation(id)
          assert.equal(await readFile(join(installation.directory, 'node_modules', name, file), 'utf8'), expected)
        }
      } finally {
        await locked.release()
      }
    } finally {
      await host.stop()
      await library.close()
      await owner.close()
    }
  },
)
