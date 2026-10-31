import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthorJobs } from '../src/jobs.mjs'
import { connectDevelopmentSdk, authorConnection } from '../src/project.mjs'
import { AuthorWorkspaces } from '../../web-ui/electron/author-workspaces.mjs'
import * as api from '../src/author-api.mjs'

test('close waits for a preparing job and prevents it from starting', async () => {
  const workspace = new EventEmitter()
  let release
  workspace.revision = () =>
    new Promise(resolve => {
      release = resolve
    })
  const jobs = new AuthorJobs(workspace)
  const starting = jobs.start({ kind: 'check' })
  const rejected = assert.rejects(starting, { code: 'WORKSPACE_CLOSED' })
  let closed = false
  const closing = jobs.close().then(() => {
    closed = true
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(closed, false)
  release('revision')
  await Promise.all([closing, rejected])
  assert.deepEqual(jobs.list(), [])
})
test('SDK parent symlinks cannot redirect writes outside a project', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'author-sdk-boundary-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  for (const parent of ['node_modules', 'node_modules/@arcadia-eternity', 'node_modules/.bin']) {
    const root = join(temporary, parent.replaceAll('/', '-'))
    const outside = root + '-outside'
    await mkdir(root)
    await mkdir(outside)
    if (parent.includes('/')) await mkdir(join(root, 'node_modules'))
    await symlink(outside, join(root, parent))
    await assert.rejects(connectDevelopmentSdk(root), { code: 'PATH_INVALID' })
    assert.deepEqual(await readdir(outside), [])
  }
})
test('MCP connection includes the desktop supplied npm runtime', () => {
  const config = authorConnection('/project', true, { ARCADIA_NPM_CLI: '/bundled/npm-cli.js' })
  assert.equal(config.mcpServers.arcadia.env.ARCADIA_NPM_CLI, '/bundled/npm-cli.js')
  assert.ok(config.mcpServers.arcadia.args.includes('--execute'))
  const readOnly = authorConnection('/base', true, {}, true)
  assert.ok(readOnly.mcpServers.arcadia.args.includes('--read-only'))
  assert.ok(!readOnly.mcpServers.arcadia.args.includes('--execute'))
})

test('base projects reject desktop asset imports, editor launches and source-writing jobs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'author-readonly-'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@arcadia-eternity/data-pack-base',
      arcadia: { projectId: 'arcadia-eternity.base', namespace: 'base' },
    }),
  )
  const manager = new AuthorWorkspaces({ root: join(root, '.arcadia'), api: async () => api })
  t.after(async () => {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  })
  const entry = await manager.add(root)
  await assert.rejects(manager.importAsset(entry.id, '/does-not-exist.png'), { code: 'WRITE_DISABLED' })
  await assert.rejects(manager.openExternal(entry.id, 'package.json', 'code'), { code: 'WRITE_DISABLED' })
  const session = await manager.session(entry.id)
  for (const kind of ['check', 'test', 'demo', 'pack'])
    await assert.rejects(session.jobs.start({ kind }), { code: 'WRITE_DISABLED' })
  assert.equal((await session.describe()).capabilities.codeExecution, false)
})
test('source export preserves dotfile configuration and its revision without dependencies', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'author-export-'))
  const root = join(temporary, 'source')
  await mkdir(join(root, '.vscode'), { recursive: true })
  await mkdir(join(root, 'node_modules'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'export', arcadia: { projectId: 'export', namespace: 'export' } }),
  )
  await writeFile(join(root, '.gitignore'), 'dist\n')
  await writeFile(join(root, '.vscode/settings.json'), '{}')
  const manager = new AuthorWorkspaces({ root: join(temporary, 'app'), api: async () => api })
  t.after(async () => {
    await manager.close()
    await rm(temporary, { recursive: true, force: true })
  })
  const entry = await manager.add(root)
  const session = await manager.session(entry.id)
  const before = await session.workspace.revision()
  await writeFile(join(root, '.vscode/settings.json'), '{"editor.tabSize":2}')
  assert.notEqual(await session.workspace.revision(), before)
  const target = join(temporary, 'export')
  await manager.export(entry.id, target)
  assert.equal(await readFile(join(target, '.gitignore'), 'utf8'), 'dist\n')
  assert.equal(await readFile(join(target, '.vscode/settings.json'), 'utf8'), '{"editor.tabSize":2}')
  assert.ok(!(await readdir(target)).includes('node_modules'))
})
