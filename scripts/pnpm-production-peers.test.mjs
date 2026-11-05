import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { parse } from 'yaml'
import { withPreservedPnpmWorkspaceState } from './desktop-pnpm-deploy.mjs'
import { verifyDesktopProductionDependencies } from './desktop-production-dependencies.mjs'
import { resolvePnpmInvocation } from './desktop-runtime-portability.mjs'

const require = createRequire(import.meta.url)
const { readPackage } = require('../.pnpmfile.cjs').hooks
const exec = promisify(execFile)

const manifest = () => ({
  name: 'better-auth',
  version: '1.7.13',
  dependencies: { '@better-auth/core': '1.7.13' },
  optionalDependencies: { 'runtime-addon': '1.0.0' },
  devDependencies: { vitest: '4.1.11' },
  peerDependencies: { vitest: '^2.0.0 || ^3.0.0 || ^4.0.0 || ^5.0.0', pg: '^8.0.0' },
  peerDependenciesMeta: { vitest: { optional: true }, pg: { optional: true } },
})

test('omits only the reviewed test peer and its pnpm 11 implicit-peer metadata', () => {
  const original = manifest()
  const result = readPackage(original)
  assert.equal(result.peerDependencies.vitest, undefined)
  assert.equal(result.peerDependenciesMeta.vitest, undefined)
  assert.deepEqual(result.peerDependencies, { pg: '^8.0.0' })
  assert.deepEqual(result.peerDependenciesMeta, { pg: { optional: true } })
  assert.equal(result.dependencies, original.dependencies)
  assert.equal(result.optionalDependencies, original.optionalDependencies)
  assert.equal(result.devDependencies, original.devDependencies)
  assert.equal(original.peerDependenciesMeta.vitest.optional, true)
  assert.equal(readPackage(result), result)
})

test('keeps development Vitest and other packages or Better Auth releases unchanged', () => {
  for (const pkg of [
    { ...manifest(), name: 'arcadia-eternity' },
    { ...manifest(), version: '1.7.14' },
    { name: 'vitest', version: '4.1.11', dependencies: { 'why-is-node-running': '^2.3.0' } },
  ])
    assert.equal(readPackage(pkg), pkg)
})

test('fails closed if the reviewed test peer becomes a runtime or required dependency', () => {
  for (const field of ['dependencies', 'optionalDependencies']) {
    const pkg = manifest()
    pkg[field].vitest = '4.1.11'
    assert.throws(() => readPackage(pkg), /not a runtime dependency/)
  }
  const required = manifest()
  required.peerDependenciesMeta.vitest.optional = false
  assert.throws(() => readPackage(required), /metadata changed/)
  const implicit = manifest()
  delete implicit.peerDependencies.vitest
  assert.throws(() => readPackage(implicit), /metadata changed/)
})

async function physicalPackage(root, path, name, version = '9.8.7') {
  const directory = join(root, path)
  await mkdir(directory, { recursive: true })
  const file = join(directory, 'package.json')
  await writeFile(file, JSON.stringify({ name, version }))
  return file
}

test('production audit uses physical manifests, not locator labels or package resources', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-peer-audit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = await physicalPackage(
    root,
    'node_modules/.pnpm/better-auth@1.7.13_vitest@4.1.11/node_modules/better-auth',
    'better-auth',
  )
  await physicalPackage(root, 'node_modules/@fixture/runtime', '@fixture/runtime')
  await physicalPackage(root, 'node_modules/@fixture/runtime/examples/unused-test', 'vitest')
  await physicalPackage(root, 'runtime/npm', 'npm')
  const before = await readFile(manifest)
  await verifyDesktopProductionDependencies(root)
  assert.deepEqual(await readFile(manifest), before)
})

