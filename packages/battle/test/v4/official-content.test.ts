import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { DataRepository } from '@arcadia-eternity/battle/v4/legacy'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import {
  AttributeSystem,
  AIPlayer,
  BattleMessageType,
  BattleStatus,
  PhaseState,
  setGlobalLogger,
  type Battle,
  type BattleMessage,
  type baseMarkId,
  type baseSkillId,
} from '@arcadia-eternity/battle/v4'
import input from '../fixtures/official-switch.input.json'
import { createOfficialContent, type OfficialPrototypeData } from '@arcadia-eternity/data-pack-base/native'
import { loadBasePrototypeData } from './base-metadata'

const data: OfficialPrototypeData = loadBasePrototypeData()
const revision = 'official-native/test-build-1'
const content = () => createOfficialContent(data, revision)
const battles: Battle[] = []
const systems: LocalBattleSystemV4[] = []
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

it('loads every native definition and wires canonical metadata without touching the legacy singleton', () => {
  const repository = DataRepository.getInstance()
  const before = [repository.effects, repository.marks, repository.skills, repository.species].map(items => [
    ...items.entries(),
  ])
  const raw = JSON.stringify(data)
  const directory = content()
  expect([directory.effects.length, directory.marks.length, directory.skills.length, directory.species.length]).toEqual(
    [1065, 416, 966, 145],
  )
  for (const prototype of [...directory.marks, ...directory.skills])
    for (const effect of prototype.effects) expect(directory.getEffect(effect.id)).toBe(effect)
  expect(directory.getSkill('skill_shuipao' as baseSkillId)).toBe(
    directory.skills.find(skill => skill.id === 'skill_shuipao'),
  )
  expect(Object.isFrozen(directory.marks)).toBe(true)
  expect(Object.isFrozen(directory.marks[0].effects)).toBe(true)
  expect(Object.isFrozen(directory.marks[0].config)).toBe(true)
  expect(JSON.stringify(data)).toBe(raw)
  expect(
    [repository.effects, repository.marks, repository.skills, repository.species].map(items => [...items.entries()]),
  ).toEqual(before)
})

it('does not consult the legacy singleton while loading, parsing teams or constructing a native battle', () => {
  const singleton = vi.spyOn(DataRepository, 'getInstance').mockImplementation(() => {
    throw new Error('Unexpected legacy singleton access')
  })
  try {
    const directory = content()
    const [a, b] = input.teams.map(team => directory.parsePlayer(team))
    battles.push(directory.createBattle(a, b, { timerConfig: { enabled: false } }))
  } finally {
    singleton.mockRestore()
  }
})

it('validates a whole player creation batch before allocating instances', () => {
  const directory = content()
  for (const invalid of ['schema', 'reference'] as const) {
    const teams = structuredClone(input.teams)
    if (invalid === 'schema') teams[1].team[0].level = 101
    else teams[1].team[0].skills[0] = 'skill_unknown'
    const before = AttributeSystem.getGlobalMemoryStats().totalInstances
    expect(() => directory.parsePlayers(teams)).toThrow(invalid === 'schema' ? '100' : 'Unknown content skill')
    expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(before)
  }
  const [a, b] = directory.parsePlayers(input.teams)
  battles.push(directory.createBattle(a, b, { timerConfig: { enabled: false } }))
})

