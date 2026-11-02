#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const semver = createRequire(join(root, 'packages/pack-loader/package.json'))('semver')
const registry = 'https://npm.pkg.github.com'
// Dependency order; only these packages are part of the author SDK release.
const names = ['const', 'schema', 'protocol', 'interface', 'battle', 'pack-loader', 'content-dev', 'data-pack-base']
const packages = await Promise.all(
  names.map(async name => ({
    directory: join(root, name === 'data-pack-base' ? 'packs/base' : `packages/${name}`),
    manifest: JSON.parse(
      await readFile(join(root, name === 'data-pack-base' ? 'packs/base' : `packages/${name}`, 'package.json'), 'utf8'),
    ),
  })),
)
const versions = new Map(packages.map(({ manifest }) => [manifest.name, manifest.version]))
const version = packages.at(-1).manifest.version
const output = resolve(
  process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : join(root, 'dist', 'ugc-release'),
)
const command = process.argv[2]
const registryMode = process.argv.includes('--registry')

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

if (command === 'pack') {
  await mkdir(output, { recursive: true })
  const records = []
  for (const { directory, manifest } of packages) {
    assert.equal(manifest.version, version, 'SDK packages must use one release version')
    assert.notEqual(manifest.private, true)
    assert.equal(manifest.publishConfig.registry, registry)
    run('pnpm', ['pack', '--pack-destination', output], directory)
    const filename = `${manifest.name.replace('@', '').replace('/', '-')}-${version}.tgz`
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
          assert.ok(versions.has(name), `Unreleased dependency: ${name}`)
          assert.ok(semver.satisfies(versions.get(name), spec), `${name}: incompatible ${spec}`)
        }
      }
    }
    for (const entry of paths([packed.main, packed.types, packed.bin, packed.exports])) {
      assert.ok(files.includes(`package/${entry.replace(/^\.\//, '')}`), `${manifest.name}: missing ${entry}`)
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
    JSON.stringify({ version, registry, tag: 'preview', build, packages: records }, null, 2) + '\n',
  )
  console.log(`Packed ${records.length} UGC packages at ${output}`)
} else if (command === 'verify') {
  const project = await mkdtemp(join(tmpdir(), 'arcadia-ugc-release-'))
  try {
    await cp(join(root, 'packages/content-dev/template'), project, { recursive: true })
    if (registryMode) {
      await writeFile(
        join(project, '.npmrc'),
        '@arcadia-eternity:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n',
      )
    }
    const release = JSON.parse(await readFile(join(output, 'release.json'), 'utf8'))
    assert.equal(release.version, version)
    for (const pkg of release.packages) {
      assert.equal(
        createHash('sha256')
          .update(await readFile(join(output, pkg.filename)))
          .digest('hex'),
        pkg.sha256,
      )
    }
    // A fresh cache in registry mode ensures verification downloads published bytes.
    if (registryMode) process.env.npm_config_cache = join(project, '.npm-cache')
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--save-dev',
        '--no-audit',
        '--no-fund',
        ...(registryMode
          ? [`@arcadia-eternity/data-pack-base@${version}`]
          : release.packages.map(pkg => join(output, pkg.filename))),
      ],
      project,
    )
    for (const pkg of release.packages) {
      const installed = JSON.parse(await readFile(join(project, 'node_modules', pkg.name, 'package.json'), 'utf8'))
      assert.equal(installed.version, version, `${pkg.name}: incorrect installed version`)
      if (registryMode) {
        const lock = JSON.parse(await readFile(join(project, 'package-lock.json'), 'utf8'))
        assert.equal(
          lock.packages[`node_modules/${pkg.name}`].integrity,
          pkg.integrity,
          `${pkg.name}: published bytes differ`,
        )
      }
    }
    const installedBuild = JSON.parse(
      await readFile(join(project, 'node_modules/@arcadia-eternity/battle/dist/environment-build.json'), 'utf8'),
    )
    assert.deepEqual(installedBuild, release.build)
    await cp(join(root, 'scripts/verify-installed-base.mjs'), join(project, 'verify-installed-base.mjs'))
    run(process.execPath, ['verify-installed-base.mjs'], project)
    run('npm', ['run', 'check'], project)
    run('npm', ['test'], project)
    run('npm', ['run', 'demo'], project)
    run('npm', ['run', 'pack'], project)
    console.log(`Verified ${registryMode ? 'GitHub Packages' : 'local archives'}: ${version}`)
  } finally {
    await rm(project, { recursive: true, force: true })
  }
} else {
  throw new Error('Usage: node scripts/release-author-sdk.mjs <pack|verify> [output-directory] [--registry]')
}
