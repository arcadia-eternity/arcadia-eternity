import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentWorkspace, synchronizeShippedEnvironments } from '../src/content-workspace.ts'

const document = { schemaVersion: 1, id: 'main', name: 'Main', packages: {}, sources: [] }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'content-workspace-'))
  const project = join(root, 'installed')
  await mkdir(join(project, 'node_modules', 'sample'), { recursive: true })
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, dependencies: { sample: '1.0.0' } }),
  )
  await writeFile(
    join(project, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'fixture', dependencies: { sample: '1.0.0' } },
        'node_modules/sample': { version: '1.0.0' },
      },
    }),
  )
  await writeFile(
    join(project, 'node_modules', 'sample', 'package.json'),
    JSON.stringify({ name: 'sample', version: '1.0.0', scripts: { postinstall: 'exit 42' } }),
  )
  await writeFile(join(project, 'node_modules', 'sample', 'content.json'), '{"power":40}')
  await writeFile(join(project, 'node_modules', 'sample', 'index.js'), 'throw new Error("never execute author entry")')
  const roots = new Map()
  const retentions = {
    async list(installationId) {
      return [...roots].filter(([, value]) => value === installationId).map(([id]) => ({ id }))
    },
    async put(installationId, id) {
      roots.set(id, installationId)
    },
    async remove(id) {
      roots.delete(id)
    },
  }
  const location = join(root, 'workspace')
  const workspaces = []
  async function open(options = {}) {
    const workspace = await ContentWorkspace.open(location, { retentions, resolveProject: () => project, ...options })
    workspaces.push(workspace)
    return workspace
  }
  t.after(async () => {
    for (const workspace of workspaces) await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, project, location, roots, open }
}
async function prepare({ directory, draft }) {
  const content = JSON.parse(await readFile(join(directory, 'node_modules/sample/content.json'), 'utf8'))
  return {
    contentRevision: `fixture:${content.power}:${draft.rules.schemaVersion}`,
    packages: [{ name: 'sample', version: '1.0.0' }],
  }
}
async function ready(workspace) {
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  return workspace.prepareEnvironment({ environmentId: 'main', expectedRevision: draft.revision }, prepare)
}

test('environment is a persistent npm project and package.json is authoritative', async t => {
  const { open, location } = await fixture(t)
  const workspace = await open()
  const prepared = await ready(workspace)
  const file = join(location, 'environments/main/package.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(manifest.dependencies.sample, '1.0.0')
  assert.equal(manifest.arcadiaEnvironment.id, 'main')
  manifest.dependencies.sample = '^2.0.0'
  await writeFile(file, JSON.stringify(manifest))
  const current = await workspace.getDraft('main')
  assert.equal(current.document.packages.sample, '^2.0.0')
  const saved = await workspace.saveDraft({
    document: { ...current.document, name: 'Edited' },
    expectedRevision: current.revision,
  })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).arcadiaEnvironment.name, 'Edited')
  assert.equal(saved.document.packages.sample, '^2.0.0')
  assert.deepEqual((await workspace.getInstallation('main')).document, prepared.document)
  await assert.rejects(workspace.saveDraft({ document: saved.document, expectedRevision: current.revision }), {
    code: 'REVISION_CONFLICT',
  })
})

test('saving or applying a replacement must retain the base package across both declaration forms', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const name = '@arcadia-eternity/data-pack-base'
  const draft = await workspace.saveDraft({ document: { ...document, sources: [name] }, expectedRevision: null })
  const pinned = await workspace.saveDraft({
    document: { ...document, packages: { [name]: '1.0.0' } },
    expectedRevision: draft.revision,
  })
  const removed = { document: { ...document, packages: { sample: '1.0.0' } }, expectedRevision: pinned.revision }
  await assert.rejects(workspace.saveDraft(removed), { code: 'ENVIRONMENT_BASE_REQUIRED' })
  await assert.rejects(workspace.prepareEnvironment({ ...removed, environmentId: document.id }, prepare), {
    code: 'ENVIRONMENT_BASE_REQUIRED',
  })
  assert.equal((await workspace.getDraft(document.id)).revision, pinned.revision)
})

