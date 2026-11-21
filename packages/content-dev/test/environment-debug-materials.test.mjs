import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { resolveNpmInvocation } from '@arcadia-eternity/pack-loader/node'
import { prepareBattleEnvironment } from '../src/environment.ts'

test('a changed local archive refreshes a debug lock, while an authored lock pins its bytes', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-debug-materials-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const project = join(temporary, 'env'),
    source = join(temporary, 'pack'),
    cache = join(temporary, 'cache')
  const name = '@test/debug-archive'
  await mkdir(join(project, 'candidates'), { recursive: true })
  await mkdir(source)
  await writeFile(
    join(source, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      files: ['data.json'],
      arcadia: { projectId: 'archive', namespace: 'archive', formatVersion: 1, content: 'data.json' },
    }),
  )
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({
      name: 'cup',
      dependencies: { [name]: 'file:candidates/material.tgz' },
      arcadiaEnvironment: {
        schemaVersion: 2,
        id: 'cup',
        name: 'Cup',
        sources: [],
        rules: { schemaVersion: 1 },
        requires: {},
      },
    }),
  )
  async function archive(extra) {
    await writeFile(
      join(source, 'data.json'),
      JSON.stringify({ data: { species: [], skills: [], marks: [], behaviors: [], ...extra } }),
    )
    const args = await resolveNpmInvocation([
      'pack',
      '--json',
      '--ignore-scripts',
      '--cache',
      cache,
      '--pack-destination',
      temporary,
    ])
    const result = JSON.parse((await promisify(execFile)(args.file, args.args, { cwd: source })).stdout)[0]
    await copyFile(join(temporary, result.filename), join(project, 'candidates/material.tgz'))
    return result.integrity
  }
  const prepare = () => prepareBattleEnvironment(project, { cache, offline: true, lockRoot: project })
  const firstIntegrity = await archive({})
  const first = await prepare()
  let lock
  try {
    assert.equal(first.environment.installation.packages[0].integrity, firstIntegrity)
    lock = await readFile(join(project, first.environmentLock.file))
  } finally {
    await first.dispose()
  }
  const secondIntegrity = await archive({ elements: [] })
  assert.notEqual(secondIntegrity, firstIntegrity)
  const second = await prepare()
  try {
    assert.equal(second.environment.installation.packages[0].integrity, secondIntegrity)
  } finally {
    await second.dispose()
  }
  await writeFile(join(project, 'package-lock.json'), lock)
  await assert.rejects(prepare(), /ENVIRONMENT_ARCHIVE_INTEGRITY/)
  await rm(join(project, 'package-lock.json'))
  await rename(join(project, 'candidates/material.tgz'), join(project, 'candidates/renamed.tgz'))
  const manifestFile = join(project, 'package.json')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  manifest.dependencies[name] = 'file:candidates/renamed.tgz'
  await writeFile(manifestFile, JSON.stringify(manifest))
  const moved = await prepare()
  try {
    assert.equal(moved.environment.installation.packages[0].integrity, secondIntegrity)
    const updated = JSON.parse(await readFile(join(project, moved.environmentLock.file), 'utf8'))
    assert.equal(updated.packages['node_modules/' + name].resolved, manifest.dependencies[name])
  } finally {
    await moved.dispose()
  }
})
