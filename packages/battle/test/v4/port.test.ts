import { describe, it, expect, beforeAll } from 'vitest'
import { setGlobalLogger, type Battle } from '@arcadia-eternity/battle/v4'
import { runScenario } from './scenario'
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
describe('direct original V1 port', () => {
  it('executes the complete real Battle loop with skills, marks, rage, switches and settlement', async () => {
    const result = await runScenario()
    expect(result.turn).toBe(4)
    expect(result.winner).toBe('A')
    expect(result.counters).toEqual({ created: 1, expired: 1, destroyed: 1, ticked: 2, hits: 1 })
    expect(result.end).toEqual([{ winner: 'A', reason: 'all_pet_fainted' }])
    expect(result.switches).toHaveLength(2)
    expect(result.checkpoints).toEqual([
      { turn: 1, rage: [35, 48], hp: [246, 260, 80, 80], accuracy: 90, atk: 82.5 },
      { turn: 2, rage: [45, 76], hp: [246, 247, 80, 80], accuracy: 100, atk: 82.5 },
      { turn: 3, rage: [75, 100], hp: [246, 247, 0, 80], accuracy: 100, atk: 82.5 },
      { turn: 4, rage: [100, 100], hp: [246, 247, 0, 0], accuracy: 100, atk: 82.5 },
    ])
  })
})

it('runs the #201 roster and explicit actions through original V1 YAML parsers and EffectBuilder', async () => {
  const { runHistoricalOfficial } = await import('./official')
  const result = await runHistoricalOfficial()
  expect(result.turn).toBe(7)
  expect(result.winner).toBe('A')
  expect(result.content).toEqual({ counts: { effects: 666, marks: 280, skills: 576, species: 91 }, failures: [] })
  expect(result.indexes).toEqual([8, 8])
  expect(result.effects.map(e => e.effect)).toContain('effect_skill_add_mark_hunzhuoshuiyu')
  expect(result.effects.map(e => e.effect)).toContain('effect_skill_raise_atk_1_stage')
  expect(result.checkpoints.map(c => c.hp)).toEqual([
    [296, 300, 30, 30],
    [283, 300, 30, 30],
    [283, 300, 30, 30],
    [283, 300, 11, 30],
    [283, 300, 0, 30],
    [283, 284, 0, 11],
    [283, 284, 0, 0],
  ])
}, 30000)

it('saves actual historical YAML effects and resumes without replaying the first two turns', async () => {
  const { SnapshotCatalog, snapshotBattle, restoreBattle, BattleMessageType } =
    await import('@arcadia-eternity/battle/v4')
  const { DataRepository } = await import('@arcadia-eternity/battle/v4/legacy')
  const { createHistoricalOfficialBattle } = await import('./official')
  const { default: input } = await import('../../src/v2/__tests__/fixtures/baseline/official-switch.input.json')
  const { battle } = await createHistoricalOfficialBattle()
  const repo = DataRepository.getInstance(),
    catalog = new SnapshotCatalog('historical/c0862898')
  for (const [key, effect] of repo.effects) catalog.registerEffect(key, effect)
  for (const [kind, items] of [
    ['species', repo.species],
    ['skill', repo.skills],
    ['mark', repo.marks],
  ] as const)
    for (const [key, value] of items) catalog.registerContent(`${kind}:${key}`, value)
  function submit(b: Battle, indexes: number[], side: number) {
    const player = [b.playerA, b.playerB][side],
      plan = input.actions[side === 0 ? 'A' : 'B'][indexes[side]++]
    const selection = b.getAvailableSelection(player.id).find(s => {
      if (s.type !== plan.type) return false
      if (s.type === 'use-skill') return b.getSkillByID(s.skill).baseId === ('skill' in plan ? plan.skill : '')
      if (s.type === 'switch-pet') return b.getPetByID(s.pet).name === ('pet' in plan ? plan.pet : '')
      return true
    })
    if (!selection || !b.setSelection(selection)) throw new Error('Historical continuation action rejected')
  }
  function nextPrompt(b: Battle) {
    return new Promise<void>(resolve => {
      const listener = (m: import('@arcadia-eternity/battle/v4').BattleMessage) => {
        if (m.type === BattleMessageType.TurnAction) {
          b.unregisterListener(listener)
          resolve()
        }
      }
      b.registerListener(listener)
    })
  }
  function drive(b: Battle) {
    const indexes = [2, 2],
      events: string[] = [],
      damage: number[] = []
    b.registerListener(m => {
      events.push(m.type)
      if (m.type === BattleMessageType.Damage) damage.push(m.data.damage)
      if (m.type === BattleMessageType.TurnAction) {
        submit(b, indexes, 0)
        submit(b, indexes, 1)
      }
      if (m.type === BattleMessageType.ForcedSwitch)
        for (const id of m.data.player) submit(b, indexes, id === b.playerA.id ? 0 : 1)
      if (m.type === BattleMessageType.FaintSwitch) submit(b, indexes, m.data.player === b.playerA.id ? 0 : 1)
    })
    return {
      indexes,
      events,
      damage,
      submit: () => {
        submit(b, indexes, 0)
        submit(b, indexes, 1)
      },
    }
  }
  let resumedBattle: Battle | undefined
  let pending = nextPrompt(battle)
  const original = battle.startBattle()
  try {
    await pending
    const indexes = [0, 0]
    for (let turn = 0; turn < 2; turn++) {
      pending = nextPrompt(battle)
      submit(battle, indexes, 0)
      submit(battle, indexes, 1)
      await pending
    }
    expect(battle.currentTurn).toBe(2)
    expect(battle.playerA.activePet.marks.some(m => m.baseId === 'stat_stage_atk_up')).toBe(true)
    const payload = JSON.parse(JSON.stringify(snapshotBattle(battle, catalog)))
    const expectedFlow = drive(battle)
    expectedFlow.submit()
    await original
    const expected = {
      turn: battle.currentTurn,
      victor: battle.victor?.name,
      hp: [battle.playerA, battle.playerB].flatMap(p => p.team.map(pet => pet.currentHp)),
      rage: [battle.playerA.currentRage, battle.playerB.currentRage],
    }
    await battle.cleanup()
    resumedBattle = restoreBattle(payload, catalog)
    const flow = drive(resumedBattle),
      resumed = resumedBattle.resumeBattle()
    flow.submit()
    await resumed
    expect(flow.events).toEqual(expectedFlow.events)
    expect(flow.damage).toEqual(expectedFlow.damage)
    expect({
      turn: resumedBattle.currentTurn,
      victor: resumedBattle.victor?.name,
      hp: [resumedBattle.playerA, resumedBattle.playerB].flatMap(p => p.team.map(pet => pet.currentHp)),
      rage: [resumedBattle.playerA.currentRage, resumedBattle.playerB.currentRage],
    }).toEqual(expected)
    expect(expected).toEqual({ turn: 7, victor: 'A', hp: [283, 284, 0, 0], rage: [100, 100] })
  } finally {
    await battle.cleanup()
    await resumedBattle?.cleanup()
    await original.catch(() => {})
  }
}, 60000)
