import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthorWorkspace } from '../src/workspace.mjs'

async function fixture(t, options = { watch: false }) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-source-'))
  await mkdir(join(root, 'data/skills'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'example', arcadia: { projectId: 'example', namespace: 'example', sdkApi: 2 } }),
  )
  await writeFile(join(root, 'data/skills/hit.yaml'), '# 作者注释\nid: hit\npower: 40 # 基础威力\nextra: keep\n')
  const workspace = await AuthorWorkspace.open(root, options)
  t.after(async () => {
    await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  return { workspace, root }
}
test('form save preserves YAML comments, unknown fields and sibling array records', async t => {
  const { workspace, root } = await fixture(t)
  let source = (await workspace.snapshot()).records[0]
  await workspace.saveRecord({ ...source, expectedVersion: source.version, record: { ...source.record, power: 60 } })
  assert.match(await readFile(join(root, source.file), 'utf8'), /power: 60 # 基础威力/)
  assert.match(await readFile(join(root, source.file), 'utf8'), /# 作者注释/)
  assert.equal((await workspace.snapshot()).records[0].record.extra, 'keep')
  await writeFile(
    join(root, 'data/skills/array.json'),
    JSON.stringify([
      { id: 'a', power: 1 },
      { id: 'b', custom: [4] },
    ]),
  )
  source = (await workspace.snapshot()).records.find(r => r.record.id === 'a')
  await workspace.saveRecord({ ...source, expectedVersion: source.version, record: { ...source.record, power: 9 } })
  assert.deepEqual(JSON.parse(await readFile(join(root, source.file), 'utf8')), [
    { id: 'a', power: 9 },
    { id: 'b', custom: [4] },
  ])
})
test('external edits reject stale saves and only block the affected file', async t => {
  const { workspace, root } = await fixture(t)
  const source = (await workspace.snapshot()).records[0]
  await writeFile(join(root, source.file), 'id: hit\npower: 77\n')
  await assert.rejects(
    workspace.saveRecord({ ...source, expectedVersion: source.version, record: { ...source.record, power: 50 } }),
    { code: 'REVISION_CONFLICT' },
  )
  assert.equal((await workspace.snapshot()).records[0].record.power, 77)
  workspace.setDirty(source.file, true)
  const current = await workspace.read(source.file)
  await assert.rejects(workspace.write({ ...current, expectedVersion: current.version, text: 'id: hit' }), {
    code: 'UNSAVED_CHANGES',
  })
  await workspace.write({ file: 'data/skills/other.json', expectedVersion: null, text: '{"id":"other"}' })
  assert.equal((await workspace.snapshot()).records.length, 2)
})
test('concurrent writers cannot both save the same version', async t => {
  const { workspace } = await fixture(t)
  const source = await workspace.read('data/skills/hit.yaml')
  const results = await Promise.allSettled(
    [1, 2].map(power =>
      workspace.write({ ...source, expectedVersion: source.version, text: `id: hit\npower: ${power}` }),
    ),
  )
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT')
})
test('broken source remains on disk and reports its actual file', async t => {
  const { workspace, root } = await fixture(t)
  await writeFile(join(root, 'data/skills/broken.yaml'), 'id: [')
  const result = await workspace.snapshot()
  assert.equal(result.records.length, 1)
  assert.equal(result.diagnostics[0].file, 'data/skills/broken.yaml')
  assert.equal(await readFile(join(root, 'data/skills/broken.yaml'), 'utf8'), 'id: [')
})
test('generated paths and symlink traversal cannot be read or written', async t => {
  const { workspace, root } = await fixture(t)
  await symlink(tmpdir(), join(root, 'outside'))
  for (const file of ['../escape', 'dist/content.json', '.git/config', 'outside/leak']) {
    await assert.rejects(workspace.write({ file, expectedVersion: null, text: 'no' }), { code: 'PATH_INVALID' })
  }
})
test('filesystem saves made by an external editor emit a refresh event', async t => {
  const { workspace, root } = await fixture(t, { watch: true })
  const changed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No file event')), 5000)
    workspace.on('change', event => {
      if (event.file !== 'data/skills/hit.yaml') return
      clearTimeout(timeout)
      resolve(event)
    })
  })
  await writeFile(join(root, 'data/skills/.save.tmp'), 'id: hit\npower: 80\n')
  await rename(join(root, 'data/skills/.save.tmp'), join(root, 'data/skills/hit.yaml'))
  await changed
  assert.equal((await workspace.snapshot()).records[0].record.power, 80)
})
