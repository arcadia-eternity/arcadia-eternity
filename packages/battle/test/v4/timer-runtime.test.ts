import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  AttributeSystem,
  BattleMessageType,
  TimerState,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type TimerConfig,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { catalogFor } from './snapshot-host'

const battles: Battle[] = [],
  running: Promise<void>[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 9, 23))
})
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
  for (const task of running.splice(0)) await task
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  vi.clearAllTimers()
  vi.useRealTimers()
})
async function fixture(options: Partial<TimerConfig> = {}) {
  const f = makeScenario(201, undefined, false, undefined, undefined, {
    enabled: true,
    turnTimeLimit: 30,
    totalTimeLimit: 100,
    ...options,
  })
  battles.push(f.battle)
  const prompt = new Promise<void>(resolve =>
    f.battle.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  running.push(
    f.battle.startBattle().catch(error => {
      if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
    }),
  )
  await prompt
  return f
}
it('pauses a submitted player independently of the animation pause setting', async () => {
  const f = await fixture({ animationPauseEnabled: false })
  await vi.advanceTimersByTimeAsync(2000)
  f.battle.setSelection(f.battle.getAvailableSelection(f.a.id).find(selection => selection.type === 'use-skill')!)
  expect(f.battle.getPlayerTimerState(f.a.id)?.state).toBe(TimerState.Paused)
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.battle.getPlayerTimerState(f.a.id)?.remainingTurnTime).toBe(28)
  expect(f.battle.getPlayerTimerState(f.b.id)?.remainingTurnTime).toBe(27)
})
it('honors disabled animation pausing when updating running clocks', async () => {
  const f = await fixture({ animationPauseEnabled: false })
  f.battle.startAnimation('fixture/animation', 2000, f.a.id)
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.battle.getPlayerTimerState(f.a.id)?.remainingTurnTime).toBe(29)
})
it('forwards animation completion after player timer initialization', async () => {
  const f = await fixture()
  const ended = vi.fn()
  f.battle.timerManager.on('animationForceEnd', ended)
  f.battle.startAnimation('fixture/animation', 1000, f.a.id)
  await vi.advanceTimersByTimeAsync(2000)
  expect(ended).toHaveBeenCalledTimes(1)
})

for (const completion of ['timeout', 'reported-invalid-duration'] as const)
  it(`finishes a deferred turn reset when its last animation ends: ${completion}`, async () => {
    const f = await fixture()
    const ended = vi.fn()
    f.battle.onTimerEvent('animationEnd', ended)
    const id = f.battle.startAnimation('fixture/animation', 1000, f.a.id)
    f.battle.timerManager.startNewTurn([f.a.id, f.b.id])
    expect(f.battle.getPlayerTimerState(f.a.id)?.state).toBe(TimerState.Paused)
    if (completion === 'timeout') await vi.advanceTimersByTimeAsync(2000)
    else f.battle.endAnimation(id, 50)
    expect(ended).toHaveBeenCalledTimes(1)
    expect(f.battle.getAllPlayerTimerStates().map(timer => [timer.state, timer.remainingTurnTime])).toEqual([
      [TimerState.Running, 30],
      [TimerState.Running, 30],
    ])
  })

it('keeps a player selected during an animation paused after the deferred reset', async () => {
  const f = await fixture()
  const id = f.battle.startAnimation('fixture/animation', 1000, f.a.id)
  f.battle.timerManager.startNewTurn([f.a.id, f.b.id])
  f.battle.setSelection(f.battle.getAvailableSelection(f.a.id).find(selection => selection.type === 'use-skill')!)
  f.battle.endAnimation(id, 200)
  expect(f.battle.getPlayerTimerState(f.a.id)).toMatchObject({ state: TimerState.Paused, remainingTurnTime: 30 })
  expect(f.battle.getPlayerTimerState(f.b.id)).toMatchObject({ state: TimerState.Running, remainingTurnTime: 30 })
})

it('does not revive stopped clocks when an outstanding animation later times out', async () => {
  const f = await fixture()
  f.battle.startAnimation('fixture/animation', 1000, f.a.id)
  f.battle.timerManager.startNewTurn([f.a.id, f.b.id])
  f.battle.timerManager.stopAllTimers()
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.battle.getAllPlayerTimerStates().map(timer => timer.state)).toEqual([TimerState.Stopped, TimerState.Stopped])
  expect(vi.getTimerCount()).toBe(0)
})

