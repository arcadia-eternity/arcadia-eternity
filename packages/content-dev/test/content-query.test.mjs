import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AuthorWorkspace } from '../src/workspace.ts'
import { queryContent } from '../src/content-query.ts'

async function json(root, file, value) {
  await mkdir(dirname(join(root, file)), { recursive: true })
  await writeFile(join(root, file), JSON.stringify(value))
}
async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-query-'))
  await json(root, 'package.json', {
    name: 'query-pack',
    version: '1.0.0',
    arcadia: { projectId: 'query-pack', namespace: 'query', sdkApi: 2 },
    ...extra,
  })
  await json(root, 'data/skills/hit.json', { id: 'hit', power: 40, custom: { preserved: true } })
  await json(root, 'data/skills/other.json', { id: 'other', power: 12 })
  await json(root, 'locales/zh-CN/skill.json', {
    hit: { name: '水量增伤', description: '增加伤害' },
    other: { name: '其他技能' },
  })
  await json(root, 'locales/en/skill.json', { hit: { name: 'Water Boost' }, other: { name: 'Other' } })
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(async () => {
    await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, workspace }
}

async function dependency(root, name, namespace = 'dependency', extras = {}) {
  const directory = join(root, 'node_modules', name)
  await json(directory, 'package.json', {
    name,
    version: '2.0.0',
    arcadia: {
      projectId: name.replaceAll('/', '.'),
      namespace,
      content: 'dist/content.json',
      presentation: 'dist/presentation.json',
      effects: 'dist/effects.mjs',
      sdkApi: 2,
    },
    ...extras,
  })
  await json(directory, 'dist/content.json', { data: { skills: [{ id: 'hit', power: 88 }], species: [], marks: [] } })
  await json(directory, 'dist/presentation.json', {
    version: 2,
    resources: [],
    bindings: [],
    locales: { 'zh-CN': { skill: { hit: { name: '依赖技能' } } } },
  })
  await writeFile(join(directory, 'dist/effects.mjs'), 'throw new Error("effects must never execute during a query")')
  await json(directory, 'data/skills/stale.json', { id: 'stale-source', power: 999 })
  return directory
}

test('localized search joins disk definitions and summary keeps source identity without replacing desktop drafts', async t => {
  const { root, workspace } = await fixture(t)
  workspace.setDirty('data/skills/hit.json', true)
  const before = await readFile(join(root, 'data/skills/hit.json'), 'utf8')
  const result = await queryContent(workspace, { search: '水量增伤', locale: 'zh-CN' })
  assert.equal(result.total, 1)
  assert.deepEqual(result.items[0], {
    namespace: 'query',
    packageName: 'query-pack',
    packageVersion: '1.0.0',
    projectId: 'query-pack',
    scope: 'project',
    readOnly: false,
    kind: 'skills',
    contentKind: 'skills',
    id: 'hit',
    qualifiedId: 'query:hit',
    file: 'data/skills/hit.json',
    version: (await workspace.read('data/skills/hit.json')).version,
    index: null,
    locale: 'zh-CN',
    name: '水量增伤',
  })
  assert.equal(result.nextOffset, null)
  assert.equal((await queryContent(workspace, { search: 'Water Boost' })).total, 1)
  assert.equal((await queryContent(workspace, { search: 'Water Boost', locale: 'zh-CN' })).total, 0)
  assert.equal(await readFile(join(root, 'data/skills/hit.json'), 'utf8'), before)
  const full = await queryContent(workspace, { id: 'query:hit', contentKind: 'skills', detail: 'full' })
  assert.equal(full.items[0].record.power, 40)
  assert.deepEqual(full.items[0].record.custom, { preserved: true })
  assert.equal(full.items[0].localizations.length, 2)
  await assert.rejects(
    workspace.write({ file: 'data/skills/hit.json', expectedVersion: full.items[0].version, text: '{}' }),
    { code: 'UNSAVED_CHANGES' },
  )
})

test('locale pagination counts individual translated objects and preserves writable source provenance', async t => {
  const { root, workspace } = await fixture(t)
  await mkdir(join(root, 'locales/fr'), { recursive: true })
  await writeFile(join(root, 'locales/fr/skill.yaml'), 'hit: &shared\n  name: Eau\nother: *shared\n')
  const first = await queryContent(workspace, { kind: 'locales', locale: 'zh-CN', limit: 1, detail: 'full' })
  assert.equal(first.total, 2)
  assert.equal(first.items.length, 1)
  assert.equal(first.items[0].id, 'hit')
  assert.equal(first.items[0].localeNamespace, 'skill')
  assert.deepEqual(first.items[0].record, { name: '水量增伤', description: '增加伤害' })
  assert.equal(first.nextOffset, 1)
  const second = await queryContent(workspace, { kind: 'locales', locale: 'zh-CN', offset: first.nextOffset, limit: 1 })
  assert.equal(second.items[0].id, 'other')
  assert.equal(second.nextOffset, null)
  assert.equal(second.items[0].version, first.items[0].version)
  const shared = await queryContent(workspace, { kind: 'locales', id: 'other', locale: 'fr', detail: 'full' })
  assert.deepEqual(shared.items[0].sharedFields[0].path, [])
  assert.equal(shared.items[0].sharedFields[0].reason, 'alias')
})

