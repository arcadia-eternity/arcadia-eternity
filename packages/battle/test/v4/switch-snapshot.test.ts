import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import {
  AttributeSystem,
  BattleMessageType,
  BattlePhase,
  BattleStatus,
  BaseMark,
  Effect,
  EffectTrigger,
  snapshotBattle,
  restoreBattle,
  setGlobalLogger,
  type Battle,
  type BattleMessage,
  type Player,
  type PlayerSelection,
  type TimerConfig,
  type baseMarkId,
  type effectId,
} from '@arcadia-eternity/battle/v4'
import { makeScenario } from './scenario'
import { catalogFor } from './snapshot-host'

const battles: Battle[] = [],
  runs: Promise<void>[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
})
afterEach(async () => {
  for (const battle of battles.splice(0)) await battle.cleanup()
  for (const run of runs.splice(0)) await run
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  if (vi.isFakeTimers()) {
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  }
})
function running(task: Promise<void>) {
  const run = task.catch(error => {
    if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
  })
  runs.push(run)
  return run
}
function submit(battle: Battle, player: Player, type: PlayerSelection['type']) {
  const action = battle.getAvailableSelection(player.id).find(action => action.type === type)
  if (!action || !battle.setSelection(action)) throw new Error(`Missing/rejected ${type} for ${player.id}`)
  return action
}
async function switchWait(
  options: { dual?: boolean; reward?: boolean; timerConfig?: Partial<TimerConfig>; ai?: boolean } = {},
) {
  const ability = options.dual
    ? new BaseMark('fixture/double-faint' as baseMarkId, [
        new Effect<EffectTrigger>(
          'fixture/double-faint-effect' as effectId,
          [EffectTrigger.TurnEnd],
          ctx => {
            if (ctx.battle.currentTurn === 1)
              for (const player of [ctx.battle.playerA, ctx.battle.playerB]) player.activePet.currentHp = 0
          },
          0,
        ),
      ])
    : undefined
  const fixture = makeScenario(201, undefined, options.ai, ability, undefined, options.timerConfig)
  const { battle, a, b } = fixture
  battle.allowFaintSwitch = options.reward !== false
  battles.push(battle)
  const catalog = catalogFor(fixture)
  if (ability) {
    catalog.registerContent(`mark:${ability.id}`, ability)
    for (const effect of ability.effects) catalog.registerEffect(effect.id, effect)
  }
  const run = running(battle.startBattle())
  await battle.waitForInputReady()
  if (options.dual) {
    submit(battle, a, 'use-skill')
    submit(battle, b, 'use-skill')
  } else {
    // The reserve has the knockout move; reach the switch through actual turn resolution.
    if (!options.ai) submit(battle, a, 'switch-pet')
    submit(battle, b, 'use-skill')
    await battle.waitForInputReady()
    if (!options.ai) submit(battle, a, 'use-skill')
    submit(battle, b, 'use-skill')
  }
  await battle.waitForInputReady()
  expect(battle.currentPhase).toBe(BattlePhase.SwitchPhase)
  return { ...fixture, catalog, run }
}
function eventLog(battle: Battle) {
  const messages: unknown[] = []
  battle.registerListener(message =>
    messages.push({ type: message.type, data: structuredClone(message.data), sequenceId: message.sequenceId }),
  )
  return messages
}
async function finishWait(battle: Battle) {
  for (const player of [battle.playerA, battle.playerB]) {
    if (player.selection) continue
    const options = battle.getAvailableSelection(player.id)
    const action =
      options.find(action => action.type === 'do-nothing') ?? options.find(action => action.type === 'switch-pet')
    if (action) expect(battle.setSelection(action)).toBe(true)
  }
  await battle.waitForInputReady()
  expect(battle.currentPhase).toBe(BattlePhase.SelectionPhase)
}
async function finishBattle(battle: Battle, run: Promise<void>) {
  battle.registerListener(message => {
    if (message.type === BattleMessageType.TurnAction)
      for (const player of [battle.playerA, battle.playerB]) submit(battle, player, 'use-skill')
    if (message.type === BattleMessageType.ForcedSwitch)
      for (const id of message.data.player) submit(battle, battle.getPlayerByID(id), 'switch-pet')
    if (message.type === BattleMessageType.FaintSwitch)
      submit(battle, battle.getPlayerByID(message.data.player), 'do-nothing')
  })
  for (const player of [battle.playerA, battle.playerB]) submit(battle, player, 'use-skill')
  await run
  expect(battle.status).toBe(BattleStatus.Ended)
}
for (const accepted of ['none', 'forced', 'reward-skip', 'reward-switch'] as const)
  it(`round trips forced/reward switch input, including partial choice: ${accepted}`, async () => {
    const { battle, catalog, run, counters } = await switchWait()
    expect(battle.pendingForcedSwitches.map(player => player.id)).toEqual(['B'])
    expect(battle.pendingFaintSwitch?.id).toBe('A')
    if (accepted === 'forced') submit(battle, battle.playerB, 'switch-pet')
    if (accepted === 'reward-skip') submit(battle, battle.playerA, 'do-nothing')
    if (accepted === 'reward-switch') submit(battle, battle.playerA, 'switch-pet')
    const before = battle.getState(undefined, true)
    const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
    expect(saved.boundary).toBe('switch')
    const selections = [battle.playerA.selection, battle.playerB.selection]
    const counts = { ...counters }
    const expectedEvents = eventLog(battle)
    await finishWait(battle)
    const expectedNext = battle.getState(undefined, true)
    // Reward switching swaps out the knockout move, so the immediate next stable wait is the common comparison point.
    if (accepted !== 'reward-switch') await finishBattle(battle, run)
    const expected = battle.getState(undefined, true)
    const rng = Array.from({ length: 8 }, () => battle.random())
    const expectedEffects = Object.fromEntries(
      Object.entries(counters).map(([key, value]) => [key, value - counts[key as keyof typeof counts]]),
    )
    await battle.cleanup()
    const restored = restoreBattle(saved, catalog)
    battles.push(restored)
    expect(restored.getState(undefined, true)).toEqual(before)
    expect([restored.playerA.selection, restored.playerB.selection]).toEqual(selections)
    expect(restored.isSnapshotBoundary()).toBe(true)
    // Saving a hydrated checkpoint again must retain the switch continuation.
    expect(JSON.parse(JSON.stringify(snapshotBattle(restored, catalog))).boundary).toBe('switch')
    const resumedEvents = eventLog(restored)
    const countAtResume = { ...counters }
    const resumed = running(restored.resumeBattle())
    await finishWait(restored)
    expect(restored.getState(undefined, true)).toEqual(expectedNext)
    if (accepted !== 'reward-switch') await finishBattle(restored, resumed)
    expect(restored.getState(undefined, true)).toEqual(expected)
    expect(resumedEvents).toEqual(expectedEvents)
    expect(Array.from({ length: 8 }, () => restored.random())).toEqual(rng)
    expect(
      Object.fromEntries(
        Object.entries(counters).map(([key, value]) => [key, value - countAtResume[key as keyof typeof counts]]),
      ),
    ).toEqual(expectedEffects)
    expect(
      resumedEvents.some(message =>
        [BattleMessageType.ForcedSwitch, BattleMessageType.FaintSwitch, BattleMessageType.BattleStart].includes(
          (message as BattleMessage).type,
        ),
      ),
    ).toBe(false)
  })
