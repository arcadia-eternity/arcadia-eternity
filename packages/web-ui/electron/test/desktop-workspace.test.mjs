import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentWorkspace } from '../../../content-dev/src/content-workspace.ts'
import { createDesktopWorkspaceProxy } from '../../../../bin/desktop-workspace-proxy.ts'
import { DesktopWorkspaceOwner } from '../desktop-workspace-owner.mjs'

const document = { schemaVersion: 1, id: 'main', name: 'Main', packages: {}, sources: [] }
function channels() {
  const child = new EventEmitter(),
    parent = new EventEmitter()
  child.connected = parent.connected = true
  const sent = []
  for (const [from, to] of [
    [child, parent],
    [parent, child],
  ])
    from.send = (message, callback) => {
      // Use the default child process JSON transport semantics, not shared references.
      const copy = JSON.parse(JSON.stringify(message))
      sent.push(copy)
      queueMicrotask(() => {
        if (from.connected) to.emit('message', copy)
      })
      callback?.(null)
    }
  return {
    child,
    parent,
    sent,
    disconnect() {
      child.connected = parent.connected = false
      child.emit('disconnect')
      parent.emit('disconnect')
    },
    exit() {
      child.connected = parent.connected = false
      child.emit('close')
    },
  }
}
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'desktop-workspace-')))
  const project = join(root, 'projects', 'installed')
  await mkdir(join(project, 'node_modules', 'sample'), { recursive: true })
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
  await writeFile(join(project, 'node_modules/sample/content.json'), '{"power":40}')
  await writeFile(join(project, 'node_modules/sample/index.js'), 'throw new Error("author entry must not execute")')
  const roots = new Map(),
    materialLeases = new Set(),
    connections = [],
    proxies = []
  const retentions = {
    async list(installationId) {
      return [...roots].filter(([, version]) => version === installationId).map(([id]) => ({ id }))
    },
    async put(installationId, id) {
      roots.set(id, installationId)
    },
    async remove(id) {
      roots.delete(id)
    },
  }
  const owner = new DesktopWorkspaceOwner({
    root,
    openWorkspace: (directory, options) => ContentWorkspace.open(directory, options),
    timeoutMs: 10000,
    library: {
      async ownsProjectDirectory(directory) {
        return directory === project
      },
      async retainProjectDirectory(directory) {
        assert.equal(directory, project)
        const token = Symbol('material')
        materialLeases.add(token)
        return async () => {
          materialLeases.delete(token)
        }
      },
    },
  })
  async function connect(timeoutMs = 10000) {
    const connection = channels()
    connections.push(connection)
    owner.attach(connection.child)
    const proxy = await createDesktopWorkspaceProxy({ channel: connection.parent, retentions, timeoutMs })
    proxies.push(proxy)
    return { connection, proxy }
  }
  t.after(async () => {
    for (const proxy of proxies) await proxy.close().catch(() => {})
    for (const connection of connections) connection.exit()
    await owner.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, project, roots, materialLeases, owner, connect }
}
async function prepare({ directory, draft, signal }) {
  signal?.throwIfAborted()
  const content = JSON.parse(await readFile(join(directory, 'node_modules/sample/content.json'), 'utf8'))
  return {
    contentRevision: `fixture:${content.power}:${draft.rules.schemaVersion}`,
    packages: [{ name: 'sample', version: '1.0.0' }],
  }
}
async function ready(proxy, project) {
  const draft = await proxy.saveDraft({ document, expectedRevision: null })
  return proxy.prepareEnvironment(
    { environmentId: document.id, expectedRevision: draft.revision, projectDirectory: project },
    prepare,
  )
}
async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail('workspace did not reach expected state')
}

