import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { create } from 'tar'
import { acquireAuthorEnvironment, parseAuthorEnvironmentNpmSpec } from '../src/author-environment-source.ts'
import { installAuthorEnvironment } from '../src/author-environment-install.ts'
import { AuthorWorkspace } from '../src/workspace.ts'
import { findAuthorInstallation } from '../src/author-install.ts'

const recipe = {
  name: '@sample/training',
  version: '1.0.1',
  arcadiaEnvironment: {
    schemaVersion: 2,
    id: 'training',
    name: 'Training',
    sources: [],
    rules: { schemaVersion: 1 },
    requires: {},
  },
  dependencies: {},
}
async function archive(root, manifest = recipe, files = {}) {
  const path = await mkdtemp(join(root, 'build-'))
  await mkdir(join(path, 'package'))
  await writeFile(join(path, 'package/package.json'), JSON.stringify(manifest))
  for (const [name, data] of Object.entries(files)) await writeFile(join(path, 'package', name), data)
  const file = join(path, 'recipe.tgz')
  await create({ file, cwd: path, gzip: true }, ['package'])
  return file
}
async function scratch(t) {
  const path = await mkdtemp(join(tmpdir(), 'arcadia-author-env-install-'))
  t.after(() => rm(path, { recursive: true, force: true }))
  return path
}

