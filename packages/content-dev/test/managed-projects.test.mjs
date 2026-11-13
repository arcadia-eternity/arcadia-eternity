import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContentWorkspace } from '../src/content-workspace.ts'
import { ManagedProjects } from '../src/managed-projects.ts'
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
    projects.prepareEnvironment(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'THIRD_PARTY_CONTENT_NOT_AUTHORIZED' },
  )
  assert.deepEqual(await workspace.listInstallations(), [])
})

test('unregistered sources and registry-protocol injection fail before package installation', async t => {
  const { workspace, projects } = await fixture(t, { allowThirdPartyContent: true })
  let draft = await workspace.saveDraft({ document: { ...document, sources: ['missing'] }, expectedRevision: null })
  await assert.rejects(
    projects.prepareEnvironment(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'INSTALL_SOURCE_NOT_REGISTERED' },
  )
  draft = await workspace.saveDraft({
    document: { ...document, packages: { example: 'github:malicious' } },
    expectedRevision: draft.revision,
  })
  await assert.rejects(
    projects.prepareEnvironment(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'INSTALL_VERSION_INVALID' },
  )
  assert.deepEqual(await workspace.listInstallations(), [])
})

test('empty environment resolves a real standard npm lock offline and cleans staging', async t => {
  const { root, workspace, projects } = await fixture(t)
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  const version = await projects.prepareEnvironment(
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
  const stages = []
  let beforeCommit = false
  const validate = async ({ directory }) => {
    await inspectNpmProject(directory)
    const packageDirectory = join(directory, 'node_modules/sample')
    await assert.rejects(access(join(packageDirectory, 'executed')), { code: 'ENOENT' })
    assert.equal(JSON.parse(await readFile(join(packageDirectory, 'content.json'), 'utf8')).power, 40)
    return { contentRevision: 'sample:40', packages: [{ name: 'sample', version: '1.0.0' }] }
  }
  const version = await projects.prepareEnvironment(
    workspace,
    {
      environmentId: 'main',
      expectedRevision: draft.revision,
      onProgress: progress => stages.push(progress.stage),
      beforeCommit: async () => {
        beforeCommit = true
      },
    },
    validate,
  )
  assert.equal(beforeCommit, true)
  assert.deepEqual(stages, ['resolving', 'acquiring', 'installing', 'verifying', 'preparing', 'preparing'])
  await writeFile(join(source, 'content.json'), '{"power":99}')
  assert.equal(
    JSON.parse(await readFile(join(version.directory, 'node_modules/sample/content.json'), 'utf8')).power,
    40,
  )
  const lock = JSON.parse(await readFile(join(version.directory, 'package-lock.json'), 'utf8'))
  assert.match(lock.packages['node_modules/sample'].resolved, /^file:candidates\/source-0-[a-f0-9]{64}\.tgz$/)
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
    projects.prepareEnvironment(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'INSTALL_DEPENDENCY_SOURCE_FORBIDDEN' },
  )
  assert.deepEqual(await workspace.listInstallations(), [])
})

test('stale, cancelled and closed requests never produce ready artifacts', async t => {
  const { workspace, projects } = await fixture(t)
  const draft = await workspace.saveDraft({ document, expectedRevision: null })
  await assert.rejects(
    projects.prepareEnvironment(workspace, { environmentId: 'main', expectedRevision: 'old' }, noPackages),
    { code: 'REVISION_CONFLICT' },
  )
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    projects.prepareEnvironment(
      workspace,
      { environmentId: 'main', expectedRevision: draft.revision, signal: controller.signal },
      noPackages,
    ),
    { name: 'AbortError' },
  )
  await projects.close()
  await assert.rejects(
    projects.prepareEnvironment(workspace, { environmentId: 'main', expectedRevision: draft.revision }, noPackages),
    { code: 'INSTALLER_CLOSED' },
  )
  assert.deepEqual(await workspace.listInstallations(), [])
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

test('shared peer ranges resolve once and an incompatible upgrade preserves existing fixed installations', async t => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'shared-peers-'))
  t.after(() => rm(sourceRoot, { recursive: true, force: true }))
  const sources = {}
  for (const [name, version, range] of [
    ['nature', '1.6.3', null],
    ['forest', '1.0.0', '^1'],
    ['arena', '1.0.0', '>=1.5 <2'],
  ]) {
    const directory = join(sourceRoot, name)
    await mkdir(directory)
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({
        name,
        version,
        ...(range ? { peerDependencies: { nature: range } } : {}),
        arcadia: { formatVersion: 1, projectId: name, namespace: name, content: 'content.json' },
      }),
    )
    await writeFile(
      join(directory, 'content.json'),
      JSON.stringify({ data: { species: [], skills: [], marks: [], behaviors: [] } }),
    )
    sources[name] = { kind: 'directory', directory }
  }
  const { workspace, projects } = await fixture(t, { allowThirdPartyContent: true, sources })
  const draft = await workspace.saveDraft({
    document: { ...document, sources: Object.keys(sources) },
    expectedRevision: null,
  })
  const validate = async ({ directory }) => {
    const inspection = await inspectNpmProject(directory)
    return {
      contentRevision: inspection.digest,
      packages: inspection.packages.map(({ name, version }) => ({ name, version })),
    }
  }
  const version = await projects.prepareEnvironment(
    workspace,
    { environmentId: 'main', expectedRevision: draft.revision },
    validate,
  )
  assert.equal(version.members.filter(member => member.name === 'nature').length, 1)
  assert.deepEqual(version.members.find(member => member.name === 'nature').requiredBy, ['arena', 'forest'])
  const file = join(sourceRoot, 'arena/package.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.peerDependencies.nature = '^2'
  await writeFile(file, JSON.stringify(manifest))
  await assert.rejects(
    projects.prepareEnvironment(
      workspace,
      { environmentId: 'main', expectedRevision: (await workspace.getDraft('main')).revision },
      validate,
    ),
    { code: 'ENVIRONMENT_DEPENDENCY_CONFLICT' },
  )
  assert.deepEqual(
    (await workspace.listInstallations()).map(item => item.installationId),
    [version.installationId],
  )
  assert.equal((await workspace.getDraft('main')).revision, version.draftRevision)
})

