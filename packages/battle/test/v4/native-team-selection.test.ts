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
        snapshotBattle(
          battle,
          catalog,
          battle.status === BattleStatus.Unstarted
            ? {
                boundary: battle.currentPhase === BattlePhase.TeamSelectionPhase ? 'team-selection' : 'initial',
              }
            : undefined,
        ),
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

/** Mutable wire fixture intentionally allows corrupt scalar fields while keeping graph references typed. */
interface SnapshotMutation {
  battle: { root: { ref: number }; nodes: { kind: string; fields: Record<string, unknown> }[] }
  teamSelection?: {
    timedOut: unknown
    state: unknown
    config: Record<string, unknown>
    choices: { player: string; selectedPets: string[]; starterPetId: string }[]
  } | null
  [key: string]: unknown
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

it('roundtrips a partial preparation and starts combat once without repeating the preparation prompt', async () => {
  const f = fixture({ maxTeamSize: 1 })
  await f.system.ready()
  await f.system.submitAction(choice(f.a, [1]))
  const before = await f.system.getState(undefined, true),
    saved = JSON.parse(JSON.stringify(await f.system.createRuntimeSnapshot()))
  await f.system.cleanup()
  const target = fixture({ maxTeamSize: 1 }),
    messages: BattleMessageType[] = []
  target.system.BattleEvent(message => messages.push(message.type))
  await target.system.restoreRuntimeSnapshot(saved)
  expect(await target.system.getState(undefined, true)).toEqual(before)
  await Promise.all([target.system.ready(), target.system.ready()])
  expect(messages).toEqual([])
  const restored = target.restored!,
    ready = restored.waitForInputReady()
  await target.system.submitAction(choice(restored.playerB, [1]))
  await ready
  expect(restored.playerA.team.map(pet => pet.id)).toEqual([f.a.team[1].id])
  expect(restored.playerB.team.map(pet => pet.id)).toEqual([f.b.team[1].id])
  expect(messages.filter(type => type === BattleMessageType.TeamSelectionComplete)).toHaveLength(1)
  expect(messages.filter(type => type === BattleMessageType.BattleStart)).toHaveLength(1)
})

it('preserves an idle preparation and its configuration before first readiness', async () => {
  const f = fixture({ mode: 'FULL_TEAM', allowStarterSelection: false, timeLimit: 17 }),
    saved = await f.system.createRuntimeSnapshot()
  expect(saved.version).toBe(3)
  await f.system.cleanup()
  const target = fixture({ maxTeamSize: 1 }),
    messages: BattleMessageType[] = []
  target.system.BattleEvent(message => messages.push(message.type))
  await target.system.restoreRuntimeSnapshot(JSON.parse(JSON.stringify(saved)))
  expect(messages).toEqual([])
  await target.system.ready()
  const battle = target.restored!,
    ready = battle.waitForInputReady()
  await target.system.submitAction(choice(battle.playerA, [1], 1))
  await target.system.submitAction(choice(battle.playerB, [1], 1))
  await ready
  expect(battle.playerA.team).toHaveLength(2)
  expect(battle.playerA.activePet.id).toBe(f.a.team[0].id)
  expect(messages.filter(type => type === BattleMessageType.TeamSelectionStart)).toHaveLength(1)
  expect(messages.filter(type => type === BattleMessageType.BattleStart)).toHaveLength(1)
})

it('restores a submitted player paused and preserves the other preparation deadline across downtime', async () => {
  vi.useFakeTimers()
  const f = fixture({ maxTeamSize: 1, timeLimit: 10 }, { enabled: true, turnTimeLimit: 3, totalTimeLimit: 100 })
  await f.system.ready()
  await vi.advanceTimersByTimeAsync(2000)
  await f.system.submitAction(choice(f.a, [1]))
  await vi.advanceTimersByTimeAsync(3000)
  const saved = await f.system.createRuntimeSnapshot()
  await f.system.cleanup()
  await vi.advanceTimersByTimeAsync(2000)
  const target = fixture({ timeLimit: 100 }),
    start = vi.fn(),
    timeout = vi.fn()
  target.system.onTimerEvent('teamSelectionTimerStart', start)
  target.system.onTimerEvent('teamSelectionTimeout', timeout)
  await target.system.restoreRuntimeSnapshot(JSON.parse(JSON.stringify(saved)))
  expect(vi.getTimerCount()).toBe(0)
  expect(await target.system.getPlayerTimerState(f.a.id)).toMatchObject({
    state: 'paused',
    remainingTurnTime: 8,
    remainingTotalTime: 98,
  })
  expect(await target.system.getPlayerTimerState(f.b.id)).toMatchObject({
    state: 'running',
    remainingTurnTime: 3,
    remainingTotalTime: 93,
  })
  await target.system.ready()
  expect(start).not.toHaveBeenCalled()
  const ready = target.restored!.waitForInputReady()
  await vi.advanceTimersByTimeAsync(3000)
  await ready
  expect(timeout).toHaveBeenCalledTimes(1)
  expect(target.restored!.playerA.activePet.id).toBe(f.a.team[1].id)
  expect(target.restored!.playerB.activePet.id).toBe(f.b.team[0].id)
  expect(await target.system.getPlayerTimerState(f.a.id)).toMatchObject({
    state: 'running',
    remainingTurnTime: 3,
    remainingTotalTime: 98,
  })
})

it('roundtrips unlimited preparation without borrowing the finite combat turn deadline', async () => {
  vi.useFakeTimers()
  const source = fixture({ maxTeamSize: 1, timeLimit: 0 }, { enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 })
  await source.system.ready()
  await vi.advanceTimersByTimeAsync(2000)
  await source.system.submitAction(choice(source.a, [1]))
  const saved = JSON.parse(JSON.stringify(await source.system.createRuntimeSnapshot()))
  await source.system.cleanup()
  await vi.advanceTimersByTimeAsync(5000)
  const target = fixture({ timeLimit: 1 }),
    timeout = vi.fn()
  target.system.onTimerEvent('teamSelectionTimeout', timeout)
  await target.system.restoreRuntimeSnapshot(saved)
  await target.system.ready()
  expect(await target.system.getPlayerTimerState(source.a.id)).toMatchObject({
    state: 'paused',
    remainingTurnTime: Infinity,
    remainingTotalTime: 98,
  })
  expect(await target.system.getPlayerTimerState(source.b.id)).toMatchObject({
    state: 'running',
    remainingTurnTime: Infinity,
    remainingTotalTime: 93,
  })
  await vi.advanceTimersByTimeAsync(31000)
  expect(timeout).not.toHaveBeenCalled()
  expect(target.restored!.currentPhase).toBe(BattlePhase.TeamSelectionPhase)
  expect(await target.system.getPlayerTimerState(source.b.id)).toMatchObject({
    remainingTurnTime: Infinity,
    remainingTotalTime: 62,
  })
  const ready = target.restored!.waitForInputReady()
  await target.system.submitAction(choice(target.restored!.playerB))
  await ready
  expect(await target.system.getPlayerTimerState(source.b.id)).toMatchObject({
    state: 'running',
    remainingTurnTime: 30,
    remainingTotalTime: 62,
  })
})

it('roundtrips a finite preparation deadline when combat turn time is unlimited', async () => {
  vi.useFakeTimers()
  const source = fixture({ maxTeamSize: 1, timeLimit: 3 }, { enabled: true, turnTimeLimit: 0, totalTimeLimit: 100 })
  await source.system.ready()
  await vi.advanceTimersByTimeAsync(1000)
  await source.system.submitAction(choice(source.a, [1]))
  expect(await source.system.getPlayerTimerState(source.b.id)).toMatchObject({
    remainingTurnTime: 2,
    remainingTotalTime: 99,
  })
  const saved = await source.system.createRuntimeSnapshot()
  await source.system.cleanup()
  await vi.advanceTimersByTimeAsync(1000)
  const target = fixture({ timeLimit: 100 }),
    timeout = vi.fn(),
    starts = vi.fn()
  target.system.onTimerEvent('teamSelectionTimeout', timeout)
  target.system.BattleEvent(message => {
    if (message.type === BattleMessageType.BattleStart) starts()
  })
  await target.system.restoreRuntimeSnapshot(JSON.parse(JSON.stringify(saved)))
  await target.system.ready()
  expect(await target.system.getPlayerTimerState(source.b.id)).toMatchObject({
    remainingTurnTime: 1,
    remainingTotalTime: 98,
  })
  const ready = target.restored!.waitForInputReady()
  await vi.advanceTimersByTimeAsync(1000)
  await ready
  expect(timeout).toHaveBeenCalledTimes(1)
  expect(starts).toHaveBeenCalledTimes(1)
  expect(target.restored!.currentPhase).toBe(BattlePhase.SelectionPhase)
  expect(await target.system.getPlayerTimerState(source.b.id)).toMatchObject({
    state: 'running',
    remainingTurnTime: Infinity,
    remainingTotalTime: 97,
  })
})

it('preserves a reported preparation timeout while the other player deadline is still pending', async () => {
  vi.useFakeTimers()
  const source = fixture({ maxTeamSize: 1, timeLimit: 2 }, { enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 })
  await source.system.ready()
  const initial = await source.system.createRuntimeSnapshot(),
    payload = JSON.parse(initial.payload) as SnapshotMutation
  await source.system.cleanup()
  // Clock setup can span wall-clock ticks. Model two valid clocks with staggered deadlines.
  const laterClock = payload.battle.nodes.find(
    node => node.kind === 'object' && node.fields.playerId === source.b.id && 'remainingTurnTime' in node.fields,
  )
  laterClock!.fields.remainingTurnTime = 2.5
  const first = fixture(),
    timeout = vi.fn()
  first.system.onTimerEvent('teamSelectionTimeout', timeout)
  await first.system.restoreRuntimeSnapshot({ ...initial, payload: JSON.stringify(payload) })
  await first.system.ready()
  await vi.advanceTimersByTimeAsync(2000)
  expect(timeout).toHaveBeenCalledTimes(1)
  expect(first.restored!.currentPhase).toBe(BattlePhase.TeamSelectionPhase)
  const saved = await first.system.createRuntimeSnapshot()
  await first.system.cleanup()
  const second = fixture()
  second.system.onTimerEvent('teamSelectionTimeout', timeout)
  await second.system.restoreRuntimeSnapshot(saved)
  expect(timeout).toHaveBeenCalledTimes(1)
  await second.system.ready()
  const ready = second.restored!.waitForInputReady()
  await vi.advanceTimersByTimeAsync(1000)
  await ready
  expect(timeout).toHaveBeenCalledTimes(1)
  expect(second.restored!.currentPhase).toBe(BattlePhase.SelectionPhase)
  expect(second.restored!.playerA.team.map(pet => pet.id)).toEqual([source.a.team[0].id])
})

for (const timeout of ['preparation', 'total'] as const)
  it(`restores quietly and activates an overdue ${timeout} deadline only on ready`, async () => {
    vi.useFakeTimers()
    const f = fixture(
      { maxTeamSize: 1, timeLimit: timeout === 'preparation' ? 2 : 100 },
      { enabled: true, turnTimeLimit: 30, totalTimeLimit: timeout === 'total' ? 2 : 100 },
    )
    await f.system.ready()
    const saved = await f.system.createRuntimeSnapshot()
    await f.system.cleanup()
    await vi.advanceTimersByTimeAsync(3000)
    const target = fixture(),
      messages: BattleMessageType[] = []
    target.system.BattleEvent(message => messages.push(message.type))
    await target.system.restoreRuntimeSnapshot(saved)
    expect(messages).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await target.system.ready()
    expect(messages).not.toContain(BattleMessageType.TeamSelectionStart)
    if (timeout === 'preparation') {
      expect(target.restored!.currentPhase).toBe(BattlePhase.SelectionPhase)
      expect(messages.filter(type => type === BattleMessageType.BattleStart)).toHaveLength(1)
    } else {
      await target.system.waitForCompletion()
      expect(target.restored!.status).toBe(BattleStatus.Ended)
      expect(messages).not.toContain(BattleMessageType.BattleStart)
    }
  })

const malformedPreparations: [string, (payload: SnapshotMutation) => void][] = [
  [
    'missing finite preparation deadline',
    payload => {
      const clock = payload.battle.nodes.find(
        node => node.kind === 'object' && node.fields.state === 'running' && 'remainingTurnTime' in node.fields,
      )!
      clock.fields.remainingTurnTime = null
    },
  ],
  [
    'finite deadline for unlimited preparation',
    payload => {
      payload.teamSelection!.config.timeLimit = 0
    },
  ],
  [
    'invalid timeout flag',
    payload => {
      payload.teamSelection!.timedOut = 'true'
    },
  ],
  [
    'missing preparation',
    payload => {
      payload.teamSelection = null
    },
  ],
  [
    'missing envelope field',
    payload => {
      delete payload.teamSelection
    },
  ],
  [
    'extra envelope field',
    payload => {
      payload.extra = true
    },
  ],
  [
    'invalid config boolean',
    payload => {
      payload.teamSelection!.config.allowStarterSelection = 'false'
    },
  ],
  [
    'null config field',
    payload => {
      payload.teamSelection!.config.timeLimit = null
    },
  ],
  [
    'duplicate players',
    payload => {
      payload.teamSelection!.choices.push(payload.teamSelection!.choices[0])
    },
  ],
  [
    'duplicate pets',
    payload => {
      const choice = payload.teamSelection!.choices[0]
      choice.selectedPets.push(choice.selectedPets[0])
    },
  ],
  [
    'unknown player',
    payload => {
      payload.teamSelection!.choices[0].player = 'foreign'
    },
  ],
  [
    'unknown pet',
    payload => {
      payload.teamSelection!.choices[0].selectedPets[0] = 'foreign'
    },
  ],
  [
    'unknown starter',
    payload => {
      payload.teamSelection!.choices[0].starterPetId = 'foreign'
    },
  ],
  [
    'lost confirmation',
    payload => {
      payload.teamSelection!.choices = []
    },
  ],
  [
    'wrong preparation state',
    payload => {
      payload.teamSelection!.state = 'idle'
    },
  ],
  [
    'wrong timer phase',
    payload => {
      const nodes = payload.battle.nodes,
        root = nodes[payload.battle.root.ref]
      nodes[(root.fields.timerRuntime as { ref: number }).ref].fields.phase = 'selection'
    },
  ],
]
for (const [name, corrupt] of malformedPreparations)
  it(`rejects ${name} before replacing a live preparation or allocating timers`, async () => {
    vi.useFakeTimers()
    const f = fixture({ maxTeamSize: 1 }, { enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 })
    await f.system.ready()
    await f.system.submitAction(choice(f.a, [1]))
    const saved = await f.system.createRuntimeSnapshot()
    await f.system.cleanup()
    const payload = JSON.parse(saved.payload)
    corrupt(payload)
    const target = fixture({ maxTeamSize: 1 }, { enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 })
    await target.system.ready()
    const before = await target.system.getState(undefined, true),
      timers = vi.getTimerCount(),
      instances = AttributeSystem.getGlobalMemoryStats().totalInstances
    await expect(target.system.restoreRuntimeSnapshot({ ...saved, payload: JSON.stringify(payload) })).rejects.toThrow()
    expect(await target.system.getState(undefined, true)).toEqual(before)
    expect(vi.getTimerCount()).toBe(timers)
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(instances)
    const ready = target.battle.waitForInputReady()
    await target.system.submitAction(choice(target.a))
    await target.system.submitAction(choice(target.b))
    await ready
    expect(target.battle.status).toBe(BattleStatus.OnBattle)
  })

it('restores a completed selected roster without reopening selection', async () => {
  const f = fixture({ maxTeamSize: 1 })
  await f.system.ready()
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