test('reads the exact scoped npm recipe and its original archive integrity from a primed offline cache', async t => {
  const root = await scratch(t)
  const cache = join(root, 'npm-cache')
  const source = parseAuthorEnvironmentNpmSpec('@sample/training@1.0.1')
  const archiveBytes = await readFile(
    await archive(root, { ...recipe, scripts: { prepare: 'exit 1' } }, { 'code.cjs': 'throw Error()' }),
  )
  const integrity = 'sha512-' + createHash('sha512').update(archiveBytes).digest('base64')
  // Populate the same npm HTTP cache entries that pacote reads on a subsequent offline install.
  const require = createRequire(import.meta.url)
  const cacache = createRequire(require.resolve('pacote'))('cacache')
  const url = 'https://registry.npmjs.org/@sample%2ftraining'
  const tarball = 'https://registry.npmjs.org/@sample/training/-/training-1.0.1.tgz'
  const registryManifest = { name: source.name, version: source.version, dist: { tarball, integrity } }
  const metadata = JSON.stringify({
    name: source.name,
    'dist-tags': { latest: '1.0.1' },
    versions: { '1.0.1': registryManifest, '1.0.2': { ...registryManifest, version: '1.0.2' } },
  })
  for (const [key, bytes] of [
    [url, metadata],
    [tarball, archiveBytes],
  ]) {
    await cacache.put(join(cache, '_cacache'), 'make-fetch-happen:request-cache:' + key, bytes, {
      metadata: {
        time: Date.now(),
        url: key,
        reqHeaders:
          key === url ? { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*' } : {},
        resHeaders: { 'cache-control': 'max-age=3600' },
        options: { compress: true },
      },
    })
  }
  const result = await acquireAuthorEnvironment(source, join(root, 'project'), { offline: true, cache })
  assert.equal(result.integrity, integrity)
  assert.equal(result.document.id, 'training')
  assert.deepEqual(await readdir(result.directory), ['package.json'])
  assert.equal(JSON.parse(await readFile(join(result.directory, 'package.json'))).scripts, undefined)
  await assert.rejects(
    acquireAuthorEnvironment({ ...source, version: '1.0.2' }, join(root, 'absent'), { offline: true, cache }),
    { code: 'SOURCE_PACKAGE_IDENTITY_MISMATCH' },
  )
  const owner = await AuthorWorkspace.open(result.directory, { watch: false })
  t.after(() => owner.close())
  const priorCache = process.env.npm_config_cache
  process.env.npm_config_cache = cache
  try {
    const installed = await installAuthorEnvironment(owner, { source, offline: true })
    assert.equal(installed.integrity, integrity)
    assert.ok(await findAuthorInstallation(installed.directory, {}))
  } finally {
    if (priorCache === undefined) delete process.env.npm_config_cache
    else process.env.npm_config_cache = priorCache
  }
  for (const invalid of ['@sample/training', 'training@^1.0.0', 'file:fixture.tgz', '@sample/training@latest']) {
    assert.throws(() => parseAuthorEnvironmentNpmSpec(invalid), { code: 'ENVIRONMENT_PACKAGE_ID_INVALID' })
  }
})

test('rejects a pack or a nonportable recipe before exposing a project', async t => {
  const root = await scratch(t)
  const invalid = join(root, 'missing.tgz')
  await mkdir(join(root, 'package'))
  await writeFile(join(root, 'package/data.json'), '{}')
  await create({ file: invalid, cwd: root, gzip: true }, ['package'])
  await assert.rejects(acquireAuthorEnvironment({ kind: 'archive', file: invalid }, join(root, 'rejected')), {
    code: 'ENVIRONMENT_PACKAGE_INVALID',
  })
  await assert.rejects(access(join(root, 'rejected')), { code: 'ENOENT' })
  for (const [manifest, code] of [
    [{ ...recipe, arcadiaEnvironment: undefined }, 'ENVIRONMENT_PACKAGE_REQUIRED'],
    [{ ...recipe, arcadia: { namespace: 'pack' } }, 'ENVIRONMENT_PACKAGE_REQUIRED'],
    [
      { ...recipe, arcadiaEnvironment: { ...recipe.arcadiaEnvironment, sources: ['local-pack'] } },
      'ENVIRONMENT_SOURCE_NOT_PORTABLE',
    ],
    [{ ...recipe, dependencies: { 'local-pack': 'file:candidates/nothing.tgz' } }, 'ENVIRONMENT_SOURCE_MISSING'],
    [{ ...recipe, engines: { arcadia: '<1.0.0' } }, 'ARCADIA_VERSION_INCOMPATIBLE'],
  ]) {
    const source = { kind: 'archive', file: await archive(root, manifest) }
    const dest = join(root, 'rejected')
    await assert.rejects(acquireAuthorEnvironment(source, dest), { code })
    await assert.rejects(access(dest), { code: 'ENOENT' })
  }
})

test('durably imports a recipe, preserves author edits on repeat, and scopes archive reads to the bound project', async t => {
  const root = await scratch(t)
  const project = join(root, 'author')
  await mkdir(project)
  await writeFile(join(project, 'package.json'), JSON.stringify(recipe))
  const workspace = await AuthorWorkspace.open(project, { watch: false })
  t.after(() => workspace.close())
  const file = await archive(project)
  const source = { kind: 'archive', file: file.slice(project.length + 1) }
  const result = await installAuthorEnvironment(workspace, { source, offline: true })
  assert.equal(result.id, recipe.arcadiaEnvironment.id)
  assert.equal(result.reused, false)
  const reopened = await AuthorWorkspace.open(result.directory, { watch: false })
  try {
    assert.equal(reopened.projectKind, 'environment')
    assert.equal(reopened.readOnly, false)
    assert.ok((await findAuthorInstallation(result.directory, {}))?.directory.startsWith(result.directory + '/'))
    const original = await reopened.read('package.json')
    await reopened.write({ file: 'package.json', expectedVersion: original.version, text: original.text + '\n' })
  } finally {
    await reopened.close()
  }
  assert.deepEqual(await installAuthorEnvironment(workspace, { source, offline: true }), { ...result, reused: true })
  assert.ok((await readFile(join(result.directory, 'package.json'), 'utf8')).endsWith('\n\n'))
  assert.deepEqual(await readdir(join(workspace.root, '.arcadia', 'installed-environments')), [
    result.directory.split('/').at(-1),
  ])
  const outside = await archive(root)
  await symlink(outside, join(project, 'linked.tgz'))
  for (const file of ['linked.tgz', '../elsewhere.tgz', outside]) {
    await assert.rejects(installAuthorEnvironment(workspace, { source: { kind: 'archive', file }, offline: true }), {
      code: 'MATERIAL_PATH_ESCAPE',
    })
  }
})
