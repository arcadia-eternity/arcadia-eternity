import { beforeAll, afterAll, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const exec = promisify(execFile)
const root = resolve(import.meta.dirname, '../../..'),
  cli = join(root, 'dist/cli.js')
let temporary: string, environment: string, digest: string
async function invoke(args: string[], code = 0) {
  let stdout = '',
    stderr = '',
    actual = 0
  try {
    ;({ stdout, stderr } = await exec(process.execPath, [cli, ...args, '--json'], {
      cwd: root,
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    }))
  } catch (error) {
    const result = error as { stdout: string; stderr: string; code: number }
    ;({ stdout, stderr } = result)
    actual = result.code
  }
  expect(actual, stderr).toBe(code)
  return JSON.parse(stdout)
}
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'arcadia-npm-cli-'))
  environment = join(temporary, 'environment')
  await mkdir(environment)
  await exec(
    process.execPath,
    [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'examples/ugc/slow/tsconfig.json')],
    { cwd: root },
  )
  const { stdout } = await exec('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
    cwd: join(root, 'examples/ugc/slow'),
  })
  const artifact = join(temporary, JSON.parse(stdout)[0].filename)
  await writeFile(
    join(environment, 'package.json'),
    JSON.stringify({
      private: true,
      name: 'example-server',
      version: '1.0.0',
      dependencies: { '@arcadia-example/slow': `file:${artifact}` },
    }),
  )
  await exec('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], {
    cwd: environment,
  })
  for (const side of [0, 1])
    await writeFile(
      join(temporary, `team-${side}.json`),
      JSON.stringify({
        id: String(side).repeat(21),
        name: `Player ${side}`,
        team: [
          {
            id: String(side + 2).repeat(21),
            name: 'Pet',
            species: 'example-slow:pet',
            level: 100,
            nature: 'Hardy',
            skills: ['example-slow:strike'],
            maxHp: 60,
            evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
            ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          },
        ],
      }),
    )
}, 60000)
afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

it('installs, inspects and requires separate explicit approval before executing a compiled TS package', async () => {
  const installed = await invoke(['content', 'npm', 'install', environment, '--offline'])
  digest = installed.digest
  expect(digest).toMatch(/^[a-f0-9]{64}$/)
  expect((await invoke(['content', 'npm', 'inspect', environment])).digest).toBe(digest)
  expect((await invoke(['content', 'validate', '--npm-project', environment], 2)).diagnostics).toHaveLength(1)
  const approved = await invoke(['content', 'npm', 'approve', environment, '--profile', 'local-development'])
  expect(approved).toEqual({ format: 'arcadia.npm-admission', version: 2, profile: 'local-development' })
  const validated = await invoke(['content', 'validate', '--npm-project', environment])
  expect(validated.valid).toBe(true)
  const admission = await readFile(join(environment, 'arcadia-admission.json'), 'utf8')
  const effects = join(environment, 'node_modules/@arcadia-example/slow/dist/effects.js')
  await writeFile(effects, (await readFile(effects, 'utf8')) + '\n// Local edit, no renewed approval required.\n')
  expect((await invoke(['content', 'validate', '--npm-project', environment])).valid).toBe(true)
  expect(await readFile(join(environment, 'arcadia-admission.json'), 'utf8')).toBe(admission)
  await invoke(['content', 'npm', 'install', environment, '--offline'], 2)
}, 60000)

it('completes an npm battle and replays only with the original separately approved environment', async () => {
  const file = join(temporary, 'replay.json')
  const result = await invoke([
    'battle',
    'simulate',
    '--npm-project',
    environment,
    '-1',
    join(temporary, 'team-0.json'),
    '-2',
    join(temporary, 'team-1.json'),
    '--seed',
    'npm-cli',
    '--replay-out',
    file,
  ])
  expect(result.counts).toEqual({ completed: 1, truncated: 0, failed: 0, cancelled: 0 })
  const saved = JSON.parse(await readFile(file, 'utf8'))
  expect(saved.environment.npm.installationDigest).toBe(digest)
  expect(JSON.stringify(saved)).not.toContain(temporary)
  expect((await invoke(['battle', 'replay', file], 3)).diagnostics[0].code).toBe('REPLAY_NPM')
  expect((await invoke(['battle', 'replay', file, '--npm-project', environment])).verified).toBe(true)
}, 60000)