it('creates the existing AI class through the native content entry and accounts for its actual decisions', async () => {
  vi.useFakeTimers()
  const directory = content(),
    teams = input.teams.map((team, index) => ({
      ...structuredClone(team),
      id: String(index).repeat(21),
      team: team.team.map(pet => ({ ...structuredClone(pet), maxHp: 10_000, skills: ['skill_paida'] })),
    })),
    [a, b] = directory.parsePlayers(teams, { aiPlayerIds: [teams[1].id] }),
    battle = directory.createBattle(a, b, {
      rngSeed: 'native-ai/201',
      timerConfig: { enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 },
    }),
    system = new LocalBattleSystemV4(battle, directory)
  battles.push(battle)
  systems.push(system)
  expect(a).not.toBeInstanceOf(AIPlayer)
  expect(b).toBeInstanceOf(AIPlayer)
  await system.ready()
  expect(b.selection?.type).toBe('use-skill')
  expect(battle.getActionLog()).toMatchObject([{ turn: 0, selection: b.selection }])
  expect(await system.getPlayerTimerState(b.id)).toMatchObject({ state: 'paused', remainingTurnTime: 30 })
  await vi.advanceTimersByTimeAsync(1000)
  expect(await system.getPlayerTimerState(b.id)).toMatchObject({ state: 'paused', remainingTotalTime: 100 })
  expect(await system.getPlayerTimerState(a.id)).toMatchObject({ state: 'running', remainingTotalTime: 99 })
  await system.submitAction((await system.getAvailableSelection(a.id)).find(action => action.type === 'use-skill')!)
  await battle.waitForInputReady()
  expect(battle.currentTurn).toBe(1)
  expect(battle.isSnapshotBoundary()).toBe(true)
  expect(battle.getActionLog().map(entry => entry.selection.player)).toEqual([b.id, a.id, b.id])
  const saved = await system.createRuntimeSnapshot(),
    savedState = await system.getState(undefined, true),
    action = (await system.getAvailableSelection(a.id)).find(action => action.type === 'use-skill')!
  await system.submitAction(action)
  await battle.waitForInputReady()
  const rngState = async (system: LocalBattleSystemV4) => {
    const frame = JSON.parse((await system.createRuntimeSnapshot()).payload).battle
    return frame.nodes[frame.nodes[frame.root.ref].fields.rngState.ref].fields
  }
  const expected = await system.getState(undefined, true),
    expectedLog = battle.getActionLog(),
    expectedRng = await rngState(system)
  expect(expectedRng).toMatchObject({ algorithm: 'sfc32-v1' })
  expect(expected.currentTurn).toBe(2)
  await system.cleanup()
  const fresh = content(),
    [c, d] = fresh.parsePlayers(teams),
    placeholder = fresh.createBattle(c, d)
  battles.push(placeholder)
  let restored: Battle | undefined
  const target = new LocalBattleSystemV4(placeholder, {
    snapshot: fresh.snapshot,
    restore: data => (restored = fresh.restore(data)),
  })
  systems.push(target)
  await target.restoreRuntimeSnapshot(saved)
  expect(restored!.playerB).toBeInstanceOf(AIPlayer)
  await target.ready()
  expect(await target.getState(undefined, true)).toEqual(savedState)
  expect(restored!.getActionLog()).toHaveLength(3)
  await target.submitAction(action)
  await restored!.waitForInputReady()
  expect(await target.getState(undefined, true)).toEqual(expected)
  expect(restored!.getActionLog()).toEqual(expectedLog)
  expect(await rngState(target)).toEqual(expectedRng)
})

it('validates AI identities before allocating a native player batch', () => {
  const directory = content()
  expect(() => directory.parsePlayers(input.teams, { aiPlayerIds: ['foreign'] })).toThrow('Unknown AI player')
  expect(AttributeSystem.getGlobalMemoryStats().totalInstances).toBe(baseline)
})

