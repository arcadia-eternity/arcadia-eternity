import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { create } from 'tar'
import { withShippedEnvironmentProject } from '@arcadia-eternity/pack-loader/node'
import { ContentWorkspace } from '../src/content-workspace.ts'
import { materialFiles, writeMaterials } from '../src/workspace-materials.ts'
import { compactMaterials, expandSharedMaterials } from '../src/environment-sharing.ts'

const encode = files => files.map(({ path, bytes }) => ({ path, data: bytes.toString('base64') }))
test('registry references retain locked bytes and accept a matching recipient-supplied tarball offline', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-registry-share-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'package'))
  const manifest = Buffer.from(JSON.stringify({ name: 'sample', version: '1.0.0' }))
  await writeFile(join(root, 'package/package.json'), manifest)
  const file = join(root, 'sample.tgz')
  await create({ cwd: root, file, gzip: true }, ['package'])
  const tarball = await readFile(file)
  const integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64')
  for (const [host, manual] of [
    ['registry.npmjs.org', false],
    ['private.invalid', true],
  ]) {
    const entry = { version: '1.0.0', resolved: `https://${host}/sample/-/sample-1.0.0.tgz`, integrity }
    const materials = [
      { path: 'package.json', bytes: manifest },
      {
        path: 'package-lock.json',
        bytes: Buffer.from(JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/sample': entry } })),
      },
      { path: 'node_modules/sample/package.json', bytes: manifest },
    ]
    const share = await compactMaterials(materials, {})
    const files = encode(share.materials)
    assert.deepEqual(share.archives[0].external, { name: 'sample', version: '1.0.0', manual, integrity })
    assert.equal(files.length, 2)
    const options = { offline: true, cache: join(root, 'empty-cache') }
    await assert.rejects(
      expandSharedMaterials(files, share.archives, options),
      manual ? { code: 'PACKAGE_ARCHIVE_REQUIRED' } : /无法取得/,
    )
    const restored = await expandSharedMaterials(files, share.archives, {
      ...options,
      supplied: { [integrity]: tarball.toString('base64') },
    })
    assert.deepEqual(restored.at(-1), materials.at(-1))
    const environments = join(root, host, 'environments')
    const previous = join(environments, 'previous')
    await mkdir(previous, { recursive: true })
    await writeMaterials(previous, materials)
    const reused = await expandSharedMaterials(files, share.archives, { ...options, environments })
    assert.deepEqual(reused.at(-1), materials.at(-1))
    await assert.rejects(
      expandSharedMaterials(files, share.archives, { ...options, supplied: { [integrity]: 'AA==' } }),
      { code: 'SOURCE_INTEGRITY_MISMATCH' },
    )
    const npmCache = join(root, 'populated-cache')
    await promisify(execFile)('npm', ['cache', 'add', file, '--offline', '--ignore-scripts', '--cache', npmCache])
    const cached = await expandSharedMaterials(files, share.archives, { ...options, cache: npmCache })
    assert.deepEqual(cached.at(-1), materials.at(-1))
    const legacyCache = await expandSharedMaterials(files, share.archives, {
      ...options,
      cache: join(npmCache, '_cacache'),
    })
    assert.deepEqual(legacyCache.at(-1), materials.at(-1))
  }
})

