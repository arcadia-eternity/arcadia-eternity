import { after, before, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
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
  let status = { status: 'idle' },
    running,
    failValidation = false,
    newDependency = false,
    currentEnvironment,
    currentBuiltin = false,
    blockedPreparation,
    failPreparation = false
  const prepared = [],
    selected = [],
    retired = []
  const heldDirectories = new Set()
  const host = {
    status: () => status,
    retainedProjectDirectories: async () => [...heldDirectories, ...(running ? [running] : [])],
    projectDirectory: () => running,
    start: async dir => {
      running = dir
      currentEnvironment = 'initial:' + dir
      status = { status: 'running', url: 'http://127.0.0.1:1234', serverId: 'test', projectName: 'test' }
      return status
    },
    prepareProject: async (dir, { builtinOnly = false } = {}) => {
      const started = status.status !== 'running'
      if (started) await host.start(dir)
      const value = { id: started ? currentEnvironment : 'prepared:' + dir, directory: dir, builtinOnly, started }
      prepared.push(value)
      if (blockedPreparation) {
        const block = blockedPreparation
        blockedPreparation = undefined
        block.enter()
        await block.promise
      }
      if (failPreparation) throw new Error('HOST_PREPARATION_FAILED')
      return value
    },
    selectPrepared: async value => {
      const previous = { id: currentEnvironment, directory: running, builtinOnly: currentBuiltin }
      selected.push(value)
      running = value.directory
      currentEnvironment = value.id
      currentBuiltin = value.builtinOnly
      return previous
    },
    retirePrepared: async value => {
      retired.push(value)
    },
    stop: async () => {
      status = { status: 'idle' }
      running = undefined
    },
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
      if (newDependency)
        packages.push({
          name: 'new-library',
          version: '2.0.0',
          location: 'node_modules/new-library',
          integrity: 'new',
          dependencies: {},
        })
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies }))
      return { format: 'arcadia.npm-installation', packages }
    }
    if (args[1] === 'validate' && failValidation) throw new Error('INVALID_CONTENT')
    return { format: 'ok' }
  }
  const manager = new ContentLibrary({ root: join(directory, 'library'), host, run })
  const file = async (id, version = '1.0.0', namespace = id) => {
    const path = join(directory, id + '-' + version + '.tgz')
    await writeFile(path, JSON.stringify({ name: '@test/' + id, version, namespace, title: id }))
    return path
  }
  return {
    manager,
    heldDirectories,
    prepared,
    selected,
    retired,
    blockPreparation: () => {
      let enter, release
      const entered = new Promise(resolve => {
        enter = resolve
      })
      const promise = new Promise(resolve => {
        release = resolve
      })
      blockedPreparation = { enter, promise }
      return { entered, release }
    },
    recover: () => {
      failValidation = false
      failPreparation = false
    },
    failHost: () => {
      failPreparation = true
    },
    host,
    run,
    calls,
    file,
    libraryRoot: join(directory, 'library'),
    fail: () => {
      failValidation = true
    },
    changeDependency: () => {
      newDependency = true
    },
  }
}
async function install(f, id = 'water', version = '1.0.0', namespace = id) {
  const plan = await f.manager.stageFile(await f.file(id, version, namespace), true)
  assert.equal(plan.kind, 'install')
  return f.manager.confirmInstall(plan.id, true)
}
it('installs by opaque plan, persists packages and keeps user source files intact on uninstall', async () => {
  const f = await fixture('installation')
  const source = await f.file('water')
  const plan = await f.manager.stageFile(source, true)
  assert.equal((await f.manager.list()).packages.length, 0)
  await assert.rejects(f.manager.confirmInstall(plan.id, false), /明确允许/)
  const id = await f.manager.confirmInstall(plan.id, true)
  const [pkg] = (await f.manager.list()).packages
  assert.equal(pkg.id, id)
  assert.deepEqual(pkg.contentIds.species, ['water:pet'])
  assert.equal(pkg.title, 'water')
  const directory = await f.manager.sourceDirectory(id)
  assert.equal(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name, pkg.name)
  await assert.rejects(f.manager.sourceDirectory('not-installed'), /未安装/)
  const restored = new ContentLibrary({ root: f.libraryRoot, run: f.run, host: f.host })
  assert.equal((await restored.list()).packages[0].id, id)
  await restored.uninstall(id)
  assert.equal((await restored.list()).packages.length, 0)
  assert.ok(await readFile(source))
})
it('prepares a complete selection and only publishes it after approval and validation', async () => {
  const f = await fixture('selection')
  const water = await install(f)
  const plan = await f.manager.planSelection([water], true)
  assert.deepEqual((await f.manager.list()).activeIds, [])
  await f.manager.applySelection(plan.id, false)
  assert.deepEqual((await f.manager.list()).activeIds, [water])
  await assert.rejects(f.manager.uninstall(water), /先停用/)
  await f.manager.start()
  const oldDirectory = f.host.projectDirectory()
  const empty = await f.manager.planSelection([], true)
  await f.manager.applySelection(empty.id, false)
  assert.equal(f.host.projectDirectory(), oldDirectory)
  assert.equal((await f.manager.list()).serviceNeedsRestart, true)
  await f.manager.uninstall(water)
})
it('preserves the prior active selection on content validation failure', async () => {
  const f = await fixture('failure')
  const water = await install(f)
  const first = await f.manager.planSelection([water], true)
  await f.manager.applySelection(first.id, false)
  f.fail()
  const plan = await f.manager.planSelection([], true)
  await assert.rejects(f.manager.applySelection(plan.id, false), /INVALID_CONTENT/)
  assert.deepEqual((await f.manager.list()).activeIds, [water])
})
it('rejects arbitrary IDs, package ranges, duplicate versions, and stale operation plans', async () => {
  const f = await fixture('bounds')
  await assert.rejects(f.manager.stageNpm('@test/water@latest'), /明确版本/)
  await assert.rejects(f.manager.stageNpm('--ignore-scripts'), /明确版本/)
  await assert.rejects(f.manager.planSelection(['/tmp/arbitrary']), /未安装/)
  const water = await install(f)
  await assert.rejects(f.manager.stageFile(await f.file('water')), /同一版本/)
  const old = await f.manager.planSelection([water])
  await install(f, 'forest')
  await assert.rejects(f.manager.applySelection(old.id, false), /已变化/)
  await f.manager.cancel(old.id)
  const otherVersion = await install(f, 'water', '2.0.0')
  await assert.rejects(f.manager.planSelection([water, otherVersion]), /只能启用一个版本/)
})
it('requires approval of newly resolved dependencies before executing content', async () => {
  const f = await fixture('dependencies')
  const id = await install(f)
  f.changeDependency()
  const plan = await f.manager.planSelection([id])
  assert.equal(plan.requiresApproval, true)
  assert.equal(plan.newDependencies[0].name, 'new-library')
  const before = f.calls.length
  await assert.rejects(f.manager.applySelection(plan.id, false), /依赖发生变化/)
  assert.equal(f.calls.length, before)
  await f.manager.applySelection(plan.id, true)
})
it('rejects namespace conflicts before changing active packages', async () => {
  const f = await fixture('conflict')
  const a = await install(f, 'a', '1.0.0', 'shared')
  const b = await install(f, 'b', '1.0.0', 'shared')
  await assert.rejects(f.manager.planSelection([a, b]), /NAMESPACE_CONFLICT/)
  assert.deepEqual((await f.manager.list()).activeIds, [])
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

async function settled(manager, expected = 'ready') {
  for (let i = 0; i < 250; i++) {
    const snapshot = await manager.list()
    if (snapshot.selection.status === expected) return snapshot
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail('Content did not reach ' + expected)
}
it('automatically installs and enables with no apply step, and persists the desired selection', async () => {
  const f = await fixture('automatic-install')
  try {
    const id = await f.manager.installFile(await f.file('water'), true)
    assert.deepEqual((await f.manager.list()).desiredIds, [id])
    assert.deepEqual((await settled(f.manager)).activeIds, [id])
    assert.equal(f.host.status().status, 'idle')
    assert.equal(f.prepared.length, 0)
    await f.manager.setSelection([], true)
    assert.deepEqual((await settled(f.manager)).activeIds, [])
    assert.equal(f.host.status().status, 'idle')
    assert.equal(f.prepared.length, 0)
    const stored = JSON.parse(await readFile(join(f.libraryRoot, 'library.json'), 'utf8'))
    assert.deepEqual(stored.desiredIds, [])
  } finally {
    await f.manager.close()
  }
})
it('converges to the latest in-flight choice without switching to a superseded candidate or restarting', async () => {
  const f = await fixture('automatic-latest')
  try {
    const a = await install(f, 'a'),
      b = await install(f, 'b'),
      c = await install(f, 'c')
    await f.manager.setSelection([a], true)
    await settled(f.manager)
    await f.manager.start() // Explicit hosting is the only service start.
    const initial = f.host.status()
    const block = f.blockPreparation()
    await f.manager.setSelection([b], true)
    await block.entered
    const staleDirectory = f.prepared.at(-1).directory
    await f.manager.setSelection([c], true)
    assert.deepEqual((await f.manager.list()).desiredIds, [c])
    block.release()
    assert.deepEqual((await settled(f.manager)).activeIds, [c])
    assert.ok(!f.selected.some(value => value.directory === staleDirectory))
    assert.ok(f.retired.some(value => value.directory === staleDirectory))
    assert.deepEqual(f.host.status(), initial)
    const count = f.prepared.length
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(f.prepared.length, count)
  } finally {
    await f.manager.close()
  }
})
it('retains the actual active content on failure and retries the desired choice without confirmation', async () => {
  const f = await fixture('automatic-failure')
  try {
    const a = await install(f, 'a'),
      b = await install(f, 'b')
    await f.manager.setSelection([a], true)
    await settled(f.manager)
    const old = f.host.projectDirectory()
    f.fail()
    await f.manager.setSelection([b], true)
    const failure = await settled(f.manager, 'failed')
    assert.deepEqual(failure.activeIds, [a])
    assert.deepEqual(failure.desiredIds, [b])
    assert.equal(f.host.projectDirectory(), old)
    const calls = f.calls.length
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(f.calls.length, calls)
    f.recover()
    await f.manager.setSelection([b], true)
    assert.deepEqual((await settled(f.manager)).activeIds, [b])
  } finally {
    await f.manager.close()
  }
})
it('restores selected content after restart without reinstalling or starting hosting', async () => {
  const f = await fixture('automatic-restore')
  const id = await f.manager.installFile(await f.file('water'), true)
  await settled(f.manager)
  await f.manager.close()
  await f.host.stop()
  const before = f.calls.length
  const restored = new ContentLibrary({ root: f.libraryRoot, host: f.host, run: f.run })
  try {
    await restored.resume()
    assert.deepEqual((await settled(restored)).activeIds, [id])
    assert.equal(f.calls.length, before)
    assert.equal(f.host.status().status, 'idle')
  } finally {
    await restored.close()
  }
})
it('updates an explicitly started host when returning to official-only content', async () => {
  const f = await fixture('automatic-base')
  try {
    await f.manager.installFile(await f.file('water'), true)
    await settled(f.manager)
    await f.manager.start()
    const ready = await f.manager.list()
    await f.manager.setSelection([], true)
    assert.deepEqual((await settled(f.manager)).activeIds, [])
    assert.deepEqual(f.host.status(), ready.serviceStatus)
    assert.equal(f.selected.at(-1).builtinOnly, true)
  } finally {
    await f.manager.close()
  }
})
it('restores the last usable content when a persisted newer goal still fails after application restart', async () => {
  const f = await fixture('automatic-fallback')
  const a = await install(f, 'a'),
    b = await install(f, 'b')
  await f.manager.setSelection([a], true)
  await settled(f.manager)
  f.fail()
  await f.manager.setSelection([b], true)
  await settled(f.manager, 'failed')
  const old = f.host.projectDirectory()
  await f.manager.close()
  await f.host.stop()
  const restored = new ContentLibrary({ root: f.libraryRoot, host: f.host, run: f.run })
  try {
    await restored.resume()
    const snapshot = await settled(restored, 'failed')
    assert.deepEqual(snapshot.desiredIds, [b])
    assert.deepEqual(snapshot.activeIds, [a])
    assert.equal(f.host.status().status, 'idle')
    assert.equal(f.host.projectDirectory(), old)
  } finally {
    await restored.close()
  }
})
it('does not prepare or switch content again when reopening an already ready client', async () => {
  const f = await fixture('automatic-reopen')
  try {
    await f.manager.installFile(await f.file('water'), true)
    await settled(f.manager)
    const count = f.prepared.length
    await f.manager.resume()
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(f.prepared.length, count)
    assert.equal((await f.manager.list()).selection.status, 'ready')
  } finally {
    await f.manager.close()
  }
})

const activeDirectory = async f => {
  const state = JSON.parse(await readFile(join(f.libraryRoot, 'library.json'), 'utf8'))
  return join(f.libraryRoot, 'projects', 'content-' + state.activeProject.replaceAll('-', ''))
}
const exists = async directory => !!(await realpath(directory).catch(() => null))
it('collects historical successful combinations while protecting installed, active, staged and leased projects', async () => {
  const f = await fixture('gc-boundaries')
  try {
    const a = await install(f, 'a'),
      b = await install(f, 'b')
    await f.manager.setSelection([a], true)
    await settled(f.manager)
    const old = await activeDirectory(f)
    const first = await f.manager.acquireProject(),
      second = await f.manager.acquireProject()
    const staged = await f.manager.planSelection([a, b], true)
    const stagedRoot = f.calls.filter(args => args[2] === 'stage').at(-1)[3]
    await f.manager.setSelection([b], true)
    await settled(f.manager)
    await f.manager.collectGarbage()
    assert.ok(await exists(old))
    assert.ok(await exists(stagedRoot))
    assert.ok(await f.manager.sourceDirectory(a))
    assert.ok(await f.manager.sourceDirectory(b))
    assert.ok(await exists(await activeDirectory(f)))
    await first.release()
    await first.release()
    assert.ok(await exists(old))
    await second.release()
    assert.equal(await exists(old), false)
    await f.manager.cancel(staged.id)
    assert.equal(await exists(stagedRoot), false)
    const unleased = await activeDirectory(f)
    await f.manager.setSelection([a], true)
    await settled(f.manager)
    await f.manager.collectGarbage()
    assert.equal(await exists(unleased), false)
  } finally {
    await f.manager.close()
  }
})
it('retains retired host environments until their room/checkpoint leases actually disappear', async () => {
  const f = await fixture('gc-host-lease')
  try {
    const a = await install(f, 'a'),
      b = await install(f, 'b')
    await f.manager.setSelection([a], true)
    await settled(f.manager)
    await f.manager.start()
    const old = f.host.projectDirectory()
    f.heldDirectories.add(old)
    await f.manager.setSelection([b], true)
    await settled(f.manager)
    await f.manager.collectGarbage()
    assert.ok(f.retired.some(value => value.directory === old))
    assert.ok(await exists(old))
    f.heldDirectories.delete(old)
    await f.manager.collectGarbage()
    assert.equal(await exists(old), false)
  } finally {
    await f.manager.close()
  }
})
it('keeps the fallback on failed goals, skips uncertain host state, and collects orphans safely after restart', async () => {
  const f = await fixture('gc-restart')
  const a = await install(f, 'a'),
    b = await install(f, 'b')
  await f.manager.setSelection([a], true)
  await settled(f.manager)
  const fallback = await activeDirectory(f)
  f.fail()
  await f.manager.setSelection([b], true)
  await settled(f.manager, 'failed')
  await f.manager.collectGarbage()
  assert.ok(await exists(fallback))
  const orphan = join(f.libraryRoot, 'projects', 'content-' + 'a'.repeat(32))
  await mkdir(orphan)
  const foreign = join(f.libraryRoot, 'projects', 'user-directory')
  await mkdir(foreign)
  const linked = join(f.libraryRoot, 'projects', 'content-' + 'b'.repeat(32))
  await symlink(foreign, linked, 'dir')
  const lifecycle = f.host.retainedProjectDirectories
  f.host.retainedProjectDirectories = async () => {
    throw new Error('disconnected')
  }
  await f.manager.collectGarbage()
  assert.ok(await exists(orphan))
  f.host.retainedProjectDirectories = lifecycle
  await f.manager.close()
  const restored = new ContentLibrary({ root: f.libraryRoot, host: f.host, run: f.run })
  try {
    await restored.resume()
    assert.equal(await exists(orphan), false)
    assert.ok(await exists(fallback))
    assert.ok(await exists(foreign))
    assert.ok((await readdir(join(f.libraryRoot, 'projects'))).includes('content-' + 'b'.repeat(32)))
  } finally {
    await restored.close()
  }
})
it('leases official-only content before the first selection and rejects static preparation before publication', async () => {
  const f = await fixture('gc-static-prepare')
  const lease = await f.manager.acquireProject()
  assert.equal(lease.directory, null)
  assert.equal(lease.builtinOnly, true)
  await lease.release()
  const a = await install(f, 'a')
  f.manager.prepare = async () => {
    throw new Error('COMPILE_FAILED')
  }
  try {
    await f.manager.setSelection([a], true)
    const snapshot = await settled(f.manager, 'failed')
    assert.deepEqual(snapshot.activeIds, [])
    assert.match(snapshot.selection.message, /COMPILE_FAILED/)
    assert.deepEqual(snapshot.desiredIds, [a])
    await f.manager.collectGarbage()
    assert.equal((await readdir(join(f.libraryRoot, 'projects'))).length, 1)
  } finally {
    await f.manager.close()
  }
})