for (const request of ['forced', 'faint'] as const)
  it(`records the existing AI's ${request} switch decision and pauses its clock`, async () => {
    vi.useFakeTimers()
    const directory = content(),
      teams = input.teams.map((team, index) => ({ ...structuredClone(team), id: String(index).repeat(21) })),
      [a, b] = directory.parsePlayers(teams, { aiPlayerIds: [teams[1].id] }),
      battle = directory.createBattle(a, b, {
        rngSeed: `native-ai/${request}`,
        allowFaintSwitch: true,
        timerConfig: { enabled: true, turnTimeLimit: 30, totalTimeLimit: 100 },
      }),
      system = new LocalBattleSystemV4(battle, directory)
    battles.push(battle)
    systems.push(system)
    if (request === 'forced') b.activePet.currentHp = 0
    else {
      a.activePet.currentHp = 0
      battle.lastKiller = b
    }
    await system.ready()
    const accepted = battle.getActionLog()[0]
    expect(accepted.selection.player).toBe(b.id)
    expect(request === 'forced' ? ['switch-pet'] : ['do-nothing', 'switch-pet']).toContain(accepted.selection.type)
    expect(await system.getPlayerTimerState(b.id)).toMatchObject({ state: 'paused' })
    if (request === 'faint') {
      await system.submitAction(
        (await system.getAvailableSelection(a.id)).find(action => action.type === 'switch-pet')!,
      )
      await battle.waitForInputReady()
    }
    expect(battle.currentTurn).toBe(0)
    expect(battle.getActionLog().at(-1)?.selection.player).toBe(b.id)
  })

for (const invalid of [
  'duplicate',
  'missing-dependency',
  'unknown-mark-effect',
  'unknown-skill-effect',
  'invalid-skill',
] as const)
  it(`rejects incomplete native content: ${invalid}`, () => {
    const changed = structuredClone(data) as {
      marks: { id: string; effect?: string[] }[]
      skills: { id: string; effect?: string[]; power?: number }[]
      species: unknown[]
    }
    if (invalid === 'duplicate') changed.marks.push(changed.marks[0])
    if (invalid === 'missing-dependency')
      changed.marks = changed.marks.filter(mark => mark.id !== 'mark_shuiwenpingzhang')
    if (invalid === 'unknown-mark-effect') changed.marks[0].effect = ['fixture/unknown-native']
    if (invalid === 'unknown-skill-effect') changed.skills[0].effect = ['fixture/unknown-native']
    if (invalid === 'invalid-skill') Reflect.set(changed.skills[0], 'power', 'invalid')
    expect(() => createOfficialContent(changed, revision)).toThrow()
  })

it('keeps prototype references and editable parameters local to independent directories and battles', () => {
  const first = content(),
    second = content()
  const worlds = [first, second].map(directory => {
    const [a, b] = input.teams.map(team => directory.parsePlayer(team))
    const battle = directory.createBattle(a, b, { timerConfig: { enabled: false } })
    battles.push(battle)
    expect(a.activePet.originalSpecies).toBe(directory.getSpecies(a.activePet.originalSpecies.id))
    expect(a.activePet.skills[0].base).toBe(directory.getSkill(a.activePet.skills[0].baseId))
    return battle
  })
  expect(first.getMark('mark_shuiwenpingzhang' as baseMarkId)).not.toBe(
    second.getMark('mark_shuiwenpingzhang' as baseMarkId),
  )
  const alias = 'effect_skill_add_mark_shuiwenpingzhang.multiply_value'
  first.parametersFor('effect_skill_add_mark_shuiwenpingzhang')!.set(worlds[0].configSystem, alias, 1.5)
  expect(first.parametersFor('effect_skill_add_mark_shuiwenpingzhang')!.read(worlds[0].configSystem, alias)).toBe(1.5)
  expect(second.parametersFor('effect_skill_add_mark_shuiwenpingzhang')!.read(worlds[1].configSystem, alias)).toBe(1)
  expect(() => second.snapshot(worlds[0])).toThrow('different content directory')
  expect(() => second.createBattle(worlds[0].playerA, worlds[0].playerB)).toThrow('Foreign content species')
})

