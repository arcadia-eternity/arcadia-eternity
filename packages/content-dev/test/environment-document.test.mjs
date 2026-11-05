import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DebugEnvironments, environmentDocument, normalizeEnvironmentDocument } from '../src/debug-environments.mjs'
import { AuthorWorkspace } from '../src/workspace.mjs'

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
      tier: 'community-standard',
      allow: { species: ['example:pet'] },
      deny: { skills: ['example:unsafe'] },
      team: { minSize: 1, maxSize: 6, uniqueSpecies: true },
    },
    requires: { engine: '4', sdk: '2', capabilities: ['effect-state-v1'] },
  }
  assert.deepEqual(normalizeEnvironmentDocument(source), source)
})

test('unknown versions and executable or unrecognized fields are rejected without losing fields', () => {
  const source = normalizeEnvironmentDocument(legacy())
  for (const value of [
    { ...source, schemaVersion: 99 },
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
      arcadia: { projectId: 'example', namespace: 'example', sdkApi: 2 },
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