test('child borrows one desktop workspace and prepares a persistent environment project', async t => {
  const f = await fixture(t),
    { proxy, connection } = await f.connect()
  const version = await ready(proxy, f.project)
  assert.equal(proxy.workspaceId, (await f.owner.ready()).workspaceId)
  assert.equal(version.directory, join(f.root, 'environments/main'))
  assert.equal(f.materialLeases.size, 0)
  assert.equal((await proxy.listInstallations()).length, 1)
  assert.equal((await proxy.getDraft('main')).document.schemaVersion, 2)
  assert.equal((await proxy.listDrafts()).length, 1)
  assert.equal((await proxy.listInstallations('main'))[0].installationId, version.installationId)
  const callback = connection.sent.find(
    message => message.type === 'arcadia.desktop.workspace.callback' && message.kind === 'prepare',
  )
  assert.notEqual(callback.input.directory, f.project)
  assert.equal((await proxy.reconcile()).workspaceId, proxy.workspaceId)
  await assert.rejects(ContentWorkspace.open(f.root), { code: 'WORKSPACE_BUSY' })
  await proxy.close()
  assert.equal(connection.parent.listenerCount('message'), 0)
  assert.equal(connection.parent.listenerCount('disconnect'), 0)
  assert.equal((await f.owner.ready()).workspaceId, proxy.workspaceId, 'proxy close keeps desktop owner alive')
})

test('runtime and persistent references roundtrip and protect shared materials until explicit release', async t => {
  const f = await fixture(t),
    { proxy, connection } = await f.connect()
  const version = await ready(proxy, f.project)
  const lease = await proxy.acquire(version.installationId, 'room:one')
  await proxy.retain(version.installationId, 'binding:main')
  assert.equal(f.roots.get('binding:main'), version.installationId)
  assert.equal((await proxy.references(version.installationId)).length, 2)
  await assert.rejects(proxy.clearInstallation(version.installationId), { code: 'ENVIRONMENT_IN_USE' })
  await Promise.all([lease.release(), lease.release()])
  assert.equal(connection.sent.filter(message => message.method === 'release').length, 1)
  await assert.rejects(proxy.clearInstallation(version.installationId), { code: 'ENVIRONMENT_IN_USE' })
  await proxy.releaseRetention('binding:main')
  await proxy.clearInstallation(version.installationId)
  assert.equal(f.materialLeases.size, 0)
  assert.ok(
    await readFile(join(f.project, 'package.json')),
    'deleting environment metadata does not delete library materials',
  )
  await assert.rejects(proxy.getInstallation(version.installationId), { code: 'ENOENT' })
})

test('online backup snapshots and owner stamps cross private IPC and observe local-owner edits', async t => {
  const f = await fixture(t),
    { proxy, connection } = await f.connect()
  const version = await ready(proxy, f.project)
  const captured = await proxy.captureSnapshot()
  assert.equal(captured.stamp.workspaceId, proxy.workspaceId)
  assert.equal(captured.stamp.bootId, proxy.bootId)
  assert.ok(Number.isSafeInteger(captured.stamp.generation))
  assert.equal(captured.snapshot.installations[0].version.installationId, version.installationId)
  assert.equal(await proxy.isSnapshotCurrent({ ...captured.stamp, bootId: 'different-owner-boot' }), false)
  assert.equal(await proxy.isSnapshotCurrent({ ...captured.stamp, workspaceId: 'different-workspace' }), false)
  assert.equal(await proxy.isSnapshotCurrent(captured.stamp), true)
  assert.equal(await proxy.isSnapshotCurrent(captured.stamp), false, 'validation consumes the one-use snapshot stamp')

  // This edit originates from the trusted parent's local content page, not the
  // child server. The shared owner must invalidate the child's captured state.
  const beforeLocalEdit = await proxy.captureSnapshot()
  const workspace = await f.owner.ready()
  const current = await workspace.getDraft('main')
  await workspace.saveDraft({
    document: { ...current.document, name: 'Changed by local owner' },
    expectedRevision: current.revision,
  })
  assert.equal(await proxy.isSnapshotCurrent(beforeLocalEdit.stamp), false)
  assert.equal(captured.snapshot.drafts[0].document.name, 'Main', 'snapshot bytes must not alias owner state')

  const refreshed = await proxy.captureSnapshot()
  assert.equal(refreshed.snapshot.drafts[0].document.name, 'Changed by local owner')
  assert.equal(await proxy.isSnapshotCurrent(refreshed.stamp), true)
  assert.ok(refreshed.stamp.generation > beforeLocalEdit.stamp.generation)
  const captureRequest = connection.sent.find(message => message.method === 'captureSnapshot')
  assert.equal(captureRequest.type, 'arcadia.desktop.workspace')
  assert.deepEqual(captureRequest.args, [])
  assert.ok(
    connection.sent.some(
      message =>
        message.type === 'arcadia.desktop.workspace' &&
        message.method === 'isSnapshotCurrent' &&
        message.args[0].generation === captured.stamp.generation,
    ),
  )

  const forbiddenId = 'snapshot-method-not-allowlisted'
  const denied = new Promise(resolve => {
    const listener = message => {
      if (message.type !== 'arcadia.desktop.workspace.result' || message.id !== forbiddenId) return
      connection.parent.off('message', listener)
      resolve(message)
    }
    connection.parent.on('message', listener)
  })
  connection.parent.send({
    type: 'arcadia.desktop.workspace',
    id: forbiddenId,
    method: 'captureSnapshotWithSecrets',
    args: [],
  })
  const denial = await denied
  assert.equal(denial.ok, false)
  assert.equal(denial.error.code, 'WORKSPACE_METHOD_INVALID')
})

