// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { patch } from 'jsondiffpatch'
import type { BattleState } from '@arcadia-eternity/const'
import { parse } from 'yaml'
import {
  AttributeSystem,
  BattleMessageType,
  BattleStatus,
  setGlobalLogger,
  type playerId,
} from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import { InMemoryPeerTransport } from '@/p2p/inMemoryPeerTransport'
import { createP2PHostBattleSystem, P2PPeerBattleSystem } from '@/p2p/p2pBattleSystem'
import { createNativeWebBattleSystem, type NativeGameDataStoreLike } from '../nativeBattleFactory'
import input from '../../../../battle/src/v2/__tests__/fixtures/baseline/official-switch.input.json'

const root = new URL('../../../../../packs/base/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('pack.json', root), 'utf8')) as {
  paths?: { dataDir?: string }
  data: Record<'marks' | 'skills' | 'species', string[]>
}
const dataRoot = new URL(`${manifest.paths?.dataDir ?? 'data'}/`, root)
const read = (kind: 'marks' | 'skills' | 'species') =>
  manifest.data[kind].flatMap(
    file => parse(readFileSync(new URL(file, dataRoot), 'utf8'), { merge: true }) as { id: string }[],
  )
const dictionary = (rows: { id: string }[]) => ({
  allIds: rows.map(row => row.id),
  byId: Object.fromEntries(rows.map(row => [row.id, row])),
})
function fixture() {
  const data: NativeGameDataStoreLike = reactive({
    marks: dictionary(read('marks')),
    skills: dictionary(read('skills')),
    species: dictionary(read('species')),
  })
  Object.defineProperty(data, 'effects', {
    get() {
      throw new Error('Legacy effect DSL must not be read')
    },
  })
  const players = input.teams.map((team, index) =>
    parseWithErrors(PlayerSchema, { ...structuredClone(team), id: String(index).repeat(21) }),
  )
  return { data, players }
}
const systems: LocalBattleSystemV4[] = []
const peers: IBattleSystem[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
})
afterEach(async () => {
  for (const peer of peers.splice(0)) await peer.cleanup()
  for (const system of systems.splice(0)) await system.cleanup()
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  if (vi.isFakeTimers()) {
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  }
})
function prompt(system: LocalBattleSystemV4) {
  return new Promise<void>(resolve => {
    const off = system.BattleEvent(message => {
      if (message.type === BattleMessageType.TurnAction) {
        off()
        resolve()
      }
    })
  })
}

it('constructs native local/P2P teams with independent instance IDs and preserves caller data', async () => {
  const f = fixture()
  f.players[1].team[0].id = f.players[0].team[0].id
  Object.assign(f.players[0].team[0], { weight: 0, height: 0, maxHp: 4321 })
  const captured = JSON.stringify(f.players)
  const system = await createNativeWebBattleSystem(f.players[0], f.players[1], f.data)
  systems.push(system)
  expect(system).toBeInstanceOf(LocalBattleSystemV4)
  const state = await system.getState(undefined, true),
    pets = state.players.flatMap(player => player.team ?? [])
  expect(state.status).toBe(BattleStatus.Unstarted)
  expect(state.players[0].team?.[0].maxHp).toBe(4321)
  const frame = JSON.parse((await system.createRuntimeSnapshot()).payload).battle
  expect(
    frame.nodes.find(
      (node: { kind: string; fields: { maxHp?: number } }) => node.kind === 'Pet' && node.fields.maxHp === 4321,
    )?.fields,
  ).toMatchObject({ weight: 0, height: 0, maxHp: 4321 })
  expect(new Set(pets.map(pet => pet.id)).size).toBe(4)
  expect(pets.every(pet => !f.players.some(player => player.team.some(draft => draft.id === pet.id)))).toBe(true)
  expect(JSON.stringify(f.players)).toBe(captured)
  expect(f.players[0].team[0].id).toBe(f.players[1].team[0].id)
})

