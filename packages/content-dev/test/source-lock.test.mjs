import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, writeFile, rm, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AuthorWorkspace } from '../src/workspace.mjs'
import { withSourceLock } from '../src/source-lock.mjs'

const workspaceUrl = new URL('../src/workspace.mjs', import.meta.url).href
const lockUrl = new URL('../src/source-lock.mjs', import.meta.url).href

async function project(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-source-lock-')))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'lock-test', arcadia: { projectId: 'lock', namespace: 'lock' } }),
  )
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(async () => {
    await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  return workspace
}

function processWriter(t, root, operation, expectedVersion, text = 'changed', file = 'source.txt') {
  const script = `
    import { AuthorWorkspace } from ${JSON.stringify(workspaceUrl)}
    const [root, operation, version, text, file] = process.argv.slice(1)
    const workspace = await AuthorWorkspace.open(root, { watch: false })
    process.send({ ready: true })
    await new Promise(resolve => process.once('message', resolve))
    try {
      const input = { file, expectedVersion: JSON.parse(version), text }
      await workspace[operation](input)
      process.send({ saved: true })
    } catch (error) {
      process.send({ code: error.code, message: error.message })
    } finally {
      await workspace.close()
      process.disconnect()
    }
  `
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', script, root, operation, JSON.stringify(expectedVersion), text, file],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  )
  let stderr = ''
  child.stderr.on('data', chunk => {
    stderr += chunk
  })
  const ready = once(child, 'message')
  const exited = once(child, 'exit').then(([code]) => assert.equal(code, 0, stderr))
  t.after(() => child.kill('SIGKILL'))
  return { child, ready, exited }
}

async function race(t, workspace, operations, version, files = []) {
  const writers = operations.map((operation, index) =>
    processWriter(t, workspace.root, operation, version, `writer-${index}`, files[index]),
  )
  await Promise.all(writers.map(writer => writer.ready))
  const results = writers.map(writer => once(writer.child, 'message').then(([result]) => result))
  writers.forEach(writer => writer.child.send('go'))
  const values = await Promise.all(results)
  await Promise.all(writers.map(writer => writer.exited))
  assert.equal(values.filter(value => value.saved).length, 1, JSON.stringify(values))
  assert.equal(
    values.filter(value => value.code === 'REVISION_CONFLICT').length,
    operations.length - 1,
    JSON.stringify(values),
  )
}

test('separate author processes cannot both replace the same source version', async t => {
  const workspace = await project(t)
  const saved = await workspace.write({ file: 'source.txt', expectedVersion: null, text: 'original' })
  await race(t, workspace, ['write', 'write', 'write'], saved.version)
  assert.match((await workspace.read('source.txt')).text, /^writer-[012]$/)
})

test('separate author processes cannot both create a new source', async t => {
  const workspace = await project(t)
  await race(t, workspace, ['write', 'write'], null)
})

test('case aliases share coordination for existing and newly created files', async t => {
  const workspace = await project(t)
  const saved = await workspace.write({ file: 'source.txt', expectedVersion: null, text: 'original' })
  try {
    assert.equal((await workspace.read('SOURCE.TXT')).version, saved.version)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    t.skip('filesystem is case-sensitive')
    return
  }
  const aliases = ['source.txt', 'SOURCE.TXT']
  await race(t, workspace, ['write', 'write'], saved.version, aliases)
  const changed = await workspace.read('source.txt')
  assert.match(changed.text, /^writer-[01]$/)
  await workspace.remove({ file: changed.file, expectedVersion: changed.version })
  await race(t, workspace, ['write', 'write'], null, aliases)
  assert.match((await workspace.read('SOURCE.TXT')).text, /^writer-[01]$/)
})

test('remove and replacement compete on the same source version', async t => {
  const workspace = await project(t)
  const saved = await workspace.write({ file: 'source.txt', expectedVersion: null, text: 'original' })
  await race(t, workspace, ['remove', 'write'], saved.version)
})

test('a killed lock owner is recoverable and coordination never changes source revisions', async t => {
  const workspace = await project(t)
  const saved = await workspace.write({ file: 'source.txt', expectedVersion: null, text: 'original' })
  const revision = await workspace.revision()
  const script = `
    import { withSourceLock } from ${JSON.stringify(lockUrl)}
    await withSourceLock(process.argv[1], 'source.txt', async () => {
      process.send('locked')
      await new Promise(resolve => setInterval(resolve, 60000))
    })
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, workspace.root], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  t.after(() => child.kill('SIGKILL'))
  await once(child, 'message')
  assert.equal(await workspace.revision(), revision)
  await assert.rejects(
    withSourceLock(workspace.root, 'another.txt', () => assert.fail('must not enter'), { timeoutMs: 80 }),
    { code: 'SOURCE_BUSY' },
  )
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  await workspace.write({ file: 'source.txt', expectedVersion: saved.version, text: 'original' })
  assert.equal(await workspace.revision(), revision)
  assert.ok(!(await workspace.files()).some(entry => entry.file.startsWith('.arcadia/')))
})

test('external saves remain available while a desktop draft waits for reconciliation', async t => {
  const workspace = await project(t)
  const file = 'data/skills/hit.json'
  const original = await workspace.write({
    file,
    expectedVersion: null,
    text: JSON.stringify({ id: 'hit', power: 40 }),
  })
  workspace.setDirty(file, true)
  const external = await AuthorWorkspace.open(workspace.root, { watch: false })
  t.after(() => external.close())
  await external.write({ file, expectedVersion: original.version, text: JSON.stringify({ id: 'hit', power: 60 }) })
  await assert.rejects(
    workspace.saveRecord({ file, expectedVersion: original.version, record: { id: 'hit', power: 50 } }),
    {
      code: 'REVISION_CONFLICT',
    },
  )
  assert.equal(JSON.parse((await workspace.read(file)).text).power, 60)
})

test('coordination refuses redirected internal directories', async t => {
  const workspace = await project(t)
  const outside = await mkdtemp(join(tmpdir(), 'arcadia-lock-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await symlink(outside, join(workspace.root, '.arcadia'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(workspace.write({ file: 'source.txt', expectedVersion: null, text: 'value' }), {
    code: 'PATH_INVALID',
  })
})
