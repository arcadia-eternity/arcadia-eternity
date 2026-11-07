import { setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { beforeAll, describe, expect, it } from 'vitest'
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
