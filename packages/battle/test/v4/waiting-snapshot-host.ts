import {
  BattleMessageType,
  BattlePhase,
  BattleStatus,
  setGlobalLogger,
  snapshotBattle,
  restoreBattle,
  type Battle,
  type BattleMessage,
  type BattleSnapshot,
  type Player,
  type PlayerSelection,
} from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import type { BattleRuntimeSnapshot } from '@arcadia-eternity/interface'
import { makeScenario } from './scenario'
import { catalogFor } from './snapshot-host'

const cases = ['forced', 'switch-pair', 'reward-pending', 'forced-pending', 'team-empty', 'team-partial'] as const
type WaitingCase = (typeof cases)[number]
type Event = Pick<BattleMessage, 'type' | 'sequenceId' | 'data'>
interface Continuation {
  state: ReturnType<Battle['getState']>
  events: Event[]
  winner: string | undefined
  rng: number[]
}
interface Probe {
  kind: WaitingCase
  snapshot: BattleSnapshot | BattleRuntimeSnapshot
  before: ReturnType<Battle['getState']>
  selections: (PlayerSelection | null)[]
  expected: Continuation
}
const silent = { debug() {}, info() {}, warn() {}, error() {} }
function require(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
function same(actual: unknown, expected: unknown, message: string) {
  require(canonical(actual) === canonical(expected), message)
}
function event(message: BattleMessage): Event {
  require(!([BattleMessageType.Error, BattleMessageType.EffectApplyFail] as BattleMessageType[]).includes(
    message.type,
  ), 'Execution error')
  return structuredClone({ type: message.type, sequenceId: message.sequenceId, data: message.data })
}
function action(battle: Battle, player: Player, type: PlayerSelection['type']) {
  const selection = battle.getAvailableSelection(player.id).find(candidate => candidate.type === type)
  require(selection && battle.setSelection(selection), `Rejected ${player.id} ${type}`)
}
function turns(battle: Battle, message: BattleMessage) {
  if (message.type !== BattleMessageType.TurnAction) return
  require(battle.currentTurn < 8, 'Waiting checkpoint continuation exceeded turn bound')
  for (const player of [battle.playerA, battle.playerB])
    action(
      battle,
      player,
      player === battle.playerA && player.activePet.id === 'A/lead' && battle.currentTurn === 0
        ? 'switch-pet'
        : 'use-skill',
    )
}
function switches(battle: Battle) {
  for (const player of battle.pendingForcedSwitches) if (!player.selection) action(battle, player, 'switch-pet')
  if (battle.pendingFaintSwitch && !battle.pendingFaintSwitch.selection)
    action(battle, battle.pendingFaintSwitch, 'do-nothing')
}
function result(battle: Battle, events: Event[]): Continuation {
  require(battle.status === BattleStatus.Ended &&
    battle.victor === battle.playerA, 'Battle did not finish with A winning')
  return {
    state: battle.getState(undefined, true),
    events,
    winner: battle.victor.id,
    rng: Array.from({ length: 8 }, () => battle.random()),
  }
}
function host() {
  const fixture = makeScenario(),
    catalog = catalogFor(fixture)
  let battle = fixture.battle
  const system = new LocalBattleSystemV4(
    battle,
    {
      snapshot: current =>
        snapshotBattle(
          current,
          catalog,
          current.status !== BattleStatus.Unstarted
            ? undefined
            : {
                boundary: current.currentPhase === BattlePhase.TeamSelectionPhase ? 'team-selection' : 'initial',
              },
        ),
      restore: data => (battle = restoreBattle(data, catalog)),
    },
    { teamSelection: { enabled: true, config: { maxTeamSize: 1 } } },
  )
  return {
    system,
    catalog,
    get battle() {
      return battle
    },
  }
}
function teamChoice(player: Player) {
  const pet = player.team[1]
  return { type: 'team-selection' as const, player: player.id, selectedPets: [pet.id], starterPetId: pet.id }
}
async function createSwitch(kind: WaitingCase): Promise<Probe> {
  const fixture = makeScenario(),
    { battle } = fixture,
    catalog = catalogFor(fixture)
  battle.allowFaintSwitch = kind !== 'forced'
  const events: Event[] = []
  let reached!: () => void,
    capturing = true
  const waiting = new Promise<void>(resolve => {
    reached = resolve
  })
  battle.registerListener(message => {
    events.push(event(message))
    turns(battle, message)
    if (capturing && message.type === BattleMessageType.ForcedSwitch) reached()
    if (
      !capturing &&
      (message.type === BattleMessageType.ForcedSwitch || message.type === BattleMessageType.FaintSwitch)
    )
      switches(battle)
  })
  const running = battle.startBattle().catch(error => {
    if (!(error instanceof Error) || error.message !== 'Battle cancelled') throw error
  })
  try {
    await waiting
    await battle.waitForInputReady()
    if (kind === 'reward-pending') action(battle, battle.playerB, 'switch-pet')
    if (kind === 'forced-pending') action(battle, battle.playerA, 'do-nothing')
    const before = battle.getState(undefined, true),
      selections = [battle.playerA.selection, battle.playerB.selection]
    const snapshot = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog))) as BattleSnapshot
    events.length = 0
    capturing = false
    switches(battle)
    await running
    return { kind, snapshot, before, selections: structuredClone(selections), expected: result(battle, events) }
  } finally {
    await battle.cleanup()
    await running
  }
}
async function createTeam(kind: WaitingCase): Promise<Probe> {
  const current = host(),
    events: Event[] = []
  current.system.BattleEvent(message => {
    events.push(event(message))
    turns(current.battle, message)
  })
  try {
    await current.system.ready()
    if (kind === 'team-partial') await current.system.submitAction(teamChoice(current.battle.playerA))
    const before = current.battle.getState(undefined, true),
      selections = [current.battle.playerA.selection, current.battle.playerB.selection]
    const snapshot = JSON.parse(JSON.stringify(await current.system.createRuntimeSnapshot())) as BattleRuntimeSnapshot
    events.length = 0
    if (kind === 'team-empty') await current.system.submitAction(teamChoice(current.battle.playerA))
    await current.system.submitAction(teamChoice(current.battle.playerB))
    await current.system.waitForCompletion()
    return { kind, snapshot, before, selections, expected: result(current.battle, events) }
  } finally {
    await current.system.cleanup()
  }
}
export async function createWaitingCheckpointProbes(): Promise<Probe[]> {
  setGlobalLogger(silent)
  const probes: Probe[] = []
  for (const kind of cases) probes.push(await (kind.startsWith('team-') ? createTeam(kind) : createSwitch(kind)))
  return probes
}
export async function resumeWaitingCheckpointProbes(probes: Probe[]) {
  setGlobalLogger(silent)
  same(
    probes.map(probe => probe.kind),
    cases,
    'Missing waiting checkpoint case',
  )
  const summaries = []
  for (const probe of probes) {
    const events: Event[] = [],
      current = host()
    try {
      if (probe.kind.startsWith('team-')) {
        current.system.BattleEvent(message => {
          events.push(event(message))
          turns(current.battle, message)
        })
        await current.system.restoreRuntimeSnapshot(probe.snapshot as BattleRuntimeSnapshot)
        same(current.battle.getState(undefined, true), probe.before, `${probe.kind}: state changed on restore`)
        await Promise.all([current.system.ready(), current.system.ready()])
        same(events, [], `${probe.kind}: restore repeated preparation/start prompts`)
        if (probe.kind === 'team-empty') await current.system.submitAction(teamChoice(current.battle.playerA))
        await current.system.submitAction(teamChoice(current.battle.playerB))
        await current.system.waitForCompletion()
        same(result(current.battle, events), probe.expected, `${probe.kind}: continuation differs`)
      } else {
        await current.system.cleanup()
        const battle = restoreBattle(probe.snapshot, current.catalog)
        try {
          same(battle.getState(undefined, true), probe.before, `${probe.kind}: state changed on restore`)
          same(
            [battle.playerA.selection, battle.playerB.selection],
            probe.selections,
            `${probe.kind}: accepted choices changed`,
          )
          battle.registerListener(message => {
            events.push(event(message))
            turns(battle, message)
            if (message.type === BattleMessageType.ForcedSwitch || message.type === BattleMessageType.FaintSwitch)
              switches(battle)
          })
          const running = battle.resumeBattle()
          await battle.waitForInputReady()
          same(events, [], `${probe.kind}: resume repeated completed switch/start prompts`)
          switches(battle)
          await running
          same(result(battle, events), probe.expected, `${probe.kind}: continuation differs`)
        } finally {
          await battle.cleanup()
        }
      }
      summaries.push({
        kind: probe.kind,
        turn: probe.expected.state.currentTurn,
        winner: probe.expected.winner,
        events: events.map(message => message.type),
      })
    } finally {
      await current.system.cleanup()
    }
  }
  return summaries
}