for (const partial of [false, true])
  it(`restores simultaneous forced switches without an optional reward, partial=${partial}`, async () => {
    const { battle, catalog } = await switchWait({ dual: true })
    expect(battle.pendingForcedSwitches.map(player => player.id)).toEqual(['A', 'B'])
    expect(battle.pendingFaintSwitch).toBeUndefined()
    if (partial) submit(battle, battle.playerA, 'switch-pet')
    const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
    await finishWait(battle)
    const expected = battle.getState(undefined, true),
      rng = battle.random()
    await battle.cleanup()
    const restored = restoreBattle(saved, catalog)
    battles.push(restored)
    running(restored.resumeBattle())
    await finishWait(restored)
    expect(restored.getState(undefined, true)).toEqual(expected)
    expect(restored.random()).toBe(rng)
  })
it('restores a required-only switch when reward switching is disabled', async () => {
  const { battle, catalog } = await switchWait({ reward: false })
  expect(battle.getAvailableSelection(battle.playerA.id)).toEqual([])
  const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  await battle.cleanup()
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  running(restored.resumeBattle())
  expect(restored.getAvailableSelection(restored.playerA.id)).toEqual([])
  await finishWait(restored)
})
for (const corruption of [
  'missing-boundary',
  'wrong-phase',
  'no-required',
  'duplicate-required',
  'wrong-required',
  'wrong-reward',
  'invalid-choice',
  'opponent-pet',
  'all-selected',
] as const)
  it(`rejects malformed switch input without publishing registrations: ${corruption}`, async () => {
    const { battle, catalog } = await switchWait()
    const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
    await battle.cleanup()
    const root = saved.nodes[saved.root.ref],
      fields = root.fields
    const required = saved.nodes[fields.pendingForcedSwitches.ref].fields
    const a = saved.nodes[fields.playerA.ref].fields,
      b = saved.nodes[fields.playerB.ref].fields
    const append = (fields: object) => {
      const ref = saved.nodes.length
      saved.nodes.push({ kind: 'object', fields })
      return { ref }
    }
    if (corruption === 'missing-boundary') delete saved.boundary
    if (corruption === 'wrong-phase') fields.currentPhase = BattlePhase.SelectionPhase
    if (corruption === 'no-required') {
      delete required['0']
      fields.pendingFaintSwitch = { atom: 'undefined' }
    }
    if (corruption === 'duplicate-required') required['1'] = required['0']
    if (corruption === 'wrong-required') required['0'] = fields.playerA
    if (corruption === 'wrong-reward') fields.pendingFaintSwitch = fields.playerB
    if (corruption === 'invalid-choice') b.selection = append({ type: 'do-nothing', player: 'B' })
    if (corruption === 'opponent-pet') b.selection = append({ type: 'switch-pet', player: 'B', pet: 'A/lead' })
    if (corruption === 'all-selected') {
      a.selection = append({ type: 'do-nothing', player: 'A' })
      b.selection = append({ type: 'switch-pet', player: 'B', pet: 'B/reserve' })
    }
    const count = AttributeSystem.getGlobalMemoryStats().totalInstances
    expect(() => restoreBattle(saved, catalog)).toThrow()
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(count)
  })
