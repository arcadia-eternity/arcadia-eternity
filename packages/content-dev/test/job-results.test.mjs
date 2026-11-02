import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthorJobs } from '../src/jobs.mjs'
import { JobJournal } from '../src/job-journal.mjs'

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'author-job-results-'))
  const workspace = new EventEmitter()
  workspace.root = root
  workspace.revisionCalls = 0
  workspace.revision = async () => {
    workspace.revisionCalls++
    return 'revision'
  }
  workspace.snapshot = async () => ({ diagnostics: [] })
  const jobs = new AuthorJobs(workspace, options)
  const journal = new JobJournal(root)
  await jobs.initialize()
  t.after(async () => {
    await jobs.close()
    await rm(root, { recursive: true, force: true })
  })
  return { root, workspace, jobs, journal }
}
function receipt(overrides = {}) {
  return {
    jobId: randomUUID(),
    kind: 'test',
    state: 'succeeded',
    stale: false,
    sourceRevision: 'revision',
    contentRevision: 'revision',
    environmentId: 'default',
    createdAt: Date.now(),
    diagnostics: [],
    output: '',
    outputCursor: 0,
    ...overrides,
  }
}

test('reconnected sessions discover paginated compact jobs and retain candidate identity', async t => {
  const { jobs, journal } = await fixture(t)
  const first = receipt({
    kind: 'preview',
    output: 'old log\n'.repeat(10000),
    diagnostics: Array.from({ length: 101 }, (_, index) => ({ code: 'TEST', message: `failure ${index}` })),
    result: {
      candidate: { packageName: 'example', integrity: 'sha512-example', build: 'build-id', sdkApi: 2 },
      preview: { endpoint: 'http://127.0.0.1:12345/private', clientPath: '/preview', url: 'http://example/preview' },
      environmentLock: { file: 'debug/environments/test.package-lock.json', version: 'lock' },
      sourceRevisions: { '@example/dependency': 'revision' },
      files: Array.from({ length: 5000 }, (_, index) => `file-${index}`),
      unbounded: 'x'.repeat(50000),
    },
  })
  const second = receipt({ createdAt: first.createdAt + 1 })
  await journal.save(first, true)
  await journal.save(second, false)
  const listed = await jobs.queryJobs({ limit: 1 })
  assert.equal(listed.total, 2)
  assert.equal(listed.nextOffset, 1)
  assert.equal(listed.items[0].jobId, second.jobId)
  assert.equal('output' in listed.items[0], false)
  assert.equal('result' in listed.items[0], false)
  assert.ok(JSON.stringify(listed).length < 2000)
  const filtered = await jobs.queryJobs({ kind: 'preview', state: 'succeeded' })
  assert.equal(filtered.items[0].jobId, first.jobId)
  assert.equal(filtered.nextOffset, null)
  const details = await jobs.queryJob({ jobId: first.jobId })
  assert.equal('output' in details, false)
  assert.equal(details.diagnosticCount, 101)
  assert.equal(details.diagnostics.length, 100)
  assert.equal(details.diagnosticsTruncated, true)
  assert.deepEqual(details.result.candidate, first.result.candidate)
  assert.deepEqual(details.result.preview, first.result.preview)
  assert.equal(details.result.fileCount, 5000)
  assert.equal('files' in details.result, false)
  assert.equal('unbounded' in details.result, false)
  // Existing consumers retain the original full receipt interface.
  assert.equal(jobs.get(first.jobId).output, first.output)
  assert.equal(jobs.list()[1].result.files.length, 5000)
})

test('log cursors remain monotonic after truncation and reconnect without duplicate output', async t => {
  const { jobs, journal } = await fixture(t)
  const job = receipt({ output: 'abcdefghij', outputCursor: 110 })
  await journal.save(job, false)
  const first = await jobs.readJobOutput({ jobId: job.jobId, cursor: 0, limit: 4 })
  assert.deepEqual(first, {
    jobId: job.jobId,
    text: 'abcd',
    cursor: 100,
    nextCursor: 104,
    endCursor: 110,
    truncated: true,
    hasMore: true,
    unit: 'utf16',
  })
  const second = await jobs.readJobOutput({ jobId: job.jobId, cursor: first.nextCursor, limit: 4 })
  assert.equal(second.text, 'efgh')
  assert.equal(second.truncated, false)
  await journal.save({ ...job, output: 'fghijklmno', outputCursor: 115 }, false)
  const third = await jobs.queryJob({ jobId: job.jobId, includeOutput: true, afterCursor: second.nextCursor, limit: 4 })
  assert.equal(third.output.text, 'ijkl')
  assert.equal(third.output.nextCursor, 112)
  const last = await jobs.readJobOutput({ jobId: job.jobId, cursor: 112 })
  assert.equal(last.text, 'mno')
  assert.equal(last.hasMore, false)
  assert.equal((await jobs.readJobOutput({ jobId: job.jobId, cursor: last.nextCursor })).text, '')
  await assert.rejects(jobs.readJobOutput({ jobId: job.jobId, cursor: 116 }), { code: 'TASK_QUERY_INVALID' })
})

