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
})
function fixture() {
  const f = makeScenario(201),
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