test('exact IDs and types avoid substring matches and report ambiguity instead of picking an object', async t => {
  const { root, workspace } = await fixture(t)
  await json(root, 'data/marks/hit.json', { id: 'hit' })
  await json(root, 'data/skills/hit-extra.json', { id: 'hit-extra' })
  const ambiguous = await queryContent(workspace, { id: 'hit' })
  assert.equal(ambiguous.total, 2)
  assert.ok(ambiguous.diagnostics.some(entry => entry.code === 'CONTENT_AMBIGUOUS'))
  const exact = await queryContent(workspace, { id: 'hit', contentKind: 'marks' })
  assert.equal(exact.total, 1)
  assert.equal(exact.items[0].kind, 'marks')
  assert.deepEqual(exact.diagnostics, [])
})

test('dependency queries read declared installed artifacts only and never import effects or include dev/extraneous packages', async t => {
  const { root, workspace } = await fixture(t, {
    dependencies: { '@packs/visible': '2.0.0' },
    devDependencies: { 'dev-pack': '2.0.0' },
  })
  await dependency(root, '@packs/visible')
  await dependency(root, 'dev-pack', 'development')
  await dependency(root, 'extraneous-pack', 'extraneous')
  assert.equal((await queryContent(workspace, { id: 'hit' })).total, 1)
  const result = await queryContent(workspace, { scope: 'dependencies', id: 'hit', detail: 'full' })
  assert.equal(result.total, 1)
  const row = result.items[0]
  assert.equal(row.packageName, '@packs/visible')
  assert.equal(row.namespace, 'dependency')
  assert.equal(row.readOnly, true)
  assert.equal(row.file, 'dist/content.json')
  assert.equal(row.record.power, 88)
  assert.equal(row.name, '依赖技能')
  assert.deepEqual(result.diagnostics, [])
  assert.equal((await queryContent(workspace, { scope: 'dependencies', id: 'stale-source' })).total, 0)
  const combined = await queryContent(workspace, { scope: 'all', id: 'hit' })
  assert.equal(combined.total, 2)
  assert.ok(combined.diagnostics.some(entry => entry.code === 'CONTENT_AMBIGUOUS'))
  assert.equal((await queryContent(workspace, { scope: 'all', id: 'dependency:hit' })).total, 1)
  assert.equal((await queryContent(workspace, { scope: 'all', id: 'hit', packageName: '@packs/visible' })).total, 1)
})

test('visible dependencies traverse ordinary declared libraries but stop at a content boundary', async t => {
  const { root, workspace } = await fixture(t, { dependencies: { bridge: '1.0.0' } })
  await json(root, 'node_modules/bridge/package.json', {
    name: 'bridge',
    version: '1.0.0',
    dependencies: { visible: '2.0.0' },
  })
  await dependency(root, 'visible', 'visible', { dependencies: { private: '2.0.0' } })
  await dependency(root, 'private', 'private')
  const result = await queryContent(workspace, { scope: 'dependencies' })
  assert.deepEqual(
    result.items.map(row => row.namespace),
    ['visible'],
  )
  assert.deepEqual(result.diagnostics, [])
})

test('linked installations keep read-only provenance; missing and conflicting dependencies remain explicit', async t => {
  const { root, workspace } = await fixture(t, {
    dependencies: { linked: '2.0.0', missing: '1.0.0', conflicting: '2.0.0' },
    optionalDependencies: { optional: '1.0.0' },
  })
  const linked = await dependency(root, 'storage', 'linked')
  await symlink(linked, join(root, 'node_modules/linked'), 'dir')
  await dependency(root, 'conflicting', 'query')
  const result = await queryContent(workspace, { scope: 'all', contentKind: 'skills' })
  assert.ok(result.items.some(row => row.namespace === 'linked' && row.readOnly && row.scope === 'dependencies'))
  assert.ok(result.diagnostics.some(row => row.code === 'DEPENDENCY_MISSING' && row.packageName === 'missing'))
  assert.ok(result.diagnostics.some(row => row.code === 'NAMESPACE_CONFLICT'))
  assert.ok(!result.diagnostics.some(row => row.packageName === 'optional'))
})

test('invalid query bounds fail before returning unbounded or misleading pages', async t => {
  const { workspace } = await fixture(t)
  for (const query of [
    { limit: 0 },
    { limit: 101 },
    { offset: -1 },
    { scope: 'global' },
    { detail: 'everything' },
    { contentKind: 'unknown' },
  ])
    await assert.rejects(queryContent(workspace, query), { code: 'QUERY_INVALID' })
})
