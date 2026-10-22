import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import {
  BattleMessageType,
  BattleStatus,
  AttributeSystem,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type playerId,
  type TimerConfig,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { catalogFor } from './snapshot-host'

const systems: LocalBattleSystemV4[] = [],
  battles: Battle[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
})
afterEach(async () => {
  for (const system of systems.splice(0)) await system.cleanup()
  for (const battle of battles.splice(0)) await battle.cleanup()
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  if (vi.isFakeTimers()) {
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  }
})
function fixture(timerConfig?: Partial<TimerConfig>) {
  const f = makeScenario(201, undefined, false, undefined, undefined, timerConfig),
    catalog = catalogFor(f)
  let restored: Battle | undefined
  battles.push(f.battle)
  const system = new LocalBattleSystemV4(f.battle, {
    snapshot: battle => snapshotBattle(battle, catalog),
    restore: data => {
      restored = restoreBattle(data, catalog)
      return restored
    },
  })
  systems.push(system)
  return {
    ...f,
    system,
    get restored() {
      return restored
    },
  }
}
function nextPrompt(system: LocalBattleSystemV4) {
  return new Promise<void>(resolve => {
    const off = system.BattleEvent(message => {
      if (message.type === BattleMessageType.TurnAction) {
        off()
        resolve()
      }
    })
  })
}

it('resolves concurrent readiness calls at an actual input boundary', async () => {
  const f = fixture()
  await Promise.all([f.system.ready(), f.system.ready()])
  expect(f.battle.isSnapshotBoundary()).toBe(true)
  expect(f.battle.getAvailableSelection(f.a.id).some(action => action.type === 'use-skill')).toBe(true)
})

it('accepts a multi-turn journal without host polling or waiting for prompt messages', async () => {
  const f = fixture()
  await f.system.ready()
  const actions = [f.a, f.b].map(player => ({
    player: player.id,
    type: 'use-skill' as const,
    skill: player.activePet.skills[0].id,
    target: player.activePet.skills[0].target,
  }))
  for (let turn = 0; turn < 3; turn++) {
    for (const action of actions) await f.system.submitAction(action)
  }
  // The next accepted action proves the third turn has finished and its input phase is ready.
  await f.system.submitAction(actions[0])
  expect((await f.system.getState()).currentTurn).toBe(3)
  expect(f.battle.getActionLog().map(entry => entry.turn)).toEqual([0, 0, 1, 1, 2, 2, 3])
})

it('ends immediately on one surrender without waiting for a peer selection', async () => {
  const f = fixture(),
    ended = vi.fn()
  f.system.BattleEvent(message => {
    if (message.type === BattleMessageType.BattleEnd) ended(message.data)
  })
  await f.system.ready()
  await f.system.submitAction({ type: 'surrender', player: f.a.id })
  expect((await f.system.getState()).status).toBe(BattleStatus.Ended)
  await f.system.waitForCompletion()
  expect(ended).toHaveBeenCalledExactlyOnceWith({ winner: f.b.id, reason: 'surrender' })
  expect(f.battle.getActionLog()).toMatchObject([{ selection: { type: 'surrender', player: f.a.id } }])
  await expect(f.system.submitAction({ type: 'surrender', player: f.b.id })).rejects.toThrow()
  expect(ended).toHaveBeenCalledTimes(1)
})

it('starts once, forwards view-filtered state and rejects invalid submissions', async () => {
  const f = fixture(),
    ready = nextPrompt(f.system),
    starts = vi.fn()
  f.battle.showHidden = false
  f.b.activePet.skills[0].appeared = false
  f.system.BattleEvent(message => {
    if (message.type === BattleMessageType.BattleStart) starts()
  })
  await f.system.ready()
  await ready
  await f.system.ready()
  expect(starts).toHaveBeenCalledTimes(1)
  const state = await f.system.getState(f.a.id)
  expect(state.players?.[0]?.team?.[0]?.skills?.[0]?.isUnknown).toBe(false)
  expect(state.players?.[1]?.team?.[0]?.skills?.[0]?.isUnknown).toBe(true)
  expect((await f.system.getState(undefined, true)).players?.[1]?.team?.[0]?.skills?.[0]?.isUnknown).toBe(false)
  await expect(f.system.submitAction({ type: 'do-nothing', player: 'unknown' as playerId })).rejects.toThrow()
  expect(await f.system.getAvailableSelection('unknown' as playerId)).toEqual([])
})

