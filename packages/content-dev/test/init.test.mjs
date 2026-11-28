import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import YAML from 'yaml'
import { parseManifestDraft } from '../src/prepared-document.ts'
import { teamDocument } from '../src/project-teams.ts'

const run = promisify(execFile)
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-content-init-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('init creates a content starter and initializes an empty current directory as a standalone environment', async t => {
  const root = await fixture(t)
  const pack = join(root, 'playable-pack')
  const created = JSON.parse((await run(process.execPath, [cli, 'init', 'pack', pack, '--offline'])).stdout)
  assert.equal(created.lock, false)
  const content = JSON.parse(await readFile(join(pack, 'package.json'), 'utf8'))
  assert.equal(content.arcadia.namespace, 'playable-pack')
  // Scaffolds ship no pinned lock; offline creation leaves it to the author's first npm install.
  await assert.rejects(readFile(join(pack, 'package-lock.json')), { code: 'ENOENT' })
  // npm publishes declared bin scripts executable; built modules may not be.
  if (process.platform !== 'win32')
    assert.match(await readlink(join(pack, 'node_modules/.bin/arcadia-content')), /[\\/]bin[\\/]arcadia-content\.mjs$/)
  assert.ok(await readFile(join(pack, 'skills/arcadia-content-authoring/SKILL.md'), 'utf8'))
  const environment = join(root, 'My tournament')
  await mkdir(environment)
  await run(process.execPath, [cli, 'init', 'environment', '.', '--id', 'cup'], { cwd: environment })
  const manifest = await readFile(join(environment, 'package.json'), 'utf8')
  assert.equal(JSON.parse(manifest).arcadia, undefined)
  const { document } = parseManifestDraft(manifest)
  assert.equal(document.id, 'cup')
  assert.equal(typeof document.packages['@arcadia-eternity/data-pack-base'], 'string')
  for (const id of ['blue', 'orange']) {
    const team = teamDocument(YAML.parse(await readFile(join(environment, 'debug/teams', id + '.yaml'), 'utf8')))
    assert.equal(team.id, id)
    assert.equal(team.team.length, 1)
  }
  assert.ok(await readFile(join(environment, 'skills/arcadia-content-authoring/SKILL.md'), 'utf8'))
})

test('parallel init calls create exactly one project and preserve existing files and invalid destinations', async t => {
  const root = await fixture(t)
  const path = join(root, 'cup')
  const calls = ['pack', 'environment'].map(kind => run(process.execPath, [cli, 'init', kind, path]))
  const results = await Promise.allSettled(calls)
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.ok(!(await readdir(path)).includes('.arcadia-init'))
  const manifest = await readFile(join(path, 'package.json'), 'utf8')
  await writeFile(join(path, 'sentinel'), 'keep')
  await assert.rejects(run(process.execPath, [cli, 'init', 'pack', path]))
  assert.equal(await readFile(join(path, 'package.json'), 'utf8'), manifest)
  assert.equal(await readFile(join(path, 'sentinel'), 'utf8'), 'keep')
  await assert.rejects(run(process.execPath, [cli, 'init', 'environment', join(root, 'default')]))
  assert.deepEqual(await readdir(root), ['cup'])
})
