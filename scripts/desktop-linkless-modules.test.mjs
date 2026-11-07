import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { materializeLinklessModules } from './desktop-linkless-modules.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-linkless-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source', 'node_modules'),
    output = join(root, 'output', 'node_modules')
  await mkdir(source, { recursive: true })
  await mkdir(dirname(output))
  async function pkg(locator, name, dependencies, body, extra = {}) {
    const path = join(source, '.pnpm', locator, 'node_modules', name)
    await mkdir(path, { recursive: true })
    await writeFile(
      join(path, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', main: 'index.cjs', dependencies, ...extra }),
    )
    await writeFile(join(path, 'index.cjs'), body)
    return path
  }
  async function link(target, path) {
    await mkdir(dirname(path), { recursive: true })
    await symlink(relative(dirname(path), target), path, 'dir')
  }
  return { root, source, output, pkg, link }
}

async function noLinks(path) {
  assert.equal((await lstat(path)).isSymbolicLink(), false)
  if ((await lstat(path)).isDirectory()) for (const name of await readdir(path)) await noLinks(join(path, name))
}

test('archive-style dereferencing loses sibling dependencies; linkless materialization survives relocation', async t => {
  const { root, source, output, pkg, link } = await fixture(t)
  const dependency = await pkg('readdirp', 'readdirp', {}, "module.exports = 'sibling found'")
  const watcher = await pkg('chokidar', 'chokidar', { readdirp: '1.0.0' }, "module.exports = require('readdirp')")
  await link(dependency, join(dirname(watcher), 'readdirp'))
  await link(watcher, join(source, 'chokidar'))
  const broken = join(root, 'broken', 'node_modules', 'chokidar')
  await cp(watcher, broken, { recursive: true, dereference: true })
  assert.throws(() => createRequire(join(broken, 'index.cjs'))('./index.cjs'), { code: 'MODULE_NOT_FOUND' })
  assert.deepEqual(await materializeLinklessModules(source, output), { packages: 2, edges: 1 })
  const moved = join(root, 'relocated')
  await rename(dirname(output), moved)
  await rm(join(root, 'source'), { recursive: true })
  await noLinks(moved)
  const result = await promisify(execFile)(process.execPath, ['-e', "console.log(require('chokidar'))"], { cwd: moved })
  assert.equal(result.stdout.trim(), 'sibling found')
})

test('preserves cyclic imports, aliases and distinct installed peer instances with identical versions', async t => {
  const { source, output, pkg, link } = await fixture(t)
  const peerOne = await pkg('peer-one', 'peer', {}, "module.exports = 'one'")
  const peerTwo = await pkg('peer-two', 'peer', {}, "module.exports = 'two'")
  const a = await pkg(
    'a',
    'a',
    { b: '1.0.0' },
    "exports.name = 'a'; exports.peer = require('peer'); exports.b = require('b')",
    { peerDependencies: { peer: '1.0.0' } },
  )
  const b = await pkg(
    'b',
    'b',
    { a: '1.0.0' },
    "exports.name = 'b'; exports.peer = require('peer'); exports.a = require('a')",
    { peerDependencies: { peer: '1.0.0' }, optionalDependencies: { absent: '1.0.0' } },
  )
  await link(b, join(dirname(a), 'b'))
  await link(a, join(dirname(b), 'a'))
  await link(peerOne, join(dirname(a), 'peer'))
  await link(peerTwo, join(dirname(b), 'peer'))
  await link(a, join(source, 'alias-a'))
  await link(b, join(source, 'b'))
  await materializeLinklessModules(source, output)
  await noLinks(output)
  const r = createRequire(join(dirname(output), 'entry.cjs'))
  assert.equal(r('alias-a').peer, 'one')
  assert.equal(r('alias-a').b.peer, 'two')
  assert.equal(r('alias-a').b.a.peer, 'one')
  assert.equal(r('b').peer, 'two')
})

test('rejects missing mandatory and escaped dependencies before creating the destination', async t => {
  const { root, source, output, pkg, link } = await fixture(t)
  const a = await pkg('a', 'a', { missing: '1.0.0' }, '')
  await link(a, join(source, 'a'))
  await assert.rejects(materializeLinklessModules(source, output), /Missing staged dependency/)
  await assert.rejects(lstat(output), { code: 'ENOENT' })
  const outside = join(root, 'foreign')
  await mkdir(outside)
  await link(outside, join(dirname(a), 'missing'))
  await assert.rejects(materializeLinklessModules(source, output), /escapes staged modules/)
  await assert.rejects(lstat(output), { code: 'ENOENT' })
})

test('refuses existing output and source-overlapping destinations', async t => {
  const { source, output, pkg, link } = await fixture(t)
  await link(await pkg('a', 'a', {}, ''), join(source, 'a'))
  await assert.rejects(materializeLinklessModules(source, join(source, 'child')), /outside source/)
  await mkdir(output)
  await assert.rejects(materializeLinklessModules(source, output), { code: 'EEXIST' })
})
