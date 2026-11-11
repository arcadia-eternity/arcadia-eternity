import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentWorkspace } from '../src/content-workspace.ts'
import { outputSchemas } from '../src/mcp-contracts.ts'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'

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
    async list(versionId) {
      return [...roots].filter(([, value]) => value === versionId).map(([id]) => ({ id }))
    },
    async put(versionId, id) {
      roots.set(id, versionId)
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
  return workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, prepare)
}

test('workspace has one live owner, stable identity and explicit draft conflicts', async t => {
  const { open, location } = await fixture(t)
  const workspace = await open()
  await assert.rejects(ContentWorkspace.open(location), { code: 'WORKSPACE_BUSY' })
  const saved = await workspace.saveDraft({ document, expectedRevision: null })
  assert.equal(saved.document.schemaVersion, 2)
  await assert.rejects(workspace.saveDraft({ document: { ...document, name: 'Stale' }, expectedRevision: null }), {
    code: 'REVISION_CONFLICT',
  })
  const updated = await workspace.saveDraft({
    document: { ...document, name: 'New' },
    expectedRevision: saved.revision,
  })
  assert.notEqual(updated.revision, saved.revision)
  const id = workspace.workspaceId
  await workspace.close()
  const reopened = await open()
  assert.equal(reopened.workspaceId, id)
  assert.equal((await reopened.listDrafts())[0].document.name, 'New')
})

test('captured artifacts isolate source changes without running scripts or modules', async t => {
  const { open, project } = await fixture(t)
  const workspace = await open()
  const first = await ready(workspace)
  assert.equal(first.status, 'ready')
  assert.notEqual(first.directory, project)
  await writeFile(join(project, 'node_modules/sample/content.json'), '{"power":99}')
  assert.equal(JSON.parse(await readFile(join(first.directory, 'node_modules/sample/content.json'))).power, 40)
  const draft = await workspace.getDraft('main')
  const second = await workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, prepare)
  assert.notEqual(first.versionId, second.versionId)
  assert.notEqual(first.contentRevision, second.contentRevision)
  assert.equal((await workspace.listVersions()).length, 2)
  await workspace.close()
  const reopened = await open()
  assert.equal((await reopened.getVersion(first.versionId)).contentRevision, first.contentRevision)
})

test('runtime leases and durable references prevent GC with concurrent acquire', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  const lease = await workspace.acquire(version.versionId, 'room:A')
  await assert.rejects(workspace.close(), { code: 'WORKSPACE_IN_USE' })
  await workspace.retain(version.versionId, 'binding:one')
  assert.equal((await workspace.references(version.versionId)).length, 2)
  await assert.rejects(workspace.deleteVersion(version.versionId), { code: 'ENVIRONMENT_IN_USE' })
  await lease.release()
  await workspace.close()
  const reopened = await open()
  assert.equal((await reopened.references(version.versionId)).length, 1, 'runtime lease does not resurrect')
  await assert.rejects(reopened.deleteVersion(version.versionId), { code: 'ENVIRONMENT_IN_USE' })
  await reopened.releaseRetention('binding:one')
  const [leased, deletion] = await Promise.allSettled([
    reopened.acquire(version.versionId),
    reopened.deleteVersion(version.versionId),
  ])
  assert.equal(leased.status, 'fulfilled')
  assert.equal(deletion.status, 'rejected')
  await leased.value.release()
  await reopened.deleteVersion(version.versionId)
  await assert.rejects(reopened.acquire(version.versionId), { code: 'ENOENT' })
})

test('missing material and unavailable retention authority fail closed', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  await rm(join(version.directory, 'package-lock.json'))
  assert.equal((await workspace.listVersions())[0].status, 'unavailable')
  await assert.rejects(workspace.acquire(version.versionId), { code: 'ENOENT' })
  await workspace.close()
  const reopened = await open({ retentions: undefined })
  await assert.rejects(reopened.deleteVersion(version.versionId), { code: 'RETENTION_UNAVAILABLE' })
})

test('failed and cancelled preparations leave old versions intact and never become ready', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  const draft = await workspace.getDraft('main')
  await assert.rejects(
    workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, async () => {
      throw new Error('invalid material')
    }),
    /invalid material/,
  )
  const controller = new AbortController()
  await assert.rejects(
    workspace.prepareVersion(
      { environmentId: 'main', expectedRevision: draft.revision, signal: controller.signal },
      async input => {
        controller.abort(new Error('cancelled'))
        return prepare(input)
      },
    ),
    /cancelled/,
  )
  assert.deepEqual(
    (await workspace.listVersions()).map(v => v.versionId),
    [version.versionId],
  )
})

