import { after, before, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentProjectManager, runContentCommand } from '../content-projects.mjs'

let root
before(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-content-project-tests-')))
})
after(async () => {
  await rm(root, { recursive: true, force: true })
})
async function fixture(name, run) {
  const directory = join(root, name, 'project')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ dependencies: { '@test/content': 'file:./content.tgz' } }),
  )
  await writeFile(join(directory, 'package-lock.json'), '{}')
  let status = { status: 'idle' }
  const host = {
    status: () => status,
    start: async () => {
      status = { status: 'running' }
      return status
    },
  }
  const file = join(root, name, 'catalog.json')
  const manager = new ContentProjectManager({ file, host, run: run ?? (async () => ({ format: 'ok' })) })
  return { manager, directory, file, host }
}
it('persists named projects, deduplicates canonical paths and never removes project files', async () => {
  const { manager, directory, file, host } = await fixture('catalog')
  const id = await manager.add(directory)
  assert.equal(await manager.add(join(directory, '.')), id)
  await manager.rename(id, '朋友服')
  const restored = new ContentProjectManager({ file, host, run: async () => {} })
  assert.equal((await restored.list())[0].name, '朋友服')
  assert.equal((await restored.list())[0].installed, false)
  await restored.forget(id)
  assert.deepEqual(await restored.list(), [])
  assert.ok(await readFile(join(directory, 'package.json'), 'utf8'))
})
it('rejects unregistered paths, unknown operations and invalid names before calling a command', async () => {
  const calls = []
  const { manager, directory } = await fixture('boundaries', async args => {
    calls.push(args)
    return {}
  })
  const id = await manager.add(directory)
  await assert.rejects(manager.operate(directory, 'install'), /未登记/)
  await assert.rejects(manager.operate(id, 'exec'), /不支持/)
  await assert.rejects(manager.operate(id, '__proto__'), /不支持/)
  await assert.rejects(manager.rename(id, ' '), /名称/)
  assert.deepEqual(calls, [])
})
it('inspects the selected project and returns package metadata and available content IDs', async () => {
  const calls = []
  const { manager, directory } = await fixture('inspection', async args => {
    calls.push(args)
    return {
      format: 'arcadia.npm-installation',
      digest: 'digest',
      packages: [
        {
          name: '@test/content',
          version: '1.0.0',
          location: 'node_modules/@test/content',
          dependencies: { lib: '2.0.0' },
          manifest: { projectId: 'project', namespace: 'custom', effects: 'dist/effects.js' },
          draft: { data: { species: [{ id: 'pet' }], skills: [{ id: 'move' }], marks: [] } },
        },
      ],
    }
  })
  const id = await manager.add(directory)
  await manager.operate(id, 'inspect')
  assert.deepEqual(calls[0], ['content', 'npm', 'inspect', directory])
  const [entry] = await manager.list()
  assert.deepEqual(entry.inspection.contentIds, { species: ['custom:pet'], skills: ['custom:move'], marks: [] })
  assert.equal(entry.inspection.packages[0].containsCode, true)
  assert.deepEqual(entry.dependencies, { '@test/content': 'file:./content.tgz' })
})
it('uses fixed approval and install arguments and clears outdated inspection on failed operations', async () => {
  const calls = []
  const { manager, directory } = await fixture('arguments', async args => {
    calls.push(args)
    if (args.includes('inspect')) return { format: 'arcadia.npm-installation', packages: [] }
    if (args.includes('install')) throw new Error('failed dependency')
    return { format: 'ok' }
  })
  const id = await manager.add(directory)
  await manager.operate(id, 'inspect')
  await assert.rejects(manager.operate(id, 'install', { offline: true }), /failed dependency/)
  assert.equal((await manager.list())[0].inspection, undefined)
  assert.deepEqual(calls[1], ['content', 'npm', 'install', directory, '--offline'])
  await manager.operate(id, 'approve', { profile: 'official' })
  assert.deepEqual(calls[2], ['content', 'npm', 'approve', directory, '--profile', 'local-development'])
})
it('keeps a running environment registered and blocks conflicting mutations', async () => {
  const { manager, directory } = await fixture('running')
  const id = await manager.add(directory)
  await manager.start(id)
  await assert.rejects(manager.forget(id), /先停止/)
  await assert.rejects(manager.operate(id, 'install'), /先停止/)
})
it('serializes mutations and leaves a missing external project registered for recovery', async () => {
  let release
  const wait = new Promise(resolve => {
    release = resolve
  })
  const { manager, directory } = await fixture('concurrency', async () => {
    await wait
    return { format: 'ok' }
  })
  const id = await manager.add(directory)
  const pending = manager.operate(id, 'validate')
  await assert.rejects(manager.forget(id), /正在进行/)
  release()
  await pending
  await rm(directory, { recursive: true })
  assert.match((await manager.list())[0].error, /不可用/)
  await manager.forget(id)
})
it('runs a real CLI child, reserves JSON output and reports command failures', async () => {
  const cli = join(root, 'fixture-cli.mjs')
  await writeFile(
    cli,
    `console.log(JSON.stringify({format:'test.result',args:process.argv.slice(2),token:process.env.ARCADIA_MANAGER_TEST_SECRET}));`,
  )
  process.env.ARCADIA_MANAGER_TEST_SECRET = 'private-test-value'
  try {
    const value = await runContentCommand({ executable: process.execPath, cli }, [
      'content',
      'npm',
      'inspect',
      '/selected/project',
    ])
    assert.deepEqual(value.args, ['content', 'npm', 'inspect', '/selected/project', '--json'])
    assert.equal(value.token, undefined)
  } finally {
    delete process.env.ARCADIA_MANAGER_TEST_SECRET
  }
  await writeFile(
    cli,
    `console.log(JSON.stringify({format:'arcadia.cli.error',diagnostics:[{code:'BAD_TREE',message:'invalid tree'}]}));process.exitCode=2;`,
  )
  await assert.rejects(runContentCommand({ executable: process.execPath, cli }, ['content']), /BAD_TREE/)
})

it('waits for an in-flight command to observe shutdown and rejects later mutations', async () => {
  let started
  const ready = new Promise(resolve => {
    started = resolve
  })
  const { manager, directory } = await fixture('shutdown', async (_args, signal) => {
    started()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return { format: 'cancelled' }
  })
  const id = await manager.add(directory)
  const operation = manager.operate(id, 'validate')
  await ready
  await manager.close()
  await operation
  await assert.rejects(manager.rename(id, 'too late'), /已关闭/)
})
