import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath, copyFile, readFile, readdir, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ContentWorkspace,
  addEnvironmentPackage,
  removeEnvironmentPackage,
} from '../../../content-dev/src/content-workspace.ts'
import { LocalEnvironments } from '../local-environments.mjs'

const document = {
  schemaVersion: 2,
  id: 'friends',
  name: '好友环境',
  packages: { sample: '1.0.0' },
  sources: [],
  rules: { schemaVersion: 1 },
  requires: {},
}
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'offline-environments-')))
  const project = join(root, 'material')
  await mkdir(join(project, 'node_modules/sample'), { recursive: true })
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { sample: '1.0.0' } }))
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
    join(project, 'node_modules/sample/package.json'),
    JSON.stringify({ name: 'sample', version: '1.0.0' }),
  )
  await writeFile(join(project, 'node_modules/sample/index.js'), 'throw new Error("must not execute author code")')
  const requests = [],
    releases = []
  const library = {
    async prepareEnvironmentProject(doc, options) {
      requests.push({ doc, options })
      options.signal.throwIfAborted()
      return { directory: project, release: async () => releases.push(true) }
    },
  }
  const validate = async ({ signal }) => {
    signal?.throwIfAborted()
    return { contentRevision: 'test:static', packages: [{ name: 'sample', version: '1.0.0' }] }
  }
  const instances = []
  const open = (options = {}) => {
    const api = new LocalEnvironments({
      openWorkspace: () => ContentWorkspace.open(join(root, 'workspace'), { retentions: { list: async () => [] } }),
      library,
      validate,
      addPackage: addEnvironmentPackage,
      removePackage: removeEnvironmentPackage,
      ...options,
    })
    instances.push(api)
    return api
  }
  t.after(async () => {
    for (const api of instances) await api.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, validate, instances, open, requests, releases, library, project }
}
async function complete(api, id) {
  // Preparation includes real npm inspection, which can take seconds on CI runners.
  const deadline = performance.now() + 30000
  let lastJob
  while (performance.now() < deadline) {
    const job = (await api.snapshot()).operations.find(job => job.id === id)
    lastJob = job
    if (!['queued', 'running'].includes(job.status)) return job
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`local environment task timed out: ${JSON.stringify(lastJob)}`)
}
test('offline drafts survive reopening, reject stale writes and installations copy materials independently', async t => {
  const f = await fixture(t)
  let api = f.open()
  const saved = await (await api.ready()).saveDraft({ document, expectedRevision: null })
  assert.equal(f.requests.length, 0)
  await api.close()
  api = f.open()
  const restored = (await api.snapshot()).environments[0]
  assert.equal(restored.revision, saved.revision)
  await assert.rejects(
    (await api.ready()).saveDraft({ document: { ...document, name: '冲突' }, expectedRevision: 'stale' }),
    { code: 'REVISION_CONFLICT' },
  )
  const started = await api.request({ action: 'apply', document, expectedRevision: saved.revision })
  const job = await complete(api, started.operationId)
  assert.equal(job.status, 'succeeded', JSON.stringify(job.error))
  assert.equal(f.requests[0].options.offline, true)
  assert.equal(f.releases.length, 1)
  assert.equal('directory' in job.result, false)
  await rm(f.project, { recursive: true })
  const exported = await api.request({ action: 'export', installationId: job.result.installationId })
  assert.ok(exported)
  const current = (await api.snapshot()).environments[0]
  await api.request({ action: 'delete-draft', environmentId: document.id, expectedRevision: current.revision })
  assert.equal((await api.snapshot()).environments.length, 0)
})
test('cancels preparation without publishing a version and keeps the saved draft', async t => {
  const f = await fixture(t)
  f.library.prepareEnvironmentProject = async (_document, { signal }) =>
    new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  const api = f.open()
  const draft = await (await api.ready()).saveDraft({ document, expectedRevision: null })
  const job = await api.request({ action: 'apply', document, expectedRevision: draft.revision })
  const queued = await api.request({ action: 'apply', document, expectedRevision: draft.revision })
  assert.equal((await api.snapshot()).operations.find(item => item.id === queued.operationId).status, 'queued')
  await api.request({ action: 'cancel', operationId: queued.operationId })
  await api.request({ action: 'cancel', operationId: job.operationId })
  assert.equal((await complete(api, job.operationId)).status, 'cancelled')
  assert.equal((await complete(api, queued.operationId)).status, 'cancelled')
  assert.equal((await api.snapshot()).installations.length, 0)
  assert.equal((await api.snapshot()).environments.length, 1)
})
test('imports a portable copy without overwriting an existing local draft', async t => {
  const f = await fixture(t)
  const api = f.open()
  const draft = await (await api.ready()).saveDraft({ document, expectedRevision: null })
  const started = await api.request({ action: 'apply', document, expectedRevision: draft.revision })
  const version = (await complete(api, started.operationId)).result
  const bundle = await api.request({ action: 'export', installationId: version.installationId })
  const duplicate = await api.request({ action: 'import', bundle })
  assert.equal((await complete(api, duplicate.operationId)).status, 'failed')
  assert.equal((await api.snapshot()).environments[0].document.id, document.id)
  const imported = await api.request({ action: 'import', bundle, environmentId: 'copied' })
  const result = await complete(api, imported.operationId)
  assert.equal(result.status, 'succeeded', JSON.stringify(result.error))
  assert.equal(result.result.environmentId, 'copied')
  assert.equal((await api.snapshot()).environments.length, 2)
  await api.request({ action: 'clear-installation', installationId: version.installationId })
  const copy = await api.request({ action: 'export', installationId: result.result.installationId })
  assert.ok(copy)
})

