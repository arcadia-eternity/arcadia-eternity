import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, symlink, readFile, readdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthorWorkspace } from '../src/workspace.mjs'
import { AuthorWorkspaces } from '../../web-ui/electron/author-workspaces.mjs'

test('install resolves project-owned successful receipts and captures verified archive bytes', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'built-receipt-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bytes = Buffer.from('actual source archive bytes')
  const result = {
    filename: 'built.tgz',
    shasum: createHash('sha1').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  }
  const file = join(root, result.filename)
  await writeFile(file, bytes)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@example/test' }))
  const workspace = new AuthorWorkspace(root)
  let job = { jobId: 'owned', kind: 'pack', state: 'succeeded', result }
  let refreshes = 0
  const jobs = {
    refresh: async () => {
      refreshes++
    },
    get: id => {
      if (id !== 'owned') throw new Error('unknown job')
      return job
    },
  }
  const manager = new AuthorWorkspaces({ root: join(root, 'app') })
  manager.session = async id => {
    if (id !== 'project') throw new Error('unknown project')
    return { workspace, jobs }
  }
  let installs = 0
  const install = async captured => {
    installs++
    assert.notEqual(captured, file)
    await writeFile(file, 'changed after capture')
    assert.deepEqual(await readFile(captured), bytes)
    return 'package@1.0.0'
  }
  assert.deepEqual(await manager.installBuiltPack('project', 'owned', install), { packageId: 'package@1.0.0' })
  assert.equal(refreshes, 1)
  assert.deepEqual(await readdir(join(root, 'app/state')), [])
  await assert.rejects(manager.installBuiltPack('other', 'owned', install), /unknown project/)
  await assert.rejects(manager.installBuiltPack('project', 'foreign-job', install), /unknown job/)
  for (const patch of [
    { kind: 'preview' },
    { state: 'running' },
    { state: 'failed' },
    { result: { ...result, filename: '../built.tgz' } },
  ]) {
    job = { jobId: 'owned', kind: 'pack', state: 'succeeded', result, ...patch }
    await assert.rejects(manager.installBuiltPack('project', 'owned', install))
  }
  job = { jobId: 'owned', kind: 'pack', state: 'succeeded', result }
  await assert.rejects(manager.installBuiltPack('project', 'owned', install), /已改变/)
  await rm(file)
  await writeFile(join(root, 'other.tgz'), bytes)
  await symlink(join(root, 'other.tgz'), file)
  await assert.rejects(manager.installBuiltPack('project', 'owned', install), { code: 'PATH_INVALID' })
  await rm(file)
  await writeFile(file, bytes)
  const duplicate = Object.assign(new Error('同名同版本已安装'), { code: 'ALREADY_INSTALLED' })
  await assert.rejects(
    manager.installBuiltPack('project', 'owned', async () => {
      throw duplicate
    }),
    error => error === duplicate,
  )
  assert.equal(installs, 1)
  assert.deepEqual(await readdir(join(root, 'app/state')), [])
})