it('keeps an accepted switch clock paused and charges the pending reward deadline across downtime', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 9, 23))
  const { battle, catalog } = await switchWait({ timerConfig: { enabled: true, turnTimeLimit: 3, totalTimeLimit: 30 } })
  submit(battle, battle.playerB, 'switch-pet')
  await vi.advanceTimersByTimeAsync(1000)
  const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  const bClock = battle.getPlayerTimerState(battle.playerB.id)
  await battle.cleanup()
  await vi.advanceTimersByTimeAsync(1000)
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  expect(vi.getTimerCount()).toBe(0)
  expect(restored.getPlayerTimerState(restored.playerB.id)?.remainingTotalTime).toBe(bClock?.remainingTotalTime)
  expect(restored.getPlayerTimerState(restored.playerA.id)?.remainingTurnTime).toBe(1)
  running(restored.resumeBattle())
  await vi.advanceTimersByTimeAsync(1000)
  await restored.waitForInputReady()
  expect(restored.currentPhase).toBe(BattlePhase.SelectionPhase)
  expect(restored.playerB.activePet.id).toBe('B/reserve')
})
for (const corruption of [
  'stopped',
  'paused',
  'timeout',
  'unlimited',
  'foreign-animation',
  'matching-animation',
] as const)
  it(`rejects an invalid pending switch clock before publishing runtime registrations: ${corruption}`, async () => {
    vi.useFakeTimers()
    const { battle, catalog } = await switchWait({
      reward: false,
      timerConfig: { enabled: true, turnTimeLimit: 3, totalTimeLimit: 30 },
    })
    if (corruption === 'foreign-animation')
      battle.startAnimation('fixture/unrelated-animation', 1000, battle.playerA.id)
    if (corruption === 'matching-animation') battle.startAnimation('fixture/own-animation', 1000, battle.playerB.id)
    const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog))) as ReturnType<typeof snapshotBattle>
    const clock = saved.nodes.find(
      node =>
        node.kind === 'object' && node.fields.playerId === battle.playerB.id && 'remainingTurnTime' in node.fields,
    )!
    if (corruption === 'unlimited') clock.fields.remainingTurnTime = null
    else {
      clock.fields.state = corruption.endsWith('-animation') ? 'paused' : corruption
      clock.fields.lastEmittedState = clock.fields.state
      if (corruption === 'foreign-animation' || corruption === 'paused') clock.fields.pauseReason = 'system'
      if (corruption === 'matching-animation') clock.fields.pauseReason = 'animation'
    }
    await battle.cleanup()
    const count = AttributeSystem.getGlobalMemoryStats().totalInstances
    expect(() => {
      battles.push(restoreBattle(saved, catalog))
    }).toThrow()
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(count)
    expect(vi.getTimerCount()).toBe(0)
  })

