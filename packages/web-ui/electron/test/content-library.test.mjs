import { after, before, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ContentLibrary } from '../content-library.mjs'

let root
before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-content-library-')))
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})
async function fixture(name) {
  const directory = join(root, name),
    calls = []
  await mkdir(directory)
  const host = {
    status: () => ({ status: 'idle' }),
    retainedProjectDirectories: async () => [],
  }
  const run = async args => {
    calls.push(args)
    const dir = args[3]
    if (args[2] === 'stage') {
      const sources = args.includes('--package') ? args.slice(args.indexOf('--package') + 1) : []
      const packages = []
      const dependencies = {}
      for (const source of sources) {
        const data = source.startsWith('file:')
          ? JSON.parse(await readFile(resolve(dir, source.slice(5)), 'utf8'))
          : {
              name: source.slice(0, source.lastIndexOf('@')),
              version: source.slice(source.lastIndexOf('@') + 1),
              namespace: 'custom',
            }
        if (packages.some(pkg => pkg.manifest?.namespace === data.namespace)) throw new Error('NAMESPACE_CONFLICT')
        dependencies[data.name] = source
        const location = 'node_modules/' + data.name
        await mkdir(join(dir, location), { recursive: true })
        await writeFile(
          join(dir, location, 'package.json'),
          JSON.stringify({ name: data.name, version: data.version, author: '作者' }),
        )
        packages.push({
          name: data.name,
          version: data.version,
          location,
          integrity: data.version,
          dependencies: {},
          manifest: { projectId: data.namespace, namespace: data.namespace, effects: 'effects.js' },
          draft: {
            project: { title: data.title ?? data.name, description: '内容说明' },
            data: { species: [{ id: 'pet' }], skills: [{ id: 'skill' }], marks: [] },
          },
        })
      }
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies }))
      return { format: 'arcadia.npm-installation', packages }
    }
    return { format: 'ok' }
  }
  const manager = new ContentLibrary({
    root: join(directory, 'library'),
    host,
    run,
  })
  const file = async (id, version = '1.0.0', namespace = id) => {
    const path = join(directory, id + '-' + version + '.tgz')
    const name = id === 'base' ? '@arcadia-eternity/data-pack-base' : '@test/' + id
    await writeFile(path, JSON.stringify({ name, version, namespace, title: id }))
    return path
  }
  return { manager, host, run, calls, file, libraryRoot: join(directory, 'library') }
}
async function install(f, id = 'water', version = '1.0.0', namespace = id) {
  return f.manager.installFile(await f.file(id, version, namespace), true)
}
it('installs without selecting content and preserves user sources on uninstall', async () => {
  const f = await fixture('installation')
  try {
    const source = await f.file('water')
    const id = await f.manager.installFile(source, true)
    const [pkg] = (await f.manager.list()).packages
    assert.equal(pkg.id, id)
    assert.deepEqual(pkg.contentIds.species, ['water:pet'])
    assert.equal((await f.manager.list()).activeIds, undefined)
    const project = await f.manager.authorProject(id)
    const { directory } = project
    assert.deepEqual(project, { id, directory, name: pkg.name, readOnly: true, published: true })
    assert.equal(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name, pkg.name)
    await assert.rejects(f.manager.authorProject('not-installed'), /未安装/)
    await assert.rejects(f.manager.installNpm('@test/water@latest'), /明确版本/)
    assert.equal(await f.manager.installFile(source), id)
    await writeFile(
      source,
      JSON.stringify({ name: pkg.name, version: pkg.version, namespace: 'changed', title: 'changed' }),
    )
    await assert.rejects(f.manager.installFile(source), /不同材料/)
    assert.equal((await f.manager.list()).packages.length, 1)
    await f.manager.uninstall(id)
    assert.equal((await f.manager.list()).packages.length, 0)
    assert.ok(await readFile(source))
    for (const name of [
      'stageFile',
      'stageNpm',
      'confirmInstall',
      'cancel',
      'planSelection',
      'applySelection',
      'setSelection',
      'start',
    ])
      assert.equal(f.manager[name], undefined)
  } finally {
    await f.manager.close()
  }
})
it('reads saved legacy choices for migration without resuming unfinished global selection writes', async () => {
  const f = await fixture('legacy-selection')
  f.manager.withDefaultArchive = async use => use(await f.file('base'))
  const base = (await f.manager.list()).packages[0]
  const custom = await install(f)
  await f.manager.close()
  const file = join(f.libraryRoot, 'library.json')
  const state = JSON.parse(await readFile(file, 'utf8'))
  state.version = 2
  state.goalRevision = 1
  state.activeGoalRevision = 0
  state.activeIds = [base.id, custom]
  state.activeProject = custom
  state.activeGraph = state.installed.find(entry => entry.id === custom).graph
  state.desiredIds = [base.id, custom]
  state.goalRevision++
  await writeFile(file, JSON.stringify(state))
  const restored = new ContentLibrary({ root: f.libraryRoot, run: f.run, host: f.host })
  try {
    await restored.resume()
    assert.equal((await restored.list()).activeIds, undefined)
    const old = await restored.acquireInitialEnvironment()
    await restored.retireLegacySelection()
    assert.equal(JSON.parse(await readFile(file, 'utf8')).legacySelection, undefined)
    const captured = await readFile(join(old.directory, 'package.json'), 'utf8')
    assert.ok(captured)
    await old.release()
    await restored.uninstall(custom)
    const fallback = await restored.acquireInitialEnvironment()
    assert.ok(await readFile(join(fallback.directory, 'package.json')))
    await fallback.release()
  } finally {
    await restored.close()
  }
})
it('keeps acquired environment projects until all runtime and server leases are released', async () => {
  const f = await fixture('environment-leases')
  try {
    await install(f, 'a')
    const lease = await f.manager.prepareEnvironmentProject(
      { packages: { '@test/a': '1.0.0' }, sources: [] },
      { offline: true },
    )
    const releaseServer = await f.manager.retainProjectDirectory(lease.directory)
    await lease.release()
    await f.manager.collectGarbage()
    assert.ok(await readFile(join(lease.directory, 'package.json')))
    await releaseServer()
    await f.manager.collectGarbage()
    await assert.rejects(readFile(join(lease.directory, 'package.json')), { code: 'ENOENT' })
    await assert.rejects(f.manager.prepareEnvironmentProject({ packages: {}, sources: ['@test/missing'] }), {
      code: 'INSTALL_SOURCE_NOT_REGISTERED',
    })
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      f.manager.prepareEnvironmentProject({ packages: {}, sources: [] }, { signal: controller.signal }),
    )
  } finally {
    await f.manager.close()
  }
})
it('reports missing package files and allows removing a broken inactive installation without touching its source', async () => {
  const f = await fixture('missing-installation')
  const source = await f.file('water')
  const id = await install(f)
  const directory = join(f.libraryRoot, 'projects', 'content-' + id.replaceAll('-', ''))
  await rm(directory, { recursive: true })
  assert.match((await f.manager.list()).packages[0].error, /丢失/)
  await f.manager.uninstall(id)
  assert.equal((await f.manager.list()).packages.length, 0)
  assert.ok(await readFile(source))
})

