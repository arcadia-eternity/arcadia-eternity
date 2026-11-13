import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentWorkspace } from '../src/content-workspace.ts'

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
  await ready(workspace)
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
  await assert.rejects(workspace.saveDraft({ document: saved.document, expectedRevision: current.revision }), {
    code: 'REVISION_CONFLICT',
  })
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
