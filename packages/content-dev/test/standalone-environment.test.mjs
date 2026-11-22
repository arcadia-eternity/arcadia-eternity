import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const mcp = fileURLToPath(new URL('../src/mcp.ts', import.meta.url))
const baseName = '@arcadia-eternity/data-pack-base'

function outputResult(output) {
  const marker = 'ARCADIA_RESULT='
  const line = output
    .split('\n')
    .filter(line => line.startsWith(marker))
    .at(-1)
  assert.ok(line, output)
  return JSON.parse(line.slice(marker.length))
}

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'arcadia-environment-author-'))
  const directory = join(temporary, 'local-cup')
  const client = new Client({ name: 'environment-author-test', version: '1' })
  t.after(async () => {
    try {
      await client.close()
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  })
  const env = {
    npm_config_offline: 'true',
    npm_config_cache: join(temporary, 'cache'),
    ...(process.env.CHOKIDAR_USEPOLLING && { CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING }),
  }
  await exec(process.execPath, [cli, 'init', 'environment', directory], { env: { ...process.env, ...env } })
  const runAt = async (cwd, ...args) =>
    (await exec(process.execPath, [cli, ...args], { cwd, env: { ...process.env, ...env } })).stdout
  // The environment is declarative. Existing pack preview code imports this file to choose teams.
  await writeFile(join(directory, 'arcadia.config.mjs'), 'throw new Error("package author config executed")\n')
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  assert.equal(manifest.arcadia, undefined)
  assert.deepEqual(Object.keys(manifest.dependencies), [baseName])
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [mcp, directory, '--execute'], env, stderr: 'pipe' }),
  )
  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args })
    assert.notEqual(result.isError, true, JSON.stringify(result.content))
    return result.structuredContent.result
  }
  const wait = async ({ jobId }) => {
    let job
    do {
      job = await call('job_get', { jobId, waitMs: 1000 })
    } while (job.state === 'queued' || job.state === 'running')
    if (job.state !== 'succeeded')
      assert.fail((await call('job_output', { jobId })).text + JSON.stringify(job.diagnostics))
    return job
  }
  return {
    directory,
    client,
    call,
    wait,
    run: (...args) => runAt(directory, ...args),
    runAt,
    id: manifest.arcadiaEnvironment.id,
  }
}

test(
  'a CLI-created environment runs its own seeded demo through CLI and MCP without a content project',
  { timeout: 120000 },
  async t => {
    const { directory, id, run, call, wait } = await fixture(t)
    await mkdir(join(directory, 'test'), { recursive: true })
    await writeFile(join(directory, 'test/guard.test.mjs'), 'throw new Error("project test executed by check")\n')
    await run('check')
    const seed = 'cup-rematch'
    const demo = outputResult(await run('demo', '--seed', seed))
    assert.equal(demo.seed, seed)
    assert.equal(demo.candidate.kind, 'environment')
    assert.equal(demo.candidate.environmentId, id)
    assert.deepEqual(
      demo.candidate.members.map(member => member.name),
      [baseName],
    )
    assert.ok(demo.turns > 0)
    const { result, stale } = await wait(await call('demo_start', { seed }))
    assert.equal(stale, false)
    assert.equal(result.seed, seed)
    assert.equal(result.candidate.environmentRevision, demo.candidate.environmentRevision)
    assert.equal(result.turns, demo.turns)
    assert.equal(result.winner, demo.winner)
  },
)

test('an environment can debug a locally packed CLI project as its only dependency', { timeout: 120000 }, async t => {
  const { directory, id, run, runAt, call } = await fixture(t)
  const pack = join(dirname(directory), 'my-creatures')
  await run('init', 'pack', pack)
  const built = outputResult(await runAt(pack, 'pack'))
  const manifest = JSON.parse(await readFile(join(pack, 'package.json'), 'utf8'))
  await mkdir(join(directory, 'candidates'))
  await copyFile(join(pack, built.filename), join(directory, 'candidates/creatures.tgz'))
  const { version, ...document } = (await call('environment_list')).items.find(item => item.id === id)
  await call('environment_save', {
    document: {
      ...document,
      packages: { [manifest.name]: 'file:candidates/creatures.tgz' },
      rules: { schemaVersion: 2, mechanics: { teamSelection: { enabled: true, minTeamSize: 1, maxTeamSize: 1 } } },
    },
    expectedVersion: version,
  })
  for (const file of ['blue.yaml', 'orange.yaml']) {
    await copyFile(join(pack, 'debug/teams', file), join(directory, 'debug/teams', file))
  }
  const demo = outputResult(await run('demo', '--seed', 'custom-only'))
  assert.deepEqual(demo.candidate.members, [{ name: manifest.name, version: manifest.version }])
  assert.equal(demo.candidate.environmentId, id)
  assert.ok(demo.turns > 0)
})

test('an MCP preview enforces the saved environment rules on isolated battles', { timeout: 120000 }, async t => {
  const { id, client, call, wait } = await fixture(t)
  const saved = (await call('environment_list')).items.find(item => item.id === id)
  assert.ok(saved)
  const { version, ...document } = saved
  const edited = await call('environment_save', {
    expectedVersion: version,
    document: { ...document, rules: { schemaVersion: 1, team: { maxSize: 1 } } },
  })
  const preview = await wait(await call('preview_start'))
  assert.equal(preview.stale, false)
  assert.equal(preview.result.candidate.environmentConfigVersion, edited.version)
  const { jobId } = preview
  const blue = (await call('team_list')).items.find(team => team.id === 'blue')
  await call('team_save', {
    expectedVersion: null,
    document: { schemaVersion: 1, id: 'oversize', name: 'Two pets', team: [blue.team[0], blue.team[0]] },
  })
  const invalid = await call('team_validate', { jobId, teamId: 'oversize' })
  assert.equal(invalid.valid, false)
  assert.equal(invalid.diagnostic.code, 'ENVIRONMENT_TEAM_REJECTED')
  assert.equal(invalid.environmentRevision, preview.result.candidate.environmentRevision)
  const valid = await call('team_validate', { jobId, teamId: 'blue' })
  assert.equal(valid.valid, true)
  assert.equal(valid.teamVersion, blue.version)
  const rejected = await client.callTool({
    name: 'battle_create',
    arguments: { jobId, teamIds: ['oversize', 'orange'], seed: 'cup' },
  })
  assert.equal(rejected.isError, true)
  assert.match(rejected.content[0].text, /ENVIRONMENT_TEAM_REJECTED/)
  const battle = await call('battle_create', { jobId, teamIds: ['blue', 'orange'], seed: 'cup' })
  assert.equal(battle.seed, 'cup')
  assert.equal(battle.stateCurrent, true)
  const advanced = await call('battle_action', {
    jobId,
    sessionId: battle.sessionId,
    expectedRevision: battle.revision,
    selection: battle.selections[0],
  })
  assert.equal(advanced.revision, battle.revision + 1)
  await call('battle_close', { jobId, sessionId: battle.sessionId, expectedRevision: advanced.revision })
  await call('job_cancel', { jobId })
})
