import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentWorkspace } from '../../../content-dev/src/content-workspace.mjs'
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
  const open = () => {
    const api = new LocalEnvironments({
      openWorkspace: () => ContentWorkspace.open(join(root, 'workspace'), { retentions: { list: async () => [] } }),
      library,
      validate,
    })
    instances.push(api)
    return api
  }
  t.after(async () => {
    for (const api of instances) await api.close()
    await rm(root, { recursive: true, force: true })
  })
  return { open, requests, releases, library, project }
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
test('offline drafts survive reopening, reject stale writes and versions copy materials independently', async t => {
  const f = await fixture(t)
  let api = f.open()
  const saved = await api.request({ action: 'save', document, expectedRevision: null })
  assert.equal(f.requests.length, 0)
  await api.close()
  api = f.open()
  const restored = (await api.snapshot()).environments[0]
  assert.equal(restored.revision, saved.revision)
  await assert.rejects(
    api.request({ action: 'save', document: { ...document, name: '冲突' }, expectedRevision: 'stale' }),
    { code: 'REVISION_CONFLICT' },
  )
  const started = await api.request({ action: 'prepare', environmentId: document.id, expectedRevision: saved.revision })
  const job = await complete(api, started.operationId)
  assert.equal(job.status, 'succeeded', JSON.stringify(job.error))
  assert.equal(f.requests[0].options.offline, true)
  assert.equal(f.releases.length, 1)
  assert.equal('directory' in job.result, false)
  await rm(f.project, { recursive: true })
  const exported = await api.request({ action: 'export', versionId: job.result.versionId })
  assert.ok(exported)
  await assert.rejects(
    api.request({ action: 'delete-draft', environmentId: document.id, expectedRevision: saved.revision }),
    { code: 'ENVIRONMENT_HAS_VERSIONS' },
  )
  await api.request({ action: 'delete-version', versionId: job.result.versionId })
  await api.request({ action: 'delete-draft', environmentId: document.id, expectedRevision: saved.revision })
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
  const draft = await api.request({ action: 'save', document, expectedRevision: null })
  const job = await api.request({ action: 'prepare', environmentId: document.id, expectedRevision: draft.revision })
  const queued = await api.request({ action: 'prepare', environmentId: document.id, expectedRevision: draft.revision })
  assert.equal((await api.snapshot()).operations.find(item => item.id === queued.operationId).status, 'queued')
  await api.request({ action: 'cancel', operationId: queued.operationId })
  await api.request({ action: 'cancel', operationId: job.operationId })
  assert.equal((await complete(api, job.operationId)).status, 'cancelled')
  assert.equal((await complete(api, queued.operationId)).status, 'cancelled')
  assert.equal((await api.snapshot()).versions.length, 0)
  assert.equal((await api.snapshot()).environments.length, 1)
})
test('imports a portable copy without overwriting an existing local draft', async t => {
  const f = await fixture(t)
  const api = f.open()
  const draft = await api.request({ action: 'save', document, expectedRevision: null })
  const started = await api.request({ action: 'prepare', environmentId: document.id, expectedRevision: draft.revision })
  const version = (await complete(api, started.operationId)).result
  const bundle = await api.request({ action: 'export', versionId: version.versionId })
  const duplicate = await api.request({ action: 'import', bundle })
  assert.equal((await complete(api, duplicate.operationId)).status, 'failed')
  assert.equal((await api.snapshot()).environments[0].revision, draft.revision)
  const imported = await api.request({ action: 'import', bundle, environmentId: 'copied' })
  const result = await complete(api, imported.operationId)
  assert.equal(result.status, 'succeeded', JSON.stringify(result.error))
  assert.equal(result.result.environmentId, 'copied')
  assert.equal((await api.snapshot()).environments.length, 2)
  await api.request({ action: 'delete-version', versionId: version.versionId })
  const copy = await api.request({ action: 'export', versionId: result.result.versionId })
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
  const draft = await api.request({ action: 'save', document, expectedRevision: null })
  const first = await api.request({ action: 'prepare', environmentId: document.id, expectedRevision: draft.revision })
  const failed = await complete(api, first.operationId)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.progress.stage, 'installing')
  const retry = await api.request({ action: 'retry', operationId: first.operationId })
  assert.equal((await complete(api, retry.operationId)).status, 'succeeded')
  assert.equal((await api.snapshot()).versions.length, 1)
  await api.request({ action: 'clear-completed' })
  assert.deepEqual((await api.snapshot()).operations, [])
})
