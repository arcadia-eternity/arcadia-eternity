import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  AttributeSystem,
  BattleMessageType,
  BattleStatus,
  createOfficialContent,
  setGlobalLogger,
  snapshotBattle,
  restoreBattle,
  type Battle,
  type BattleMessage,
} from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import input from '../../src/v2/__tests__/fixtures/baseline/official-switch.input.json'
import { makeScenario } from './scenario'
import { catalogFor } from './snapshot-host'

const dataRoot = new URL('../../../../packs/base/data/', import.meta.url)
const load = (name: string) => parse(readFileSync(new URL(`${name}.yaml`, dataRoot), 'utf8'), { merge: true })
const data = {
  marks: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'].flatMap(load),
  skills: load('skill'),
  species: load('species'),
}
const content = () => createOfficialContent(data, 'initial/native/1')
const battles: Battle[] = [],
  systems: LocalBattleSystemV4[] = [],
  runs: Promise<void>[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
})
afterEach(async () => {
  for (const system of systems.splice(0)) await system.cleanup()
  for (const battle of battles.splice(0)) await battle.cleanup()
  for (const run of runs.splice(0)) await run
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  if (vi.isFakeTimers()) {
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  }
})
function prompt(battle: Battle) {
  return new Promise<void>(resolve => {
    const listener = (message: BattleMessage) => {
      if (message.type === BattleMessageType.TurnAction) {
        battle.unregisterListener(listener)
        resolve()
      }
    }
    battle.registerListener(listener)
  })
}
function run(task: Promise<void>) {
  runs.push(
    task.catch(error => {
      if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
    }),
  )
}
it('requires an explicit initial boundary on the generic snapshot API', async () => {
  const f = makeScenario()
  battles.push(f.battle)
  const catalog = catalogFor(f)
  expect(() => snapshotBattle(f.battle, catalog)).toThrow('boundary')
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalog, { boundary: 'initial' })))
  expect(saved.boundary).toBe('initial')
  const ids = [...f.a.team, ...f.b.team].flatMap(pet => pet.skills.map(skill => skill.id))
  const rng = Array.from({ length: 5 }, () => f.battle.random())
  await f.battle.cleanup()
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  expect(restored.status).toBe(BattleStatus.Unstarted)
  expect(Array.from({ length: 5 }, () => restored.random())).toEqual(rng)
  expect([...restored.petMap.values()].flatMap(pet => pet.skills.map(skill => skill.id))).toEqual(ids)
  await expect(restored.resumeBattle()).rejects.toThrow('restored selection')
  const ready = prompt(restored)
  run(restored.startBattle())
  await ready
  expect(restored.status).toBe(BattleStatus.OnBattle)
})
it('restores an enabled initial timer quietly and starts a full clock only when the host is ready', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 9, 23))
  const directory = content(),
    players = input.teams.map(team => directory.parsePlayer(team))
  const original = directory.createBattle(players[0], players[1], {
    rngSeed: 201,
    timerConfig: { enabled: true, turnTimeLimit: 2, totalTimeLimit: 10 },
  })
  battles.push(original)
  const source = new LocalBattleSystemV4(original, directory)
  systems.push(source)
  const saved = await source.createRuntimeSnapshot()
  await source.cleanup()
  await vi.advanceTimersByTimeAsync(5000)
  const fresh = content(),
    nextPlayers = input.teams.map(team => fresh.parsePlayer(team))
  const placeholder = fresh.createBattle(nextPlayers[0], nextPlayers[1], { timerConfig: { enabled: false } })
  battles.push(placeholder)
  let restored!: Battle
  const target = new LocalBattleSystemV4(placeholder, {
    snapshot: battle => fresh.snapshot(battle),
    restore: data => {
      restored = fresh.restore(data)
      return restored
    },
  })
  systems.push(target)
  const starts = vi.fn()
  target.BattleEvent(message => {
    if (message.type === BattleMessageType.BattleStart) starts()
  })
  await target.restoreRuntimeSnapshot(saved)
  expect(vi.getTimerCount()).toBe(0)
  expect(starts).not.toHaveBeenCalled()
  const ready = prompt(restored)
  await target.ready()
  await ready
  expect(starts).toHaveBeenCalledTimes(1)
  expect(await target.getPlayerTimerState(restored.playerA.id)).toMatchObject({
    state: 'running',
    remainingTurnTime: 2,
    remainingTotalTime: 10,
  })
  await vi.advanceTimersByTimeAsync(1000)
  expect(await target.getPlayerTimerState(restored.playerA.id)).toMatchObject({
    remainingTurnTime: 1,
    remainingTotalTime: 9,
  })
})
it('replays the original instance-ID actions after initial restoration through a fresh content directory', async () => {
  const directory = content(),
    players = input.teams.map(team => directory.parsePlayer(team))
  const original = directory.createBattle(players[0], players[1], { rngSeed: 201, timerConfig: { enabled: false } })
  battles.push(original)
  const source = new LocalBattleSystemV4(original, directory)
  systems.push(source)
  const saved = await source.createRuntimeSnapshot()
  let ready = prompt(original)
  await source.ready()
  await ready
  const actions = await Promise.all(
    players.map(
      async player => (await source.getAvailableSelection(player.id)).find(action => action.type === 'use-skill')!,
    ),
  )
  ready = prompt(original)
  for (const action of actions) await source.submitAction(action)
  await ready
  const expected = [...original.petMap.values()].map(pet => ({ id: pet.id, hp: pet.currentHp }))
  const rage = [original.playerA.currentRage, original.playerB.currentRage]
  const rng = Array.from({ length: 5 }, () => original.random())
  await source.cleanup()
  const fresh = content(),
    restored = fresh.restore(JSON.parse(saved.payload).battle)
  battles.push(restored)
  const target = new LocalBattleSystemV4(restored, fresh)
  systems.push(target)
  ready = prompt(restored)
  await target.ready()
  await ready
  ready = prompt(restored)
  for (const action of actions) await target.submitAction(action)
  await ready
  expect([...restored.petMap.values()].map(pet => ({ id: pet.id, hp: pet.currentHp }))).toEqual(expected)
  expect([restored.playerA.currentRage, restored.playerB.currentRage]).toEqual(rage)
  expect(Array.from({ length: 5 }, () => restored.random())).toEqual(rng)
})
for (const corruption of [
  'missing-boundary',
  'started-root',
  'nonzero-turn',
  'accepted-input',
  'running-clock',
] as const)
  it(`rejects an invalid initial checkpoint without registrations or timers: ${corruption}`, async () => {
    const directory = content(),
      players = input.teams.map(team => directory.parsePlayer(team))
    const battle = directory.createBattle(players[0], players[1], { timerConfig: { enabled: true } })
    battles.push(battle)
    const saved = JSON.parse(JSON.stringify(directory.snapshot(battle)))
    await battle.cleanup()
    const root = saved.nodes[saved.root.ref]
    if (corruption === 'missing-boundary') delete saved.boundary
    if (corruption === 'started-root') root.fields.status = BattleStatus.OnBattle
    if (corruption === 'nonzero-turn') root.fields.currentTurn = 1
    if (corruption === 'accepted-input') saved.nodes[root.fields.playerA.ref].fields.selection = { ref: saved.root.ref }
    if (corruption === 'running-clock') {
      const runtime = saved.nodes[root.fields.timerRuntime.ref]
      const rows = saved.nodes[runtime.fields.players.ref]
      saved.nodes[rows.fields['0'].ref].fields.state = 'running'
    }
    const count = AttributeSystem.getGlobalMemoryStats().totalInstances
    expect(() => directory.restore(saved)).toThrow()
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(count)
  })
