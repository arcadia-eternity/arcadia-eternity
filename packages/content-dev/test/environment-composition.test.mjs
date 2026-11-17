import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addEnvironmentPackage, removeEnvironmentPackage } from '../src/content-workspace.ts'
import { normalizeEnvironmentDocument } from '../src/debug-environments.ts'

function fixture() {
  let draft = {
    revision: '1',
    document: normalizeEnvironmentDocument({
      schemaVersion: 1,
      id: 'shared',
      name: 'Shared',
      packages: { forest: '^1', arena: '^2' },
      sources: [],
    }),
  }
  const version = {
    status: 'ready',
    environmentId: 'shared',
    createdAt: 1,
    document: structuredClone(draft.document),
    members: [
      { name: 'forest', dependencies: ['nature'] },
      { name: 'arena', dependencies: ['nature'] },
      { name: 'nature', dependencies: [] },
    ],
  }
  return {
    listDrafts: async () => [structuredClone(draft)],
    listInstallations: async () => [version],
    saveDraft: async input => {
      assert.equal(input.expectedRevision, draft.revision)
      draft = { document: normalizeEnvironmentDocument(input.document), revision: String(Number(draft.revision) + 1) }
      return structuredClone(draft)
    },
  }
}
test('shared dependency blocks removal; explicit cascade deletes declarations without history', async () => {
  const workspace = fixture()
  const input = { environmentId: 'shared', expectedRevision: '1', name: 'nature' }
  await assert.rejects(removeEnvironmentPackage(workspace, input), { code: 'ENVIRONMENT_PACKAGE_REQUIRED' })
  assert.equal((await workspace.listDrafts())[0].revision, '1')
  const disabled = await removeEnvironmentPackage(workspace, { ...input, cascade: true })
  assert.deepEqual(disabled.document.packages, {})
  assert.equal('disabled' in disabled.document, false)
  const enabled = await addEnvironmentPackage(workspace, {
    ...input,
    expectedRevision: disabled.revision,
    name: 'forest',
    version: '^1',
  })
  assert.deepEqual(enabled.document.packages, { forest: '^1' })
  assert.equal('disabled' in enabled.document, false)
  assert.deepEqual((await workspace.listInstallations())[0].document.packages, { forest: '^1', arena: '^2' })
})
test('stale revision and changed unresolved composition cannot authorize a dependency removal', async () => {
  const workspace = fixture()
  await assert.rejects(
    removeEnvironmentPackage(workspace, {
      environmentId: 'shared',
      expectedRevision: 'old',
      name: 'nature',
      cascade: true,
    }),
    { code: 'REVISION_CONFLICT' },
  )
  const draft = (await workspace.listDrafts())[0]
  draft.document.packages.forest = '^3'
  await workspace.saveDraft({ ...draft, expectedRevision: draft.revision })
  await assert.rejects(
    removeEnvironmentPackage(workspace, {
      environmentId: 'shared',
      expectedRevision: '2',
      name: 'nature',
      cascade: true,
    }),
    { code: 'ENVIRONMENT_DEPENDENCIES_UNRESOLVED' },
  )
})
test('legacy removed declarations are discarded without affecting active requirements', () => {
  const document = normalizeEnvironmentDocument({
    schemaVersion: 2,
    id: 'test',
    name: 'Test',
    packages: { sample: '^1' },
    sources: [],
    disabled: { packages: { sample: '^2', old: '^3' }, sources: [] },
    rules: { schemaVersion: 1 },
    requires: {},
  })
  assert.equal('disabled' in document, false)
  assert.deepEqual(document.packages, { sample: '^1' })
})

test('adds new versioned and registered-source packages without implicit restoration', async () => {
  const workspace = fixture()
  const added = await addEnvironmentPackage(workspace, {
    environmentId: 'shared',
    expectedRevision: '1',
    name: '@test/new',
    version: '^3.0.0',
  })
  assert.equal(added.document.packages['@test/new'], '^3.0.0')
  const source = await addEnvironmentPackage(workspace, {
    environmentId: 'shared',
    expectedRevision: added.revision,
    name: '@test/source',
    source: true,
  })
  assert.deepEqual(source.document.sources, ['@test/source'])
  const replaced = await addEnvironmentPackage(workspace, {
    environmentId: 'shared',
    expectedRevision: source.revision,
    name: '@test/source',
    version: '2.0.0',
  })
  assert.deepEqual(replaced.document.sources, [])
  assert.equal(replaced.document.packages['@test/source'], '2.0.0')
})
test('rejects missing, conflicting, unsafe and stale new declarations without saving', async () => {
  const workspace = fixture()
  const base = { environmentId: 'shared', expectedRevision: '1', name: '@test/new' }
  await assert.rejects(addEnvironmentPackage(workspace, base), { code: 'ENVIRONMENT_PACKAGE_DECLARATION_REQUIRED' })
  for (const input of [{ version: '' }, { version: '^1', source: true }, { source: 'yes' }])
    await assert.rejects(addEnvironmentPackage(workspace, { ...base, ...input }), {
      code: 'ENVIRONMENT_PACKAGE_INVALID',
    })
  await assert.rejects(addEnvironmentPackage(workspace, { ...base, version: 'file:/tmp/private' }), {
    code: 'ENVIRONMENT_INVALID',
  })
  await assert.rejects(addEnvironmentPackage(workspace, { ...base, version: '^1', expectedRevision: 'old' }), {
    code: 'REVISION_CONFLICT',
  })
  assert.equal((await workspace.listDrafts())[0].revision, '1')
})