test('production audit rejects test package names at every installed layout and any version', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-peer-layouts-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  for (const [index, [name, path]] of [
    ['vitest', 'node_modules/ordinary-alias'],
    ['why-is-node-running', 'node_modules/@fixture/runtime/node_modules/ordinary-alias'],
    ['stackback', 'node_modules/.pnpm/unrelated-locator/node_modules/ordinary-alias'],
    ['stackback', 'runtime/npm/node_modules/ordinary-alias'],
  ].entries()) {
    const root = join(temporary, String(index))
    await physicalPackage(root, 'node_modules/@fixture/runtime', '@fixture/runtime')
    await physicalPackage(root, 'runtime/npm', 'npm')
    const manifest = await physicalPackage(root, path, name)
    const before = await readFile(manifest)
    await assert.rejects(
      verifyDesktopProductionDependencies(root),
      error => error.code === 'DESKTOP_TEST_DEPENDENCY' && error.message.includes(`${name}@9.8.7`),
    )
    assert.deepEqual(await readFile(manifest), before)
  }
})

test('production audit permits ancestor aliases and rejects redirected roots or node_modules', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-peer-links-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const directoryLink = process.platform === 'win32' ? 'junction' : 'dir'
  const parent = join(temporary, 'physical')
  const root = join(parent, 'runtime')
  await physicalPackage(root, 'node_modules/.pnpm/runtime@1/node_modules/runtime-package', 'runtime-package')
  await symlink(
    join(root, 'node_modules/.pnpm/runtime@1/node_modules/runtime-package'),
    join(root, 'node_modules/runtime-package'),
    directoryLink,
  )
  const ancestor = join(temporary, 'ancestor')
  await symlink(parent, ancestor, directoryLink)
  await verifyDesktopProductionDependencies(join(ancestor, 'runtime'))
  const redirectedRoot = join(temporary, 'redirected')
  await symlink(root, redirectedRoot, directoryLink)
  await assert.rejects(verifyDesktopProductionDependencies(redirectedRoot), { code: 'DESKTOP_DEPENDENCIES_INVALID' })
  const redirectedModules = join(temporary, 'redirected-modules')
  await mkdir(redirectedModules)
  await assert.rejects(verifyDesktopProductionDependencies(redirectedModules), { code: 'ENOENT' })
  await symlink(join(root, 'node_modules'), join(redirectedModules, 'node_modules'), directoryLink)
  await assert.rejects(verifyDesktopProductionDependencies(redirectedModules), { code: 'DESKTOP_DEPENDENCIES_INVALID' })
  const redirectedStore = join(temporary, 'redirected-store')
  await mkdir(join(redirectedStore, 'node_modules'), { recursive: true })
  await symlink(join(root, 'node_modules/.pnpm'), join(redirectedStore, 'node_modules/.pnpm'), directoryLink)
  await assert.rejects(verifyDesktopProductionDependencies(redirectedStore), { code: 'DESKTOP_DEPENDENCIES_INVALID' })
})

// Minimal USTAR archives keep this fixture independent of npm pack, network
// packages, native builds, and the repository's package-manager store.
function archive(files) {
  const chunks = []
  for (const [name, contents] of Object.entries(files)) {
    const body = Buffer.from(contents)
    const header = Buffer.alloc(512)
    header.write(`package/${name}`)
    for (const [offset, width, value] of [
      [100, 8, 0o644],
      [108, 8, 0],
      [116, 8, 0],
      [124, 12, body.length],
      [136, 12, 0],
    ])
      header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width)
    header.fill(32, 148, 156)
    header.write('0', 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
    chunks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]))
}

