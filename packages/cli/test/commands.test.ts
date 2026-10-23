import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { RunResult, Replay } from '../src/application/types'

vi.setConfig({ testTimeout: 20000 })

const execute = promisify(execFile)
const root = resolve(import.meta.dirname, '../../..')
let temporary: string, cli: string, guard: string, teams: string[]
let counter = 0
async function invoke(args: string[], code = 0, extraEnv: Record<string, string> = {}) {
  let stdout = '',
    stderr = '',
    actual = 0
  try {
    ;({ stdout, stderr } = await execute(process.execPath, ['--import', guard, cli, ...args], {
      cwd: temporary,
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ARCADIA_PACKS_DIR: '', NODE_PATH: '', NODE_OPTIONS: '', ...extraEnv },
    }))
  } catch (error) {
    const e = error as { stdout: string; stderr: string; code: number }
    stdout = e.stdout
    stderr = e.stderr
    actual = e.code
  }
  expect(actual, stderr).toBe(code)
  return { stdout, stderr, json: () => JSON.parse(stdout) }
}
function battle(...extra: string[]) {
  return [
    'battle',
    'simulate',
    '--player1',
    teams[0],
    '--player2',
    teams[1],
    '--seed',
    'command-fixture',
    '--json',
    ...extra,
  ]
}
const output = (name: string) => join(temporary, `${counter++}-${name}.json`)

beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'arcadia-offline-cli-'))
  const runtime = join(temporary, 'runtime')
  await cp(join(root, 'dist'), join(runtime, 'dist'), { recursive: true })
  await mkdir(join(runtime, 'packs/base/assets'), { recursive: true })
  for (const file of ['pack.json', 'pack-lock.yaml', 'data', 'locales', 'assets/assets.json'])
    await cp(join(root, 'packs/base', file), join(runtime, 'packs/base', file), { recursive: true })
  await writeFile(join(runtime, 'package.json'), '{"type":"module"}')
  cli = join(runtime, 'dist/cli.js')
  guard = join(temporary, 'offline.mjs')
  await writeFile(
    guard,
    `import net from 'node:net'; import http from 'node:http'; import https from 'node:https'; const fail = () => {throw new Error('NETWORK_FORBIDDEN')}; net.Socket.prototype.connect = fail; http.request = fail; https.request = fail; globalThis.fetch = fail;`,
  )
  const fixture = JSON.parse(
    await readFile(join(root, 'packages/battle/src/v2/__tests__/fixtures/baseline/official-switch.input.json'), 'utf8'),
  )
  teams = fixture.teams.map((_: unknown, i: number) => join(temporary, `team-${i}.json`))
  for (const [i, team] of fixture.teams.entries()) {
    for (const pet of team.team) {
      pet.skills = ['skill_paida']
      pet.maxHp = 25
    }
    await writeFile(teams[i], JSON.stringify(team))
  }
}, 60000)
afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true })
})

it('runs complete battles offline from a relocated artifact, and repeats a finite batch deterministically', async () => {
  const first = (await invoke(battle('--runs', '3', '--team-selection'))).json()
  const second = (await invoke(battle('--runs', '3', '--team-selection'))).json()
  expect(first).toEqual(second)
  expect(first.counts).toEqual({ completed: 3, truncated: 0, failed: 0, cancelled: 0 })
  for (const result of first.results as RunResult[]) {
    expect(result.reason).toBe('all_pet_fainted')
    expect(result.turns).toBeGreaterThan(1)
    expect(result.winner).not.toBeNull()
    expect(result.actions).toBeGreaterThan(4)
  }
}, 60000)

it('replays in an independent process including roster selection, skills and faint switches', async () => {
  const file = output('replay')
  const simulated = (await invoke(battle('--team-selection', '--replay-out', file))).json()
  const replay = JSON.parse(await readFile(file, 'utf8')) as Replay
  expect(replay.inputs.some(input => input.type === 'team-selection')).toBe(true)
  expect(replay.inputs.some(input => input.type === 'use-skill')).toBe(true)
  expect(replay.inputs.some(input => input.type === 'switch-pet')).toBe(true)
  expect(replay.inputs.some(input => input.phase === 'SWITCH_PHASE')).toBe(true)
  const verified = (await invoke(['battle', 'replay', file, '--verify', '--json'])).json()
  expect(verified.verified).toBe(true)
  expect(verified.result).toEqual(simulated.results[0])
})

it('reports deterministic truncation with no invented winner and verifies the limited replay', async () => {
  const file = output('truncated')
  const result = (await invoke(battle('--max-actions', '1', '--replay-out', file), 1)).json()
  expect(result.results[0]).toMatchObject({ status: 'truncated', reason: 'MAX_ACTIONS', winner: null, actions: 1 })
  expect((await invoke(['battle', 'replay', file, '--json'])).json().verified).toBe(true)
  const turn = (await invoke(battle('--max-turns', '1'), 1)).json()
  expect(turn.results[0]).toMatchObject({ status: 'truncated', reason: 'MAX_TURNS', winner: null })
})

