import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { normalizeRuntimeLinks, resolvePnpmInvocation } from './desktop-runtime-portability.mjs'

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-runtime-links-')))
  const root = join(directory, 'original')
  await mkdir(join(root, 'store', 'package'), { recursive: true })
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'store', 'package', 'index.js'), 'fixed material')
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, root, packageRoot: join(root, 'store', 'package') }
}

test('internal absolute directory/file links become relative and survive runtime relocation', async t => {
  const { directory, root, packageRoot } = await fixture(t)
  const dependency = join(root, 'node_modules', 'package')
  // The Windows source fixture represents pnpm's actual absolute junctions.
  await symlink(packageRoot, dependency, process.platform === 'win32' ? 'junction' : 'dir')
  await symlink(join(packageRoot, 'index.js'), join(root, 'entry.js'), 'file')
  assert.equal((await normalizeRuntimeLinks(root)).rewritten, 2)
  assert.equal(isAbsolute(await readlink(dependency)), false)
  assert.equal(isAbsolute(await readlink(join(root, 'entry.js'))), false)
  assert.equal((await normalizeRuntimeLinks(root)).rewritten, 0)
  const moved = join(directory, 'relocated')
  await rename(root, moved)
  assert.equal(await readFile(join(moved, 'node_modules', 'package', 'index.js'), 'utf8'), 'fixed material')
  assert.equal(await readFile(join(moved, 'entry.js'), 'utf8'), 'fixed material')
})

test('valid relative links and link chains retain their original spelling', async t => {
  const { directory, root, packageRoot } = await fixture(t)
  const relativeLink = join(root, 'node_modules', 'relative')
  await symlink('../store/./package', relativeLink, 'dir')
  const originalTarget = await readlink(relativeLink)
  await symlink(relativeLink, join(root, 'node_modules', 'chain'), 'dir')
  await symlink(root, join(packageRoot, 'runtime-root'), 'dir')
  assert.equal((await normalizeRuntimeLinks(root)).rewritten, 2)
  assert.equal(await readlink(relativeLink), originalTarget)
  const moved = join(directory, 'moved')
  await rename(root, moved)
  assert.equal(await readFile(join(moved, 'node_modules', 'chain', 'index.js'), 'utf8'), 'fixed material')
  assert.equal(await realpath(join(moved, 'store', 'package', 'runtime-root')), moved)
})

test('absolute and relative escapes reject before any other internal link is rewritten', async t => {
  const { directory, root, packageRoot } = await fixture(t)
  const external = join(directory, 'external')
  await mkdir(external)
  const internal = join(root, 'a-internal')
  await symlink(packageRoot, internal, 'dir')
  const originalTarget = await readlink(internal)
  const escaping = join(root, 'z-escape')
  for (const target of [external, '../external']) {
    await symlink(target, escaping, 'dir')
    await assert.rejects(normalizeRuntimeLinks(root), { code: 'RUNTIME_LINK_ESCAPE' })
    assert.equal(await readlink(internal), originalTarget)
    await rm(escaping)
  }
})

test('a lexical internal link resolving through an external link is rejected', async t => {
  const { directory, root } = await fixture(t)
  const external = join(directory, 'external')
  await mkdir(external)
  await symlink(external, join(root, 'z-external'), 'dir')
  await symlink('z-external', join(root, 'a-lexically-internal'), 'dir')
  await assert.rejects(normalizeRuntimeLinks(root), { code: 'RUNTIME_LINK_ESCAPE' })
})

test('dangling links and symbolic cycles fail closed without mutation', async t => {
  const { root, packageRoot } = await fixture(t)
  await symlink(packageRoot, join(root, 'a-internal'), 'dir')
  const originalTarget = await readlink(join(root, 'a-internal'))
  await symlink('absent', join(root, 'z-dangling'), 'file')
  await assert.rejects(normalizeRuntimeLinks(root), { code: 'RUNTIME_LINK_UNRESOLVED' })
  assert.equal(await readlink(join(root, 'a-internal')), originalTarget)
  await rm(join(root, 'z-dangling'))
  await symlink('cycle-two', join(root, 'cycle-one'), 'file')
  await symlink('cycle-one', join(root, 'cycle-two'), 'file')
  await assert.rejects(normalizeRuntimeLinks(root), { code: 'RUNTIME_LINK_UNRESOLVED' })
})