it('keeps repeated callback registrations independent', async () => {
  const f = fixture(),
    callback = vi.fn(),
    ready = nextPrompt(f.system)
  const first = f.system.BattleEvent(callback, { viewerId: f.a.id })
  const second = f.system.BattleEvent(callback, { viewerId: f.b.id })
  await f.system.ready()
  await ready
  callback.mockClear()
  first()
  first()
  f.battle.emitMessage(BattleMessageType.Info, { message: 'remaining subscription' })
  expect(callback).toHaveBeenCalledTimes(1)
  second()
  callback.mockClear()
  f.battle.emitMessage(BattleMessageType.Info, { message: 'unsubscribed' })
  expect(callback).not.toHaveBeenCalled()
})

it('forwards timer methods and removes timer subscriptions independently', async () => {
  const f = fixture(),
    handler = vi.fn()
  expect(await f.system.isTimerEnabled()).toBe(false)
  expect(await f.system.getPlayerTimerState(f.a.id)).toBeNull()
  expect(await f.system.getAllPlayerTimerStates()).toEqual([])
  expect((await f.system.getTimerConfig()).enabled).toBe(false)
  const off = f.system.onTimerEvent('animationEnd', handler)
  f.battle.emitter.emit('animationEnd', { animationId: 'fixture/animation', actualDuration: 1 })
  expect(handler).toHaveBeenCalledTimes(1)
  off()
  off()
  f.battle.emitter.emit('animationEnd', { animationId: 'fixture/animation', actualDuration: 1 })
  expect(handler).toHaveBeenCalledTimes(1)
})

it('validates malformed restores before changing a live selection boundary', async () => {
  const f = fixture(),
    ready = nextPrompt(f.system)
  await f.system.ready()
  await ready
  const before = await f.system.getState(undefined, true)
  await expect(f.system.restoreRuntimeSnapshot({ format: 'wrong', version: 1, payload: '{}' })).rejects.toThrow(
    'Unsupported',
  )
  await expect(
    f.system.restoreRuntimeSnapshot({ format: 'arcadia.battle.native.v4', version: 1, payload: '{}' }),
  ).rejects.toThrow()
  expect(await f.system.getState(undefined, true)).toEqual(before)
  expect(f.battle.isSnapshotBoundary()).toBe(true)
})

it('restores into a fresh catalog, retains subscriptions and continues a partially submitted turn', async () => {
  const f = fixture(),
    ready = nextPrompt(f.system)
  await f.system.ready()
  await ready
  const action = (await f.system.getAvailableSelection(f.a.id)).find(selection => selection.type === 'use-skill')!
  await f.system.submitAction(action)
  const saved = await f.system.createRuntimeSnapshot()
  await f.system.cleanup()
  const fresh = fixture(),
    target = fresh.system
  let turns = 0
  target.BattleEvent(message => {
    if (message.type === BattleMessageType.TurnEnd) turns++
  })
  await target.restoreRuntimeSnapshot(JSON.parse(JSON.stringify(saved)))
  expect(fresh.restored?.playerA.selection?.type).toBe('use-skill')
  const next = nextPrompt(target)
  await target.ready()
  const remaining = (await target.getAvailableSelection(f.b.id)).find(selection => selection.type === 'use-skill')!
  await target.submitAction(remaining)
  await next
  expect(turns).toBe(1)
  expect((await target.getState()).currentTurn).toBe(1)
  await target.cleanup()
  await expect(target.ready()).rejects.toThrow('disposed')
})

it('preserves the active-identity guard without disrupting the live battle', async () => {
  const f = fixture(),
    ready = nextPrompt(f.system)
  await f.system.ready()
  await ready
  const saved = await f.system.createRuntimeSnapshot()
  await expect(f.system.restoreRuntimeSnapshot(saved)).rejects.toThrow('already active')
  expect(f.battle.isSnapshotBoundary()).toBe(true)
  expect((await f.system.getState()).currentTurn).toBe(0)
})

it('disposes a restore cancelled by concurrent cleanup without leaving runtime objects', async () => {
  const f = fixture(),
    ready = nextPrompt(f.system)
  await f.system.ready()
  await ready
  const saved = await f.system.createRuntimeSnapshot()
  await f.system.cleanup()
  const fresh = fixture()
  const restoring = fresh.system.restoreRuntimeSnapshot(saved)
  const cleanup = fresh.system.cleanup()
  await expect(restoring).rejects.toThrow('disposed')
  await cleanup
})

