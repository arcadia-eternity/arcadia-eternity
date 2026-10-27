import { afterEach, beforeAll, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { AttributeSystem, BattleStatus, setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { PlayerSchema, parseWithErrors, type PlayerSchemaType } from '@arcadia-eternity/schema'
import { createNativeLocalBattle } from '../native-local-battle'

const input: { teams: Record<string, unknown>[] } = JSON.parse(
  readFileSync(new URL('../../packages/battle/test/fixtures/official-switch.input.json', import.meta.url), 'utf8'),
)

const systems: Awaited<ReturnType<typeof createNativeLocalBattle>>['system'][] = []
const directories: string[] = []
const baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const system of systems.splice(0)) await system.cleanup()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
})
function drafts() {
  return input.teams.map((team, index) =>
    parseWithErrors(PlayerSchema, { ...structuredClone(team), id: String(index).repeat(21) }),
  ) as [PlayerSchemaType, PlayerSchemaType]
}

it('creates the native authority with fresh identities while preserving complete draft metadata', async () => {
  const players = drafts()
  Object.assign(players[0].team[0], { weight: 0, height: 0, maxHp: 4321 })
  const before = JSON.stringify(players)
  const loaded = await createNativeLocalBattle(players, { packRef: 'builtin:base' })
  systems.push(loaded.system)
  expect(loaded.effectCount).toBe(1065)
  expect(loaded.humanIds).toEqual(loaded.playerIds)
  const state = await loaded.system.getState(undefined, true)
  expect(state.players[0].team?.[0].maxHp).toBe(4321)
  expect(new Set(state.players.flatMap(player => player.team?.map(pet => pet.id) ?? [])).size).toBe(4)
  expect(loaded.playerIds.every(id => !players.some(player => player.id === id))).toBe(true)
  expect(JSON.stringify(players)).toBe(before)
  expect((await loaded.system.createRuntimeSnapshot()).format).toBe('arcadia.battle.native.v4')
})

it('uses the existing AI with actual native decisions and human input', async () => {
  const loaded = await createNativeLocalBattle(drafts(), {
    packRef: 'builtin:base',
    aiPlayers: [' PLAYER2 '],
    battle: { rngSeed: 201 },
  })
  systems.push(loaded.system)
  expect(loaded.humanIds).toEqual([loaded.playerIds[0]])
  await loaded.system.ready()
  const saved = JSON.parse((await loaded.system.createRuntimeSnapshot()).payload).battle
  expect(saved.nodes.some((node: { kind: string }) => node.kind === 'AIPlayer')).toBe(true)
  const action = (await loaded.system.getAvailableSelection(loaded.playerIds[0])).find(
    action => action.type === 'use-skill',
  )!
  await loaded.system.submitAction(action)
  await loaded.system.submitAction({ type: 'surrender', player: loaded.playerIds[0] })
  await loaded.system.waitForCompletion()
  expect(await loaded.system.getState()).toMatchObject({ status: BattleStatus.Ended, currentTurn: 1 })
})

it('rejects invalid seed and missing content without leaking allocated players', async () => {
  await expect(createNativeLocalBattle(drafts(), { battle: { rngSeed: NaN } })).rejects.toThrow()
  const players = drafts()
  players[0].team[0].skills = ['skill_missing_native_cli']
  await expect(createNativeLocalBattle(players, { packRef: 'builtin:base' })).rejects.toThrow()
})

it('runs the actual local command with native content, two AIs and strict validation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-native-cli-'))
  directories.push(directory)
  const player = drafts()[0]
  player.team = [{ ...player.team[0], skills: ['skill_paida'], maxHp: 25 }]
  const file = join(directory, 'player.json')
  await writeFile(file, JSON.stringify(player))
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      'bin/cli.ts',
      'local',
      '--player1',
      file,
      '--player2',
      file,
      '--ai',
      'player1,player2',
      '--strict',
      '--validate-data',
    ],
    {
      cwd: resolve(import.meta.dirname, '../..'),
      env: { ...process.env },
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  expect(stdout).toContain('已加载 1065 个效果实现')
  expect(stdout).toContain('对战开始！')
  expect(stdout).toContain('completed: all_pet_fainted')
}, 40_000)
