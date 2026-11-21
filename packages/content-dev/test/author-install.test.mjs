import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
import { findAuthorInstallation, installAuthorDependencies } from '../src/author-install.ts'
import { queryContent } from '../src/content-query.ts'
import { prepareBattleEnvironment } from '../src/environment.ts'
import { createSourceProject } from '../src/project.ts'
import { AuthorWorkspace } from '../src/workspace.ts'

const minimalData = { data: { species: [], skills: [], marks: [], behaviors: [] } }
const depName = '@test/installed-addon'
const deps = { [depName]: 'file:candidates/addon.tgz' }

async function packProject(path, name, extra) {
  const id = name.split('/').at(-1)
  await mkdir(path)
  await writeFile(
    join(path, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      files: ['content.json'],
      arcadia: { formatVersion: 1, projectId: id, namespace: id, content: 'content.json' },
      ...extra,
    }),
  )
  await writeFile(join(path, 'content.json'), JSON.stringify(minimalData))
}

test('author install materializes local packs, preserves linked SDK, and supplies queries and offline pack previews', async t => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-installed-author-')))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'author'),
    addon = join(temporary, 'addon'),
    originalSdk = join(temporary, 'sdk')
  const marker = join(temporary, 'lifecycle-ran')
  await packProject(addon, depName, {
    scripts: { postinstall: `node -e "require('fs').writeFileSync('${marker}', 'ran')"` },
  })
  await packProject(root, '@test/author', { dependencies: deps })
  await mkdir(join(root, 'candidates'))
  const archive = join(root, 'candidates/addon.tgz')
  const args = await resolveNpmInvocation([
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    temporary,
    '--cache',
    join(temporary, 'cache'),
  ])
  const packed = JSON.parse((await promisify(execFile)(args.file, args.args, { cwd: addon })).stdout)[0]
  await copyFile(join(temporary, packed.filename), archive)
  await mkdir(originalSdk)
  await symlink(originalSdk, join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(() => workspace.close())
  const { version: expectedVersion } = await workspace.read('package.json')
  const install = () => installAuthorDependencies(workspace, { expectedVersion, offline: true })
  await assert.rejects(installAuthorDependencies(workspace, { expectedVersion: 'stale' }), {
    code: 'REVISION_CONFLICT',
  })
  const first = await install()
  assert.deepEqual(first.packages, [{ name: depName, version: '1.0.0' }])
  assert.equal(first.manifestVersion, expectedVersion)
  assert.deepEqual((await readFile(join(first.directory, 'package-lock.json'), 'utf8')).includes('sha512-'), true)
  assert.deepEqual(
    JSON.parse(await readFile(join(first.directory, 'node_modules', depName, 'content.json'), 'utf8')),
    minimalData,
  )
  assert.equal(await realpath(join(root, 'node_modules')), originalSdk)
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
  const frozen = join(temporary, 'frozen')
  await mkdir(join(frozen, 'candidates'), { recursive: true })
  await copyFile(archive, join(frozen, 'candidates/addon.tgz'))
  await writeFile(archive, 'changed candidate')
  assert.deepEqual(await findAuthorInstallation(root, deps, frozen), first)
  await writeFile(join(frozen, 'package-lock.json'), '{}')
  assert.equal(await findAuthorInstallation(root, deps, frozen), undefined)
  assert.equal(await findAuthorInstallation(root, deps), undefined)
  await assert.rejects(install(), { code: 'NPM_INSTALL_FAILED' })
  await rm(archive)
  assert.deepEqual(await install(), first)
  const reopened = await AuthorWorkspace.open(root, { watch: false })
  t.after(() => reopened.close())
  const result = await queryContent(reopened, { kind: 'files', scope: 'dependencies', packageName: depName })
  assert.deepEqual(result.diagnostics, [])
  assert.ok(result.items.some(row => row.file === 'package.json' && row.readOnly))
  const prepared = await prepareBattleEnvironment(root, { offline: true })
  try {
    assert.deepEqual(prepared.candidate.members.map(entry => entry.name).sort(), ['@test/author', depName])
  } finally {
    await prepared.dispose()
  }
  const named = { schemaVersion: 1, id: 'cup', name: 'Cup', packages: {}, sources: [] }
  await workspace.write({ file: 'debug/environments/cup.json', expectedVersion: null, text: JSON.stringify(named) })
  const prepare = () => prepareBattleEnvironment(root, { offline: true, environmentId: 'cup', lockRoot: root })
  const firstCup = await prepare()
  await firstCup.dispose()
  const updated = JSON.parse(await readFile(join(addon, 'package.json'), 'utf8'))
  updated.version = '1.1.0'
  await writeFile(join(addon, 'package.json'), JSON.stringify(updated))
  const repacked = JSON.parse((await promisify(execFile)(args.file, args.args, { cwd: addon })).stdout)[0]
  await copyFile(join(temporary, repacked.filename), archive)
  const newInstall = await install()
  assert.notEqual(newInstall.directory, first.directory)
  const secondCup = await prepare()
  try {
    assert.ok(secondCup.candidate.members.some(entry => entry.name === depName && entry.version === '1.1.0'))
  } finally {
    await secondCup.dispose()
  }
})

