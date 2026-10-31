import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AuthorWorkspace } from '../src/workspace.mjs'

test('base source layout is readable without modifying its package manifest', async t => {
  const workspace = await AuthorWorkspace.open(fileURLToPath(new URL('../../../packs/base', import.meta.url)), {
    watch: false,
  })
  t.after(() => workspace.close())
  const snapshot = await workspace.snapshot()
  assert.equal(snapshot.capabilities.sourceEditing, false)
  assert.equal(snapshot.project.projectId, 'arcadia-eternity.base')
  assert.ok(snapshot.records.some(row => row.kind === 'species' && row.record.id === 'pet_dilan'))
  assert.ok(snapshot.records.some(row => row.kind === 'skills' && row.record.id === 'skill_xishui'))
  assert.ok(snapshot.localeSources.some(row => row.namespace === 'species' && row.entries.pet_dilan.name === '迪兰'))
  assert.deepEqual(snapshot.diagnostics, [])
})

test('read-only workspaces reject raw writes, form saves and late changes to base identity', async t => {
  for (const options of [{ watch: false, readOnly: true }, { watch: false }]) {
    const { workspace, root } = await fixture(t, options)
    if (!options.readOnly)
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({ name: '@arcadia-eternity/data-pack-base', arcadia: { projectId: 'base', namespace: 'base' } }),
      )
    const source = await workspace.read('data/skills/hit.yaml')
    await assert.rejects(workspace.write({ ...source, expectedVersion: source.version, text: 'id: hit\npower: 99' }), {
      code: 'WRITE_DISABLED',
    })
    await assert.rejects(
      workspace.saveChanges(
        {
          changes: [
            { kind: 'record', file: source.file, expectedVersion: source.version, record: { id: 'hit', power: 99 } },
          ],
        },
        { fromForm: true },
      ),
      { code: 'WRITE_DISABLED' },
    )
    assert.equal((await workspace.read(source.file)).text, source.text)
  }
})

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
test('new objects and new locale sources join a reviewed save without replacing existing files', async t => {
  const { workspace, root } = await fixture(t)
  const file = 'data/marks/independent.yaml'
  const changes = [
    { kind: 'create-record', file, expectedVersion: null, record: { id: 'independent', config: { duration: 2 } } },
    {
      kind: 'locale',
      file: 'locales/en/mark.yaml',
      expectedVersion: null,
      id: 'independent',
      record: { name: 'Independent' },
    },
  ]
  const result = await workspace.saveChanges({ changes }, { fromForm: true })
  assert.equal(result.complete, true)
  assert.equal(
    (await workspace.snapshot()).records.find(row => row.record.id === 'independent').record.config.duration,
    2,
  )
  assert.match(await readFile(join(root, 'locales/en/mark.yaml'), 'utf8'), /Independent/)
  await assert.rejects(workspace.saveChanges({ changes }), { code: 'DUPLICATE_ID' })
  await assert.rejects(
    workspace.saveChanges({
      changes: [{ ...changes[0], file: 'data/marks/invalid.yaml', index: 0, record: { id: 'invalid' } }],
    }),
    { code: 'SOURCE_INVALID' },
  )
  await writeFile(join(root, 'data/marks/occupied.yaml'), 'id: external\nconfig: {duration: 9}\n')
  await assert.rejects(
    workspace.saveChanges({
      changes: [{ ...changes[0], file: 'data/marks/occupied.yaml', record: { id: 'another' } }],
    }),
    { code: 'REVISION_CONFLICT' },
  )
  assert.match(await readFile(join(root, 'data/marks/occupied.yaml'), 'utf8'), /external/)
})
test('new records preserve existing locale anchors and reject an invalid creation before any writes', async t => {
  const { workspace, root } = await fixture(t)
  await mkdir(join(root, 'locales/zh-CN'), { recursive: true })
  await writeFile(join(root, 'locales/zh-CN/skill.yaml'), '# names\nhit: &title\n  name: Hit\ncopy: *title\n')
  const source = await workspace.read('locales/zh-CN/skill.yaml')
  const create = {
    kind: 'create-record',
    file: 'data/skills/standalone.yaml',
    expectedVersion: null,
    record: { id: 'standalone', power: 3 },
  }
  await workspace.saveChanges({
    changes: [
      create,
      {
        kind: 'locale',
        file: source.file,
        expectedVersion: source.version,
        id: 'standalone',
        record: { name: '独立技能' },
      },
    ],
  })
  const saved = await readFile(join(root, source.file), 'utf8')
  assert.match(saved, /&title/)
  assert.match(saved, /\*title/)
  assert.match(saved, /# names/)
  const before = await workspace.read('data/skills/hit.yaml')
  await assert.rejects(
    workspace.saveChanges({
      changes: [
        { kind: 'record', file: before.file, expectedVersion: before.version, record: { id: 'hit', power: 80 } },
        { ...create, file: 'outside.yaml', record: { id: 'bad' } },
      ],
    }),
    { code: 'SOURCE_INVALID' },
  )
  assert.equal((await workspace.read(before.file)).version, before.version)
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

test('resource IDs survive relocation, resource drafts conflict on outside changes, and bindings save separately', async t => {
  const { workspace, root } = await fixture(t)
  await mkdir(join(root, 'art'))
  await writeFile(join(root, 'art/sound.mp3'), Buffer.from('sound'))
  const resource = { id: 'hit-sound', kind: 'audio', source: 'art/sound.mp3' }
  const binding = { id: 'hit-display', target: { kind: 'skills', id: 'hit' }, sfx: 'hit-sound' }
  const rule = await workspace.read('data/skills/hit.yaml')
  await workspace.saveChanges({
    changes: [
      { kind: 'create-record', file: 'data/resources/hit.yaml', expectedVersion: null, record: resource },
      { kind: 'create-record', file: 'data/presentations/hit.yaml', expectedVersion: null, record: binding },
    ],
  })
  let snapshot = await workspace.snapshot()
  assert.deepEqual(snapshot.diagnostics, [])
  assert.equal(snapshot.assets[0].references[0].id, 'hit')
  assert.equal((await workspace.read(rule.file)).text, rule.text)
  const source = snapshot.records.find(row => row.kind === 'resources')
  await rename(join(root, 'art/sound.mp3'), join(root, 'art/renamed.mp3'))
  snapshot = await workspace.snapshot()
  assert.equal(snapshot.diagnostics[0].code, 'RESOURCE_MISSING')
  await writeFile(join(root, source.file), '# external\nid: hit-sound\nkind: audio\nsource: art/renamed.mp3\n')
  await assert.rejects(
    workspace.saveRecord({ ...source, expectedVersion: source.version, record: { ...resource, name: 'Hit' } }),
    { code: 'REVISION_CONFLICT' },
  )
  const latest = (await workspace.snapshot()).records.find(row => row.kind === 'resources')
  await workspace.saveRecord({ ...latest, expectedVersion: latest.version, record: { ...latest.record, name: 'Hit' } })
  assert.match((await workspace.read(latest.file)).text, /# external/)
  snapshot = await workspace.snapshot()
  assert.deepEqual(snapshot.diagnostics, [])
  assert.deepEqual(snapshot.records.find(row => row.kind === 'presentations').record, binding)
  assert.equal((await workspace.asset('art/renamed.mp3')).bytes.toString(), 'sound')
  await rename(join(root, latest.file), join(root, 'data/resources/moved.yaml'))
  assert.equal((await workspace.snapshot()).assets[0].references[0].id, 'hit')
})