it('runs the real native P2P host through sync, remote input and a complete turn', async () => {
  const f = fixture(),
    transports = [new InMemoryPeerTransport(), new InMemoryPeerTransport()]
  for (const player of f.players)
    for (const pet of player.team) {
      pet.maxHp = 10_000
      pet.skills = ['skill_paida']
    }
  transports[0].pairWith(transports[1])
  transports[1].pairWith(transports[0])
  await transports[0].connect({ role: 'host', remotePeerId: f.players[1].id })
  await transports[1].connect({ role: 'peer', remotePeerId: f.players[0].id })
  const bridge = (transport: InMemoryPeerTransport) => ({
      transport,
      connect: async () => {},
      close: async () => {},
      handleSignal: async () => {},
      sendMessage: async (type: string, payload: unknown) => transport.send({ type, payload }),
    }),
    a = f.players[0].id as playerId,
    b = f.players[1].id as playerId,
    host = await createP2PHostBattleSystem({
      localPlayerId: a,
      remotePlayerId: b,
      localPlayerName: 'A',
      remotePlayerName: 'B',
      localTeam: f.players[0].team,
      remoteTeam: f.players[1].team,
      dataStore: f.data,
      bridge: bridge(transports[0]),
      transport: transports[0],
      battleConfig: { rngSeed: 201, timerConfig: { enabled: false } },
    }),
    peer = new P2PPeerBattleSystem(b, bridge(transports[1]), transports[1])
  peers.push(peer, host)
  // The existing battle store consumes deltas into the peer's initialized view.
  let view: BattleState | undefined,
    applied = -1
  peer.onSnapshot(({ battleState }) => {
    view = battleState
    applied = Math.max(applied, battleState.sequenceId ?? -1)
  })
  peer.BattleEvent(message => {
    if (view && (message.sequenceId ?? Infinity) > applied) {
      if (message.stateDelta) patch(view, message.stateDelta)
      applied = message.sequenceId ?? applied
    }
  })
  const initialized = new Promise<void>(resolve => {
    const off = peer.onSnapshot(({ battleState, availableSelections }) => {
      if (
        battleState.status === BattleStatus.OnBattle &&
        availableSelections.some(action => action.type === 'use-skill')
      ) {
        off()
        resolve()
      }
    })
  })
  await host.ready()
  await peer.ready()
  await initialized
  const nextTurn = new Promise<void>(resolve => {
    const off = peer.onSnapshot(({ battleState, availableSelections }) => {
      if (battleState.currentTurn === 1 && availableSelections.some(action => action.type === 'use-skill')) {
        off()
        resolve()
      }
    })
  })
  await host.submitAction((await host.getAvailableSelection(a)).find(action => action.type === 'use-skill')!)
  await peer.submitAction((await peer.getAvailableSelection()).find(action => action.type === 'use-skill')!)
  await nextTurn
  const local = (await host.getState(b, true)).players.find(player => player.id === b)!,
    remote = (await peer.getState()).players.find(player => player.id === b)!
  expect(remote.rage).toBe(local.rage)
  expect(remote.team?.map(pet => ({ id: pet.id, hp: pet.currentHp }))).toEqual(
    local.team?.map(pet => ({ id: pet.id, hp: pet.currentHp })),
  )
})

it('uses current edited metadata and captures it with team/config inputs before asynchronous creation', async () => {
  const f = fixture(),
    skill = f.data.skills.byId.skill_paida as { power: number },
    config = reactive({ rngSeed: 201, timerConfig: { enabled: false } })
  skill.power = 17
  const pending = createNativeWebBattleSystem(f.players[0], f.players[1], f.data, config)
  skill.power = 999
  f.players[1].team[0].level = 101
  config.rngSeed = 999
  const system = await pending
  systems.push(system)
  const state = await system.getState(undefined, true)
  expect(state.players[1].team?.[0].level).toBe(50)
  expect(state.players[1].team?.[0].skills?.find(skill => skill.baseId === 'skill_paida')?.power).toBe(17)
})

it('creates the built-in AI and keeps its decision timer paused', async () => {
  vi.useFakeTimers()
  const f = fixture(),
    system = await createNativeWebBattleSystem(f.players[0], f.players[1], f.data, {
      rngSeed: 201,
      ai: { enabled: true },
      timerConfig: { enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 },
    })
  systems.push(system)
  await system.ready()
  expect(await system.getPlayerTimerState(f.players[0].id as playerId)).toMatchObject({ state: 'running' })
  expect(await system.getPlayerTimerState(f.players[1].id as playerId)).toMatchObject({ state: 'paused' })
  const frame = JSON.parse((await system.createRuntimeSnapshot()).payload).battle
  expect(frame.nodes.some((node: { kind: string }) => node.kind === 'AIPlayer')).toBe(true)
})

it('starts optional team selection and restores the selected native roster without repeating it', async () => {
  const f = fixture(),
    config = {
      rngSeed: 201,
      ai: { enabled: true },
      teamSelection: { enabled: true, config: { maxTeamSize: 1 } },
      timerConfig: { enabled: false },
    }
  const system = await createNativeWebBattleSystem(f.players[0], f.players[1], f.data, config)
  systems.push(system)
  await system.ready()
  const selection = (await system.getAvailableSelection(f.players[0].id as playerId)).find(
    action => action.type === 'team-selection',
  )!
  const ready = prompt(system)
  await system.submitAction(selection)
  await ready
  const before = await system.getState(undefined, true),
    saved = await system.createRuntimeSnapshot()
  expect(before.players.map(player => player.team?.length)).toEqual([1, 1])
  await system.cleanup()
  const target = await createNativeWebBattleSystem(f.players[0], f.players[1], f.data, config)
  systems.push(target)
  const repeated = vi.fn()
  target.BattleEvent(message => {
    if (message.type === BattleMessageType.TeamSelectionStart) repeated()
  })
  await target.restoreRuntimeSnapshot(saved)
  await target.ready()
  expect(await target.getState(undefined, true)).toEqual(before)
  expect(repeated).not.toHaveBeenCalled()
})

for (const invalid of ['schema', 'reference', 'same-player', 'team-config', 'rng'] as const)
  it(`rejects invalid creation without leaking native instances: ${invalid}`, async () => {
    const f = fixture()
    if (invalid === 'schema') f.players[1].team[0].level = 101
    if (invalid === 'reference') f.players[1].team[0].skills[0] = 'skill_unknown'
    if (invalid === 'same-player') f.players[1].id = f.players[0].id
    await expect(
      createNativeWebBattleSystem(
        f.players[0],
        f.players[1],
        f.data,
        invalid === 'team-config'
          ? { teamSelection: { enabled: true, config: { minTeamSize: 0 } } }
          : invalid === 'rng'
            ? { rngSeed: NaN }
            : {},
      ),
    ).rejects.toThrow()
  })
