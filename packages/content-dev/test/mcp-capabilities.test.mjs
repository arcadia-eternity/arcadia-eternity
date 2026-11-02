import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { JobJournal } from '../src/job-journal.mjs'
import { AuthorWorkspaces } from '../../web-ui/electron/author-workspaces.mjs'
import * as api from '../src/author-api.mjs'

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-mcp-capabilities-'))
  const root = join(temporary, 'project')
  for (const directory of ['data/skills', 'data/resources', 'locales/zh-CN', 'assets'])
    await mkdir(join(root, directory), { recursive: true })
  const json = (file, value) => writeFile(join(root, file), JSON.stringify(value))
  await json('package.json', {
    name: 'mcp-capabilities',
    arcadia: { projectId: 'capabilities', namespace: 'capabilities', sdkApi: 2 },
  })
  await json('data/skills/hit.json', { id: 'hit', power: 40 })
  await json('locales/zh-CN/skill.json', { hit: { name: '测试攻击' }, second: { name: '第二项' } })
  await json('data/resources/image.json', { id: 'icon', kind: 'image', source: 'assets/icon.png' })
  await writeFile(
    join(root, 'assets/icon.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH2kAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  t.after(() => rm(temporary, { recursive: true, force: true }))
  return { temporary, root, json }
}
async function connect(t, root, flags = []) {
  const client = new Client({ name: 'capabilities-test', version: '1' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url)), root, ...flags],
      stderr: 'pipe',
    }),
  )
  t.after(() => client.close())
  const call = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args })
    assert.notEqual(response.isError, true, JSON.stringify(response))
    return response.structuredContent.result
  }
  return { client, call }
}

test('MCP exposes typed discovery, shared team/environment saves and native image content', async t => {
  const { root } = await fixture(t)
  const { client, call } = await connect(t, root, ['--execute'])
  const listed = (await client.listTools()).tools
  assert.ok(listed.some(tool => tool.name === 'battle_create'))
  assert.equal(
    listed.find(tool => tool.name === 'job_get').outputSchema.properties.result.properties.jobId.type,
    'string',
  )
  const summary = await call('content_query', { search: '测试攻击', contentKind: 'skills' })
  assert.equal(summary.items[0].id, 'hit')
  assert.equal(summary.items[0].record, undefined)
  const full = await call('content_query', { id: 'hit', detail: 'full' })
  assert.equal(full.items[0].record.power, 40)
  const locale = await call('content_query', { kind: 'locales', limit: 1 })
  assert.equal(locale.items.length, 1)
  assert.equal(locale.nextOffset, 1)
  const reference = await call('author_reference', { topic: 'team' })
  assert.equal(reference.schema.properties.schemaVersion.const, 1)
  const resources = await client.listResources()
  assert.ok(resources.resources.some(resource => resource.uri === 'arcadia://authoring/effects'))
  const referenceResource = await client.readResource({ uri: 'arcadia://authoring/effects' })
  assert.equal(JSON.parse(referenceResource.contents[0].text).topic, 'effects')
  const image = await client.callTool({ name: 'asset_inspect', arguments: { id: 'icon', includeImage: true } })
  assert.notEqual(image.isError, true, JSON.stringify(image))
  assert.equal(image.content[1].type, 'image')
  assert.equal(image.structuredContent.result.metadata.width, 1)
  assert.equal(image.structuredContent.result.image, undefined)
  const team = { schemaVersion: 1, id: 'blue', name: 'Blue', team: [] }
  const saved = await call('team_save', { document: team, expectedVersion: null })
  assert.equal((await call('team_list')).items[0].version, saved.version)
  const stale = await client.callTool({
    name: 'team_save',
    arguments: { document: { ...team, name: 'Wrong' }, expectedVersion: null },
  })
  assert.equal(stale.isError, true)
  const environment = { schemaVersion: 1, id: 'interaction', name: 'Interaction', packages: {}, sources: [] }
  const env = await call('environment_save', { document: environment, expectedVersion: null })
  assert.equal((await call('environment_list')).items.find(item => item.id === 'interaction').version, env.version)
  await call('team_remove', { id: team.id, expectedVersion: saved.version })
  assert.equal((await call('team_list')).items.length, 0)
})