it('restores running and submitted clocks without resetting the turn or scheduling before resume', async () => {
  const f = await fixture()
  await vi.advanceTimersByTimeAsync(2000)
  f.battle.setSelection(f.battle.getAvailableSelection(f.a.id).find(selection => selection.type === 'use-skill')!)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalogFor(f))))
  await f.battle.cleanup()
  await vi.advanceTimersByTimeAsync(3000)
  const fresh = makeScenario()
  battles.push(fresh.battle)
  const catalog = catalogFor(fresh)
  await fresh.battle.cleanup()
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  expect(vi.getTimerCount()).toBe(0)
  expect(restored.getPlayerTimerState(restored.playerA.id)).toMatchObject({
    state: TimerState.Paused,
    remainingTurnTime: 28,
    remainingTotalTime: 98,
  })
  expect(restored.getPlayerTimerState(restored.playerB.id)).toMatchObject({
    state: TimerState.Running,
    remainingTurnTime: 25,
    remainingTotalTime: 95,
  })
  running.push(
    restored.resumeBattle().catch(error => {
      if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
    }),
  )
  await Promise.resolve()
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(1000)
  expect(restored.getPlayerTimerState(restored.playerA.id)?.remainingTurnTime).toBe(28)
  expect(restored.getPlayerTimerState(restored.playerB.id)?.remainingTurnTime).toBe(24)
})

it('round-trips unlimited counters through JSON using explicit null instead of infinity', async () => {
  const f = await fixture({ turnTimeLimit: undefined, totalTimeLimit: undefined })
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalogFor(f))))
  await f.battle.cleanup()
  const restored = restoreBattle(saved, catalogFor(f))
  battles.push(restored)
  expect(restored.getPlayerTimerState(restored.playerA.id)).toMatchObject({
    remainingTurnTime: Infinity,
    remainingTotalTime: Infinity,
  })
  expect(vi.getTimerCount()).toBe(0)
})

it('activates an expired total deadline only after resumed observers have attached', async () => {
  const f = await fixture({ totalTimeLimit: 2 })
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalogFor(f))))
  await f.battle.cleanup()
  await vi.advanceTimersByTimeAsync(3000)
  const restored = restoreBattle(saved, catalogFor(f))
  battles.push(restored)
  const ended = vi.fn()
  restored.registerListener(message => {
    if (message.type === BattleMessageType.BattleEnd) ended(message.data)
  })
  expect(ended).not.toHaveBeenCalled()
  await restored.resumeBattle()
  expect(ended).toHaveBeenCalledTimes(1)
  expect(ended).toHaveBeenCalledWith({ winner: restored.playerB.id, reason: 'total_time_timeout' })
  expect(vi.getTimerCount()).toBe(0)
  expect(restored.getAllPlayerTimerStates().map(timer => timer.remainingTotalTime)).toEqual([0, 0])
})

it('resolves an expired turn once without overwriting a submitted peer selection', async () => {
  const f = await fixture({ turnTimeLimit: 2 })
  f.battle.setSelection(f.battle.getAvailableSelection(f.a.id).find(selection => selection.type === 'use-skill')!)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalogFor(f))))
  await f.battle.cleanup()
  await vi.advanceTimersByTimeAsync(3000)
  const restored = restoreBattle(saved, catalogFor(f))
  battles.push(restored)
  const next = new Promise<void>(resolve =>
    restored.registerListener(message => {
      if (message.type === BattleMessageType.TurnAction) resolve()
    }),
  )
  running.push(
    restored.resumeBattle().catch(error => {
      if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
    }),
  )
  await next
  expect(restored.currentTurn).toBe(1)
  expect(
    restored.getActionLog().filter(action => action.turn === 0 && action.selection.player === f.a.id),
  ).toHaveLength(1)
  expect(
    restored.getActionLog().filter(action => action.turn === 0 && action.selection.player === f.b.id),
  ).toHaveLength(1)
})

for (const corruption of [
  'negative-counter',
  'foreign-player',
  'inconsistent-selection',
  'missing-runtime',
  'invalid-unlimited',
] as const)
  it(`rejects malformed timer state without runtime registrations: ${corruption}`, async () => {
    const f = await fixture()
    const saved = JSON.parse(JSON.stringify(snapshotBattle(f.battle, catalogFor(f))))
    await f.battle.cleanup()
    const root = saved.nodes[saved.root.ref]
    const runtime = saved.nodes[root.fields.timerRuntime.ref]
    const rows = saved.nodes[runtime.fields.players.ref]
    const first = saved.nodes[rows.fields['0'].ref]
    if (corruption === 'negative-counter') first.fields.remainingTurnTime = -1
    if (corruption === 'foreign-player') first.fields.playerId = 'foreign'
    if (corruption === 'invalid-unlimited') first.fields.remainingTotalTime = null
    if (corruption === 'missing-runtime') delete root.fields.timerRuntime
    if (corruption === 'inconsistent-selection') {
      const selections = saved.nodes[runtime.fields.selections.ref]
      saved.nodes[selections.fields['0'].ref].fields['1'] = true
    }
    const before = AttributeSystem.getGlobalMemoryStats().totalInstances
    expect(() => restoreBattle(saved, catalogFor(f))).toThrow()
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(before)
    expect(vi.getTimerCount()).toBe(0)
  })
