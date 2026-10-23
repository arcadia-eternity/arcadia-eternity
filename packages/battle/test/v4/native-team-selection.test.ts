import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import {
  AttributeSystem,
  BattleMessageType,
  BattleStatus,
  BattlePhase,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type Player,
  type playerId,
  type TeamSelectionAction,
  type TeamSelectionConfig,
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
function fixture(
  config: Partial<TeamSelectionConfig> = {},
  timerConfig: Partial<TimerConfig> = { enabled: false },
  ai = false,
) {
  const f = makeScenario(201, undefined, ai, undefined, undefined, timerConfig),
    catalog = catalogFor(f)
  battles.push(f.battle)
  let restored: Battle | undefined
  const system = new LocalBattleSystemV4(
    f.battle,
    {
      snapshot: battle =>
        snapshotBattle(battle, catalog, battle.status === BattleStatus.Unstarted ? { boundary: 'initial' } : undefined),
      restore: data => (restored = restoreBattle(data, catalog)),
    },
    { teamSelection: { enabled: true, config } },
  )
  systems.push(system)
  return {
    ...f,
    system,
    get restored() {
      return restored
    },
  }
}
function choice(player: Player, indexes = [0], starter = indexes[0]): TeamSelectionAction {
  return {
    type: 'team-selection',
    player: player.id,
    selectedPets: indexes.map(index => player.team[index].id),
    starterPetId: player.team[starter].id,
  }
}
function nextInput(f: ReturnType<typeof fixture>) {
  return f.battle.waitForInputReady()
}

it('waits for both teams, keeps selected instances and starts combat once', async () => {
  const f = fixture({ maxTeamSize: 1 }),
    messages: BattleMessageType[] = [],
    reserve = f.a.team[1],
    removed = f.a.team[0]
  f.system.BattleEvent(message => messages.push(message.type))
  await Promise.all([f.system.ready(), f.system.ready()])
  expect((await f.system.getState()).currentPhase).toBe(BattlePhase.TeamSelectionPhase)
  expect(f.battle.status).toBe(BattleStatus.Unstarted)
  const action = new Proxy(choice(f.a, [1]), {})
  action.selectedPets = new Proxy(action.selectedPets, {})
  await f.system.submitAction(action)
  action.selectedPets[0] = f.b.team[0].id
  expect(f.a.team).toHaveLength(2)
  expect(messages).toEqual([BattleMessageType.TeamSelectionStart])
  const ready = nextInput(f)
  await f.system.submitAction(choice(f.b))
  await ready
  expect(f.a.team).toEqual([reserve])
  expect(f.a.activePet).toBe(reserve)
  expect(f.battle.petMap.has(removed.id)).toBe(false)
  for (const skill of removed.skills) expect(f.battle.skillMap.has(skill.id)).toBe(false)
  expect(messages.filter(type => type === BattleMessageType.TeamSelectionComplete)).toHaveLength(1)
  expect(messages.filter(type => type === BattleMessageType.BattleStart)).toHaveLength(1)
  expect((await f.system.getState()).status).toBe(BattleStatus.OnBattle)
  expect(await f.system.getAvailableSelection('foreign' as playerId)).toEqual([])
})

it('rejects invalid inputs before changing teams or consuming a valid choice', async () => {
  const f = fixture({ minTeamSize: 1, maxTeamSize: 1 })
  await f.system.ready()
  for (const action of [
    { ...choice(f.a), player: 'foreign' as playerId },
    { ...choice(f.a), selectedPets: [f.b.team[0].id] },
    choice(f.a, [0, 1]),
    { ...choice(f.a), starterPetId: f.a.team[1].id },
    { type: 'do-nothing' as const, player: f.a.id },
  ])
    await expect(f.system.submitAction(action)).rejects.toThrow()
  expect(f.a.team).toHaveLength(2)
  const ready = nextInput(f)
  await f.system.submitAction(choice(f.a))
  await f.system.submitAction(choice(f.b))
  await ready
  expect(f.a.team).toHaveLength(1)
})

for (const allowStarterSelection of [true, false])
  it(`retains the full roster and applies the starter policy: ${allowStarterSelection}`, async () => {
    const f = fixture({ mode: 'FULL_TEAM', allowStarterSelection }),
      original = [...f.a.team]
    await f.system.ready()
    const ready = nextInput(f)
    await f.system.submitAction(choice(f.a, [1], 1))
    await f.system.submitAction(choice(f.b))
    await ready
    expect(f.a.team).toEqual(original)
    expect(f.a.activePet).toBe(original[allowStarterSelection ? 1 : 0])
    expect(original.map(pet => pet.appeared)).toEqual(allowStarterSelection ? [false, true] : [true, false])
  })

it('completes view-only preparation without input and respects hidden team information', async () => {
  const f = fixture({ mode: 'VIEW_ONLY', teamInfoVisibility: 'HIDDEN' }),
    messages: BattleMessageType[] = []
  f.system.BattleEvent(message => {
    messages.push(message.type)
    if (message.type === BattleMessageType.TeamSelectionStart)
      expect(message.data).toMatchObject({ playerATeam: null, playerBTeam: null })
  })
  await f.system.ready()
  expect(messages.slice(0, 3)).toEqual([
    BattleMessageType.TeamSelectionStart,
    BattleMessageType.TeamSelectionComplete,
    BattleMessageType.BattleStart,
  ])
  expect(f.a.team).toHaveLength(2)
  expect(f.battle.isSnapshotBoundary()).toBe(true)
})

for (const showOpponentTeam of [true, false])
  it(`filters team preview payload for a player view: opponent visible=${showOpponentTeam}`, async () => {
    const f = fixture({ mode: 'VIEW_ONLY', teamInfoVisibility: 'FULL', showOpponentTeam }),
      preview = vi.fn()
    f.system.BattleEvent(
      message => {
        if (message.type === BattleMessageType.TeamSelectionStart) preview(message.data)
      },
      { viewerId: f.a.id },
    )
    await f.system.ready()
    expect(preview).toHaveBeenCalledTimes(1)
    const data = preview.mock.calls[0][0]
    expect(data.playerATeam.playerId).toBe(f.a.id)
    if (showOpponentTeam) expect(data.playerBTeam.playerId).toBe(f.b.id)
    else expect(data.playerBTeam).toBeNull()
  })

it('uses an AI default within the selected-team limit', async () => {
  const f = fixture({ maxTeamSize: 1 }, { enabled: true, turnTimeLimit: 3, totalTimeLimit: 100 }, true)
  vi.useFakeTimers()
  await f.system.ready()
  expect(await f.system.getPlayerTimerState(f.a.id)).toMatchObject({ state: 'paused' })
  const ready = nextInput(f)
  await f.system.submitAction(choice(f.b))
  await ready
  expect(f.a.team).toHaveLength(1)
  expect(f.a.selection?.type).toBe('use-skill')
  expect(f.battle.getActionLog()).toHaveLength(1)
})

it('uses the preparation limit, pauses a submitted player and preserves spent total time', async () => {
  vi.useFakeTimers()
  const f = fixture({ maxTeamSize: 1, timeLimit: 10 }, { enabled: true, turnTimeLimit: 3, totalTimeLimit: 100 }),
    start = vi.fn(),
    stop = vi.fn()
  f.system.onTimerEvent('teamSelectionTimerStart', start)
  f.system.onTimerEvent('teamSelectionTimerStop', stop)
  await f.system.ready()
  await vi.advanceTimersByTimeAsync(2000)
  await f.system.submitAction(choice(f.a))
  await vi.advanceTimersByTimeAsync(3000)
  expect(await f.system.getPlayerTimerState(f.a.id)).toMatchObject({
    state: 'paused',
    remainingTotalTime: 98,
    remainingTurnTime: 8,
  })
  expect(await f.system.getPlayerTimerState(f.b.id)).toMatchObject({
    state: 'running',
    remainingTotalTime: 95,
    remainingTurnTime: 5,
  })
  const ready = nextInput(f)
  await f.system.submitAction(choice(f.b))
  await ready
  expect(await f.system.getPlayerTimerState(f.a.id)).toMatchObject({
    state: 'running',
    remainingTotalTime: 98,
    remainingTurnTime: 3,
  })
  expect((await f.system.getTimerConfig()).turnTimeLimit).toBe(3)
  expect(start).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ timeLimit: 10 }))
  expect(stop).toHaveBeenCalledTimes(1)
})