test('late prepare captures old draft and cannot change latest selection', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  let entered, release
  const started = new Promise(resolve => {
    entered = resolve
  })
  const gate = new Promise(resolve => {
    release = resolve
  })
  const pending = workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, async input => {
    entered()
    await gate
    return prepare(input)
  })
  await started
  const latest = await workspace.saveDraft({
    document: { ...document, name: 'Latest' },
    expectedRevision: draft.revision,
  })
  release()
  const old = await pending
  assert.equal(old.draftRevision, draft.revision)
  assert.equal((await workspace.getDraft('main')).revision, latest.revision)
})

test('portable archive validates bytes and rejects traversal, identity leakage and unvalidated imports', async t => {
  const { open, root } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  const archive = await workspace.exportVersion(version.versionId)
  assert.equal(JSON.stringify(archive).includes(root), false)
  assert.equal(archive.workspaceId, undefined)
  assert.equal(archive.versionId, undefined)
  const imported = await workspace.importVersion(archive, { environmentId: 'copy' }, prepare)
  assert.equal(imported.contentRevision, version.contentRevision)
  assert.notEqual(imported.versionId, version.versionId)
  const hostile = structuredClone(archive)
  hostile.files.push({ path: '../escape', data: '' })
  await assert.rejects(workspace.importVersion(hostile, { environmentId: 'bad' }, prepare), {
    code: 'MATERIAL_PATH_INVALID',
  })
  await assert.rejects(
    workspace.importVersion({ ...archive, contentRevision: 'forged' }, { environmentId: 'bad' }, prepare),
    { code: 'ENVIRONMENT_IMPORT_MISMATCH' },
  )
  assert.equal(
    (await workspace.listDrafts()).some(x => x.document.id === 'bad'),
    false,
  )
})

test('material capture rejects symlink escape and nonportable locks', async t => {
  const { open, project, root } = await fixture(t)
  const workspace = await open()
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  const outside = join(root, 'secret.txt')
  await writeFile(outside, 'secret')
  await symlink(outside, join(project, 'node_modules/sample/leak'))
  await assert.rejects(workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, prepare), {
    code: 'MATERIAL_PATH_ESCAPE',
  })
  await rm(join(project, 'node_modules/sample/leak'))
  await writeFile(join(project, '.npmrc'), 'secret-token')
  await symlink(join(project, '.npmrc'), join(project, 'node_modules/sample/leak'))
  await assert.rejects(workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, prepare), {
    code: 'MATERIAL_PATH_INVALID',
  })
  await rm(join(project, 'node_modules/sample/leak'))
  await writeFile(
    join(project, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/sample': { resolved: 'file:/private/secret' } } }),
  )
  await assert.rejects(workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, prepare), {
    code: 'MATERIAL_LOCK_NOT_PORTABLE',
  })
})

test('zero-copy adoption requires material owner and releases only after version deletion', async t => {
  const { open, project, location } = await fixture(t)
  await mkdir(location)
  const { cp } = await import('node:fs/promises')
  const shared = join(location, 'projects', 'existing')
  await cp(project, shared, { recursive: true })
  let retained = 0
  const workspace = await open({
    acquireMaterials: async () => {
      retained++
      return () => {
        retained--
      }
    },
  })
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  const version = await workspace.adoptVersion(
    { environmentId: 'main', expectedRevision: draft.revision, directory: shared },
    prepare,
  )
  assert.equal(version.directory, await realpath(shared))
  assert.equal(retained, 1)
  await workspace.deleteVersion(version.versionId)
  assert.equal(retained, 0)
  assert.equal(JSON.parse(await readFile(join(shared, 'package.json'))).name, 'fixture')
})

test('MCP output keeps v2 rule and requirements fields', () => {
  const value = {
    ...document,
    schemaVersion: 2,
    rules: { schemaVersion: 1, team: { maxSize: 3 } },
    requires: { capabilities: ['teams'] },
    version: 'a'.repeat(64),
  }
  assert.deepEqual(outputSchemas['environment-save'].parse(value), value)
})

test('prepared material must satisfy declared package selection', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const draft = await workspace.saveDraft({
    document: { ...document, packages: { sample: '^2.0.0' } },
    expectedRevision: null,
  })
  await assert.rejects(workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, prepare), {
    code: 'ENVIRONMENT_PACKAGE_MISMATCH',
  })
  assert.equal((await workspace.listVersions()).length, 0)
})

