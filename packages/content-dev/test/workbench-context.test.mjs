import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { AuthorWorkspaces } from '../../web-ui/electron/author-workspaces.mjs'
import * as api from '../src/author-api.mjs'

test('MCP reads live focus and unsaved drafts without a selection, and rejects stale or foreign context', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'workbench-context-'))
  const root = join(temporary, 'source')
  await mkdir(join(root, 'data/skills'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'context', arcadia: { projectId: 'context', namespace: 'context' } }),
  )
  await writeFile(join(root, 'data/skills/hit.json'), JSON.stringify({ id: 'hit', power: 40 }))
  const manager = new AuthorWorkspaces({ root: join(temporary, 'app'), api: async () => api })
  const entry = await manager.add(root)
  await manager.session(entry.id)
  const config = api.authorConnection(await realpath(root), false, {}, false, manager.contextFile(entry.id)).mcpServers
    .arcadia
  const client = new Client({ name: 'context-test', version: '1' })
  t.after(async () => {
    await client.close()
    await manager.close()
    await rm(temporary, { recursive: true, force: true })
  })
  await client.connect(new StdioClientTransport({ ...config, stderr: 'pipe' }))
  const context = async () =>
    (await client.callTool({ name: 'workspace_context', arguments: {} })).structuredContent.result
  assert.equal((await context()).connected, false)
  await manager.setContext(entry.id, {
    view: { category: 'skills' },
    focus: { kind: 'skills', id: 'hit' },
    drafts: [{ value: { id: 'hit', power: 77 } }],
  })
  assert.equal((await context()).state.focus.id, 'hit')
  assert.equal((await context()).state.drafts[0].value.power, 77)
  const source = await client.callTool({ name: 'source_read', arguments: { file: 'data/skills/hit.json' } })
  assert.equal(JSON.parse(source.structuredContent.result.text).power, 40)
  await manager.setContext(entry.id, { view: { category: 'marks' }, focus: null, drafts: [] })
  assert.equal((await context()).state.view.category, 'marks')
  assert.equal((await context()).state.focus, null)
  const file = manager.contextFile(entry.id)
  const envelope = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...envelope, root: '/another-project' }))
  assert.equal((await context()).reason, 'project-mismatch')
  await writeFile(file, JSON.stringify({ ...envelope, updatedAt: Date.now() - 100000 }))
  assert.equal((await context()).reason, 'expired')
  await manager.release(entry.id)
  assert.equal((await context()).reason, 'workbench-closed')
  await assert.rejects(readFile(file), { code: 'ENOENT' })
})

test('installed content registration remains read-only after reopening a manager', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'readonly-context-'))
  const root = join(temporary, 'package')
  await mkdir(root)
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'installed', arcadia: { projectId: 'installed', namespace: 'installed' } }),
  )
  const options = { root: join(temporary, 'app'), api: async () => api }
  let manager = new AuthorWorkspaces(options)
  t.after(async () => {
    await manager.close()
    await rm(temporary, { recursive: true, force: true })
  })
  const original = await manager.add(root)
  await manager.session(original.id)
  const entry = await manager.add(root, { readOnly: true })
  assert.equal(entry.id, original.id)
  assert.equal((await manager.session(entry.id)).workspace.readOnly, true)
  await manager.close()
  manager = new AuthorWorkspaces(options)
  const session = await manager.session(entry.id)
  await assert.rejects(session.call('write', { file: 'data/skills/new.json', expectedVersion: null, text: '{}' }), {
    code: 'WRITE_DISABLED',
  })
  assert.equal((await manager.add(root)).readOnly, true)
})

test('installed browsing uses declared built rules, resources and locales and never edits generated data', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'published-context-'))
  await mkdir(join(temporary, 'dist'))
  await mkdir(join(temporary, 'data/skills'), { recursive: true })
  await mkdir(join(temporary, 'assets'))
  const json = (file, value) => writeFile(join(temporary, file), JSON.stringify(value))
  await json('package.json', {
    name: 'published',
    arcadia: {
      projectId: 'published',
      namespace: 'published',
      content: 'dist/content.json',
      presentation: 'dist/presentation.json',
    },
  })
  await json('data/skills/hit.json', { id: 'hit', power: 999 })
  await json('dist/content.json', { data: { skills: [{ id: 'hit', power: 40 }], species: [], marks: [] } })
  await writeFile(join(temporary, 'assets/hit.png'), 'image-bytes')
  await json('dist/presentation.json', {
    version: 2,
    bindings: [{ id: 'hit-view', target: { kind: 'skills', id: 'hit' }, icon: 'hit-icon' }],
    resources: [{ id: 'hit-icon', kind: 'file', source: 'assets/hit.png', mime: 'image/png' }],
    locales: { en: { skill: { hit: { name: 'Hit' } } } },
  })
  const session = await api.openAuthorSession(temporary, { published: true, watch: false })
  t.after(async () => {
    await session.close()
    await rm(temporary, { recursive: true, force: true })
  })
  const snapshot = await session.workspace.snapshot()
  assert.equal(snapshot.capabilities.sourceEditing, false)
  assert.equal(snapshot.records.find(row => row.kind === 'skills').record.power, 40)
  assert.equal(snapshot.records.find(row => row.kind === 'resources').record.kind, 'image')
  assert.equal(snapshot.localeSources[0].entries.hit.name, 'Hit')
  assert.equal(snapshot.assets[0].references[0].id, 'hit')
  assert.equal(snapshot.diagnostics.length, 0)
  assert.equal((await session.workspace.asset('assets/hit.png')).bytes.toString(), 'image-bytes')
  const source = await session.workspace.read('dist/content.json')
  await assert.rejects(session.call('write', { file: source.file, expectedVersion: source.version, text: '{}' }), {
    code: 'WRITE_DISABLED',
  })
  const editable = await api.openAuthorSession(temporary, { watch: false })
  try {
    assert.equal((await editable.workspace.snapshot()).records[0].record.power, 999)
    await assert.rejects(editable.workspace.read('dist/content.json'), { code: 'PATH_INVALID' })
  } finally {
    await editable.close()
  }
})

test('legacy base registrations become read-only without removing missing source projects', async t => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-registration-'))
  const base = join(root, 'base')
  await mkdir(base)
  await mkdir(join(root, 'app/state'), { recursive: true })
  await writeFile(
    join(base, 'package.json'),
    JSON.stringify({
      name: '@arcadia-eternity/data-pack-base',
      arcadia: { projectId: 'arcadia-eternity.base', namespace: 'base' },
    }),
  )
  const file = join(root, 'app/state/projects.json')
  await writeFile(
    file,
    JSON.stringify([
      { id: 'f5579655-65af-40fb-8e13-9e8f93a78931', name: '基础包', directory: base },
      { id: 'ba254841-a674-48e7-96ba-45dfe96ac856', name: 'Missing project', directory: join(root, 'missing') },
    ]),
  )
  const manager = new AuthorWorkspaces({ root: join(root, 'app'), api: async () => api })
  t.after(async () => {
    await manager.close()
    await rm(root, { recursive: true, force: true })
  })
  const [first, concurrent] = await Promise.all([manager.list(), manager.list()])
  assert.equal(first[0].readOnly, true)
  assert.deepEqual(first, concurrent)
  assert.equal(first[1].name, 'Missing project')
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].readOnly, true)
})
