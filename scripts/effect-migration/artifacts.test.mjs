import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeMigrationArtifact } from './artifacts.mjs'

test('creates native TS once and refuses a later generator overwrite, including empty files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'effect-migration-authority-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const source = join(dir, 'effect.generated.ts')
  await writeMigrationArtifact(source, 'export const heal = 3\n')
  await writeMigrationArtifact(source, 'export const heal = 3\n')
  await writeFile(source, 'export const heal = 7\n')
  await assert.rejects(writeMigrationArtifact(source, 'export const heal = 3\n'), /refuses to overwrite/)
  assert.equal(await readFile(source, 'utf8'), 'export const heal = 7\n')
  await writeFile(source, '')
  await assert.rejects(writeMigrationArtifact(source, 'export const heal = 3\n'), /refuses to overwrite/)
  assert.equal(await readFile(source, 'utf8'), '')
})

test('check mode never creates or repairs source or metadata', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'effect-migration-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const file of ['effect.generated.ts', 'ledger.json']) {
    const path = join(dir, file)
    await assert.rejects(writeMigrationArtifact(path, 'generated', { check: true }), { code: 'ENOENT' })
    await assert.rejects(readFile(path), { code: 'ENOENT' })
    await writeFile(path, 'manual')
    await assert.rejects(writeMigrationArtifact(path, 'generated', { check: true }), /Generated drift/)
    assert.equal(await readFile(path, 'utf8'), 'manual')
    await writeMigrationArtifact(path, 'manual', { check: true })
  }
})

test('explicit metadata generation remains available without changing native authority', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'effect-migration-metadata-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'ledger.json')
  await writeMigrationArtifact(path, '{"revision":1}')
  await writeMigrationArtifact(path, '{"revision":2}')
  assert.equal(await readFile(path, 'utf8'), '{"revision":2}')
})

test('the actual skill-power command preserves edited TS and its ledger on a rejected rerun', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'effect-migration-command-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'packs/base/data'), { recursive: true })
  for (const kind of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const relative = `packs/base/data/effect_${kind}.yaml`
    await copyFile(relative, join(dir, relative))
  }
  await mkdir(join(dir, 'packs/base/src/effects'), { recursive: true })
  await mkdir(join(dir, 'docs/v4/validation'), { recursive: true })
  const source = join(dir, 'packs/base/src/effects/skill-power.generated.ts')
  const ledger = join(dir, 'docs/v4/validation/skill-power-candidates.json')
  await writeFile(source, '// reviewed manual repair\n')
  await writeFile(ledger, '{"reviewed":true}\n')
  await assert.rejects(
    promisify(execFile)(process.execPath, [resolve('scripts/effect-migration/skill-power.mjs')], { cwd: dir }),
    error => error.code === 1 && /TypeScript owns behavior.*refuses to overwrite/s.test(error.stderr),
  )
  assert.equal(await readFile(source, 'utf8'), '// reviewed manual repair\n')
  assert.equal(await readFile(ledger, 'utf8'), '{"reviewed":true}\n')
})