test('both exports omit all sender base materials and both old formats import using the receiving host', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-receiver-base-'))
  const bundledPackageRoot = fileURLToPath(new URL('../../../packs/base', import.meta.url))
  const sender = await ContentWorkspace.open(join(root, 'sender'))
  const recipient = await ContentWorkspace.open(join(root, 'recipient'), { bundledPackageRoot })
  t.after(async () => {
    await Promise.all([sender.close(), recipient.close()])
    await rm(root, { recursive: true, force: true })
  })
  const name = '@arcadia-eternity/data-pack-base'
  const location = 'node_modules/' + name
  const senderVersion = '0.0.1'
  const hostVersion = JSON.parse(await readFile(join(bundledPackageRoot, 'package.json'))).version
  assert.notEqual(senderVersion, hostVersion)
  const validate = async ({ directory }) => ({
    contentRevision: JSON.parse(await readFile(join(directory, location, 'package.json'))).version,
  })
  const source = await withShippedEnvironmentProject(bundledPackageRoot, async directory => {
    const project = JSON.parse(await readFile(join(directory, 'package.json')))
    const lock = JSON.parse(await readFile(join(directory, 'package-lock.json')))
    const pkg = JSON.parse(await readFile(join(directory, location, 'package.json')))
    pkg.version = senderVersion
    const archive = 'candidates/old-catalog.tgz'
    project.dependencies[name] = 'file:' + archive
    project.dependencies.sample = '1.0.0'
    lock.packages[''].dependencies = project.dependencies
    lock.packages[location] = { name, version: senderVersion, resolved: 'file:' + archive }
    lock.packages['node_modules/sample'] = { version: '1.0.0' }
    await mkdir(join(directory, 'candidates'))
    await mkdir(join(directory, 'node_modules/sample'))
    await writeFile(join(directory, archive), 'sender archive')
    await writeFile(join(directory, 'candidates/orphan.tgz'), 'old synchronized base archive')
    await writeFile(join(directory, location, 'sender-only.txt'), 'sender installed material')
    await writeFile(join(directory, location, 'package.json'), JSON.stringify(pkg))
    await writeFile(join(directory, 'package.json'), JSON.stringify(project))
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock))
    await writeFile(
      join(directory, 'node_modules/sample/package.json'),
      JSON.stringify({ name: 'sample', version: '1.0.0' }),
    )
    const doc = {
      schemaVersion: 1,
      id: 'mixed',
      name: 'Mixed',
      packages: { [name]: senderVersion, sample: '1.0.0' },
      sources: [],
    }
    return sender.prepareEnvironment(
      { environmentId: doc.id, expectedRevision: null, document: doc, directory },
      validate,
    )
  })
  const bundles = []
  for (const mode of ['share', 'offline']) {
    const bundle = await sender.exportEnvironment('mixed', mode)
    assert.equal(bundle.format, 'arcadia.environment-export/4')
    assert.equal(bundle.document.packages[name], '*')
    assert.ok(!bundle.files.some(file => file.path.startsWith(location) || file.path.startsWith('candidates/')))
    assert.ok(bundle.files.some(file => file.path === 'node_modules/sample/package.json'))
    assert.deepEqual(bundle.archives, [])
    const lock = JSON.parse(Buffer.from(bundle.files.find(file => file.path === 'package-lock.json').data, 'base64'))
    assert.equal(lock.packages[location], undefined)
    bundles.push(bundle)
  }
  const legacy = {
    format: 'arcadia.environment-export/2',
    document: source.document,
    contentRevision: senderVersion,
    files: encode(await materialFiles(source.directory)),
  }
  bundles.push(legacy, {
    ...legacy,
    format: 'arcadia.environment-export/3',
    files: legacy.files.filter(file => !file.path.startsWith(location)),
    archives: [{ location, paths: ['sender-only.txt'], digest: 'obsolete-sender-digest', bundledBase: true }],
  })
  for (const [index, bundle] of bundles.entries()) {
    const result = await recipient.importEnvironment(
      bundle,
      { environmentId: 'copy-' + index, allowDownload: false },
      validate,
    )
    assert.equal(result.document.packages[name], hostVersion)
    assert.equal(result.contentRevision, hostVersion)
    const lock = JSON.parse(await readFile(join(result.directory, 'package-lock.json')))
    assert.equal(lock.packages[location].version, hostVersion)
    await readFile(join(result.directory, lock.packages[location].resolved.slice(5)))
    await assert.rejects(readFile(join(result.directory, location, 'sender-only.txt')), { code: 'ENOENT' })
    await assert.rejects(readFile(join(result.directory, 'candidates/old-catalog.tgz')), { code: 'ENOENT' })
    assert.ok(
      (await recipient.exportEnvironment(result.installationId, 'offline')).files.every(
        file => !file.path.startsWith('candidates/'),
      ),
    )
  }
  await assert.rejects(sender.importEnvironment(legacy, { environmentId: 'missing-base' }, validate), {
    code: 'BUNDLED_PACKAGE_UNAVAILABLE',
  })
})