it('validates offline content through both the new command and compatibility alias', async () => {
  const first = (await invoke(['content', 'validate', '--json'])).json()
  const second = (await invoke(['validate', '--strict', '--format', 'json'])).json()
  expect(first).toEqual(second)
  expect(first).toMatchObject({ valid: true, counts: { effect: 1065, species: 145 }, diagnostics: [] })
  const missing = (await invoke(['content', 'validate', '--pack-ref', '/missing/pack.json', '--json'], 2)).json()
  expect(missing.diagnostics[0].code).toBe('CONTENT_INVALID')
})

it.each(['0', '-1', '1.5', '2junk', 'Infinity', '9007199254740992'])(
  'rejects invalid run count %s as machine-readable argument failure',
  async count => {
    const result = (await invoke(battle('--runs', count), 2)).json()
    expect(result.diagnostics).toHaveLength(1)
  },
)

it('rejects missing references, ignored script switches and clobbering input paths', async () => {
  const invalid = output('invalid-team')
  const team = JSON.parse(await readFile(teams[0], 'utf8'))
  team.team[0].skills = ['skill_not_installed']
  await writeFile(invalid, JSON.stringify(team))
  await invoke(battle('--player1', invalid), 2)
  await invoke(battle('--load-scripts'), 2)
  const before = await readFile(teams[0], 'utf8')
  await invoke(battle('--out', teams[0]), 2)
  expect(await readFile(teams[0], 'utf8')).toBe(before)
  const same = output('conflicting')
  await invoke(battle('--out', same, '--replay-out', same), 2)
})

it('rejects changed build/content, malformed or reordered inputs, unused inputs and altered results', async () => {
  const file = output('original')
  await invoke(battle('--team-selection', '--replay-out', file))
  const original = JSON.parse(await readFile(file, 'utf8')) as Replay
  const mutations: ((r: Replay) => void)[] = [
    r => {
      r.version = 2 as 1
    },
    r => {
      r.environment.build = { ...r.environment.build, coreBuildId: '0'.repeat(64) }
    },
    r => {
      r.environment.data = { ...r.environment.data, skills: [] }
    },
    r => {
      r.inputs[0].seat = 9
    },
    r => {
      r.inputs[0].turn++
    },
    r => {
      r.inputs[2].type = 'surrender'
    },
    r => {
      r.inputs.pop()
    },
    r => {
      r.inputs.push(r.inputs[0])
    },
    r => {
      r.expected.turns++
    },
    r => {
      r.spec.teams[0].team[0].maxHp = 9999
    },
    r => {
      r.spec.seed = 'changed-seed'
    },
    r => {
      r.initial.version = 2
    },
  ]
  for (const mutate of mutations) {
    const changed = structuredClone(original)
    mutate(changed)
    const path = output('changed')
    await writeFile(path, JSON.stringify(changed))
    expect((await invoke(['battle', 'replay', path, '--json'], 3)).json().diagnostics[0].code).toMatch(/REPLAY|INPUT/)
  }
}, 60000)

it('keeps frozen replay inputs after original teams and source content are removed', async () => {
  const file = output('frozen')
  const source = output('source-team')
  await cp(teams[0], source)
  await invoke(battle('--player1', source, '--replay-out', file))
  await writeFile(source, 'broken: true')
  expect((await invoke(['battle', 'replay', file, '--json'])).json().verified).toBe(true)
})