test('cancelled or unauthorized import never overwrites an existing draft', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  const archive = await workspace.exportVersion(version.versionId)
  const original = await workspace.getDraft('main')
  archive.document.name = 'Imported'
  await assert.rejects(
    workspace.importVersion(
      archive,
      {
        expectedRevision: original.revision,
        beforeCommit: async () => {
          throw new Error('permission revoked')
        },
      },
      prepare,
    ),
    /permission revoked/,
  )
  assert.deepEqual(await workspace.getDraft('main'), original)
  assert.equal((await workspace.listVersions()).length, 1)
  const controller = new AbortController()
  await assert.rejects(
    workspace.importVersion(
      archive,
      {
        expectedRevision: original.revision,
        signal: controller.signal,
      },
      async input => {
        controller.abort(new Error('cancelled'))
        return prepare(input)
      },
    ),
    /cancelled/,
  )
  assert.deepEqual(await workspace.getDraft('main'), original)
})

test('prepare checks authorization immediately before committing the frozen version', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  await assert.rejects(
    workspace.prepareVersion(
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
  assert.equal((await workspace.listVersions()).length, 0)
})

test('an import survives process death at the durable commit boundary and resumes exactly once', async t => {
  const { open, root, location } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  const bundle = await workspace.exportVersion(version.versionId)
  bundle.document.id = 'recovered'
  const file = join(root, 'bundle.json')
  await writeFile(file, JSON.stringify(bundle))
  await workspace.close()
  const importId = 'a'.repeat(64)
  const module = new URL('../src/content-workspace.ts', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { readFile } from 'node:fs/promises';
    import { ContentWorkspace } from ${JSON.stringify(module)};
    const workspace = await ContentWorkspace.open(process.argv[1]);
    const bundle = JSON.parse(await readFile(process.argv[2], 'utf8'));
    await workspace.importVersion(bundle, { importId: process.argv[3], beforeCommit: async () => process.exit(23) },
      async () => ({ contentRevision: bundle.contentRevision, packages: [{ name: 'sample', version: '1.0.0' }] }));
  `,
      location,
      file,
      importId,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  assert.equal((await once(child, 'close'))[0], 23)
  const recovered = await open({ stagingRetentionMs: 0 })
  assert.deepEqual(await recovered.cleanupStaging(), [])
  await assert.rejects(recovered.getDraft('recovered'), { code: 'ENOENT' })
  const first = await recovered.recoverImport(importId)
  const draft = await recovered.getDraft('recovered')
  await recovered.saveDraft({ document: { ...draft.document, name: 'Later edit' }, expectedRevision: draft.revision })
  assert.equal((await recovered.recoverImport(importId)).versionId, first.versionId)
  assert.equal((await recovered.getDraft('recovered')).document.name, 'Later edit')
  await assert.rejects(recovered.deleteVersion(first.versionId), { code: 'ENVIRONMENT_IN_USE' })
  await recovered.forgetImport(importId)
  await recovered.deleteVersion(first.versionId)
})

test('server snapshot restore preserves identity while clone remaps version identities', async t => {
  const { open, root } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  const snapshot = await workspace.exportSnapshot()
  const restored = await ContentWorkspace.open(join(root, 'restore'))
  const cloned = await ContentWorkspace.open(join(root, 'clone'))
  try {
    const original = await restored.restoreSnapshot(snapshot, { mode: 'restore' }, prepare)
    assert.equal(original.workspaceId, workspace.workspaceId)
    assert.equal(original.versionIds[version.versionId], version.versionId)
    assert.equal((await restored.getVersion(version.versionId)).contentRevision, version.contentRevision)
    const copy = await cloned.restoreSnapshot(snapshot, { mode: 'clone' }, prepare)
    assert.notEqual(copy.workspaceId, workspace.workspaceId)
    assert.notEqual(copy.versionIds[version.versionId], version.versionId)
    assert.equal((await cloned.getVersion(copy.versionIds[version.versionId])).contentRevision, version.contentRevision)
    await assert.rejects(restored.restoreSnapshot(snapshot, { mode: 'restore' }, prepare), {
      code: 'WORKSPACE_NOT_EMPTY',
    })
  } finally {
    await restored.close()
    await cloned.close()
  }
})

test('online snapshot stamps are one-use, owner-scoped and invalidate actual exported-file edits', async t => {
  const { open, project } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  const first = await workspace.captureSnapshot()
  assert.equal(await workspace.isSnapshotCurrent({ ...first.stamp, bootId: randomUUID() }), false)
  assert.equal(await workspace.isSnapshotCurrent(first.stamp), true)
  assert.equal(await workspace.isSnapshotCurrent(first.stamp), false)
  const isolated = await workspace.captureSnapshot()
  // Author source edits cannot change the captured immutable project.
  await writeFile(join(project, 'node_modules/sample/content.json'), '{"power":99}')
  assert.equal(await workspace.isSnapshotCurrent(isolated.stamp), true)
  const corrupted = await workspace.captureSnapshot()
  await writeFile(join(version.directory, 'node_modules/sample/content.json'), '{"power":77}')
  assert.equal(await workspace.isSnapshotCurrent(corrupted.stamp), false)
})

test('online stamps invalidate successful and failed metadata mutations and version GC', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  let capture = await workspace.captureSnapshot()
  const draft = await workspace.getDraft('main')
  await workspace.saveDraft({ document: { ...draft.document, name: 'Updated' }, expectedRevision: draft.revision })
  assert.equal(await workspace.isSnapshotCurrent(capture.stamp), false)
  capture = await workspace.captureSnapshot()
  await assert.rejects(workspace.saveDraft({ document, expectedRevision: 'stale' }), { code: 'REVISION_CONFLICT' })
  assert.equal(await workspace.isSnapshotCurrent(capture.stamp), false)
  capture = await workspace.captureSnapshot()
  await workspace.deleteVersion(version.versionId)
  assert.equal(await workspace.isSnapshotCurrent(capture.stamp), false)
  capture = await workspace.captureSnapshot()
  await workspace.deleteDraft({ environmentId: 'main', expectedRevision: (await workspace.getDraft('main')).revision })
  assert.equal(await workspace.isSnapshotCurrent(capture.stamp), false)
})

test('unresolved import commit receipts prevent both offline and online unrestorable snapshots', async t => {
  const { open } = await fixture(t)
  const workspace = await open()
  const version = await ready(workspace)
  const bundle = await workspace.exportVersion(version.versionId)
  const capture = await workspace.captureSnapshot()
  const importId = 'b'.repeat(64)
  await assert.rejects(
    workspace.importVersion(
      bundle,
      {
        environmentId: 'imported',
        importId,
        beforeCommit: async () => {
          throw new Error('commit reply lost')
        },
      },
      prepare,
    ),
    /commit reply lost/,
  )
  assert.equal(await workspace.isSnapshotCurrent(capture.stamp), false)
  await assert.rejects(workspace.captureSnapshot(), { code: 'WORKSPACE_SNAPSHOT_UNSETTLED' })
  await assert.rejects(workspace.exportSnapshot(), { code: 'WORKSPACE_SNAPSHOT_UNSETTLED' })
  // Only the durable operation owner decides commit vs discard.
  await workspace.recoverImport(importId)
  const recovered = await workspace.captureSnapshot()
  assert.equal(recovered.snapshot.versions.length, 2)
  assert.equal(await workspace.isSnapshotCurrent(recovered.stamp), true)
  await workspace.forgetImport(importId)
})

test('a dead owner can be recovered without stealing a live process lock', async t => {
  const { open, location } = await fixture(t)
  const module = new URL('../src/content-workspace.ts', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { ContentWorkspace } from ${JSON.stringify(module)}; const w=await ContentWorkspace.open(process.argv[1]); console.log(w.workspaceId); setInterval(()=>{},1000);`,
      location,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  const [data] = await once(child.stdout, 'data')
  const id = String(data).trim()
  await assert.rejects(open(), { code: 'WORKSPACE_BUSY' })
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  const recovered = await open()
  assert.equal(recovered.workspaceId, id)
})

test('staging cleanup never deletes an active preparation', async t => {
  const { open, location } = await fixture(t)
  const workspace = await open({ stagingRetentionMs: 0 })
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  const orphan = randomUUID()
  await mkdir(join(location, 'staging', orphan))
  let entered, release
  const started = new Promise(resolve => {
    entered = resolve
  })
  const gate = new Promise(resolve => {
    release = resolve
  })
  const pending = workspace.prepareVersion({ environmentId: 'main', expectedRevision: draft.revision }, async input => {
    entered()
    await gate
    return prepare(input)
  })
  await started
  assert.deepEqual(await workspace.cleanupStaging(), [orphan])
  release()
  assert.equal((await pending).status, 'ready')
})
