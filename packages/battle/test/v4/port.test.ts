import { describe, it, expect, beforeAll } from 'vitest'
import { setGlobalLogger } from '@arcadia-eternity/battle/v4'
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
      { turn: 1, rage: [33, 48], hp: [248, 260, 80, 80], accuracy: 90, atk: 82.5 },
      { turn: 2, rage: [41, 76], hp: [248, 247, 80, 80], accuracy: 100, atk: 82.5 },
      { turn: 3, rage: [71, 91], hp: [248, 247, 0, 80], accuracy: 100, atk: 82.5 },
      { turn: 4, rage: [100, 87], hp: [248, 247, 0, 0], accuracy: 100, atk: 82.5 },
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
    [298, 300, 30, 30],
    [284, 300, 30, 30],
    [284, 300, 30, 30],
    [284, 273, 11, 30],
    [284, 273, 0, 30],
    [284, 255, 0, 12],
    [284, 255, 0, 0],
  ])
}, 30000)
