import { beforeAll, describe, expect, test } from 'vitest'
import { GameRng } from '@arcadia-eternity/engine'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import { getTestRepository, runAutoBattleWithSeed } from './helpers/regression-helpers.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

describe('v2 rng regressions', () => {
  test('rng state restore is deterministic (GameRng.fromState)', () => {
    const rng = new GameRng('rng-restore')
    const checkpoint = rng.getState()
    const expectedTail = Array.from({ length: 12 }, () => rng.next())
    const restored = GameRng.fromState(checkpoint)
    const actualTail = Array.from({ length: 12 }, () => restored.next())
    expect(actualTail).toEqual(expectedTail)
  })

  test('same seed auto battle yields identical result summary', async () => {
    const r1 = await runAutoBattleWithSeed(repo, 'rng-battle-same-seed')
    const r2 = await runAutoBattleWithSeed(repo, 'rng-battle-same-seed')
    expect(r2).toEqual(r1)
  })

  test('different seeds produce diversified auto battle summaries', async () => {
    const seeds = [
      'rng-battle-div-1',
      'rng-battle-div-2',
      'rng-battle-div-3',
      'rng-battle-div-4',
      'rng-battle-div-5',
    ]
    const results = await Promise.all(seeds.map(seed => runAutoBattleWithSeed(repo, seed)))
    const signatures = new Set(results.map(result => JSON.stringify(result)))
    expect(signatures.size).toBeGreaterThan(1)
  })
})