test('preparing updates one installation instead of creating selectable snapshots', async t => {
  const { open, project, location } = await fixture(t)
  const workspace = await open()
  const first = await ready(workspace)
  await writeFile(join(project, 'node_modules/sample/content.json'), '{"power":99}')
  const draft = await workspace.getDraft('main')
  const next = await workspace.prepareEnvironment({ environmentId: 'main', expectedRevision: draft.revision }, prepare)
  assert.equal(first.installationId, 'main')
  assert.equal(next.installationId, first.installationId)
  assert.equal(next.directory, join(workspace.root, 'environments/main'))
  assert.equal(next.directory, first.directory)
  assert.notEqual(first.contentRevision, next.contentRevision)
  assert.equal((await workspace.listInstallations()).length, 1)
  await assert.rejects(readFile(join(location, 'versions')), { code: 'ENOENT' })
  await workspace.close()
  const reopened = await open()
  assert.equal((await reopened.getInstallation('main')).contentRevision, next.contentRevision)
})

test('one live owner and environment references prevent destructive deletion', async t => {
  const { open, location } = await fixture(t)
  const workspace = await open()
  await assert.rejects(ContentWorkspace.open(location), { code: 'WORKSPACE_BUSY' })
  await ready(workspace)
  const lease = await workspace.acquire('main')
  const draft = await workspace.getDraft('main')
  await assert.rejects(workspace.deleteDraft({ environmentId: 'main', expectedRevision: draft.revision }), {
    code: 'ENVIRONMENT_IN_USE',
  })
  await lease.release()
  await workspace.retain('main', 'binding:server')
  await assert.rejects(workspace.deleteDraft({ environmentId: 'main', expectedRevision: draft.revision }), {
    code: 'ENVIRONMENT_IN_USE',
  })
  await workspace.releaseRetention('binding:server')
  await workspace.deleteDraft({ environmentId: 'main', expectedRevision: draft.revision })
  assert.deepEqual(await workspace.listDrafts(), [])
})

test('failed preparation and cancellation preserve the installed project', async t => {
  const { open, project } = await fixture(t)
  const workspace = await open()
  const first = await ready(workspace)
  const draft = await workspace.getDraft('main')
  const input = { environmentId: 'main', expectedRevision: draft.revision }
  await writeFile(join(project, 'node_modules/sample/content.json'), '{"power":99}')
  await assert.rejects(
    workspace.prepareEnvironment(input, async () => {
      throw new Error('invalid effect')
    }),
    /invalid effect/,
  )
  const controller = new AbortController()
  await assert.rejects(
    workspace.prepareEnvironment({ ...input, signal: controller.signal }, async args => {
      controller.abort(new Error('cancelled'))
      return prepare(args)
    }),
    /cancelled/,
  )
  assert.equal((await workspace.getInstallation('main')).contentRevision, first.contentRevision)
  assert.equal(JSON.parse(await readFile(join(first.directory, 'node_modules/sample/content.json'))).power, 40)
})

test('preparation checks authorization before replacing the environment', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const first = await ready(workspace)
  const draft = await workspace.getDraft('main')
  await assert.rejects(
    workspace.prepareEnvironment(
      {
        environmentId: 'main',
        expectedRevision: draft.revision,
        beforeCommit: async () => {
          throw new Error('revoked')
        },
      },
      prepare,
    ),
    /revoked/,
  )
  assert.equal((await workspace.getInstallation('main')).createdAt, first.createdAt)
})

test('selected registry dependencies travel with the export and satisfy later imports without downloads', async t => {
  const { root, project, open } = await fixture(t)
  const sender = await open()
  const target = await ContentWorkspace.open(join(root, 'receiver'))
  try {
    const lockPath = join(project, 'package-lock.json')
    const lock = JSON.parse(await readFile(lockPath))
    const dependency = 'node_modules/sample/node_modules/helper'
    const entries = [
      ['node_modules/sample', 'https://registry.npmjs.org/sample/-/sample-1.0.0.tgz', 'public'],
      [dependency, 'https://private.invalid/helper.tgz', 'private'],
    ]
    await mkdir(join(project, dependency), { recursive: true })
    await writeFile(join(project, dependency, 'package.json'), JSON.stringify({ name: 'helper', version: '1.0.0' }))
    for (const [location, resolved, token] of entries)
      lock.packages[location] = {
        version: '1.0.0',
        resolved,
        integrity: 'sha512-' + Buffer.alloc(64, token).toString('base64'),
      }
    await writeFile(lockPath, JSON.stringify(lock))
    await ready(sender)
    const { revision, dependencies } = await sender.previewEnvironmentExport('main')
    assert.deepEqual(dependencies.map(item => [item.name, item.manual]).sort(), [
      ['helper', true],
      ['sample', false],
    ])
    assert.ok(dependencies.every(item => item.bytes > 0))
    const portable = await sender.exportEnvironment('main', { revision, locations: [] })
    const probe = { lock: portable.files.find(file => file.path === 'package-lock.json'), archives: portable.archives }
    assert.deepEqual(
      (await target.missingEnvironmentArchives(probe)).sort(),
      dependencies.map(item => item.integrity).sort(),
    )
    const publicOnly = await sender.exportEnvironment('main', { revision, locations: ['node_modules/sample'] })
    assert.deepEqual(
      publicOnly.archives.map(ref => ref.location),
      [dependency],
    )
    assert.ok(publicOnly.files.some(file => file.path === 'node_modules/sample/content.json'))
    assert.ok(!publicOnly.files.some(file => file.path.startsWith(dependency)))
    await assert.rejects(sender.exportEnvironment('main', { revision: 'old', locations: [] }), {
      code: 'REVISION_CONFLICT',
    })
    const attached = await sender.exportEnvironment('main', {
      revision,
      locations: dependencies.map(item => item.location),
    })
    const restored = await target.importEnvironment(attached, { allowDownload: false }, prepare)
    assert.equal(
      await readFile(join(restored.directory, dependency, 'package.json'), 'utf8'),
      await readFile(join(project, dependency, 'package.json'), 'utf8'),
    )
    assert.deepEqual(await target.missingEnvironmentArchives(probe), [])
    const reused = await target.importEnvironment(portable, { environmentId: 'reused', allowDownload: false }, prepare)
    assert.equal(reused.contentRevision, restored.contentRevision)
  } finally {
    await target.close()
  }
})