async function play(checkpoint: boolean) {
  let directory = content()
  const [a, b] = input.teams.map(team => directory.parsePlayer(team))
  let battle = directory.createBattle(a, b, { rngSeed: 201, timerConfig: { enabled: false }, showHidden: true })
  battles.push(battle)
  const indexes = [0, 0],
    trace: unknown[] = [],
    errors: string[] = []
  let stopped!: () => void
  const boundary = new Promise<void>(resolve => {
    stopped = resolve
  })
  const alias = 'effect_skill_add_mark_shuiwenpingzhang.multiply_value'
  directory.parametersFor('effect_skill_add_mark_shuiwenpingzhang')!.set(battle.configSystem, alias, 1.5)
  const submit = (side: number) => {
    const player = [battle.playerA, battle.playerB][side]
    const plan = input.actions[side === 0 ? 'A' : 'B'][indexes[side]++]
    if (!plan) throw new Error('Official native action script exhausted')
    const selection = battle.getAvailableSelection(player.id).find(selection => {
      if (selection.type !== plan.type) return false
      if (selection.type === 'use-skill')
        return battle.getSkillByID(selection.skill).baseId === ('skill' in plan ? plan.skill : '')
      if (selection.type === 'switch-pet')
        return battle.getPetByID(selection.pet).name === ('pet' in plan ? plan.pet : '')
      return true
    })
    if (!selection || !battle.setSelection(selection))
      throw new Error(`Official native action rejected: ${JSON.stringify(plan)}`)
  }
  const observe = (pause: boolean) =>
    battle.registerListener((message: BattleMessage) => {
      trace.push(message.type)
      if (message.type === BattleMessageType.TurnEnd)
        trace.push({
          turn: battle.currentTurn,
          hp: [...battle.playerA.team, ...battle.playerB.team].map(pet => pet.currentHp),
          rage: [battle.playerA.currentRage, battle.playerB.currentRage],
        })
      if (([BattleMessageType.EffectApplyFail, BattleMessageType.Error] as BattleMessageType[]).includes(message.type))
        errors.push(message.type)
      try {
        if (message.type === BattleMessageType.TurnAction) {
          if (pause && battle.currentTurn === 2) {
            stopped()
            return
          }
          submit(0)
          submit(1)
        }
        if (message.type === BattleMessageType.ForcedSwitch)
          for (const id of message.data.player)
            submit([battle.playerA, battle.playerB].findIndex(player => player.id === id))
        if (message.type === BattleMessageType.FaintSwitch)
          submit([battle.playerA, battle.playerB].findIndex(player => player.id === message.data.player))
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Unknown official native action error')
        void battle.cleanup()
      }
    })
  const cancelled = (error: Error) => {
    if (error.message !== 'Battle cancelled') throw error
  }
  observe(checkpoint)
  let running = battle.startBattle().catch(cancelled)
  try {
    if (checkpoint) {
      await Promise.race([
        boundary,
        running.then(() => {
          throw new Error('Official game ended before checkpoint')
        }),
      ])
      const saved = JSON.parse(JSON.stringify(directory.snapshot(battle)))
      await battle.cleanup()
      await running
      directory = content()
      battle = directory.restore(saved)
      battles.push(battle)
      expect(battle.playerA.activePet.skills[0].base).toBe(
        directory.getSkill(battle.playerA.activePet.skills[0].baseId),
      )
      expect(directory.parametersFor('effect_skill_add_mark_shuiwenpingzhang')!.read(battle.configSystem, alias)).toBe(
        1.5,
      )
      observe(false)
      running = battle.resumeBattle().catch(cancelled)
      submit(0)
      submit(1)
    }
    await running
    expect(errors).toEqual([])
    expect(battle.phaseManager.getPhasesByState(PhaseState.Failed)).toEqual([])
    expect(battle.status).toBe(BattleStatus.Ended)
    expect(battle.currentTurn).toBe(7)
    expect(battle.victor?.name).toBe('A')
    expect(indexes).toEqual([8, 8])
    return trace
  } finally {
    await battle.cleanup()
    await running
  }
}

it('runs the complete native official game and resumes identical events with a fresh content directory', async () => {
  expect(await play(true)).toEqual(await play(false))
})