it('restores a switch clock paused for its deferred reset while a saved animation is active', async () => {
  vi.useFakeTimers()
  const { battle, catalog } = await switchWait({
    reward: false,
    timerConfig: { enabled: true, turnTimeLimit: 3, totalTimeLimit: 30, animationPauseEnabled: true },
  })
  const animation = battle.startAnimation('fixture/switch-animation', 1000, battle.playerB.id)
  battle.timerManager.startSwitchPhase([battle.playerB.id])
  expect(battle.getPlayerTimerState(battle.playerB.id)?.state).toBe('paused')
  const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  await battle.cleanup()
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  expect(vi.getTimerCount()).toBe(0)
  running(restored.resumeBattle())
  restored.endAnimation(animation)
  expect(restored.getPlayerTimerState(restored.playerB.id)).toMatchObject({
    state: 'running',
    remainingTurnTime: 3,
  })
  await finishWait(restored)
})
it('retains an AI forced-switch choice without choosing twice or consuming another RNG draw', async () => {
  const { battle, catalog } = await switchWait({ dual: true, ai: true })
  expect(battle.playerA.selection?.type).toBe('switch-pet')
  expect(battle.playerB.selection).toBeNull()
  const saved = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
  const accepted = structuredClone(battle.playerA.selection)
  const actionCount = battle.getActionLog().length
  const expectedEvents = eventLog(battle)
  await finishWait(battle)
  const expected = battle.getState(undefined, true),
    rng = battle.random()
  const expectedActionCount = battle.getActionLog().length - actionCount
  await battle.cleanup()
  const restored = restoreBattle(saved, catalog)
  battles.push(restored)
  expect(restored.playerA.selection).toEqual(accepted)
  const actualEvents = eventLog(restored)
  running(restored.resumeBattle())
  await finishWait(restored)
  expect(restored.getState(undefined, true)).toEqual(expected)
  expect(restored.getActionLog().length - actionCount).toBe(expectedActionCount)
  expect(actualEvents).toEqual(expectedEvents)
  expect(restored.random()).toBe(rng)
})
