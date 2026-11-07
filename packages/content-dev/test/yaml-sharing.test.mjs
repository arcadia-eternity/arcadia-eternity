import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { AuthorWorkspace } from '../src/workspace.mjs'
import { readContentSources } from '../src/lib/content.mjs'
import { buildPresentation } from '../src/lib/presentation.mjs'

const source = `# shared status
- id: first
  name: First
  config: &status
    duration: 3 # turns
    maxStacks: 6
- id: second
  name: Second
  config: *status
- id: override
  config:
    <<: *status
    duration: 5
`
async function fixture(t, text = source) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-yaml-'))
  const file = 'data/marks/status.yaml'
  await mkdir(join(root, 'data/marks'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', arcadia: { projectId: 'fixture', namespace: 'fixture' } }),
  )
  await writeFile(join(root, file), text)
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(async () => {
    await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  const rows = async () => (await workspace.snapshot()).records
  const save = (row, record) => workspace.saveRecord({ ...row, expectedVersion: row.version, record })
  const contents = () => readFile(join(root, file), 'utf8')
  return { root, file, workspace, rows, save, contents }
}

test('shared provenance distinguishes definitions, aliases and inherited fields from local overrides', async t => {
  const { rows, root } = await fixture(t)
  const [first, second, override] = await rows()
  assert.deepEqual(
    first.sharedFields.map(f => [f.path, f.reason]),
    [[['config'], 'anchor']],
  )
  assert.deepEqual(
    second.sharedFields.map(f => [f.path, f.reason]),
    [[['config'], 'alias']],
  )
  assert.deepEqual(
    override.sharedFields.map(f => [f.path, f.reason]),
    [[['config', 'maxStacks'], 'merge']],
  )
  for (const row of [first, second, override]) {
    assert.equal(row.sharedFields[0].anchor, 'status')
    assert.deepEqual(row.sharedFields[0].sourcePath, [0, 'config'])
    assert.equal(row.sharedFields[0].line, 5)
  }
  assert.equal(second.record.config.duration, 3)
  assert.equal(override.record.config.duration, 5)
  assert.deepEqual((await readContentSources(root))[0].records, [first.record, second.record, override.record])
})

test('ordinary and local override saves preserve comments, names, aliases and sibling values', async t => {
  const { rows, save, contents } = await fixture(t)
  let [first, second] = await rows()
  await save(second, { ...second.record, name: 'Changed' })
  let text = await contents()
  assert.match(text, /config: &status/)
  assert.match(text, /config: \*status/)
  assert.match(text, /<<: \*status/)
  assert.match(text, /duration: 3 # turns/)
  assert.match(text, /# shared status/)
  assert.deepEqual((await rows())[0].record, first.record)
  const override = (await rows())[2]
  await save(override, { ...override.record, config: { ...override.record.config, duration: 7 } })
  assert.deepEqual(
    (await rows()).map(r => r.record.config.duration),
    [3, 3, 7],
  )
  text = await contents()
  const unchanged = (await rows())[1]
  await save(unchanged, unchanged.record)
  assert.equal(await contents(), text)
})

test('backend rejects changes and removal of shared fields even without UI metadata', async t => {
  const { rows, save, contents } = await fixture(t)
  for (const row of await rows()) {
    const before = await contents()
    const field = row.record.id === 'override' ? 'maxStacks' : 'duration'
    await assert.rejects(
      save(
        { ...row, sharedFields: [] },
        {
          ...row.record,
          config: { ...row.record.config, [field]: 99 },
        },
      ),
      { code: 'SHARED_FIELD_READ_ONLY' },
    )
    const removed = { ...row.record }
    delete removed.config
    await assert.rejects(save(row, removed), { code: 'SHARED_FIELD_READ_ONLY' })
    assert.equal(await contents(), before)
  }
})

test('external shared changes invalidate stale form saves and refresh all users', async t => {
  const { workspace, root, file, rows, save, contents } = await fixture(t)
  const second = (await rows())[1]
  await writeFile(join(root, file), source.replace('duration: 3', 'duration: 4'))
  await assert.rejects(save(second, { ...second.record, name: 'Draft' }), { code: 'REVISION_CONFLICT' })
  assert.deepEqual(
    (await rows()).map(r => r.record.config.duration),
    [4, 4, 5],
  )
  assert.match(await contents(), /name: Second/)
  assert.deepEqual((await workspace.snapshot()).diagnostics, [])
})

test('merge sequence precedence and nested sharing are retained', async t => {
  const { rows, save } = await fixture(
    t,
    `- id: one
  config: &one { duration: 3, maxStacks: 6 }
- id: two
  config: &two { duration: 9, stackable: true }
- id: three
  config:
    <<: [*one, *two]
    duration: 5
  extra:
    levels: &levels [1, 2]
    same: *levels
`,
  )
  const row = (await rows())[2]
  assert.deepEqual(row.record.config, { duration: 5, maxStacks: 6, stackable: true })
  assert.deepEqual(
    row.sharedFields.map(f => [f.path.join('.'), f.anchor]),
    [
      ['config.maxStacks', 'one'],
      ['config.stackable', 'two'],
      ['extra.levels', 'levels'],
      ['extra.same', 'levels'],
    ],
  )
  await save(row, { ...row.record, name: 'Allowed' })
  const current = (await rows())[2]
  await assert.rejects(save(current, { ...current.record, extra: { levels: [1], same: [1, 2] } }), {
    code: 'SHARED_FIELD_READ_ONLY',
  })
})

test('anchors on scalars and whole records cannot be silently replaced', async t => {
  const { rows, save } = await fixture(
    t,
    `- &record
  id: first
  power: &power 3
- id: second
  power: *power
  example: *record
`,
  )
  const [first, second] = await rows()
  assert.deepEqual(first.sharedFields[0].path, [])
  assert.equal(second.sharedFields[0].reason, 'alias')
  await assert.rejects(save(first, { ...first.record, name: 'Unsafe' }), { code: 'SHARED_FIELD_READ_ONLY' })
  await save(second, { ...second.record, name: 'Allowed' })
})

test('merge sources supplied through an aliased sequence remain inherited and read-only', async t => {
  const { rows, save } = await fixture(
    t,
    `- id: one
  sources: &sources [{ duration: 3 }, { maxStacks: 6 }]
- id: two
  config:
    <<: *sources
    duration: 5
`,
  )
  const row = (await rows())[1]
  assert.deepEqual(
    row.sharedFields.map(field => field.path),
    [['config', 'maxStacks']],
  )
  await assert.rejects(save(row, { ...row.record, config: { duration: 5, maxStacks: 8 } }), {
    code: 'SHARED_FIELD_READ_ONLY',
  })
})

test('localized names and descriptions resolve the same way in workspace and build', async t => {
  const { root, workspace } = await fixture(t)
  const file = 'locales/zh-CN/mark.yaml'
  await mkdir(join(root, 'locales/zh-CN'), { recursive: true })
  await writeFile(
    join(root, file),
    `first: &text
  name: 状态
  description: 持续三个回合
second: *text
override:
  <<: *text
  name: 特殊状态
`,
  )
  const snapshot = await workspace.snapshot()
  const presentation = await buildPresentation(root, await readContentSources(root))
  assert.deepEqual(snapshot.locales[file], presentation.locales['zh-CN'].mark)
  assert.deepEqual(presentation.locales['zh-CN'].mark.override, { name: '特殊状态', description: '持续三个回合' })
})

for (const [name, text] of [
  ['unresolved alias', 'id: broken\nconfig: *missing\n'],
  ['cycle', 'id: broken\nconfig: &cycle { self: *cycle }\n'],
  [
    'expansion limit',
    'id: broken\na: &a [1, 2]\nb: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a, *a]\nc: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b, *b]\n',
  ],
])
  test(`${name} reports a diagnostic and leaves source untouched`, async t => {
    const { workspace, contents } = await fixture(t, text)
    const snapshot = await workspace.snapshot()
    assert.equal(snapshot.records.length, 0)
    assert.equal(snapshot.diagnostics[0].code, 'SOURCE_INVALID')
    assert.equal(await contents(), text)
  })

test('base pack mark files remain semantically identical after an independent form edit', async t => {
  const { root, file, rows, save, contents } = await fixture(t)
  for (const name of ['mark', 'mark_ability', 'mark_emblem', 'mark_global']) {
    const text = await readFile(new URL(`../../../packs/base/data/${name}.yaml`, import.meta.url), 'utf8')
    await writeFile(join(root, file), text)
    const before = YAML.parse(text, { merge: true })
    const row = (await rows())[0]
    assert(row, `${name} loads`)
    await save(row, { ...row.record, name: 'Edited name' })
    const after = YAML.parse(await contents(), { merge: true })
    assert.deepEqual(
      after,
      before.map((record, i) => (i === 0 ? { ...record, name: 'Edited name' } : record)),
    )
  }
})
