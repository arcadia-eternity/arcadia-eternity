import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DebugEnvironments, environmentDocument, normalizeEnvironmentDocument } from '../src/debug-environments.ts'
import { AuthorWorkspace } from '../src/workspace.ts'
import { openAuthorSession } from '../src/author-api.ts'

const legacy = () => ({
  schemaVersion: 1,
  id: 'community',
  name: '社区对战',
  packages: { '@example/content': '^1.0.0' },
  sources: ['@example/development'],
})

test('legacy environment reads preserve their schema while normalization produces detached v2 data', () => {
  const source = legacy()
  assert.deepEqual(environmentDocument(source), source)
  const current = normalizeEnvironmentDocument(source)
  assert.deepEqual(current, { ...source, schemaVersion: 2, rules: { schemaVersion: 1 }, requires: {} })
  current.packages['@example/content'] = '2.0.0'
  assert.equal(source.packages['@example/content'], '^1.0.0')
  assert.equal(source.schemaVersion, 1)
  assert.equal(source.rules, undefined)
})

test('v2 environment preserves explicit versioned rules and capabilities', () => {
  const source = {
    ...legacy(),
    schemaVersion: 2,
    rules: {
      schemaVersion: 1,
      tier: 'standard',
      allow: { species: ['example:pet'] },
      deny: { skills: ['example:unsafe'] },
      team: { minSize: 1, maxSize: 6, uniqueSpecies: true },
    },
    requires: { engine: '4', sdk: '4', capabilities: ['effect-state-v1'] },
  }
  assert.deepEqual(normalizeEnvironmentDocument(source), source)
})

test('unknown versions and executable or unrecognized fields are rejected without losing fields', () => {
  const source = normalizeEnvironmentDocument(legacy())
  for (const value of [
    { ...source, schemaVersion: 99 },
    { ...source, rules: { schemaVersion: 1, tier: 'unknown' } },
    { ...source, rules: { schemaVersion: 2, team: { maxSize: 7 } } },
    { ...legacy(), rules: source.rules },
    { ...source, databaseUrl: 'postgres://localhost/secret' },
    { ...source, rules: { schemaVersion: 1, script: 'run.js' } },
    { ...source, rules: { schemaVersion: 1, team: { minSize: 7, maxSize: 6 } } },
    { ...source, rules: { schemaVersion: 1, deny: { species: ['example:pet', 'example:pet'] } } },
    { ...source, requires: { capabilities: ['execute:arbitrary', 'execute:arbitrary'] } },
    { ...source, requires: { secret: 'hidden' } },
    { ...source, packages: { '@example/content': 'file:/private/project' } },
  ])
    assert.throws(() => environmentDocument(value), { code: 'ENVIRONMENT_INVALID' })
})

test('file-backed debug environments preserve v1, explicitly save v2 and reject stale writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-environment-document-'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'example',
      arcadia: { projectId: 'example', namespace: 'example', sdkApi: 4 },
    }),
  )
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(async () => {
    await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  const environments = new DebugEnvironments(workspace)
  const original = await environments.save({ document: legacy(), expectedVersion: null })
  assert.equal((await environments.list())[0].id, 'default')
  assert.equal((await environments.list())[1].schemaVersion, 1)
  const upgraded = normalizeEnvironmentDocument(legacy())
  upgraded.rules.team = { maxSize: 3 }
  const saved = await environments.save({ document: upgraded, expectedVersion: original.version })
  assert.notEqual(saved.version, original.version)
  assert.deepEqual(JSON.parse(await readFile(join(root, environments.file('community')), 'utf8')), upgraded)
  assert.deepEqual((await environments.list())[1].rules.team, { maxSize: 3 })
  await assert.rejects(environments.save({ document: legacy(), expectedVersion: original.version }), {
    code: 'REVISION_CONFLICT',
  })
  assert.equal((await environments.list())[1].schemaVersion, 2)
})

test('an environment author session reads and updates the npm declaration at its observed version', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-env-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { packages, ...declaration } = normalizeEnvironmentDocument(legacy())
  const sourceDependency = { '@example/development': 'file:candidates/dev.tgz' }
  const manifest = {
    name: '@example/cup',
    version: '1.2.3',
    dependencies: { ...packages, ...sourceDependency },
    arcadiaEnvironment: declaration,
    engines: { arcadia: '^4' },
  }
  const file = join(root, 'package.json')
  await writeFile(file, JSON.stringify(manifest))
  const session = await openAuthorSession(root, { watch: false })
  t.after(() => session.close())
  assert.deepEqual((await session.describe()).project, { kind: 'environment', id: 'community', name: '社区对战' })
  const { items } = await session.call('environment-list')
  assert.equal(items.length, 1)
  const { version, ...document } = items[0]
  assert.deepEqual(document, { ...declaration, packages })
  assert.equal(version, (await session.call('read', { file: 'package.json' })).version)
  const updated = {
    ...document,
    packages: { '@example/content': '2.0.0' },
    rules: { schemaVersion: 1, team: { maxSize: 3 } },
  }
  const saved = await session.call('environment-save', { document: updated, expectedVersion: version })
  assert.deepEqual((await session.call('environment-list')).items, [saved])
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    ...manifest,
    dependencies: { ...updated.packages, ...sourceDependency },
    arcadiaEnvironment: { ...declaration, rules: updated.rules },
  })
  await assert.rejects(session.call('environment-save', { document, expectedVersion: version }), {
    code: 'REVISION_CONFLICT',
  })
  await assert.rejects(
    session.call('environment-save', { document: { ...document, id: 'other' }, expectedVersion: saved.version }),
    { code: 'ENVIRONMENT_INVALID' },
  )
  await assert.rejects(session.call('save', { changes: [] }), { code: 'PROJECT_INVALID' })
})

test('an archive under candidates contributes to the environment revision', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-env-archives-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { packages: _, ...arcadiaEnvironment } = normalizeEnvironmentDocument(legacy())
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'cup',
      arcadiaEnvironment,
      dependencies: { content: 'file:candidates/content.tgz' },
    }),
  )
  await mkdir(join(root, 'candidates'))
  const archive = join(root, 'candidates/content.tgz')
  await writeFile(archive, 'first')
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(() => workspace.close())
  const before = await workspace.revision({ contentOnly: true })
  await writeFile(join(root, 'build-output.tgz'), 'packed output')
  assert.equal(await workspace.revision({ contentOnly: true }), before)
  await writeFile(archive, 'updated')
  assert.notEqual(await workspace.revision({ contentOnly: true }), before)
})

test('installed, prepared and owner-managed environment manifests stay readable and immutable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-env-owned-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { packages, ...declaration } = normalizeEnvironmentDocument(legacy())
  await writeFile(join(root, 'workspace.json'), JSON.stringify({ format: 'arcadia.content-workspace/2' }))
  for (const directory of [
    join(root, 'node_modules', 'cup'),
    join(root, 'environments', 'cup'),
    join(root, 'prepared'),
  ]) {
    await mkdir(directory, { recursive: true })
    if (directory.endsWith('prepared')) await writeFile(join(directory, '.arcadia-prepared.json'), '{}')
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'cup', dependencies: packages, arcadiaEnvironment: declaration }),
    )
    const workspace = await AuthorWorkspace.open(directory, { watch: false })
    t.after(() => workspace.close())
    const environments = new DebugEnvironments(workspace)
    const [{ version, ...document }] = await environments.list()
    assert.equal((await workspace.snapshot()).capabilities.sourceEditing, false)
    await assert.rejects(environments.save({ document, expectedVersion: version }), { code: 'WRITE_DISABLED' })
  }
})