test('legacy receipts start their log cursor at zero', async t => {
  const { jobs, journal } = await fixture(t)
  const job = receipt({ output: 'old output' })
  delete job.outputCursor
  await journal.save(job, false)
  const result = await jobs.readJobOutput({ jobId: job.jobId, limit: 3 })
  assert.equal(result.cursor, 0)
  assert.equal(result.nextCursor, 3)
  assert.equal(result.endCursor, 10)
  assert.equal(result.text, 'old')
})

test('waiting observes peer progress without repeatedly hashing the source tree', async t => {
  const { jobs, journal, workspace } = await fixture(t)
  const job = receipt({ state: 'running', output: 'start', outputCursor: 5 })
  await journal.save(job, false)
  workspace.revisionCalls = 0
  const pending = jobs.queryJob({ jobId: job.jobId, waitMs: 1000, afterCursor: 5 })
  await new Promise(resolve => setTimeout(resolve, 50))
  await journal.save({ ...job, output: 'start done', outputCursor: 10 }, false)
  const result = await pending
  assert.equal(result.outputCursor, 10)
  assert.equal(result.state, 'running')
  assert.equal(workspace.revisionCalls, 2)
  assert.equal('output' in result, false)
  const started = Date.now()
  const immediate = await jobs.queryJob({ jobId: job.jobId, waitMs: 1000, afterCursor: 5 })
  assert.equal(immediate.outputCursor, 10)
  assert.ok(Date.now() - started < 500)
})

test('wait duration is bounded and closing wakes a pending reader', async t => {
  const { jobs, journal } = await fixture(t)
  const job = receipt({ state: 'running' })
  await journal.save(job, false)
  let started = Date.now()
  const unchanged = await jobs.queryJob({ jobId: job.jobId, waitMs: 40 })
  assert.equal(unchanged.state, 'running')
  assert.ok(Date.now() - started >= 30)
  assert.ok(Date.now() - started < 1000)
  started = Date.now()
  const pending = jobs.queryJob({ jobId: job.jobId, waitMs: 10000 })
  await new Promise(resolve => setTimeout(resolve, 30))
  await jobs.close()
  await pending
  assert.ok(Date.now() - started < 1000)
  await assert.rejects(jobs.queryJob({ jobId: job.jobId, waitMs: 10001 }), { code: 'TASK_QUERY_INVALID' })
  await assert.rejects(jobs.queryJobs({ limit: 101 }), { code: 'TASK_QUERY_INVALID' })
})

test('real child output records an absolute cursor across the retained log limit', async t => {
  const { root, workspace, jobs: unused } = await fixture(t)
  await unused.close()
  const executable = join(root, 'output.mjs')
  await writeFile(executable, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(1024 * 1024 + 20) + 'END')\n`)
  await chmod(executable, 0o755)
  const jobs = new AuthorJobs(workspace, { executable })
  await jobs.initialize()
  t.after(() => jobs.close())
  let job = await jobs.start({ kind: 'check' })
  while (['queued', 'running'].includes(job.state)) job = await jobs.queryJob({ jobId: job.jobId, waitMs: 1000 })
  assert.equal(job.state, 'succeeded')
  assert.equal(job.outputCursor, 1024 * 1024 + 23)
  assert.equal(job.outputStartCursor, 23)
  const tail = await jobs.readJobOutput({ jobId: job.jobId, cursor: job.outputCursor - 3 })
  assert.equal(tail.text, 'END')
  assert.equal(tail.truncated, false)
  assert.equal(jobs.get(job.jobId).output.length, 1024 * 1024)
})

test('incremental decoding preserves Unicode split across child output chunks', async t => {
  const { root, workspace, jobs: unused } = await fixture(t)
  await unused.close()
  const executable = join(root, 'unicode.mjs')
  await writeFile(
    executable,
    `#!${process.execPath}\nfor (const byte of Buffer.from('开始🙂结束')) { process.stdout.write(Buffer.from([byte])); await new Promise(resolve => setTimeout(resolve, 2)) }\n`,
  )
  await chmod(executable, 0o755)
  const jobs = new AuthorJobs(workspace, { executable })
  await jobs.initialize()
  t.after(() => jobs.close())
  let job = await jobs.start({ kind: 'check' })
  while (['queued', 'running'].includes(job.state)) job = await jobs.queryJob({ jobId: job.jobId, waitMs: 1000 })
  const output = await jobs.readJobOutput({ jobId: job.jobId })
  assert.equal(output.text, '开始🙂结束')
  assert.equal(output.nextCursor, 6)
  assert.equal(job.phase, 'finished')
})
