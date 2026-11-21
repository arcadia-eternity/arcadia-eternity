import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { jobKind, outputSchemas } from '../src/mcp-contracts.ts'

const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

test('CLI inventories project and Desktop commands from an empty directory', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'arcadia-command-discovery-'))
  t.after(() => rm(cwd, { force: true, recursive: true }))
  const run = (...args) => exec(process.execPath, [cli, ...args], { cwd })
  const [{ stdout }, help] = await Promise.all([run('commands', '--json'), run('--help')])
  const { schemaVersion, sdkVersion, commands, workspace } = JSON.parse(stdout)
  assert.equal(schemaVersion, 1)
  assert.equal(sdkVersion, createRequire(import.meta.url)('../package.json').version)
  const byName = new Map(commands.map(command => [command.name, command]))
  assert.equal(byName.size, commands.length)
  assert.match(byName.get('init').arguments, /pack\|environment/)
  assert.equal(byName.get('demo').target, 'project')
  assert.equal(byName.get('desktop instances').target, 'desktop')
  for (const library of ['environments', 'packages']) {
    assert.equal(byName.get(`desktop ${library} list`).target, 'desktop')
    assert.match(byName.get(`desktop ${library} install`).arguments, /--allow-download/)
  }
  for (const command of commands) {
    assert.ok(help.stdout.includes([command.name, command.arguments].filter(Boolean).join(' ')))
  }
  assert.deepEqual(
    workspace.jobs.map(job => job.name),
    jobKind.options,
  )
  const demo = workspace.jobs.find(job => job.name === 'demo')
  assert.equal(demo.requiresExecute, true)
  assert.deepEqual(demo.projectKinds, ['pack', 'environment'])
  assert.ok(demo.options.includes('--seed <seed>'))
  assert.deepEqual(workspace.jobs.find(job => job.name === 'release').projectKinds, ['pack'])
  assert.equal(workspace.jobs.find(job => job.name === 'check').requiresExecute, false)
  for (const operation of [...Object.keys(outputSchemas), 'snapshot', 'job', 'jobs', 'cancel'])
    assert.ok(workspace.operations.includes(operation), operation)
  assert.deepEqual(
    workspace.previewOperations.find(operation => operation.name === 'team-validate'),
    {
      name: 'team-validate',
      requiresExecute: false,
    },
  )
  assert.deepEqual(await readdir(cwd), [])
  await assert.rejects(run('commands', '--json', '--typo'), error => /Usage:/.test(error.stderr))
})