test('failed captured tasks can be retried, report real stages and clear terminal records', async t => {
  const f = await fixture(t)
  const acquire = f.library.prepareEnvironmentProject
  let failOnce = true
  f.library.prepareEnvironmentProject = async (doc, options) => {
    await options.onProgress({ stage: 'installing' })
    if (failOnce) {
      failOnce = false
      throw new Error('installation failed')
    }
    return acquire(doc, options)
  }
  const api = f.open()
  const draft = await (await api.ready()).saveDraft({ document, expectedRevision: null })
  const first = await api.request({ action: 'apply', document, expectedRevision: draft.revision })
  const failed = await complete(api, first.operationId)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.progress.stage, 'installing')
  const retry = await api.request({ action: 'retry', operationId: first.operationId })
  assert.equal((await complete(api, retry.operationId)).status, 'succeeded')
  assert.equal((await api.snapshot()).installations.length, 1)
  await api.request({ action: 'clear-completed' })
  assert.deepEqual((await api.snapshot()).operations, [])
})

// The Electron ASAR has no workspace packages; they live in the separate runtime.
test('relocated desktop environment module loads without workspace packages and delegates package state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'relocated-environments-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'local-environments.mjs')
  await copyFile(new URL('../local-environments.mjs', import.meta.url), file)
  const { LocalEnvironments: Relocated } = await import(pathToFileURL(file).href)
  const workspace = { root, close: async () => {} }
  const input = { action: 'remove-package', environmentId: 'friends', name: 'sample' }
  const api = new Relocated({
    openWorkspace: async () => workspace,
    removePackage: async (actualWorkspace, actualInput) => {
      assert.equal(typeof actualWorkspace.saveDraft, 'function')
      assert.equal(actualInput, input)
      return { document, revision: 'updated' }
    },
  })
  assert.equal(typeof (await api.request(input)).operationId, 'string')
  await api.close()
})

test('one apply action creates and updates the installation without saving a draft first', async t => {
  const f = await fixture(t)
  const api = f.open()
  let submitted = await api.request({ action: 'apply', document, expectedRevision: null })
  assert.equal((await complete(api, submitted.operationId)).status, 'succeeded')
  const original = (await api.snapshot()).environments[0]
  f.library.prepareEnvironmentProject = async () => {
    throw new Error('download failed')
  }
  submitted = await api.request({
    action: 'apply',
    document: { ...document, name: 'Rejected' },
    expectedRevision: original.revision,
  })
  assert.equal((await complete(api, submitted.operationId)).status, 'failed')
  assert.deepEqual((await api.snapshot()).environments[0], original)
})