test('IPC disconnect rejects child requests but holds runtime leases until process exit is observed', async t => {
  const f = await fixture(t),
    first = await f.connect()
  const version = await ready(first.proxy, f.project)
  await first.proxy.acquire(version.installationId, 'room:old-child')
  const interrupted = first.proxy.getInstallation(version.installationId)
  first.connection.disconnect()
  await assert.rejects(interrupted, { code: 'WORKSPACE_PARENT_DISCONNECTED' })
  assert.equal(first.connection.parent.listenerCount('message'), 0)
  await assert.rejects((await f.owner.ready()).clearInstallation(version.installationId), {
    code: 'RETENTION_UNAVAILABLE',
  })
  const second = await f.connect()
  assert.ok(
    (await second.proxy.references(version.installationId)).some(reference => reference.owner === 'room:old-child'),
  )
  await assert.rejects(second.proxy.clearInstallation(version.installationId), { code: 'ENVIRONMENT_IN_USE' })
  first.connection.exit()
  await eventually(async () => (await second.proxy.references(version.installationId)).length === 0)
  await second.proxy.clearInstallation(version.installationId)
  assert.equal(f.materialLeases.size, 0)
})

test('preparation cancellation crosses the IPC boundary and never publishes the aborted candidate', async t => {
  const f = await fixture(t),
    { proxy, connection } = await f.connect()
  const draft = await proxy.saveDraft({ document, expectedRevision: null })
  const controller = new AbortController()
  let entered
  const starting = new Promise(resolve => {
    entered = resolve
  })
  const candidate = proxy.prepareEnvironment(
    { environmentId: 'main', expectedRevision: draft.revision, projectDirectory: f.project, signal: controller.signal },
    async ({ signal }) => {
      entered()
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      throw new Error('unreachable')
    },
  )
  await starting
  controller.abort(new Error('cancel request'))
  await assert.rejects(candidate, /cancel request/)
  assert.ok(connection.sent.some(message => message.type === 'arcadia.desktop.workspace.cancel'))
  await eventually(async () => (await readdir(join(f.root, 'staging'))).length === 0)
  assert.deepEqual(await proxy.listInstallations(), [])
  assert.equal(f.materialLeases.size, 0)
  assert.ok(await readFile(join(f.project, 'package.json')))
})

test('timed-out preparation aborts its child callback and releases preparation materials', async t => {
  const f = await fixture(t),
    { proxy: setup } = await f.connect()
  const draft = await setup.saveDraft({ document, expectedRevision: null })
  const { proxy } = await f.connect(1500)
  let aborted = false
  await assert.rejects(
    proxy.prepareEnvironment(
      { environmentId: 'main', expectedRevision: draft.revision, projectDirectory: f.project },
      async ({ signal }) => {
        await new Promise((_, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(signal.reason)
            },
            { once: true },
          ),
        )
        throw new Error('unreachable')
      },
    ),
    { code: 'WORKSPACE_REQUEST_TIMEOUT' },
  )
  assert.equal(aborted, true)
  await eventually(async () => (await readdir(join(f.root, 'staging'))).length === 0)
  assert.equal(f.materialLeases.size, 0)
  assert.deepEqual(await proxy.listInstallations(), [])
})