test('an ordinary file is not a runtime root', async t => {
  const { packageRoot } = await fixture(t)
  await assert.rejects(normalizeRuntimeLinks(join(packageRoot, 'index.js')), { code: 'RUNTIME_ROOT_INVALID' })
})

test('unsupported FIFO entries reject before normalization', { skip: process.platform === 'win32' }, async t => {
  const { root, packageRoot } = await fixture(t)
  const internal = join(root, 'a-internal')
  await symlink(packageRoot, internal, 'dir')
  const originalTarget = await readlink(internal)
  await promisify(execFile)('mkfifo', [join(root, 'z-pipe')])
  await assert.rejects(normalizeRuntimeLinks(root), { code: 'RUNTIME_ENTRY_UNSUPPORTED' })
  assert.equal(await readlink(internal), originalTarget)
})

test('pnpm invocation preserves the supplied Node entry path as one argument', async () => {
  const entry = '/tools/package managers/pnpm/bin/pnpm.cjs'
  assert.deepEqual(
    await resolvePnpmInvocation({
      platform: 'darwin',
      env: { npm_execpath: entry },
      execPath: '/tools/node',
      isFile: async path => path === entry,
    }),
    { command: '/tools/node', args: [entry] },
  )
  assert.deepEqual(
    await resolvePnpmInvocation({
      platform: 'linux',
      env: { npm_execpath: '/tools/npm-cli.js' },
      isFile: async () => true,
    }),
    { command: 'pnpm', args: [] },
  )
})

test('Windows pnpm invocation uses an absolute JavaScript entry rather than a cmd shim', async () => {
  const entry = 'C:\\Program Files\\pnpm\\bin\\pnpm.cjs'
  assert.deepEqual(
    await resolvePnpmInvocation({
      platform: 'win32',
      env: { npm_execpath: entry },
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      isFile: async path => path === entry,
    }),
    { command: 'C:\\Program Files\\nodejs\\node.exe', args: [entry] },
  )
  await assert.rejects(
    resolvePnpmInvocation({
      platform: 'win32',
      env: { npm_execpath: 'C:\\pnpm.cmd' },
      pathEntries: [],
      isFile: async () => true,
      resolvePackage: () => {
        throw new Error('not installed')
      },
    }),
    { code: 'PNPM_CLI_NOT_FOUND' },
  )
})

test('Windows pnpm resolves an installed package or Corepack PATH layout without shell quoting', async () => {
  const entry = 'C:\\tools\\node_modules\\pnpm\\bin\\pnpm.cjs'
  assert.deepEqual(
    await resolvePnpmInvocation({
      platform: 'win32',
      env: {},
      execPath: 'node.exe',
      resolvePackage: () => 'C:\\tools\\node_modules\\pnpm\\package.json',
      isFile: async path => path === entry,
    }),
    { command: 'node.exe', args: [entry] },
  )
  const corepack = 'C:\\Program Files\\nodejs\\node_modules\\corepack\\dist\\pnpm.js'
  assert.deepEqual(
    await resolvePnpmInvocation({
      platform: 'win32',
      env: { Path: 'C:\\unused;C:\\Program Files\\nodejs' },
      execPath: 'node.exe',
      resolvePackage: () => {
        throw new Error('not installed')
      },
      isFile: async path => path === corepack,
    }),
    { command: 'node.exe', args: [corepack] },
  )
})

test('Windows pnpm rejects missing entries and relative PATH directories', async () => {
  const seen = []
  await assert.rejects(
    resolvePnpmInvocation({
      platform: 'win32',
      env: { npm_execpath: 'pnpm.js', PATH: '.;relative;C:\\missing' },
      resolvePackage: () => {
        throw new Error('not installed')
      },
      isFile: async path => {
        seen.push(path)
        return false
      },
    }),
    /pnpm exec node/,
  )
  assert.ok(seen.length > 0)
  assert.ok(seen.every(path => /^[A-Za-z]:\\/.test(path)))
})