test('author install refuses read-only projects, arbitrary file dependencies and a linked install directory', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-install-guard-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'author')
  await packProject(root, 'author', { dependencies: { other: 'file:../other' } })
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(() => workspace.close())
  const source = await workspace.read('package.json')
  await assert.rejects(installAuthorDependencies(workspace, { expectedVersion: source.version }), {
    code: 'INSTALL_DEPENDENCY_INVALID',
  })
  workspace.readOnly = true
  await assert.rejects(installAuthorDependencies(workspace, { expectedVersion: source.version }), {
    code: 'WRITE_DISABLED',
  })
  workspace.readOnly = false
  const manifest = JSON.parse(source.text)
  delete manifest.dependencies
  const fresh = await workspace.write({
    file: 'package.json',
    text: JSON.stringify(manifest),
    expectedVersion: source.version,
  })
  await mkdir(join(temporary, 'external'))
  await mkdir(join(root, '.arcadia'), { recursive: true })
  await symlink(
    join(temporary, 'external'),
    join(root, '.arcadia/dependencies'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await assert.rejects(installAuthorDependencies(workspace, { expectedVersion: fresh.version }), {
    code: 'MATERIAL_PATH_ESCAPE',
  })
})

test('standalone preview combines installed archives and captured source mappings after the original archive is removed', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-mixed-source-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'environment'),
    addon = join(temporary, 'addon'),
    source = join(temporary, 'source')
  await createSourceProject(source, 'mapped-pack')
  const name = '@arcadia-local/mapped-pack'
  await packProject(addon, depName, {})
  await mkdir(join(root, 'candidates'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'mixed-env',
      version: '1.0.0',
      dependencies: deps,
      arcadiaEnvironment: {
        schemaVersion: 2,
        id: 'mixed-env',
        name: 'Mixed',
        sources: [name],
        rules: { schemaVersion: 1 },
        requires: {},
      },
    }),
  )
  const args = await resolveNpmInvocation([
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    temporary,
    '--cache',
    join(temporary, 'cache'),
  ])
  const packed = JSON.parse((await promisify(execFile)(args.file, args.args, { cwd: addon })).stdout)[0]
  const archive = join(root, 'candidates/addon.tgz')
  await copyFile(join(temporary, packed.filename), archive)
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(() => workspace.close())
  const { version: expectedVersion } = await workspace.read('package.json')
  await installAuthorDependencies(workspace, { expectedVersion, offline: true })
  await rm(archive)
  const prepared = await prepareBattleEnvironment(root, { offline: true, sources: { [name]: source } })
  try {
    assert.ok(prepared.sourceRevisions[name])
    assert.deepEqual(prepared.candidate.members.map(entry => entry.name).sort(), [name, depName].sort())
  } finally {
    await prepared.dispose()
  }
})

test('npm ci installs a registry version pinned by the author lock from its cached integrity', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-pinned-registry-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const root = join(temporary, 'project'),
    addon = join(temporary, 'addon')
  const dependencies = { [depName]: '^1.0.0' }
  await packProject(root, 'author', { dependencies })
  await packProject(addon, depName, {})
  const cache = join(root, '.arcadia/dependencies/npm-cache')
  await mkdir(cache, { recursive: true })
  async function npm(args) {
    const invocation = await resolveNpmInvocation([...args, '--ignore-scripts', '--offline', '--cache', cache])
    return (await promisify(execFile)(invocation.file, invocation.args, { cwd: addon })).stdout
  }
  const packed = JSON.parse(await npm(['pack', '--json', '--pack-destination', temporary]))[0]
  await npm(['cache', 'add', join(temporary, packed.filename)])
  const resolution = 'https://registry.npmjs.org/@test/installed-addon/-/installed-addon-1.0.0.tgz'
  const sourceLock = JSON.stringify({
    name: 'author',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'author', version: '1.0.0', dependencies },
      ['node_modules/' + depName]: { version: '1.0.0', resolved: resolution, integrity: packed.integrity },
    },
  })
  await writeFile(join(root, 'package-lock.json'), sourceLock)
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(() => workspace.close())
  const { version: expectedVersion } = await workspace.read('package.json')
  const result = await installAuthorDependencies(workspace, { expectedVersion, offline: true })
  assert.deepEqual(result.packages, [{ name: depName, version: '1.0.0' }])
  const lock = JSON.parse(await readFile(join(result.directory, 'package-lock.json'), 'utf8'))
  assert.equal(lock.packages['node_modules/' + depName].resolved, resolution)
  assert.equal(lock.packages['node_modules/' + depName].integrity, packed.integrity)
  assert.equal(await readFile(join(root, 'package-lock.json'), 'utf8'), sourceLock)
})