test('migrates the working local selection once and preserves selected environments and live leases', async t => {
  const f = await fixture(t)
  let migrations = 0
  f.library.acquireInitialEnvironment = async () => {
    migrations++
    return { directory: f.project, packages: [{ name: 'sample', version: '1.0.0' }], release: async () => {} }
  }
  let api = f.open()
  const first = await api.snapshot()
  assert.equal(first.environments.length, 1)
  assert.equal(first.selectedEnvironmentId, first.environments[0].document.id)
  assert.deepEqual(first.environments[0].document.packages, { sample: '1.0.0' })
  const original = await api.acquireProject()
  const apply = await api.request({ action: 'apply', document, expectedRevision: null })
  assert.equal((await complete(api, apply.operationId)).status, 'succeeded')
  const select = await api.request({ action: 'select', environmentId: document.id })
  assert.equal((await complete(api, select.operationId)).status, 'succeeded')
  await assert.rejects(api.request({ action: 'references', installationId: document.id }), { code: 'INVALID_ACTION' })
  const next = await api.acquireProject()
  assert.equal(next.document.id, document.id)
  assert.equal(original.document.id, first.selectedEnvironmentId)
  assert.notEqual(original.directory, next.directory)
  await assert.rejects(api.request({ action: 'clear-installation', installationId: document.id }), {
    code: 'ENVIRONMENT_IN_USE',
  })
  const invalid = await api.request({ action: 'select', environmentId: 'missing' })
  assert.equal((await complete(api, invalid.operationId)).status, 'failed')
  assert.equal((await api.snapshot()).selectedEnvironmentId, document.id)
  await original.release()
  await next.release()
  await api.close()
  api = f.open()
  assert.equal((await api.snapshot()).selectedEnvironmentId, document.id)
  assert.equal(migrations, 1)
})

test('local add-package accepts a new version declaration and applies it atomically', async t => {
  const f = await fixture(t)
  const api = f.open()
  const workspace = await api.ready()
  const saved = await workspace.saveDraft({ expectedRevision: null, document: { ...document, packages: {} } })
  const input = {
    action: 'add-package',
    environmentId: document.id,
    name: 'sample',
    version: '1.0.0',
    expectedRevision: saved.revision,
  }
  await assert.rejects(api.request({ ...input, enabled: true }), { code: 'INVALID_REQUEST' })
  await assert.rejects(api.request({ ...input, action: 'package-state' }), { code: 'INVALID_ACTION' })
  const started = await api.request(input)
  assert.equal((await complete(api, started.operationId)).status, 'succeeded')
  assert.equal((await workspace.getDraft(document.id)).document.packages.sample, '1.0.0')
  const revision = (await workspace.getDraft(document.id)).revision
  await assert.rejects(api.request(input), { code: 'REVISION_CONFLICT' })
  assert.equal((await workspace.getDraft(document.id)).revision, revision)
})

test('archives legacy removed declarations before rewriting an environment', async t => {
  const f = await fixture(t)
  const api = f.open()
  const workspace = await api.ready()
  await workspace.saveDraft({ document, expectedRevision: null })
  const manifestFile = join(workspace.root, 'environments', document.id, 'package.json')
  const legacy = JSON.parse(await readFile(manifestFile, 'utf8'))
  legacy.arcadiaEnvironment.disabled = { packages: { old: '^1' }, sources: [] }
  const original = JSON.stringify(legacy)
  await writeFile(manifestFile, original)
  const loaded = await workspace.getDraft(document.id)
  assert.equal(loaded.document.disabled, undefined)
  await workspace.saveDraft({ document: loaded.document, expectedRevision: loaded.revision })
  const backups = await readdir(join(workspace.root, 'migration-backups'))
  assert.equal(backups.length, 1)
  assert.equal(await readFile(join(workspace.root, 'migration-backups', backups[0]), 'utf8'), original)
  assert.equal(JSON.parse(await readFile(manifestFile, 'utf8')).arcadiaEnvironment.disabled, undefined)
})

test('recovering an interrupted import archives legacy declarations before replacing the manifest', async t => {
  const f = await fixture(t)
  const workspace = await f.open().ready()
  await workspace.prepareEnvironment(
    { environmentId: document.id, document, expectedRevision: null, projectDirectory: f.project },
    async () => ({ contentRevision: 'test', packages: [] }),
  )
  const directory = join(workspace.root, 'environments', document.id)
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  manifest.arcadiaEnvironment.disabled = { packages: { old: '^1' }, sources: [] }
  const original = JSON.stringify(manifest)
  await writeFile(join(directory, 'package.json'), original)
  const draft = await workspace.getDraft(document.id)
  const importId = 'a'.repeat(64)
  const staging = 'prepare-' + randomUUID()
  const stagedDirectory = join(workspace.root, 'staging', staging)
  await cp(directory, stagedDirectory, { recursive: true })
  delete manifest.arcadiaEnvironment.disabled
  await writeFile(join(stagedDirectory, 'package.json'), JSON.stringify(manifest))
  const metadata = JSON.parse(await readFile(join(stagedDirectory, '.arcadia-prepared.json'), 'utf8'))
  await writeFile(join(stagedDirectory, '.arcadia-prepared.json'), JSON.stringify({ ...metadata, importId }))
  await writeFile(
    join(workspace.root, 'imports', importId + '.json'),
    JSON.stringify({ environmentId: document.id, staging, expectedRevision: draft.revision, completed: false }),
  )
  await workspace.recoverImport(importId)
  const backups = await readdir(join(workspace.root, 'migration-backups'))
  assert.equal(await readFile(join(workspace.root, 'migration-backups', backups[0]), 'utf8'), original)
  assert.equal(
    JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).arcadiaEnvironment.disabled,
    undefined,
  )
})

