import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setEnvironmentPackageEnabled } from '../src/content-workspace.ts'
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
test('shared dependency blocks disable; explicit cascade retains ranges and reenable does not publish', async () => {
  const workspace = fixture()
  const input = { environmentId: 'shared', expectedRevision: '1', name: 'nature', enabled: false }
  await assert.rejects(setEnvironmentPackageEnabled(workspace, input), { code: 'ENVIRONMENT_PACKAGE_REQUIRED' })
  assert.equal((await workspace.listDrafts())[0].revision, '1')
  const disabled = await setEnvironmentPackageEnabled(workspace, { ...input, cascade: true })
  assert.deepEqual(disabled.document.packages, {})
  assert.deepEqual(disabled.document.disabled.packages, { forest: '^1', arena: '^2' })
  const enabled = await setEnvironmentPackageEnabled(workspace, {
    ...input,
    expectedRevision: disabled.revision,
    name: 'forest',
    enabled: true,
  })
  assert.deepEqual(enabled.document.packages, { forest: '^1' })
  assert.deepEqual(enabled.document.disabled.packages, { arena: '^2' })
  assert.deepEqual((await workspace.listInstallations())[0].document.packages, { forest: '^1', arena: '^2' })
})
test('stale revision and changed unresolved composition cannot authorize a dependency toggle', async () => {
  const workspace = fixture()
  await assert.rejects(
    setEnvironmentPackageEnabled(workspace, {
      environmentId: 'shared',
      expectedRevision: 'old',
      name: 'nature',
      enabled: false,
      cascade: true,
    }),
    { code: 'REVISION_CONFLICT' },
  )
  const draft = (await workspace.listDrafts())[0]
  draft.document.packages.forest = '^3'
  await workspace.saveDraft({ ...draft, expectedRevision: draft.revision })
  await assert.rejects(
    setEnvironmentPackageEnabled(workspace, {
      environmentId: 'shared',
      expectedRevision: '2',
      name: 'nature',
      enabled: false,
      cascade: true,
    }),
    { code: 'ENVIRONMENT_DEPENDENCIES_UNRESOLVED' },
  )
})
test('active and disabled declarations cannot overlap', () => {
  assert.throws(
    () =>
      normalizeEnvironmentDocument({
        schemaVersion: 2,
        id: 'test',
        name: 'Test',
        packages: { sample: '^1' },
        sources: [],
        disabled: { packages: { sample: '^2' }, sources: [] },
        rules: { schemaVersion: 1 },
        requires: {},
      }),
    { code: 'ENVIRONMENT_INVALID' },
  )
})