test('portable environment export/import validates received materials through the child static callback', async t => {
  const f = await fixture(t),
    { proxy, connection } = await f.connect()
  const version = await ready(proxy, f.project)
  const bundle = await proxy.exportEnvironment(version.installationId)
  assert.equal(bundle.format, 'arcadia.environment-export/2')
  assert.equal(JSON.stringify(bundle).includes(f.root), false)
  const imported = await proxy.importEnvironment(bundle, { environmentId: 'copy' }, prepare)
  assert.equal(imported.environmentId, 'copy')
  assert.equal(imported.contentRevision, version.contentRevision)
  assert.notEqual(imported.installationId, version.installationId)
  const request = connection.sent.find(message => message.method === 'importEnvironment')
  assert.equal(
    connection.sent.filter(
      message =>
        message.type === 'arcadia.desktop.workspace.callback' &&
        message.requestId === request.id &&
        message.kind === 'prepare',
    ).length,
    1,
  )
  assert.notEqual(imported.directory, f.project)
  assert.equal((await proxy.listInstallations()).length, 2)
})

test('the parent retains a committed import intent when the child loses its callback response', async t => {
  const f = await fixture(t),
    { proxy, connection } = await f.connect()
  const version = await ready(proxy, f.project)
  const bundle = await proxy.exportEnvironment(version.installationId)
  const importId = 'c'.repeat(64)
  await assert.rejects(
    proxy.importEnvironment(
      bundle,
      {
        environmentId: 'recover-copy',
        importId,
        beforeCommit: async () => {
          throw Object.assign(new Error('commit response lost'), { code: 'COMMIT_RESPONSE_LOST' })
        },
      },
      prepare,
    ),
    { code: 'COMMIT_RESPONSE_LOST' },
  )
  await proxy.close()
  connection.exit()
  const resumed = (await f.connect()).proxy
  const imported = await resumed.recoverImport(importId)
  assert.equal(imported.environmentId, 'recover-copy')
  assert.equal((await resumed.recoverImport(importId)).installationId, imported.installationId)
  await resumed.forgetImport(importId)
  assert.deepEqual(await readdir(join(f.root, 'imports')), [])
})

test('draft deletion preserves optimistic concurrency and refuses an environment with retained installations', async t => {
  const f = await fixture(t),
    { proxy } = await f.connect()
  const draft = await proxy.saveDraft({ document, expectedRevision: null })
  await assert.rejects(proxy.deleteDraft({ environmentId: 'main', expectedRevision: 'stale' }), {
    code: 'REVISION_CONFLICT',
  })
  await proxy.deleteDraft({ environmentId: 'main', expectedRevision: draft.revision })
  assert.deepEqual(await proxy.listDrafts(), [])
  const version = await ready(proxy, f.project)
  await proxy.retain('main', 'binding:test')
  await assert.rejects(proxy.deleteDraft({ environmentId: 'main', expectedRevision: version.draftRevision }), {
    code: 'ENVIRONMENT_IN_USE',
  })
  await proxy.releaseRetention('binding:test')
  await proxy.deleteDraft({ environmentId: 'main', expectedRevision: version.draftRevision })
})

test('staging cleanup removes only recognized expired staging artifacts through the owner', async t => {
  const f = await fixture(t),
    { proxy } = await f.connect()
  const abandoned = '11111111-1111-4111-8111-111111111111'
  for (const name of [abandoned, 'user-folder']) {
    const path = join(f.root, 'staging', name)
    await mkdir(path)
    await utimes(path, new Date(0), new Date(0))
  }
  assert.deepEqual(await proxy.cleanupStaging(), [abandoned])
  assert.deepEqual(await readdir(join(f.root, 'staging')), ['user-folder'])
})

