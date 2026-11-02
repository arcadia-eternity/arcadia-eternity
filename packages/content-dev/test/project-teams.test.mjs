import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthorWorkspace } from '../src/workspace.mjs'
import { ProjectTeams } from '../src/project-teams.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-project-teams-'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'teams', arcadia: { projectId: 'teams', namespace: 'teams' } }),
  )
  const workspace = await AuthorWorkspace.open(root, { watch: false })
  t.after(async () => {
    await workspace.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, workspace, teams: new ProjectTeams(workspace) }
}
test('portable teams keep stable identity, isolate content revisions and reject external-save/delete conflicts', async t => {
  const { root, workspace, teams } = await fixture(t)
  const contentBefore = await workspace.revision({ contentOnly: true }),
    before = await workspace.revision()
  const document = { schemaVersion: 1, id: 'blue', name: '蓝队', team: [] }
  const first = await teams.save({ document, expectedVersion: null })
  assert.equal(await workspace.revision({ contentOnly: true }), contentBefore)
  assert.notEqual(await workspace.revision(), before)
  assert.deepEqual(await teams.list(), [first])
  assert.equal((await teams.save({ document, expectedVersion: first.version })).version, first.version)
  const file = join(root, 'debug/teams/blue.yaml')
  await writeFile(file, (await readFile(file, 'utf8')).replace('蓝队', 'Git 新队'))
  await assert.rejects(teams.save({ document: { ...document, name: '草稿' }, expectedVersion: first.version }), {
    code: 'REVISION_CONFLICT',
  })
  await assert.rejects(teams.remove({ id: 'blue', expectedVersion: first.version }), { code: 'REVISION_CONFLICT' })
  assert.match(await readFile(file, 'utf8'), /Git 新队/)
  await teams.remove({ id: 'blue', expectedVersion: (await teams.list())[0].version })
  assert.deepEqual(await teams.list(), [])
})
test('team operations reject arbitrary paths, runtime fields, symlinks and read-only projects', async t => {
  const { root, workspace, teams } = await fixture(t)
  const document = { schemaVersion: 1, id: 'blue', name: '蓝队', team: [] }
  await assert.rejects(teams.save({ document: { ...document, id: '../../bad' }, expectedVersion: null }))
  await assert.rejects(teams.save({ document: { ...document, absolutePath: '/tmp' }, expectedVersion: null }))
  await assert.rejects(teams.save({ document: { ...document, team: [{ id: '0'.repeat(21) }] }, expectedVersion: null }))
  workspace.readOnly = true
  await assert.rejects(teams.save({ document, expectedVersion: null }), { code: 'WRITE_DISABLED' })
  workspace.readOnly = false
  await mkdir(join(root, 'outside'))
  await symlink(join(root, 'outside'), join(root, 'debug'))
  await assert.rejects(teams.save({ document, expectedVersion: null }), { code: 'PATH_INVALID' })
})
