import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import pino from 'pino'
import { AttributeSystem, BattleMessageType, BattleStatus, setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { playerId, BattleState } from '@arcadia-eternity/const'
import type { RoomState } from '../src/cluster/types'
import { LocalBattleRuntimeFactory } from '../src/domain/battle/runtime/localBattleRuntimeFactory'
import {
  readRuntimeDescriptor,
  type NativeRuntimeIdentity,
  type BattleRuntimeRequest,
} from '../src/domain/battle/runtime/runtimeIdentity'
import input from '../../battle/src/v2/__tests__/fixtures/baseline/official-switch.input.json'

const mocks = vi.hoisted(() => ({ validate: vi.fn(), legacy: vi.fn() }))
vi.mock('@arcadia-eternity/rules', () => ({ ServerRuleIntegration: { validateBattleCreation: mocks.validate } }))
vi.mock('@arcadia-eternity/battle/node', () => ({ createLocalBattleFromYAML: mocks.legacy }))
const systems: IBattleSystem[] = []
let baseline = 0
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
beforeEach(() => {
  baseline = AttributeSystem.getGlobalMemoryStats().totalInstances
  mocks.validate.mockReset().mockResolvedValue({
    validation: { isValid: true, errors: [] },
    battleOptions: { allowFaintSwitch: false, showHidden: false, timerConfig: { enabled: false } },
  })
  mocks.legacy.mockReset().mockRejectedValue(new Error('Unexpected legacy creation'))
})
afterEach(async () => {
  for (const system of systems.splice(0)) await system.cleanup()
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
  expect(mocks.legacy).not.toHaveBeenCalled()
})
function fixture() {
  const factory = new LocalBattleRuntimeFactory(pino({ level: 'silent' }))
  const room: RoomState = {
    id: 'native-factory',
    status: 'active',
    sessions: [],
    sessionPlayers: {},
    instanceId: 'native-test',
    lastActive: 0,
    spectators: [],
    metadata: { runtimeSeed: 'native-factory/201' },
  }
  const players = input.teams.map((team, index) =>
    parseWithErrors(PlayerSchema, { ...team, id: String(index).repeat(21) }),
  )
  return { factory, room, players }
}
async function create(f = fixture(), expected?: NativeRuntimeIdentity) {
  const system = await f.factory.createBattleSystem(f.room, f.players[0], f.players[1], { kind: 'native-v4', expected })
  systems.push(system)
  return { ...f, system }
}
function prompt(system: IBattleSystem) {
  return new Promise<void>(resolve => {
    const off = system.BattleEvent(message => {
      if (message.type === BattleMessageType.TurnAction) {
        off()
        resolve()
      }
    })
  })
}
it('uses the native implementation for new battles when no runtime override is provided', async () => {
  const f = fixture(),
    system = await f.factory.createBattleSystem(f.room, f.players[0], f.players[1])
  systems.push(system)
  expect(f.factory.describe(system).runtime.kind).toBe('native-v4')
})
it('creates an unstarted native runtime with actual build/content identity and original-instance bootstrap', async () => {
  const f = fixture()
  f.players[1].team[0].id = f.players[0].team[0].id
  const raw = JSON.stringify(f.players)
  const { system } = await create(f)
  const state = await system.getState(undefined, true)
  expect(state.status).toBe(BattleStatus.Unstarted)
  expect(new Set(state.players.flatMap(player => player.team?.map(pet => pet.id) ?? [])).size).toBe(4)
  expect(JSON.stringify(f.players)).toBe(raw)
  const descriptor = f.factory.describe(system)
  expect(descriptor.runtime.kind).toBe('native-v4')
  if (!('initial' in descriptor) || descriptor.runtime.kind !== 'native-v4')
    throw new Error('Expected native bootstrap')
  expect(descriptor.runtime.build).toEqual(nativeBuildIdentity)
  expect(descriptor.runtime.contentRevision).toMatch(/^arcadia\.native-content\/1:/)
  expect(JSON.parse(descriptor.initial.payload).battle.boundary).toBe('initial')
  descriptor.runtime.contentRevision = 'changed copy'
  expect(f.factory.describe(system).runtime).not.toEqual(descriptor.runtime)
  expect(await system.isTimerEnabled()).toBe(false)
})
it('keeps the native implementation when rule configuration needs its default fallback', async () => {
  mocks.validate.mockRejectedValueOnce(new Error('Rules unavailable'))
  const f = await create()
  expect(f.factory.describe(f.system).runtime.kind).toBe('native-v4')
  expect(await f.system.getTimerConfig()).toMatchObject({ enabled: true, turnTimeLimit: 30, totalTimeLimit: 1500 })
})
for (const invalid of ['build', 'revision'] as const)
  it(`rejects mismatched pinned ${invalid} without creating a V2 substitute`, async () => {
    const f = fixture(),
      expected: NativeRuntimeIdentity = {
        kind: 'native-v4',
        build: { ...nativeBuildIdentity },
        contentRevision: 'foreign',
      }
    if (invalid === 'build') expected.build.coreBuildId = '0'.repeat(64)
    await expect(create(f, expected)).rejects.toThrow(
      invalid === 'build' ? 'build identity mismatch' : 'revision mismatch',
    )
  })
for (const invalid of ['schema', 'reference', 'same-player'] as const)
  it(`rejects invalid native input without partially registered players: ${invalid}`, async () => {
    const f = fixture()
    if (invalid === 'schema') f.players[1].team[0].level = 101
    if (invalid === 'reference') f.players[1].team[0].skills[0] = 'skill_unknown'
    if (invalid === 'same-player') f.players[1].id = f.players[0].id
    await expect(create(f)).rejects.toThrow(
      invalid === 'schema' ? '100' : invalid === 'reference' ? 'Unknown content skill' : 'distinct identities',
    )
  })
for (const request of [
  { kind: 'future' },
  { kind: 'native-v4', expected: { kind: 'legacy-v2' } },
  { kind: 'legacy-v2', expected: {} },
])
  it(`rejects an unknown or inconsistent creation request: ${JSON.stringify(request)}`, async () => {
    const f = fixture()
    await expect(
      f.factory.createBattleSystem(f.room, f.players[0], f.players[1], request as unknown as BattleRuntimeRequest),
    ).rejects.toThrow('runtime request')
  })

it('restores the original bootstrap into a new factory and accepts the original action IDs', async () => {
  const source = await create(),
    descriptor = source.factory.describe(source.system)
  if (!('initial' in descriptor) || descriptor.runtime.kind !== 'native-v4')
    throw new Error('Expected native bootstrap')
  let ready = prompt(source.system)
  await source.system.ready()
  await ready
  const actions = await Promise.all(
    source.players.map(
      async player =>
        (await source.system.getAvailableSelection(player.id as playerId)).find(action => action.type === 'use-skill')!,
    ),
  )
  ready = prompt(source.system)
  for (const action of actions) await source.system.submitAction(action)
  await ready
  const expected = await source.system.getState(undefined, true)
  expect(expected.currentTurn).toBe(1)
  await source.system.cleanup()
  const target = await create(fixture(), descriptor.runtime)
  await target.system.restoreRuntimeSnapshot!(descriptor.initial)
  ready = prompt(target.system)
  await target.system.ready()
  await ready
  ready = prompt(target.system)
  for (const action of actions) await target.system.submitAction(action)
  await ready
  const restored = await target.system.getState(undefined, true)
  expect(restored.currentTurn).toBe(expected.currentTurn)
  const summary = (state: BattleState) =>
    state.players.map(player => {
      if (!player.team) throw new Error('Full-view team is missing')
      return { rage: player.rage, team: player.team.map(pet => ({ id: pet.id, hp: pet.currentHp })) }
    })
  expect(summary(restored)).toEqual(summary(expected))
})

const nativeDescriptor = () => ({
  runtime: { kind: 'native-v4', build: { ...nativeBuildIdentity }, contentRevision: 'test/revision' },
  initial: {
    format: 'arcadia.battle.native.v4',
    version: 3,
    payload: JSON.stringify({ battle: { boundary: 'initial' }, reconnect: [], teamSelection: null }),
  },
})
it('reads untagged historical bootstraps as V2 and copies native descriptor data', () => {
  expect(readRuntimeDescriptor({})).toEqual({ runtime: { kind: 'legacy-v2' } })
  const input = nativeDescriptor(),
    parsed = readRuntimeDescriptor(input)
  input.runtime.contentRevision = 'mutated'
  expect(parsed.runtime).toMatchObject({ contentRevision: 'test/revision' })
})
for (const corruption of [
  'missing-runtime',
  'missing-initial',
  'unknown-kind',
  'invalid-build',
  'empty-revision',
  'selection-boundary',
  'reconnect-window',
  'bad-json',
  'unsupported-version',
] as const)
  it(`rejects damaged native bootstrap metadata instead of inferring V2: ${corruption}`, () => {
    const input = JSON.parse(JSON.stringify(nativeDescriptor()))
    if (corruption === 'missing-runtime') delete input.runtime
    if (corruption === 'missing-initial') delete input.initial
    if (corruption === 'unknown-kind') input.runtime.kind = 'future'
    if (corruption === 'invalid-build') input.runtime.build.coreBuildId = 'foreign'
    if (corruption === 'empty-revision') input.runtime.contentRevision = ''
    if (corruption === 'selection-boundary') input.initial.payload = JSON.stringify({ battle: {}, reconnect: [] })
    if (corruption === 'reconnect-window')
      input.initial.payload = JSON.stringify({ battle: { boundary: 'initial' }, reconnect: [{}] })
    if (corruption === 'bad-json') input.initial.payload = '{'
    if (corruption === 'unsupported-version') input.initial.version = 999
    expect(() => readRuntimeDescriptor(input)).toThrow()
  })