it('cleans an in-flight selection and makes cleanup idempotent', async () => {
  const f = fixture(),
    ready = nextPrompt(f.system)
  await f.system.ready()
  await ready
  const first = f.system.cleanup(),
    second = f.system.cleanup()
  expect(first).toBe(second)
  await first
  expect(f.battle.status).not.toBe(BattleStatus.Ended)
  await expect(f.system.submitAction({ player: f.a.id, type: 'surrender' })).rejects.toThrow('disposed')
})

it('reports asynchronous runtime failure through completion and later host calls', async () => {
  const f = fixture()
  vi.spyOn(f.battle, 'startBattle').mockRejectedValueOnce(new Error('fixture/runtime-failure'))
  await f.system.ready()
  await expect(f.system.waitForCompletion()).rejects.toThrow('fixture/runtime-failure')
  await expect(f.system.getState()).rejects.toThrow('fixture/runtime-failure')
})

async function timedFixture(timerConfig?: Partial<TimerConfig>) {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 9, 23))
  const f = fixture(timerConfig),
    ready = nextPrompt(f.system)
  await f.system.ready()
  await ready
  return f
}

it('expires a disconnect grace window even when decision timers are disabled', async () => {
  const f = await timedFixture(),
    ended = vi.fn()
  f.system.BattleEvent(message => {
    if (message.type === BattleMessageType.BattleEnd) ended(message.data)
  })
  await f.system.startReconnectGraceTimer(f.a.id, 2)
  await vi.advanceTimersByTimeAsync(2000)
  await f.system.waitForCompletion()
  expect(ended).toHaveBeenCalledExactlyOnceWith({ winner: f.b.id, reason: 'surrender' })
  expect((await f.system.getState()).status).toBe(BattleStatus.Ended)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels disconnect grace without pausing or resetting the decision clocks', async () => {
  const f = await timedFixture({ enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 })
  await f.system.submitAction(
    (await f.system.getAvailableSelection(f.a.id)).find(action => action.type === 'use-skill')!,
  )
  await f.system.startReconnectGraceTimer(f.a.id, 5)
  await vi.advanceTimersByTimeAsync(1000)
  await f.system.cancelReconnectGraceTimer(f.a.id)
  await vi.advanceTimersByTimeAsync(4000)
  expect((await f.system.getState()).status).toBe(BattleStatus.OnBattle)
  expect(await f.system.getPlayerTimerState(f.a.id)).toMatchObject({ state: 'paused', remainingTurnTime: 30 })
  expect(await f.system.getPlayerTimerState(f.b.id)).toMatchObject({ state: 'running', remainingTurnTime: 25 })
})

it('replaces a disconnect window and clears all peer windows when the battle ends', async () => {
  const f = await timedFixture()
  await f.system.startReconnectGraceTimer(f.a.id, 2)
  await vi.advanceTimersByTimeAsync(1000)
  await f.system.startReconnectGraceTimer(f.a.id, 3)
  await f.system.startReconnectGraceTimer(f.b.id, 10)
  await vi.advanceTimersByTimeAsync(2000)
  expect((await f.system.getState()).status).toBe(BattleStatus.OnBattle)
  await vi.advanceTimersByTimeAsync(1000)
  await f.system.waitForCompletion()
  expect(f.battle.victor?.id).toBe(f.b.id)
  expect(vi.getTimerCount()).toBe(0)
})

for (const seconds of [0, -1, NaN, Infinity])
  it(`normalizes an immediate disconnect deadline like the previous host: ${seconds}`, async () => {
    const f = await timedFixture()
    await f.system.startReconnectGraceTimer(f.a.id, seconds)
    await f.system.waitForCompletion()
    expect(f.battle.victor?.id).toBe(f.b.id)
    expect(vi.getTimerCount()).toBe(0)
  })

it('rejects unknown disconnect players and preserves a valid window after an invalid replacement', async () => {
  const f = await timedFixture()
  await expect(f.system.startReconnectGraceTimer('foreign' as playerId, 1)).rejects.toThrow('Unknown reconnect player')
  await expect(f.system.cancelReconnectGraceTimer('foreign' as playerId)).rejects.toThrow('Unknown reconnect player')
  await f.system.startReconnectGraceTimer(f.a.id, 2)
  await expect(f.system.startReconnectGraceTimer(f.a.id, Number.MAX_VALUE)).rejects.toThrow('out of range')
  await vi.advanceTimersByTimeAsync(2000)
  await f.system.waitForCompletion()
  expect(f.battle.victor?.id).toBe(f.b.id)
})