test('import checks every declared Arcadia range against the recipient and preserves the current installation on rejection', async t => {
  const { open, project, root } = await fixture(t)
  const { version } = JSON.parse(await readFile(new URL('../../pack-loader/package.json', import.meta.url)))
  const sampleFile = join(project, 'node_modules/sample/package.json')
  const sample = JSON.parse(await readFile(sampleFile))
  sample.dependencies = { helper: '1.0.0' }
  const helper = { name: 'helper', version: '1.0.0', engines: { arcadia: '^' + version.split('.')[0] + '.0.0' } }
  const helperLocation = 'node_modules/sample/node_modules/helper'
  await mkdir(join(project, helperLocation), { recursive: true })
  await writeFile(join(project, helperLocation, 'package.json'), JSON.stringify(helper))
  await writeFile(sampleFile, JSON.stringify(sample))
  const lockFile = join(project, 'package-lock.json')
  const lock = JSON.parse(await readFile(lockFile))
  lock.packages['node_modules/sample'].dependencies = sample.dependencies
  lock.packages[helperLocation] = { version: helper.version, engines: helper.engines }
  await writeFile(lockFile, JSON.stringify(lock))
  const sender = await open()
  await ready(sender)
  const target = await ContentWorkspace.open(join(root, 'recipient'))
  try {
    const bundle = await sender.exportEnvironment('main')
    const installed = await target.importEnvironment(bundle, {}, prepare)
    const previous = await target.getDraft('main')
    for (const [range, code] of [
      ['>', 'ARCADIA_VERSION_RANGE_INVALID'],
      ['>' + version, 'ARCADIA_VERSION_INCOMPATIBLE'],
    ]) {
      const incoming = structuredClone(bundle)
      helper.engines.arcadia = range
      lock.packages[helperLocation].engines = helper.engines
      for (const [path, json] of [
        [helperLocation + '/package.json', helper],
        ['package-lock.json', lock],
      ]) {
        incoming.files.find(file => file.path === path).data = Buffer.from(JSON.stringify(json)).toString('base64')
      }
      await assert.rejects(
        target.importEnvironment(incoming, { expectedRevision: previous.revision }, prepare),
        err =>
          err.code === code &&
          err.message.includes('helper') &&
          (code !== 'ARCADIA_VERSION_INCOMPATIBLE' || (err.message.includes(range) && err.message.includes(version))),
      )
      assert.deepEqual(await target.getDraft('main'), previous)
      assert.equal((await target.getInstallation('main')).contentRevision, installed.contentRevision)
      assert.deepEqual(JSON.parse(await readFile(join(installed.directory, helperLocation, 'package.json'))).engines, {
        arcadia: '^' + version.split('.')[0] + '.0.0',
      })
    }
  } finally {
    await target.close()
  }
})

test('export and import revalidate current materials without matching an old runtime hash', async t => {
  const { open, root } = await fixture(t)
  const workspace = await open()
  await ready(workspace)
  const bundle = await workspace.exportEnvironment('main')
  bundle.contentRevision = 'previous-engine-build'
  const target = await ContentWorkspace.open(join(root, 'target'))
  t.after(() => target.close())
  const imported = await target.importEnvironment(bundle, {}, prepare)
  assert.equal(imported.installationId, 'main')
  assert.equal(imported.contentRevision, 'fixture:40:1')
  assert.equal((await target.getDraft('main')).document.packages.sample, '1.0.0')
  await assert.rejects(target.importEnvironment(bundle, {}, prepare), { code: 'REVISION_CONFLICT' })
  await target.close()
})

