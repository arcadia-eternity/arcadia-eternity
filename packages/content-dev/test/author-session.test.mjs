import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSourceProject, openAuthorSession } from '../src/author-api.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

async function finish(session, kind) {
  let job = await session.jobs.start({ kind })
  while (['queued', 'running'].includes(job.state)) {
    await new Promise(resolve => setTimeout(resolve, 50))
    job = session.jobs.get(job.jobId)
  }
  return job
}
test(
  'a new source project checks, tests the actual installed package and runs a real demonstration',
  { timeout: 45000 },
  async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-author-session-')),
      root = join(temporary, '项目 with spaces')
    await createSourceProject(root, 'author-test')
    const session = await openAuthorSession(root, { watch: false, execute: true })
    t.after(async () => {
      await session.close()
      await rm(temporary, { recursive: true, force: true })
    })
    assert.equal((await session.describe()).project.sdkApi, 2)
    for (const kind of ['check', 'test', 'demo']) {
      const job = await finish(session, kind)
      assert.equal(job.state, 'succeeded', job.output)
      assert.equal(job.stale, false)
      if (kind !== 'check') {
        assert.match(job.result.candidate.integrity, /^sha512-/)
        assert.ok(job.result.candidate.build)
        assert.equal(job.result.candidate.sdkApi, 2)
      }
      if (kind === 'test') {
        assert.match(job.output, /# pass 4/)
        assert.match(job.output, /waiting-point restoration/)
      }
      if (kind === 'demo') {
        assert.match(job.output, /Environment: arcadia/)
        assert.match(job.output, /finished in \d+ turns/)
      }
    }
    const file = 'data/skills/strike.yaml',
      previous = await session.workspace.read(file)
    await session.workspace.write({
      file,
      expectedVersion: previous.version,
      text: previous.text.replace('power: 40', 'power: 41'),
    })
    assert.ok(session.jobs.list().every(job => job.stale))
    await writeFile(join(root, 'src/bad.ts'), 'const value: number = "wrong"\n')
    const failed = await finish(session, 'check')
    assert.equal(failed.state, 'failed')
    assert.ok(failed.diagnostics.some(error => error.file === 'src/bad.ts' && error.line === 1))
  },
)
test('MCP uses the same file versions and diagnostics, and execution is opt-in', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-author-mcp-'))
  await mkdir(join(root, 'data/skills'), { recursive: true })
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'mcp-test', arcadia: { projectId: 'mcp-test', namespace: 'mcp-test', sdkApi: 2 } }),
  )
  await writeFile(join(root, 'data/skills/hit.json'), '{"id":"hit","power":40}')
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url)), root],
    stderr: 'pipe',
  })
  const client = new Client({ name: 'author-test-client', version: '1' })
  t.after(async () => {
    await client.close()
    await rm(root, { recursive: true, force: true })
  })
  await client.connect(transport)
  const names = (await client.listTools()).tools.map(tool => tool.name)
  assert.ok(names.includes('source_apply'))
  assert.ok(!names.includes('test_start'))
  const read = await client.callTool({ name: 'source_read', arguments: { file: 'data/skills/hit.json' } })
  const version = read.structuredContent.result.version
  const result = await client.callTool({
    name: 'source_apply',
    arguments: { file: 'data/skills/hit.json', expectedVersion: version, text: '{"id":"hit","power":70}' },
  })
  assert.equal(result.isError, undefined)
  assert.equal(JSON.parse(await readFile(join(root, 'data/skills/hit.json'), 'utf8')).power, 70)
  const stale = await client.callTool({
    name: 'source_apply',
    arguments: { file: 'data/skills/hit.json', expectedVersion: version, text: '{}' },
  })
  assert.equal(stale.isError, true)
  assert.match(stale.content[0].text, /REVISION_CONFLICT/)
  const query = await client.callTool({ name: 'content_query', arguments: { search: 'hit' } })
  assert.equal(query.structuredContent.result.items[0].record.power, 70)
  const created = await client.callTool({
    name: 'content_apply',
    arguments: {
      changes: [
        { kind: 'create-record', file: 'data/marks/shared.json', expectedVersion: null, record: { id: 'shared' } },
        {
          kind: 'locale',
          file: 'locales/en/mark.json',
          expectedVersion: null,
          id: 'shared',
          record: { name: 'Shared' },
        },
      ],
    },
  })
  assert.equal(created.isError, undefined)
  assert.equal(created.structuredContent.result.complete, true)
  assert.equal(JSON.parse(await readFile(join(root, 'locales/en/mark.json'), 'utf8')).shared.name, 'Shared')
})