for (const downtime of [1000, 5000])
  it(`restores a disconnect deadline quietly without extending it: ${downtime}ms downtime`, async () => {
    const f = await timedFixture()
    await f.system.startReconnectGraceTimer(f.a.id, 3)
    const saved = await f.system.createRuntimeSnapshot()
    await f.system.cleanup()
    await vi.advanceTimersByTimeAsync(downtime)
    const fresh = fixture(),
      ended = vi.fn()
    fresh.system.BattleEvent(message => {
      if (message.type === BattleMessageType.BattleEnd) ended(message.data)
    })
    await fresh.system.restoreRuntimeSnapshot(saved)
    expect(vi.getTimerCount()).toBe(0)
    expect(ended).not.toHaveBeenCalled()
    await fresh.system.ready()
    await vi.advanceTimersByTimeAsync(Math.max(0, 3000 - downtime))
    await fresh.system.waitForCompletion()
    expect(ended).toHaveBeenCalledExactlyOnceWith({ winner: f.b.id, reason: 'surrender' })
    expect(vi.getTimerCount()).toBe(0)
  })

it('cancels all disconnect timers on cleanup or asynchronous runtime failure', async () => {
  vi.useFakeTimers()
  const f = fixture()
  await f.system.startReconnectGraceTimer(f.a.id, 10)
  expect(vi.getTimerCount()).toBe(1)
  await f.system.cleanup()
  expect(vi.getTimerCount()).toBe(0)
  const failed = fixture()
  await failed.system.startReconnectGraceTimer(failed.a.id, 10)
  vi.spyOn(failed.battle, 'startBattle').mockRejectedValueOnce(new Error('fixture/disconnect-failure'))
  await failed.system.ready()
  await expect(failed.system.waitForCompletion()).rejects.toThrow('fixture/disconnect-failure')
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects malformed reconnect state while preserving the live battle and its disconnect window', async () => {
  const f = await timedFixture()
  await f.system.startReconnectGraceTimer(f.a.id, 3)
  const saved = await f.system.createRuntimeSnapshot()
  await f.system.cleanup()
  const payload = JSON.parse(saved.payload)
  payload.reconnect[0].playerId = 'foreign'
  const fresh = fixture(),
    ready = nextPrompt(fresh.system)
  await fresh.system.ready()
  await ready
  await fresh.system.startReconnectGraceTimer(fresh.b.id, 2)
  const before = AttributeSystem.getGlobalMemoryStats().totalInstances
  await expect(fresh.system.restoreRuntimeSnapshot({ ...saved, payload: JSON.stringify(payload) })).rejects.toThrow(
    'roster',
  )
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(before)
  expect(fresh.battle.status).toBe(BattleStatus.OnBattle)
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(2000)
  await fresh.system.waitForCompletion()
  expect(fresh.battle.victor?.id).toBe(fresh.a.id)
})

it('continues reading the original version-one native runtime envelope', async () => {
  const f = await timedFixture(),
    saved = await f.system.createRuntimeSnapshot()
  await f.system.cleanup()
  const payload = JSON.parse(saved.payload),
    fresh = fixture()
  await fresh.system.restoreRuntimeSnapshot({ ...saved, version: 1, payload: JSON.stringify(payload.battle) })
  await fresh.system.ready()
  expect((await fresh.system.getState()).status).toBe(BattleStatus.OnBattle)
  expect(vi.getTimerCount()).toBe(0)
})

it('activates an expired restored decision clock before allowing an immediate submission', async () => {
  const f = await timedFixture({ enabled: true, totalTimeLimit: 1, turnTimeLimit: 30 }),
    action = (await f.system.getAvailableSelection(f.a.id)).find(selection => selection.type === 'use-skill')!,
    saved = await f.system.createRuntimeSnapshot()
  await f.system.cleanup()
  await vi.advanceTimersByTimeAsync(1000)
  const fresh = fixture({ enabled: true, totalTimeLimit: 1, turnTimeLimit: 30 })
  await fresh.system.restoreRuntimeSnapshot(saved)
  await fresh.system.ready()
  await expect(fresh.system.submitAction(action)).rejects.toThrow('ended')
  await fresh.system.waitForCompletion()
  expect((await fresh.system.getState()).status).toBe(BattleStatus.Ended)
  expect(fresh.restored!.getActionLog()).toHaveLength(0)
})