it('selects valid defaults on preparation timeout and reports that timeout once', async () => {
  vi.useFakeTimers()
  const f = fixture({ maxTeamSize: 1, timeLimit: 2 }, { enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 }),
    timeout = vi.fn()
  f.system.onTimerEvent('teamSelectionTimeout', timeout)
  await f.system.ready()
  const ready = nextInput(f)
  await vi.advanceTimersByTimeAsync(2000)
  await ready
  expect(f.a.team).toHaveLength(1)
  expect(f.b.team).toHaveLength(1)
  expect(timeout).toHaveBeenCalledTimes(1)
  expect(f.battle.currentPhase).toBe(BattlePhase.SelectionPhase)
})

it('does not start a preparation deadline when decision timers are disabled', async () => {
  vi.useFakeTimers()
  const f = fixture({ timeLimit: 1 })
  await f.system.ready()
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.battle.status).toBe(BattleStatus.Unstarted)
  expect(vi.getTimerCount()).toBe(0)
})

for (const end of ['surrender', 'total-timeout', 'cleanup'] as const)
  it(`releases pending preparation on ${end} without starting battle effects`, async () => {
    vi.useFakeTimers()
    const f = fixture({ timeLimit: 10 }, { enabled: true, turnTimeLimit: 30, totalTimeLimit: 1 }),
      messages: BattleMessageType[] = []
    f.system.BattleEvent(message => messages.push(message.type))
    await f.system.ready()
    if (end === 'cleanup') await f.system.cleanup()
    else {
      if (end === 'surrender') await f.system.submitAction({ type: 'surrender', player: f.a.id })
      else await vi.advanceTimersByTimeAsync(1000)
      await f.system.waitForCompletion()
      expect(f.battle.status).toBe(BattleStatus.Ended)
      expect(messages.filter(type => type === BattleMessageType.BattleEnd)).toHaveLength(1)
    }
    expect(messages).not.toContain(BattleMessageType.BattleStart)
    expect(messages).not.toContain(BattleMessageType.TeamSelectionComplete)
  })

it('rejects preparation snapshots and restores a completed selected roster without reopening selection', async () => {
  const f = fixture({ maxTeamSize: 1 })
  await expect(f.system.createRuntimeSnapshot()).rejects.toThrow('Team selection')
  await f.system.ready()
  await expect(f.system.createRuntimeSnapshot()).rejects.toThrow('Team selection')
  const ready = nextInput(f)
  await f.system.submitAction(choice(f.a, [1]))
  await f.system.submitAction(choice(f.b, [1]))
  await ready
  const before = await f.system.getState(undefined, true),
    saved = await f.system.createRuntimeSnapshot()
  await f.system.cleanup()
  const target = fixture({ maxTeamSize: 1 }),
    messages: BattleMessageType[] = []
  target.system.BattleEvent(message => messages.push(message.type))
  await target.system.restoreRuntimeSnapshot(saved)
  await target.system.ready()
  expect(await target.system.getState(undefined, true)).toEqual(before)
  expect(messages).not.toContain(BattleMessageType.TeamSelectionStart)
  expect(target.restored?.playerA.team).toHaveLength(1)
})