it('freezes custom content and validates original workspace locks for multiple packs', async () => {
  const recorded = output('base-input')
  await invoke(battle('--replay-out', recorded))
  const data = (JSON.parse(await readFile(recorded, 'utf8')) as Replay).environment.data
  const workspace = join(temporary, 'custom-packs')
  await mkdir(join(workspace, 'user'), { recursive: true })
  const base = join(temporary, 'runtime/packs/base/pack.json')
  // The workspace has one original entry; its dependency is checked against its own original lock too.
  const skill = {
    ...(data.skills.find(raw => (raw as { id: string }).id === 'skill_paida') as object),
    id: 'skill_cli_custom',
  }
  const manifest = {
    id: 'fixture.custom',
    version: '1.0.0',
    engine: 'seer2-v2',
    dependencies: [{ id: 'arcadia-eternity.base', path: base }],
    data: { effects: [], marks: [], skills: ['skills.json'], species: [] },
  }
  const raw = JSON.stringify(manifest)
  const entry = join(workspace, 'user/pack.json'),
    lock = join(workspace, 'user/pack-lock.yaml'),
    source = join(workspace, 'user/skills.json')
  await writeFile(entry, raw)
  await writeFile(source, JSON.stringify([skill]))
  const lockData = {
    lockfileVersion: 1,
    generatedAt: '2026-10-23T00:00:00.000Z',
    importers: {
      '.': {
        specifiers: {},
        dependencies: {
          'fixture.custom': { specifier: 'workspace:fixture', version: '1.0.0', packageKey: '/fixture.custom@1.0.0' },
        },
      },
    },
    packages: {
      '/fixture.custom@1.0.0': {
        name: 'fixture.custom',
        version: '1.0.0',
        kind: 'data',
        engine: 'seer2-v2',
        source: 'workspace:fixture',
        entry: 'pack.json',
        provenance: 'workspace',
        resolution: { integrity: 'sha512-' + createHash('sha512').update(raw).digest('base64') },
        dependencies: {},
      },
    },
  }
  await writeFile(lock, JSON.stringify(lockData))
  // A second workspace entry exercises the historical temporary-aggregate lock failure.
  await mkdir(join(workspace, 'extra'))
  const extra = {
    ...manifest,
    id: 'fixture.extra',
    dependencies: [],
    data: { effects: [], marks: [], skills: [], species: [] },
  }
  const extraRaw = JSON.stringify(extra)
  await writeFile(join(workspace, 'extra/pack.json'), extraRaw)
  const extraLock = JSON.parse(JSON.stringify(lockData).replaceAll('fixture.custom', 'fixture.extra'))
  extraLock.packages['/fixture.extra@1.0.0'].resolution.integrity =
    'sha512-' + createHash('sha512').update(extraRaw).digest('base64')
  await writeFile(join(workspace, 'extra/pack-lock.yaml'), JSON.stringify(extraLock))
  const env = { ARCADIA_PACKS_DIR: workspace }
  const validated = (await invoke(['content', 'validate', '--json'], 0, env)).json()
  expect(validated.packs.map((pack: { id: string }) => pack.id)).toEqual([
    'arcadia-eternity.base',
    'fixture.custom',
    'fixture.extra',
  ])
  const customTeam = output('custom-team'),
    saved = output('custom-replay')
  const team = JSON.parse(await readFile(teams[0], 'utf8'))
  for (const pet of team.team) pet.skills = ['skill_cli_custom']
  await writeFile(customTeam, JSON.stringify(team))
  await invoke(battle('--player1', customTeam, '--replay-out', saved), 0, env)
  await writeFile(source, '[]')
  expect((await invoke(['battle', 'replay', saved, '--json'])).json().verified).toBe(true)
  await rm(lock)
  expect((await invoke(['content', 'validate', '--json'], 2, env)).json().diagnostics[0].message).toContain('lockfile')
}, 60000)

it('keeps local and its alias finite without exiting before cleanup', async () => {
  const args = ['--player1', teams[0], '--player2', teams[1], '--ai', 'player1,player2', '--seed', 'local']
  expect((await invoke(['battle', 'local', ...args])).stdout).toContain('completed: all_pet_fainted')
  expect((await invoke(['local', ...args])).stdout).toContain('completed: all_pet_fainted')
  expect((await invoke(['battle', 'local', ...args, '--max-actions', '1'], 1)).stdout).toContain(
    'truncated: MAX_ACTIONS',
  )
})

it('fails cleanly on human input EOF', async () => {
  const result = await invoke(['battle', 'local', '--player1', teams[0], '--player2', teams[1]], 1)
  expect(result.stdout).toContain('failed: RUNTIME_FAILED')
  expect(result.stderr).toContain('Console input ended')
})

it.each(['limit', 'interrupt'])('closes a real human prompt on %s and returns the correct exit code', async mode => {
  const child = spawn(
    process.execPath,
    ['--import', guard, cli, 'battle', 'local', '--player1', teams[0], '--player2', teams[1], '--max-actions', '1'],
    { cwd: temporary, stdio: ['pipe', 'pipe', 'pipe'] },
  )
  let stdout = '',
    stderr = '',
    handled = false
  child.stdout.on('data', data => {
    stdout += String(data)
    if (!handled && stdout.includes('请选择操作:')) {
      handled = true
      if (mode === 'interrupt') child.kill('SIGINT')
      else child.stdin.write('1\n')
    }
  })
  child.stderr.on('data', data => {
    stderr += String(data)
  })
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 12000)
  const code = await new Promise<number | null>(resolve => child.once('exit', resolve))
  clearTimeout(watchdog)
  expect(handled).toBe(true)
  expect(code, stderr).toBe(mode === 'interrupt' ? 130 : 1)
  expect(stdout).toContain(mode === 'interrupt' ? 'cancelled: INTERRUPTED' : 'truncated: MAX_ACTIONS')
})

it('cancels a running batch with SIGINT, writes partial JSON and exits 130', async () => {
  const report = output('cancelled')
  const child = spawn(process.execPath, ['--import', guard, cli, ...battle('--runs', '10000', '--out', report)], {
    cwd: temporary,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '',
    stderr = ''
  child.stdout.on('data', data => {
    stdout += String(data)
  })
  child.stderr.on('data', data => {
    stderr += String(data)
  })
  // Wait for initialization rather than signal during module evaluation.
  const timer = setTimeout(() => child.kill('SIGINT'), 1500)
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 10000)
  const code = await new Promise<number | null>(resolve => child.once('exit', resolve))
  clearTimeout(timer)
  clearTimeout(watchdog)
  expect(code, stderr).toBe(130)
  const result = JSON.parse(stdout)
  expect(result.counts.cancelled).toBe(1)
  expect(JSON.parse(await readFile(report, 'utf8'))).toEqual(result)
}, 15000)