test('backup and clone preserve npm projects, not historical versions', async t => {
  const { open, root } = await fixture(t)
  const workspace = await open()
  await ready(workspace)
  await workspace.saveDraft({ document: { ...document, id: 'empty' }, expectedRevision: null })
  const snapshot = await workspace.exportSnapshot()
  assert.equal(snapshot.installations.length, 1)
  for (const mode of ['restore', 'clone']) {
    const target = await ContentWorkspace.open(join(root, mode))
    t.after(() => target.close())
    await target.restoreSnapshot(snapshot, { mode }, prepare)
    assert.equal((await target.getInstallation('main')).installationId, 'main')
    assert.equal((await target.listDrafts()).length, 2)
    assert.equal(target.workspaceId === workspace.workspaceId, mode === 'restore')
    await target.close()
  }
})

test('shipped definitions migrate 4.8 workspace and snapshot identities and accept new environment documents', async t => {
  const { open, location, root, project } = await fixture(t)
  const initial = await open()
  const legacyId = 'builtin-120-4a1f2470-8b31-4059-87f5-46fdf5d3c29e'
  await initial.saveDraft({ document: { ...document, id: legacyId }, expectedRevision: null })
  const snapshot = await initial.exportSnapshot()
  await initial.close()
  const metadataFile = join(location, 'workspace.json')
  const metadata = JSON.parse(await readFile(metadataFile, 'utf8'))
  delete metadata.builtinEnvironmentIds
  await writeFile(metadataFile, JSON.stringify({ ...metadata, builtin120EnvironmentId: legacyId }))
  delete snapshot.builtinEnvironmentIds
  snapshot.builtin120EnvironmentId = legacyId
  const reopened = await open()
  const restored = await ContentWorkspace.open(join(root, 'restored'), { resolveProject: () => project })
  t.after(() => restored.close())
  await restored.restoreSnapshot(snapshot, { mode: 'restore' }, prepare)
  const definitions = ['classic', 'training-120', 'another'].map(id => ({
    schemaVersion: 2,
    id,
    name: id,
    packages: { sample: '1.0.0' },
    sources: [],
    requires: {},
    rules: { schemaVersion: 2 },
  }))
  const catalog = { defaultEnvironment: 'classic', environments: definitions }
  for (const owner of [reopened, restored]) {
    const prepared = []
    const synchronize = () =>
      synchronizeShippedEnvironments(owner, catalog, { classic: 'classic' }, async (doc, revision) => {
        prepared.push(doc.id)
        assert.equal(doc.packages.sample, '1.0.0')
        const draft = await owner.saveDraft({ document: doc, expectedRevision: revision })
        await owner.prepareEnvironment({ environmentId: doc.id, expectedRevision: draft.revision }, prepare)
      })
    assert.equal(await synchronize(), 'classic')
    assert.equal(owner.builtinEnvironmentIds['training-120'], 'training-120')
    assert.deepEqual(owner.builtinEnvironmentAliases, { [legacyId]: 'training-120' })
    assert.deepEqual(prepared, ['classic', 'training-120', 'another'])
    await synchronize()
    assert.equal(prepared.length, 3)
    assert.equal((await owner.listDrafts()).length, 3)
    const archived = JSON.parse(await readFile(join(owner.root, 'migration-backups', legacyId, 'package.json'), 'utf8'))
    assert.equal(archived.arcadiaEnvironment.id, legacyId)
    assert.deepEqual((await owner.exportSnapshot()).builtinEnvironmentAliases, { [legacyId]: 'training-120' })
    assert.deepEqual((await owner.exportSnapshot()).builtinEnvironmentIds, owner.builtinEnvironmentIds)
  }
  await restored.close()
})

test('registering shipped IDs preserves a conflicting custom draft', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const custom = await workspace.saveDraft({ document, expectedRevision: null })
  await assert.rejects(workspace.registerBuiltinEnvironments(['main'], {}), { code: 'BUILTIN_ENVIRONMENT_ID_CONFLICT' })
  assert.deepEqual(await workspace.getDraft('main'), custom)
  assert.deepEqual(workspace.builtinEnvironmentIds, {})
})