test('apply creates a complete environment atomically and keeps failed edits out of package.json', async t => {
  const { workspace, projects } = await fixture(t)
  const installed = await projects.prepareEnvironment(
    workspace,
    { environmentId: 'main', document, expectedRevision: null },
    noPackages,
  )
  const original = await workspace.getDraft('main')
  await assert.rejects(
    projects.prepareEnvironment(
      workspace,
      {
        environmentId: 'main',
        document: { ...original.document, name: 'Rejected' },
        expectedRevision: original.revision,
      },
      async () => {
        throw new Error('invalid content')
      },
    ),
    { code: 'ENVIRONMENT_INSTALL_FAILED' },
  )
  assert.deepEqual(await workspace.getDraft('main'), original)
  assert.equal((await workspace.getInstallation('main')).createdAt, installed.createdAt)
})

test('bundled base applies locally with an unreachable registry and no third-party permission', async t => {
  const { fileURLToPath } = await import('node:url')
  const bundledPackageRoot = fileURLToPath(new URL('../../../packs/base/', import.meta.url))
  const base = JSON.parse(await readFile(join(bundledPackageRoot, 'package.json'), 'utf8'))
  for (const mixed of [false, true]) {
    const source = await mkdtemp(join(tmpdir(), 'local-helper-'))
    t.after(() => rm(source, { recursive: true, force: true }))
    await writeFile(
      join(source, 'package.json'),
      JSON.stringify({ name: 'helper', version: '1.0.0', peerDependencies: { [base.name]: '*' } }),
    )
    const { workspace, projects } = await fixture(t, {
      bundledPackageRoot,
      registry: 'https://127.0.0.1:1',
      offline: false,
      allowThirdPartyContent: mixed,
      sources: { helper: { kind: 'directory', directory: source } },
    })
    const installed = await projects.prepareEnvironment(
      workspace,
      {
        environmentId: 'main',
        document: { ...document, packages: { [base.name]: base.version }, sources: mixed ? ['helper'] : [] },
        expectedRevision: null,
      },
      async () => ({ contentRevision: 'local-base', packages: [] }),
    )
    const actual = JSON.parse(
      await readFile(join(installed.directory, 'node_modules', base.name, 'package.json'), 'utf8'),
    )
    assert.equal(actual.version, base.version)
    const draft = await workspace.getDraft('main')
    await projects.prepareEnvironment(
      workspace,
      { environmentId: 'main', document: draft.document, expectedRevision: draft.revision },
      async () => ({ contentRevision: 'again', packages: [] }),
    )
  }
})

test('a missing bundled base never falls back to the registry', async t => {
  const { workspace, projects } = await fixture(t, {
    offline: false,
    allowThirdPartyContent: true,
    registry: 'https://127.0.0.1:1',
  })
  await assert.rejects(
    projects.prepareEnvironment(
      workspace,
      {
        environmentId: 'main',
        document: { ...document, packages: { '@arcadia-eternity/data-pack-base': '*' } },
        expectedRevision: null,
      },
      noPackages,
    ),
    { code: 'BUNDLED_PACKAGE_UNAVAILABLE' },
  )
  assert.deepEqual(await workspace.listDrafts(), [])
})
