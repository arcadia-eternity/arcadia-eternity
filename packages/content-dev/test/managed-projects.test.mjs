import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentWorkspace } from '../src/content-workspace.mjs'
import { ManagedProjects } from '../src/managed-projects.mjs'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'

const document = { schemaVersion: 1, id: 'main', name: 'Main', packages: {}, sources: [] }
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'managed-projects-'))
  const workspace = await ContentWorkspace.open(join(root, 'workspace'))
  const projects = new ManagedProjects(join(root, 'projects'), { offline: true, ...options })
  t.after(async () => {
    await projects.close()
    await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, workspace, projects }
}
async function noPackages({ directory }) {
  await inspectNpmProject(directory)
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dependencies, {})
  return { contentRevision: 'empty', packages: [] }
}

test('content acquisition requires its own permission, independent of execution policy', async t => {
  const { workspace, projects } = await fixture(t, { allowThirdPartyExecution: true })
  const draft = await workspace.saveDraft({
    document: { ...document, packages: { example: '1.0.0' } },
    expectedRevision: null,
  })
  await assert.rejects(
    projects.prepareVersion(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'THIRD_PARTY_CONTENT_NOT_AUTHORIZED' },
  )
  assert.deepEqual(await workspace.listVersions(), [])
})

test('unregistered sources and registry-protocol injection fail before package installation', async t => {
  const { workspace, projects } = await fixture(t, { allowThirdPartyContent: true })
  let draft = await workspace.saveDraft({ document: { ...document, sources: ['missing'] }, expectedRevision: null })
  await assert.rejects(
    projects.prepareVersion(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'INSTALL_SOURCE_NOT_REGISTERED' },
  )
  draft = await workspace.saveDraft({
    document: { ...document, packages: { example: 'github:malicious' } },
    expectedRevision: draft.revision,
  })
  await assert.rejects(
    projects.prepareVersion(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'INSTALL_VERSION_INVALID' },
  )
  assert.deepEqual(await workspace.listVersions(), [])
})

test('empty environment resolves a real standard npm lock offline and cleans staging', async t => {
  const { root, workspace, projects } = await fixture(t)
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  const version = await projects.prepareVersion(
    workspace,
    { environmentId: 'main', expectedRevision: draft.revision },
    noPackages,
  )
  assert.equal(version.status, 'ready')
  const lock = JSON.parse(await readFile(join(version.directory, 'package-lock.json'), 'utf8'))
  assert.equal(lock.lockfileVersion, 3)
  assert.deepEqual(await readdir(join(root, 'projects/staging')), [])
})

test('host registered built sources install without lifecycle or module execution and freeze independent materials', async t => {
  const root = await mkdtemp(join(tmpdir(), 'managed-source-fixture-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'built')
  await mkdir(source)
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({
      name: 'sample',
      version: '1.0.0',
      files: ['package.json', 'index.js', 'content.json'],
      scripts: {
        prepare: 'node -e "throw new Error(\'prepare must never run\')"',
        prepack: 'node -e "throw new Error(\'prepack must never run\')"',
        postinstall: "node -e \"require('fs').writeFileSync('executed','bad')\"",
      },
    }),
  )
  await writeFile(join(source, 'index.js'), 'throw new Error("module must never execute")')
  await writeFile(join(source, 'content.json'), '{"power":40}')
  const { workspace, projects } = await fixture(t, {
    allowThirdPartyContent: true,
    allowThirdPartyExecution: false,
    sources: { sample: { kind: 'directory', directory: source } },
  })
  const draft = await workspace.saveDraft({ document: { ...document, sources: ['sample'] }, expectedRevision: null })
  let beforeCommit = false
  const validate = async ({ directory }) => {
    await inspectNpmProject(directory)
    const packageDirectory = join(directory, 'node_modules/sample')
    await assert.rejects(access(join(packageDirectory, 'executed')), { code: 'ENOENT' })
    assert.equal(JSON.parse(await readFile(join(packageDirectory, 'content.json'), 'utf8')).power, 40)
    return { contentRevision: 'sample:40', packages: [{ name: 'sample', version: '1.0.0' }] }
  }
  const version = await projects.prepareVersion(
    workspace,
    {
      environmentId: 'main',
      expectedRevision: draft.revision,
      beforeCommit: async () => {
        beforeCommit = true
      },
    },
    validate,
  )
  assert.equal(beforeCommit, true)
  await writeFile(join(source, 'content.json'), '{"power":99}')
  assert.equal(
    JSON.parse(await readFile(join(version.directory, 'node_modules/sample/content.json'), 'utf8')).power,
    40,
  )
  const lock = JSON.parse(await readFile(join(version.directory, 'package-lock.json'), 'utf8'))
  assert.equal(lock.packages['node_modules/sample'].resolved, 'file:candidates/source-0.tgz')
})

test('source dependencies cannot request arbitrary host files or Git commands through npm', async t => {
  const root = await mkdtemp(join(tmpdir(), 'managed-unsafe-source-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'sample',
      version: '1.0.0',
      dependencies: { stolen: 'file:/tmp/private-package' },
    }),
  )
  const { workspace, projects } = await fixture(t, {
    allowThirdPartyContent: true,
    sources: { sample: { kind: 'directory', directory: root } },
  })
  const draft = await workspace.saveDraft({ document: { ...document, sources: ['sample'] }, expectedRevision: null })
  await assert.rejects(
    projects.prepareVersion(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'INSTALL_DEPENDENCY_SOURCE_FORBIDDEN' },
  )
  assert.deepEqual(await workspace.listVersions(), [])
})

test('stale, cancelled and closed requests never produce ready artifacts', async t => {
  const { workspace, projects } = await fixture(t)
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  await assert.rejects(
    projects.prepareVersion(workspace, { environmentId: 'main', expectedRevision: 'old' }, noPackages),
    { code: 'REVISION_CONFLICT' },
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    projects.prepareVersion(
      workspace,
      { environmentId: 'main', expectedRevision: draft.revision, signal: controller.signal },
      noPackages,
    ),
    { name: 'AbortError' },
  )
  await projects.close()
  await assert.rejects(
    projects.prepareVersion(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'INSTALLER_CLOSED' },
  )
  assert.deepEqual(await workspace.listVersions(), [])
})

test('host registry and resource bounds reject unsafe configuration', () => {
  assert.throws(() => new ManagedProjects('/tmp/unused', { registry: 'http://example.com/' }), {
    code: 'INSTALL_REGISTRY_INVALID',
  })
  assert.throws(() => new ManagedProjects('/tmp/unused', { registry: 'https://secret:token@example.com/' }), {
    code: 'INSTALL_REGISTRY_INVALID',
  })
  assert.throws(() => new ManagedProjects('/tmp/unused', { maxConcurrent: 0 }), { code: 'INSTALL_LIMIT_INVALID' })
})