test(
  'real offline pnpm deployment omits the test peer closure and preserves runtime and development packages',
  {
    timeout: 60000,
  },
  async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-production-peers-'))
    t.after(() => rm(temporary, { recursive: true, force: true }))
    const pnpm = await resolvePnpmInvocation()
    const nativeMarker = Buffer.from('fixture runtime native bytes\0\xff', 'latin1')
    const packages = new Map()
    function pkg(metadata, source, extra = {}) {
      const value = { main: 'index.cjs', ...metadata }
      const tarball = archive({ 'package.json': JSON.stringify(value), 'index.cjs': source, ...extra })
      packages.set(value.name, { manifest: value, tarball })
    }
    pkg(
      manifest(),
      "module.exports = { core: require('@better-auth/core'), addon: require('runtime-addon'), pg: require('pg') }\n",
    )
    pkg({ name: '@better-auth/core', version: '1.7.13' }, "module.exports = 'auth-core'\n")
    pkg(
      { name: 'runtime-addon', version: '1.0.0' },
      "module.exports = require('node:fs').readFileSync(require('node:path').join(__dirname, 'runtime.node'))\n",
      { 'runtime.node': nativeMarker },
    )
    pkg({ name: 'pg', version: '8.23.1' }, "module.exports = 'postgres-driver'\n")
    pkg(
      { name: 'vitest', version: '4.1.11', dependencies: { 'why-is-node-running': '2.3.0' } },
      "module.exports = require('why-is-node-running')\n",
    )
    pkg(
      { name: 'why-is-node-running', version: '2.3.0', dependencies: { stackback: '0.0.2' } },
      "module.exports = require('stackback')\n",
    )
    pkg({ name: 'stackback', version: '0.0.2' }, "module.exports = 'development-stackback'\n")

    let registry
    let requests = 0
    const server = createServer((req, res) => {
      requests++
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const isArchive = path.startsWith('/tarballs/')
      const name = path.slice(isArchive ? '/tarballs/'.length : 1).replace(/\.tgz$/, '')
      const fixture = packages.get(name)
      if (!fixture) {
        res.writeHead(404).end()
        return
      }
      if (isArchive) {
        res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(fixture.tarball)
        return
      }
      const metadata = {
        ...fixture.manifest,
        dist: {
          tarball: `${registry}/tarballs/${encodeURIComponent(name)}.tgz`,
          integrity: `sha512-${createHash('sha512').update(fixture.tarball).digest('base64')}`,
        },
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          name,
          'dist-tags': { latest: metadata.version },
          versions: { [metadata.version]: metadata },
        }),
      )
    })
    t.after(() => (server.listening ? new Promise(resolve => server.close(resolve)) : undefined))

    for (const policy of ['control', 'peer-only', 'reviewed']) {
      const root = join(temporary, policy, 'workspace')
      const output = join(temporary, policy, 'deployed')
      const run = args =>
        exec(pnpm.command, [...pnpm.args, ...args], {
          cwd: root,
          env: { ...process.env, CI: 'true', HUSKY: '0' },
          timeout: 20000,
          maxBuffer: 1024 * 1024,
        })
      await mkdir(join(root, 'packages/server'), { recursive: true })
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({
          private: true,
          packageManager: 'pnpm@11.21.0',
          devDependencies: { vitest: '4.1.11' },
        }),
      )
      assert.equal((await run(['--version'])).stdout.trim(), '11.21.0')
      await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
      await writeFile(
        join(root, 'packages/server/package.json'),
        JSON.stringify({
          name: 'fixture-server',
          version: '1.0.0',
          dependencies: { 'better-auth': '1.7.13', pg: '8.23.1' },
        }),
      )
      if (policy === 'reviewed')
        await copyFile(new URL('../.pnpmfile.cjs', import.meta.url), join(root, '.pnpmfile.cjs'))
      if (policy === 'peer-only')
        await writeFile(
          join(root, '.pnpmfile.cjs'),
          `module.exports = { hooks: { readPackage(pkg) {
        if (pkg.name !== 'better-auth' || pkg.version !== '1.7.13') return pkg
        const peerDependencies = { ...pkg.peerDependencies }
        delete peerDependencies.vitest
        return { ...pkg, peerDependencies }
      } } }`,
        )

      // Only fixture bytes from the loopback registry can enter this independent
      // cache. The deployment below must make zero registry requests.
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      registry = `http://127.0.0.1:${server.address().port}`
      const storeFlags = [
        '--store-dir',
        join(temporary, policy, 'store'),
        '--cache-dir',
        join(temporary, policy, 'cache'),
      ]
      const registryFlags = [`--registry=${registry}`]
      await run(['install', '--ignore-scripts', ...storeFlags, ...registryFlags])
      await new Promise(resolve => server.close(resolve))
      const sourceRequire = createRequire(join(root, 'package.json'))
      const devEntry = sourceRequire.resolve('vitest')
      assert.equal(sourceRequire('vitest'), 'development-stackback')
      const sourceAuth = createRequire(createRequire(join(root, 'packages/server/package.json')).resolve('better-auth'))
      const sourceMarker = join(dirname(sourceAuth.resolve('runtime-addon')), 'runtime.node')
      const nativeBefore = await readFile(sourceMarker)
      assert.deepEqual(nativeBefore, nativeMarker)
      const sourcePaths = [
        'package.json',
        'packages/server/package.json',
        'pnpm-lock.yaml',
        'node_modules/.modules.yaml',
        'node_modules/.pnpm-workspace-state-v1.json',
      ]
      const before = await Promise.all(sourcePaths.map(file => readFile(join(root, file))))
      const devBefore = await readFile(devEntry)
      const lock = parse(before[2].toString())
      const authSnapshot = Object.entries(lock.snapshots).find(([name]) => name.startsWith('better-auth@1.7.13'))?.[1]
      assert.ok(authSnapshot)
      assert.equal(authSnapshot.optionalDependencies?.vitest, policy !== 'reviewed' ? '4.1.11' : undefined)
      assert.equal(
        lock.packages['better-auth@1.7.13'].peerDependencies?.vitest,
        policy === 'peer-only' ? '*' : policy === 'control' ? manifest().peerDependencies.vitest : undefined,
      )
      assert.equal(lock.snapshots['vitest@4.1.11'].dependencies['why-is-node-running'], '2.3.0')
      assert.equal(lock.snapshots['why-is-node-running@2.3.0'].dependencies.stackback, '0.0.2')
      if (policy === 'reviewed') assert.ok(lock.pnpmfileChecksum)
      const beforeRequests = requests
      await withPreservedPnpmWorkspaceState(root, () =>
        run([
          '--filter',
          'fixture-server',
          'deploy',
          '--legacy',
          '--prod',
          '--frozen-lockfile',
          '--offline',
          '--ignore-scripts',
          ...storeFlags,
          ...registryFlags,
          output,
        ]),
      )
      assert.equal(requests, beforeRequests)
      assert.deepEqual(await Promise.all(sourcePaths.map(file => readFile(join(root, file)))), before)
      assert.deepEqual(await readFile(devEntry), devBefore)
      assert.deepEqual(await readFile(sourceMarker), nativeBefore)
      assert.equal(sourceRequire('vitest'), 'development-stackback')

      const deployedRequire = createRequire(join(output, 'package.json'))
      const runtime = deployedRequire('better-auth')
      assert.equal(runtime.core, 'auth-core')
      assert.equal(runtime.pg, 'postgres-driver')
      assert.deepEqual(runtime.addon, nativeMarker)
      const authEntry = await realpath(deployedRequire.resolve('better-auth'))
      const location = relative(await realpath(output), authEntry)
      assert.ok(!location.startsWith('..') && !isAbsolute(location), 'auth must resolve inside deployment')
      const authRequire = createRequire(authEntry)
      const storeEntries = await readdir(join(output, 'node_modules/.pnpm'))
      // pnpm may omit the root dev peer itself during legacy deployment while
      // still shipping its transitive test packages. Lock down that actual leak.
      for (const name of ['why-is-node-running', 'stackback']) {
        const present = storeEntries.some(entry => entry.startsWith(`${name}@`))
        assert.equal(present, policy !== 'reviewed', `${name} physical production closure: ${storeEntries.join(', ')}`)
      }
      if (policy === 'reviewed') {
        assert.ok(!storeEntries.some(entry => entry.startsWith('vitest@')))
        assert.throws(() => authRequire.resolve('vitest'), { code: 'MODULE_NOT_FOUND' })
        await verifyDesktopProductionDependencies(output)
      } else await assert.rejects(verifyDesktopProductionDependencies(output), { code: 'DESKTOP_TEST_DEPENDENCY' })
    }
  },
)