it('rejects a persisted source path that escapes its managed installation', async () => {
  const f = await fixture('invalid-source')
  await install(f)
  const file = join(f.libraryRoot, 'library.json')
  const stored = JSON.parse(await readFile(file, 'utf8'))
  stored.installed[0].source.file = '../../outside.tgz'
  await writeFile(file, JSON.stringify(stored))
  const restored = new ContentLibrary({ root: f.libraryRoot, run: f.run, host: f.host })
  await assert.rejects(restored.list(), /格式不正确/)
})

it('cancels queued and running installation tasks and retries without changing enabled content', async () => {
  const f = await fixture('installation-tasks')
  const original = f.manager.run
  let block = true
  f.manager.run = async (args, signal) => {
    if (block && args[2] === 'stage')
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    return original(args, signal)
  }
  try {
    const first = f.manager.installFile(await f.file('water'), true)
    const firstRejected = assert.rejects(first)
    const second = f.manager.installFile(await f.file('fire'), true)
    const secondRejected = assert.rejects(second)
    const jobs = (await f.manager.list()).operations
    const running = jobs.find(job => job.status === 'running')
    const queued = jobs.find(job => job.status === 'queued')
    assert.ok(running)
    assert.ok(queued)
    f.manager.cancelInstall(queued.id)
    f.manager.cancelInstall(running.id)
    await Promise.all([firstRejected, secondRejected])
    assert.ok((await f.manager.list()).operations.every(job => job.status === 'cancelled'))
    assert.equal((await f.manager.list()).desiredIds, undefined)
    block = false
    await f.manager.retryInstall(running.id)
    const snapshot = await f.manager.list()
    assert.equal(snapshot.packages.length, 1)
    assert.equal(snapshot.operations[0].status, 'succeeded')
    assert.equal(snapshot.activeIds, undefined)
    f.manager.clearInstallTasks()
    assert.deepEqual((await f.manager.list()).operations, [])
  } finally {
    await f.manager.close()
  }
})
