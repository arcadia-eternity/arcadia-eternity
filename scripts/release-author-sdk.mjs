#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const registry = 'https://registry.npmjs.org'
// Dependency order; only these packages are part of the author SDK release.
const directories = [
  ...['const', 'schema', 'protocol', 'interface', 'battle', 'pack-loader', 'content-dev'].map(
    name => `packages/${name}`,
  ),
  'packs/base',
]
const packages = await Promise.all(
  directories.map(async directory => ({
    directory: join(root, directory),
    manifest: JSON.parse(await readFile(join(root, directory, 'package.json'), 'utf8')),
  })),
)
const packageNames = new Set(packages.map(({ manifest }) => manifest.name))
const { name: releaseName, version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const output = resolve(process.argv[3] ?? join(root, 'dist', 'ugc-release'))
const command = process.argv[2]

function run(command, args, cwd, capture = false) {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  })
}

function paths(value) {
  if (typeof value === 'string') return [value]
  if (value && typeof value === 'object') return Object.values(value).flatMap(paths)
  return []
}

function archiveName(name) {
  return `${name.slice(1).replace('/', '-')}-${version}.tgz`
}

async function readRelease() {
  const release = JSON.parse(await readFile(join(output, 'release.json'), 'utf8'))
  assert.equal(release.version, version)
  assert.equal(release.registry, registry)
  assert.equal(release.tag, 'latest')
  assert.deepEqual(
    release.packages.map(pkg => [pkg.name, pkg.version, pkg.filename]),
    packages.map(({ manifest }) => [manifest.name, version, archiveName(manifest.name)]),
  )
  for (const pkg of release.packages) {
    const bytes = await readFile(join(output, pkg.filename))
    assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, pkg.integrity)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pkg.sha256)
  }
  return release
}

if (command === 'pack') {
  for (const { manifest } of packages) {
    assert.equal(manifest.version, version, `${manifest.name}: expected release version ${version}`)
    assert.notEqual(manifest.private, true)
    assert.deepEqual(manifest.publishConfig, { registry, access: 'public' })
  }
  for (const path of ['packages/content-dev/template/package.json', 'examples/ugc/slow/package.json']) {
    const manifest = JSON.parse(await readFile(join(root, path), 'utf8'))
    for (const [name, spec] of Object.entries(manifest.devDependencies))
      if (packageNames.has(name)) assert.equal(spec, version, `${path}: incorrect ${name} pin`)
  }
  await mkdir(output, { recursive: true })
  const records = []
  for (const { directory, manifest } of packages) {
    run('pnpm', ['pack', '--pack-destination', output], directory)
    const filename = archiveName(manifest.name)
    const archive = join(output, filename)
    const files = run('tar', ['-tzf', archive], root, true).trim().split('\n')
    const packed = JSON.parse(run('tar', ['-xOzf', archive, 'package/package.json'], root, true))
    assert.ok(files.includes('package/LICENSE'), `${manifest.name}: license missing`)
    assert.equal(packed.name, manifest.name)
    assert.equal(packed.version, version)
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
      for (const [name, spec] of Object.entries(packed[section] ?? {})) {
        assert.ok(!/^(workspace:|catalog:|file:|link:)/.test(spec), `${name}: unresolved ${spec}`)
        if (name.startsWith('@arcadia-eternity/')) {
          assert.ok(packageNames.has(name), `Unreleased dependency: ${name}`)
          assert.equal(spec, version, `${name}: expected exact SDK release dependency`)
        }
      }
    }
    for (const entry of paths([packed.main, packed.types, packed.bin, packed.exports])) {
      assert.ok(files.includes(`package/${entry.replace(/^\.\//, '')}`), `${manifest.name}: missing ${entry}`)
    }
    if (packed.arcadia)
      for (const field of ['content', 'presentation', 'effectArtifact', 'catalog'])
        if (packed.arcadia[field])
          assert.ok(files.includes(`package/${packed.arcadia[field]}`), `${packed.name}: missing ${field} artifact`)
    if (manifest.name === '@arcadia-eternity/data-pack-base') {
      assert.equal(packed.arcadiaEternityPack, 'dist/pack.json')
      assert.ok(files.includes('package/dist/pack.json'), 'base pack: missing compiled manifest')
      assert.deepEqual(
        files.filter(file => /^package\/(?:data|locales|src)\//.test(file) || file === 'package/pack.json'),
        [],
        'base pack: authoring sources must not be published',
      )
      assert.deepEqual(
        files.filter(file => /\.ya?ml$/i.test(file) && file !== 'package/dist/pack-lock.yaml'),
        [],
        'base pack: only the generated distribution lock may be YAML',
      )
    }
    if (manifest.name === '@arcadia-eternity/content-sdk') {
      for (const file of [
        'SKILL.md',
        'references/project-conventions.md',
        'references/mechanics-and-validation.md',
        'references/testing.md',
      ])
        assert.ok(
          files.includes(`package/dist/template/skills/seer2-recreate-pet/${file}`),
          `${manifest.name}: missing recreation skill ${file}`,
        )
    }
    if (manifest.name.endsWith('/battle')) {
      assert.ok(files.includes('package/dist/THIRD_PARTY_NOTICES.md'))
      assert.ok(files.includes('package/dist/environment-build.json'))
      assert.ok(files.includes('package/dist/environment-runtime.mjs'))
    }
    records.push({
      name: manifest.name,
      version,
      filename,
      integrity: `sha512-${createHash('sha512')
        .update(await readFile(archive))
        .digest('base64')}`,
      sha256: createHash('sha256')
        .update(await readFile(archive))
        .digest('hex'),
    })
  }
  const build = JSON.parse(await readFile(join(root, 'packages/battle/dist/environment-build.json'), 'utf8'))
  await writeFile(
    join(output, 'release.json'),
    JSON.stringify({ version, registry, tag: 'latest', build, packages: records }, null, 2) + '\n',
  )
  console.log(`Packed ${records.length} UGC packages at ${output}`)
} else if (command === 'publish') {
  assert.equal(process.env.RELEASE_TAG, `${releaseName}-v${version}`, 'Release tag does not match the SDK version')
  const release = await readRelease()
  assert.equal(run('npm', ['config', 'get', 'tag'], root, true).trim(), release.tag)
  // Inspect all existing versions before uploading anything. A retry can reuse the verified archives.
  const unpublished = []
  for (const pkg of release.packages) {
    const url = `${registry}/${encodeURIComponent(pkg.name)}/${version}`
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (response.status === 404) {
      unpublished.push(pkg)
      continue
    }
    assert.ok(response.ok, `${pkg.name}: registry returned HTTP ${response.status}`)
    const { dist } = await response.json()
    assert.equal(dist?.integrity, pkg.integrity, `${pkg.name}@${version}: registry already has different bytes`)
    console.log(`Already published: ${pkg.name}@${version}`)
  }
  // The implicit latest tag lets npm reject a manual replay older than a published stable release.
  for (const pkg of unpublished) {
    run(
      'npm',
      ['publish', join(output, pkg.filename), '--ignore-scripts', '--registry', registry, '--access', 'public'],
      root,
    )
  }
} else {
  throw new Error('Usage: node scripts/release-author-sdk.mjs <pack|publish> [output-directory]')
}
