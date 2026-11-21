import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { catalogMaterialDigest, withShippedEnvironmentProject } from '@arcadia-eternity/pack-loader/node'
import { selectPackageUpdate, selectServerBase } from '@arcadia-eternity/content-sdk/managed-projects'

test('selects the newest declared compatible stable release for each npm package', () => {
  const name = '@community/pets'
  const metadata = { name, 'dist-tags': { latest: '8.1.0' }, versions: {} }
  const versions = {
    '7.0.0': '^4.0.0',
    '7.1.0': '^4.0.0',
    '7.2.0': '',
    '7.3.0': undefined,
    '8.0.0-beta.1': '^4.0.0',
    '8.1.0': '^5',
    '9.0.0': '*',
  }
  for (const [version, range] of Object.entries(versions)) {
    metadata.versions[version] = {
      version,
      engines: { arcadia: range },
      dist: {
        integrity: 'sha512-' + Buffer.alloc(64).toString('base64'),
        tarball: `https://registry.npmjs.org/${name}/-/pets-${version}.tgz`,
      },
    }
  }
  assert.equal(selectPackageUpdate(metadata, name, '7.0.0', '4.11.0').version, '7.1.0')
  assert.equal(selectPackageUpdate(metadata, name, '7.1.0', '4.11.0'), null)
  assert.equal(selectPackageUpdate(metadata, name, '7.1.0', '5.1.0').version, '8.1.0')
  metadata.versions['7.1.0'].dist.integrity = ''
  assert.throws(() => selectPackageUpdate(metadata, name, '7.0.0', '4.11.0'), /归档/)
})

test('server resolves shipped, cached and pinned versions against the same offline material identity', async t => {
  const name = '@arcadia-eternity/data-pack-base'
  const root = await mkdtemp(join(tmpdir(), 'server-base-selection-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const shipped = join(root, 'shipped')
  await withShippedEnvironmentProject(resolve('packs/base'), project =>
    cp(join(project, 'node_modules', name), shipped, { recursive: true }),
  )
  const store = join(root, 'cache')
  await mkdir(store)
  const manifest = JSON.parse(await readFile(join(shipped, 'package.json')))
  const put = async (directory, version, range) => {
    await writeFile(
      join(directory, 'package.json'),
      JSON.stringify({ ...manifest, version, engines: { arcadia: range } }),
    )
  }
  await put(shipped, '2.0.0', '*')
  for (const [version, range] of [
    ['2.0.0', '*'],
    ['3.0.0', '^4'],
    ['4.0.0', '^5'],
  ]) {
    const directory = join(store, version)
    await cp(shipped, directory, { recursive: true })
    await put(directory, version, range)
    await writeFile(join(directory, '.arcadia-material-digest'), await catalogMaterialDigest(directory))
  }
  assert.equal((await selectServerBase(store, shipped, '4.11.0')).version, '3.0.0')
  assert.equal((await selectServerBase(store, shipped, '5.0.0')).version, '4.0.0')
  const selected = await selectServerBase(store, shipped, '4.11.0', undefined, async directory => {
    if (directory !== shipped) throw new Error('invalid preset')
  })
  assert.equal(selected.directory, shipped)
  await cp(shipped, join(store, '1.0.0'), { recursive: true })
  await put(join(store, '1.0.0'), '1.0.0', '*')
  const previous = await selectServerBase(store, shipped, '4.11.0', undefined, async directory => {
    if (directory !== join(store, '1.0.0')) throw new Error('unusable preset')
  })
  assert.equal(previous.version, '1.0.0')
  await assert.rejects(selectServerBase(store, shipped, '4.11.0', '4.0.0'), /No compatible/)
  const same = join(store, '2.0.0')
  assert.equal(await catalogMaterialDigest(same), await catalogMaterialDigest(shipped))
  assert.equal((await selectServerBase(store, shipped, '4.11.0', '2.0.0')).directory, shipped)
  const file = join(shipped, manifest.arcadia.effectArtifact)
  await writeFile(file, (await readFile(file, 'utf8')) + '\n')
  assert.notEqual(await catalogMaterialDigest(same), await catalogMaterialDigest(shipped))
  assert.equal((await selectServerBase(store, shipped, '4.11.0', '2.0.0')).directory, shipped)
  await writeFile(join(store, '3.0.0', manifest.arcadia.catalog), 'damaged')
  assert.equal((await selectServerBase(store, shipped, '4.11.0')).directory, shipped)
})