test('migrates the generated default to the shared installation, preserves edits and protects every write path', async t => {
  const f = await fixture(t)
  const id = 'desktop-host'
  const old = 'local-' + randomUUID()
  const edited = 'local-' + randomUUID()
  const builtin = { ...document, id, name: '默认环境' }
  const host = await ContentWorkspace.open(join(f.root, 'managed'))
  f.instances.push(host)
  let api = f.open()
  const personal = await api.ready()
  const prepare = (workspace, doc) =>
    workspace.prepareEnvironment(
      { environmentId: doc.id, document: doc, projectDirectory: f.project, expectedRevision: null },
      f.validate,
    )
  const { extended: extendedId } = await host.registerBuiltinEnvironments(['classic', 'extended'], { classic: id })
  await prepare(host, { ...builtin, id: extendedId, name: '120 资质 · 神魔化与二代' })
  await prepare(host, builtin)
  await prepare(personal, { ...builtin, id: old })
  await prepare(personal, { ...builtin, id: edited, name: '自定义规则' })
  await prepare(personal, { ...builtin, name: '同 ID 的私人环境' })
  const select = await api.request({ action: 'select', environmentId: old })
  assert.equal((await complete(api, select.operationId)).status, 'succeeded')
  await api.close()
  const shared = { openBuiltin: async () => ({ workspace: host, id }) }
  api = f.open(shared)
  const migrated = await api.snapshot()
  assert.equal(migrated.selectedEnvironmentId, id)
  assert.deepEqual(
    migrated.environments.filter(item => item.builtin).map(item => item.document.id),
    [id, extendedId],
  )
  assert.equal(migrated.environments.length, 4)
  const privateCopy = migrated.environments.find(item => item.document.name === '同 ID 的私人环境').document.id
  assert.notEqual(privateCopy, id)
  const listed = await (await api.hostingWorkspace()).listInstallations()
  assert.deepEqual(listed.map(item => item.environmentId).sort(), [privateCopy, edited].sort())
  const lease = await api.acquireProject(old)
  assert.equal(lease.document.id, id)
  await lease.release()
  const bundle = await api.request({ action: 'export', installationId: old })
  assert.equal(bundle.document.id, id)
  for (const target of [id, old, extendedId]) {
    for (const request of [
      { action: 'apply', document: { ...builtin, id: target, name: '新名称' } },
      { action: 'add-package', environmentId: target },
      { action: 'remove-package', environmentId: target },
      { action: 'delete-draft', environmentId: target },
      { action: 'clear-installation', installationId: target },
      { action: 'use-member', targetId: target },
      { action: 'import', bundle, environmentId: target },
    ])
      await assert.rejects(api.request(request), { code: 'BUILTIN_ENVIRONMENT_READ_ONLY' })
  }
  await assert.rejects(api.request({ action: 'import', bundle }), { code: 'BUILTIN_ENVIRONMENT_READ_ONLY' })
  const copy = await api.request({
    action: 'apply',
    copyFrom: extendedId,
    document: { ...builtin, id: 'my-copy' },
    expectedRevision: null,
  })
  assert.equal((await complete(api, copy.operationId)).status, 'succeeded')
  const selected = await api.request({ action: 'select', environmentId: extendedId })
  assert.equal((await complete(api, selected.operationId)).status, 'succeeded')
  await api.close()
  api = f.open(shared)
  const restored = await api.snapshot()
  assert.deepEqual(
    restored.environments.map(item => item.document.id).sort(),
    [privateCopy, edited, id, extendedId, 'my-copy'].sort(),
  )
  assert.equal(restored.selectedEnvironmentId, extendedId)
  const selectedLease = await api.acquireProject()
  assert.equal(selectedLease.environmentId, extendedId)
  await selectedLease.release()
})
