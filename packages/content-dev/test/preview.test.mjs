import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSourceProject, openAuthorSession } from '../src/author-api.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { JobJournal } from '../src/job-journal.mjs'

async function finish(session, kind) {
  let job = await session.jobs.start({ kind })
  while (['queued', 'running'].includes(job.state)) {
    await new Promise(resolve => setTimeout(resolve, 50))
    job = session.jobs.get(job.jobId)
  }
  assert.equal(job.state, 'succeeded', JSON.stringify(job))
  return job
}
const command = async (endpoint, method, ...args) => {
  const response = await fetch(`${endpoint}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
  })
  const data = await response.json()
  assert.equal(response.status, 200, JSON.stringify(data))
  return data.result
}

test('cross-entry reads tolerate concurrently pruned history and retain live candidates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-preview-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const journal = new JobJournal(root),
    activeId = randomUUID(),
    completed = []
  await journal.save({ jobId: activeId, createdAt: 1, state: 'succeeded', diagnostics: [] }, true)
  for (let i = 0; i < 60; i++) {
    const id = randomUUID()
    completed.push(id)
    await journal.save({ jobId: id, createdAt: i + 2, state: 'succeeded', diagnostics: [] }, false)
  }
  const [records] = await Promise.all([journal.read(), Promise.all(completed.map(id => journal.remove(id)))])
  assert.ok(records.some(receipt => receipt.job.jobId === activeId && receipt.live))
})

test(
  'captured preview survives source edits and failed/cancelled candidates, serves media, and completes a real battle',
  { timeout: 120000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-preview-'))
    const project = join(root, 'project')
    await createSourceProject(project, 'preview-test')
    const session = await openAuthorSession(project, { execute: true, watch: false })
    t.after(async () => {
      await session.close()
      await rm(root, { recursive: true, force: true })
    })
    const first = await finish(session, 'preview')
    const endpoint = first.result.preview.endpoint
    const catalog = await (await fetch(`${endpoint}/content`)).json()
    assert.equal(catalog.candidate.integrity, first.result.candidate.integrity)
    assert.equal(catalog.content.skills[0].effect, undefined)
    const image = await fetch(catalog.content.species[0].presentation.icon)
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('cache-control'), 'no-store')
    assert.ok((await image.arrayBuffer()).byteLength > 0)
    assert.equal((await fetch(endpoint.replace(/\/[a-f0-9]{48}$/, '/bad') + '/content')).status, 403)
    const opened = await command(endpoint, 'open')
    const player = opened.state.players[0].id
    await command(endpoint, 'ready')
    const original = await command(endpoint, 'getState', undefined, true)
    const file = join(project, 'src/bad.ts')
    await writeFile(file, 'const wrong: number = "broken"\n')
    let bad = await session.jobs.start({ kind: 'preview' })
    while (['queued', 'running'].includes(bad.state)) {
      await new Promise(resolve => setTimeout(resolve, 50))
      bad = session.jobs.get(bad.jobId)
    }
    assert.equal(bad.state, 'failed')
    assert.ok(bad.diagnostics.some(item => item.file === 'src/bad.ts' && item.line === 1))
    assert.deepEqual(await command(endpoint, 'getState', undefined, true), original)
    await rm(file)
    const pending = await session.jobs.start({ kind: 'preview' })
    session.jobs.cancel(pending.jobId)
    while (['queued', 'running'].includes(session.jobs.get(pending.jobId).state))
      await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(session.jobs.get(pending.jobId).state, 'cancelled')
    assert.deepEqual(await command(endpoint, 'getState', undefined, true), original)
    const skillFile = join(project, 'data/skills/strike.yaml')
    await writeFile(skillFile, (await readFile(skillFile, 'utf8')).replace('power: 40', 'power: 70'))
    const second = await finish(session, 'preview')
    const updated = await (await fetch(`${second.result.preview.endpoint}/content`)).json()
    const strike = data => data.content.skills.find(item => item.id.endsWith(':strike'))
    assert.equal(strike(catalog).power, 40)
    assert.equal(strike(updated).power, 70)
    assert.equal(strike(await (await fetch(`${endpoint}/content`)).json()).power, 40)
    let state,
      turns = 0
    do {
      const choices = await command(endpoint, 'getAvailableSelection', player)
      const choice = choices.find(item => item.type === 'use-skill') ?? choices.find(item => item.type !== 'surrender')
      if (choice) {
        await command(endpoint, 'submitAction', choice)
        turns++
      }
      await new Promise(resolve => setTimeout(resolve, 50))
      state = await command(endpoint, 'getState', undefined, true)
    } while (state.status !== 'Ended' && turns < 40)
    assert.equal(state.status, 'Ended')
    assert.ok(turns > 0 && turns < 40)
    const messages = await (await fetch(`${endpoint}/events?after=0`)).json()
    assert.ok(messages.events.length > 0)
    const reopened = await command(endpoint, 'open')
    assert.deepEqual(
      reopened.outcome,
      messages.events.findLast(event => event.message.type === 'BATTLE_END').message.data,
    )
    const teams = structuredClone(catalog.players)
    teams[0].team[0].level = 65
    teams[0].team[0].name = '独立测试首发'
    await command(endpoint, 'configure', teams)
    const configured = await command(endpoint, 'getState', undefined, true)
    assert.equal(configured.players[0].team[0].level, 65)
    assert.equal(configured.players[0].team[0].name, '独立测试首发')
    assert.deepEqual((await (await fetch(`${endpoint}/content`)).json()).players, catalog.players)
    const invalid = structuredClone(teams)
    invalid[0].team[0].species = 'missing:pet'
    await assert.rejects(command(endpoint, 'configure', invalid))
    assert.deepEqual(await command(endpoint, 'getState', undefined, true), configured)
    await command(endpoint, 'cleanup')
    await session.jobs.stopPreviews()
    assert.equal(session.jobs.hasLivePreviews, false)
    assert.equal(session.jobs.get(first.jobId).state, 'cancelled')
    assert.equal(session.jobs.get(second.jobId).state, 'cancelled')
    await assert.rejects(fetch(`${endpoint}/content`))
    await assert.rejects(fetch(`${second.result.preview.endpoint}/content`))
    session.jobs.cancel(second.jobId)
  },
)

test(
  'MCP diagnoses and repairs a source error, runs real tests, and shares its preview with CLI cancellation',
  { timeout: 120000 },
  async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-preview-mcp-')),
      root = join(temporary, 'pack')
    await createSourceProject(root, 'preview-mcp')
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url)), root, '--execute'],
      stderr: 'pipe',
    })
    const client = new Client({ name: 'preview-acceptance', version: '1' })
    const peer = await openAuthorSession(root, { execute: true, watch: false })
    t.after(async () => {
      await client.close()
      await peer.close()
      await rm(temporary, { recursive: true, force: true })
    })
    await client.connect(transport)
    const call = async (name, args = {}) => {
      const response = await client.callTool({ name, arguments: args })
      assert.notEqual(response.isError, true, JSON.stringify(response))
      return response.structuredContent.result
    }
    const wait = async job => {
      while (['queued', 'running'].includes(job.state)) {
        await new Promise(resolve => setTimeout(resolve, 100))
        job = await call('job_get', { jobId: job.jobId })
      }
      return job
    }
    await call('source_apply', { file: 'src/bad.ts', expectedVersion: null, text: 'const wrong: number = "broken"\n' })
    const broken = await wait(await call('check_start'))
    assert.equal(broken.state, 'failed')
    assert.ok(broken.diagnostics.some(item => item.file === 'src/bad.ts' && item.line === 1))
    const source = await call('source_read', { file: 'src/bad.ts' })
    await call('source_apply', {
      file: 'src/bad.ts',
      expectedVersion: source.version,
      text: 'const corrected: number = 1\n',
    })
    const checked = await wait(await call('check_start'))
    assert.equal(checked.state, 'succeeded')
    const tested = await wait(await call('test_start'))
    assert.equal(tested.state, 'succeeded', tested.output)
    assert.match(tested.output, /# pass 4/)
    const preview = await wait(await call('preview_start'))
    assert.equal(preview.state, 'succeeded', preview.output)
    assert.equal(preview.sourceRevision, tested.sourceRevision)
    assert.equal(preview.result.candidate.integrity, tested.result.candidate.integrity)
    const journal = new JobJournal(root)
    for (let i = 0; i < 31; i++)
      await journal.save({ ...checked, jobId: randomUUID(), createdAt: Date.now() + i }, false)
    const receipt = await peer.call('job', { jobId: preview.jobId })
    assert.deepEqual(receipt.result.preview, preview.result.preview)
    const cli = spawn(
      process.execPath,
      [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'workspace', root, 'cancel', '--execute'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    cli.stdin.end(JSON.stringify({ jobId: preview.jobId }))
    let stdout = ''
    cli.stdout.on('data', chunk => {
      stdout += chunk
    })
    const code = await new Promise(resolve => cli.on('exit', resolve))
    assert.equal(code, 0, stdout)
    let cancelled = preview
    for (let attempt = 0; attempt < 50 && cancelled.state !== 'cancelled'; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      cancelled = await call('job_get', { jobId: preview.jobId })
    }
    assert.equal(cancelled.state, 'cancelled')
    assert.match(await readFile(join(root, 'src/bad.ts'), 'utf8'), /corrected/)
  },
)

test('a killed CLI owner leaves an interrupted receipt and its preview child exits', { timeout: 45000 }, async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-preview-interrupted-')),
    root = join(temporary, 'pack')
  await createSourceProject(root, 'preview-interrupted')
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'workspace', root, 'preview', '--execute'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let session
  t.after(async () => {
    child.kill('SIGKILL')
    await session?.close()
    await rm(temporary, { recursive: true, force: true })
  })
  const job = await new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk
      if (output.includes('\n')) {
        try {
          resolve(JSON.parse(output.split('\n')[0]).result)
        } catch (error) {
          reject(error)
        }
      }
    })
    child.once('exit', code => {
      if (code) reject(new Error(`CLI exited: ${code}`))
    })
  })
  assert.equal(job.state, 'succeeded')
  await new Promise(resolve => setTimeout(resolve, 300))
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
  session = await openAuthorSession(root, { watch: false })
  const restored = await session.call('job', { jobId: job.jobId })
  assert.equal(restored.state, 'interrupted')
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(job.result.preview.endpoint + '/content')
    } catch {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.fail('preview child must stop after its owner disconnects')
})

test(
  'ordinary player inputs may omit IDs and a peer can stop a CLI-owned preview cleanly',
  { timeout: 45000 },
  async t => {
    const temporary = await mkdtemp(join(tmpdir(), 'arcadia-preview-cli-')),
      root = join(temporary, 'pack')
    await createSourceProject(root, 'preview-cli')
    const config = join(root, 'arcadia.config.mjs')
    await writeFile(config, (await readFile(config, 'utf8')).replace(/\s+id: String\(side\)\.repeat\(21\),/, ''))
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'workspace', root, 'preview', '--execute'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let peer,
      output = ''
    const exited = new Promise(resolve => child.once('exit', resolve))
    t.after(async () => {
      child.kill('SIGKILL')
      await peer?.close()
      await rm(temporary, { recursive: true, force: true })
    })
    const ready = await new Promise((resolve, reject) => {
      child.stdout.on('data', chunk => {
        output += chunk
        if (output.includes('\n')) {
          try {
            resolve(JSON.parse(output.split('\n')[0]).result)
          } catch (error) {
            reject(error)
          }
        }
      })
      child.once('exit', code => {
        if (code) reject(new Error(`preview owner exited: ${code}`))
      })
    })
    const opened = await command(ready.result.preview.endpoint, 'open')
    assert.ok(opened.state.players.every(player => typeof player.id === 'string' && player.id.length === 21))
    await command(ready.result.preview.endpoint, 'ready')
    peer = await openAuthorSession(root, { execute: true, watch: false })
    await peer.call('cancel', { jobId: ready.jobId })
    assert.equal(await exited, 0, output)
    assert.equal(JSON.parse(output.trim().split('\n').at(-1)).result.state, 'cancelled')
  },
)