test('MCP reconnect discovers retained jobs without repeating log payloads', async t => {
  const { root } = await fixture(t)
  const journal = new JobJournal(root)
  const jobId = randomUUID()
  const session = await api.openAuthorSession(root, { watch: false })
  const sourceRevision = await session.workspace.revision()
  await session.close()
  await journal.save(
    {
      jobId,
      kind: 'check',
      state: 'succeeded',
      stale: false,
      sourceRevision,
      createdAt: Date.now(),
      diagnostics: [],
      output: 'hello world',
      outputCursor: 11,
    },
    false,
  )
  const { call } = await connect(t, root)
  const jobs = await call('job_list')
  assert.equal(jobs.items[0].jobId, jobId)
  assert.equal(jobs.items[0].output, undefined)
  assert.equal((await call('job_get', { jobId })).output, undefined)
  const first = await call('job_output', { jobId, limit: 5 })
  const second = await call('job_output', { jobId, cursor: first.nextCursor })
  assert.equal(first.text + second.text, 'hello world')
  assert.equal((await call('job_get', { jobId, includeOutput: true, afterCursor: 6 })).output.text, 'world')
})

test('MCP changes notify the open desktop workspace and never overwrite its dirty content', async t => {
  const { temporary, root } = await fixture(t)
  const events = []
  const manager = new AuthorWorkspaces({
    root: join(temporary, 'desktop'),
    api: async () => api,
    notify: event => events.push(event),
  })
  t.after(() => manager.close())
  const entry = await manager.add(root)
  await manager.session(entry.id)
  const { client, call } = await connect(t, root, ['--context-file', manager.contextFile(entry.id)])
  const source = await call('source_read', { file: 'data/skills/hit.json' })
  await manager.setContext(entry.id, {
    drafts: [{ file: source.file, expectedVersion: source.version, value: { id: 'hit', power: 90 } }],
  })
  await call('source_apply', { file: source.file, expectedVersion: source.version, text: '{"id":"hit","power":50}' })
  assert.equal(JSON.parse(await readFile(join(root, source.file), 'utf8')).power, 50)
  assert.equal((await call('workspace_context')).state.drafts[0].value.power, 90)
  // Disk writes leave the user's draft/base intact for desktop reconciliation.
  const stale = await client.callTool({
    name: 'source_apply',
    arguments: { file: source.file, expectedVersion: source.version, text: '{"id":"hit","power":60}' },
  })
  assert.equal(stale.isError, true)
  assert.match(stale.content[0].text, /REVISION_CONFLICT/)
  await call('team_save', { document: { schemaVersion: 1, id: 'blue', name: 'Blue', team: [] }, expectedVersion: null })
  const deadline = Date.now() + 3000
  while (
    (!events.some(event => event.file === source.file) ||
      !events.some(event => event.file === 'debug/teams/blue.yaml')) &&
    Date.now() < deadline
  )
    await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(events.some(event => event.id === entry.id && event.file === source.file))
  assert.ok(events.some(event => event.id === entry.id && event.file === 'debug/teams/blue.yaml'))
  assert.equal((await call('workspace_context')).root, await realpath(root))
})

test('read-only and non-executing MCP connections hide mutation and battle controls', async t => {
  const { root } = await fixture(t)
  const readonly = await connect(t, root, ['--read-only', '--execute'])
  const names = (await readonly.client.listTools()).tools.map(tool => tool.name)
  for (const name of [
    'team_save',
    'team_remove',
    'environment_save',
    'battle_create',
    'battle_action',
    'source_apply',
    'preview_start',
  ])
    assert.ok(!names.includes(name), name)
  assert.ok(names.includes('team_list'))
  assert.ok(names.includes('asset_inspect'))
  const ordinary = await connect(t, root)
  assert.ok(!(await ordinary.client.listTools()).tools.some(tool => tool.name.startsWith('battle_')))
})