test('authorization checks execute in the child immediately before prepare/adopt/import commits', async t => {
  const f = await fixture(t),
    { proxy, connection } = await f.connect()
  const previous = await ready(proxy, f.project)
  const bundle = await proxy.exportEnvironment(previous.installationId)
  let checks = 0
  const beforeCommit = async () => {
    checks++
    throw Object.assign(new Error('authorization revoked'), { code: 'AUTH_REVOKED' })
  }
  for (const method of ['prepareEnvironment']) {
    await assert.rejects(
      proxy[method](
        { environmentId: 'main', expectedRevision: previous.draftRevision, projectDirectory: f.project, beforeCommit },
        prepare,
      ),
      { code: 'AUTH_REVOKED' },
    )
  }
  await assert.rejects(proxy.importEnvironment(bundle, { environmentId: 'denied', beforeCommit }, prepare), {
    code: 'AUTH_REVOKED',
  })
  assert.equal(checks, 2)
  assert.ok(
    connection.sent.some(
      message => message.type === 'arcadia.desktop.workspace.callback' && message.kind === 'beforeCommit',
    ),
  )
  assert.deepEqual(
    (await proxy.listInstallations()).map(version => version.installationId),
    [previous.installationId],
  )
  assert.deepEqual(
    (await proxy.listDrafts()).map(draft => draft.document.id),
    ['main'],
  )
  assert.equal(f.materialLeases.size, 0)
  assert.deepEqual(await readdir(join(f.root, 'staging')), [])
})

test('server snapshot restore preserves identity and clone creates an independent workspace', async t => {
  const source = await fixture(t),
    { proxy } = await source.connect()
  const version = await ready(proxy, source.project)
  const snapshot = await proxy.exportSnapshot()
  const destination = await fixture(t),
    restored = (await destination.connect()).proxy
  assert.notEqual(restored.workspaceId, proxy.workspaceId)
  const result = await restored.restoreSnapshot(snapshot, { mode: 'restore' }, prepare)
  assert.equal(restored.workspaceId, proxy.workspaceId)
  assert.equal(result.installationIds[version.installationId], version.installationId)
  assert.equal((await restored.getInstallation(version.installationId)).contentRevision, version.contentRevision)
  const copy = await fixture(t),
    cloned = (await copy.connect()).proxy
  const cloneId = cloned.workspaceId
  const clonedResult = await cloned.restoreSnapshot(snapshot, { mode: 'clone' }, prepare)
  assert.equal(cloned.workspaceId, cloneId)
  assert.notEqual(cloneId, proxy.workspaceId)
  assert.equal(clonedResult.installationIds[version.installationId], version.installationId)
})

test('an unanswered owner handshake rejects and removes IPC listeners without another timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const connection = channels()
  const rejected = assert.rejects(
    createDesktopWorkspaceProxy({
      channel: connection.parent,
      retentions: { list: async () => [] },
      timeoutMs: 100,
    }),
    { code: 'WORKSPACE_REQUEST_TIMEOUT' },
  )
  t.mock.timers.tick(100)
  await rejected
  assert.equal(connection.parent.listenerCount('message'), 0)
  assert.equal(connection.parent.listenerCount('disconnect'), 0)
  assert.ok(connection.sent.some(message => message.method === 'close'))
})

test('reports real preparation stages over the owner bridge without serializing callbacks', async t => {
  const f = await fixture(t)
  const { proxy, connection } = await f.connect(5000)
  const draft = await proxy.saveDraft({ document, expectedRevision: null })
  const stages = []
  await proxy.prepareEnvironment(
    {
      environmentId: 'main',
      expectedRevision: draft.revision,
      projectDirectory: f.project,
      onProgress: progress => stages.push(progress.stage),
    },
    prepare,
  )
  assert.deepEqual(stages, ['preparing'])
  const request = connection.sent.find(message => message.method === 'prepareEnvironment')
  assert.equal(request.args[0].hasProgress, true)
  assert.equal(Object.hasOwn(request.args[0], 'onProgress'), false)
})