test('online backup stamp detects edits to installed files and is single use', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const installation = await ready(workspace)
  const capture = await workspace.captureSnapshot()
  await writeFile(join(installation.directory, 'node_modules/sample/content.json'), '{"power":99}')
  assert.equal(await workspace.isSnapshotCurrent(capture.stamp), false)
  const unchanged = await workspace.captureSnapshot()
  assert.equal(await workspace.isSnapshotCurrent(unchanged.stamp), true)
  assert.equal(await workspace.isSnapshotCurrent(unchanged.stamp), false)
})

test('untrusted material cannot escape the project directory', async t => {
  const { open, project, root } = await fixture(t)
  const workspace = await open()
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  const outside = join(root, 'secret')
  await writeFile(outside, 'secret')
  await symlink(outside, join(project, 'node_modules/sample/escape'))
  await assert.rejects(
    workspace.prepareEnvironment({ environmentId: 'main', expectedRevision: draft.revision }, prepare),
    { code: 'MATERIAL_PATH_ESCAPE' },
  )
})

test('interrupted committed imports retain recoverable intent and cannot enter a backup', async t => {
  const { open, root } = await fixture(t)
  const workspace = await open()
  await ready(workspace)
  const bundle = await workspace.exportEnvironment('main')
  const target = await ContentWorkspace.open(join(root, 'import-target'))
  const importId = 'a'.repeat(64)
  await assert.rejects(
    target.importEnvironment(
      bundle,
      {
        importId,
        beforeCommit: async () => {
          throw new Error('response lost after database commit')
        },
      },
      prepare,
    ),
    /response lost/,
  )
  await assert.rejects(target.exportSnapshot(), { code: 'WORKSPACE_SNAPSHOT_UNSETTLED' })
  await target.cleanupStaging()
  await target.close()
  const reopened = await ContentWorkspace.open(join(root, 'import-target'))
  try {
    const installed = await reopened.recoverImport(importId)
    assert.equal(installed.installationId, 'main')
    const draft = await reopened.getDraft('main')
    await reopened.saveDraft({ document: { ...draft.document, name: 'Later edit' }, expectedRevision: draft.revision })
    await reopened.recoverImport(importId)
    assert.equal((await reopened.getDraft('main')).document.name, 'Later edit')
    await reopened.forgetImport(importId)
    assert.equal((await reopened.exportSnapshot()).installations.length, 1)
  } finally {
    await reopened.close()
  }
})

test('backup preserves cleared projects and pending dependency edits', async t => {
  for (const clear of [false, true]) {
    const { open, root } = await fixture(t)
    const workspace = await open()
    const installed = await ready(workspace)
    const file = join(installed.directory, 'package.json')
    const manifest = JSON.parse(await readFile(file, 'utf8'))
    manifest.dependencies.sample = '^2.0.0'
    manifest.custom = { retained: true }
    await writeFile(file, JSON.stringify(manifest))
    await mkdir(join(installed.directory, 'candidates'))
    await writeFile(join(installed.directory, 'candidates/source.tgz'), 'archive')
    await assert.rejects(workspace.exportEnvironment('main'), { code: 'ENVIRONMENT_PREPARATION_REQUIRED' })
    if (clear) await workspace.clearInstallation('main')
    const snapshot = await workspace.exportSnapshot()
    const target = await ContentWorkspace.open(join(root, 'restored'))
    t.after(() => target.close())
    await target.restoreSnapshot(snapshot, { mode: 'restore' }, prepare)
    const directory = join(target.root, 'environments/main')
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')), manifest)
    assert.equal(
      await readFile(join(directory, 'package-lock.json'), 'utf8'),
      await readFile(join(installed.directory, 'package-lock.json'), 'utf8'),
    )
    assert.equal(await readFile(join(directory, 'candidates/source.tgz'), 'utf8'), 'archive')
    assert.equal((await target.listInstallations()).length, clear ? 0 : 1)
    await target.close()
  }
})

test('a reader keeps consistent materials while the current project is replaced', async t => {
  const { open, project } = await fixture(t)
  const workspace = await open()
  await ready(workspace)
  const reader = await workspace.acquire('main')
  try {
    await writeFile(join(project, 'node_modules/sample/content.json'), '{"power":80}')
    const draft = await workspace.getDraft('main')
    const installed = await workspace.prepareEnvironment(
      { environmentId: 'main', expectedRevision: draft.revision },
      prepare,
    )
    assert.equal(
      JSON.parse(await readFile(join(reader.directory, 'node_modules/sample/content.json'), 'utf8')).power,
      40,
    )
    assert.equal(
      JSON.parse(await readFile(join(installed.directory, 'node_modules/sample/content.json'), 'utf8')).power,
      80,
    )
  } finally {
    await reader.release()
  }
  await assert.rejects(readFile(join(reader.directory, 'package.json')), { code: 'ENOENT' })
})
