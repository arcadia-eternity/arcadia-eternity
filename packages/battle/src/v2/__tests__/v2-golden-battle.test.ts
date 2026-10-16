import { beforeAll, describe, expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import { getTestRepository } from './helpers/regression-helpers.js'
import { runGoldenBattle, type GoldenScenario } from './helpers/golden-battle.js'

let repo: V2DataRepository
beforeAll(async () => {
  repo = await getTestRepository()
})

describe('V2 → V1 headless golden baseline', () => {
  test('official skills, marks, rage and switches through a complete battle', async () => {
    const scenario: GoldenScenario = JSON.parse(
      await readFile(new URL('./fixtures/baseline/official-switch.input.json', import.meta.url), 'utf8'),
    )
    const result = await runGoldenBattle(repo, scenario)
    expect(result.final.victor).toBe('A')
    expect(result.events.map(event => event.type)).toEqual(
      expect.arrayContaining([
        'battleStart',
        'turnStart',
        'skillUse',
        'damage',
        'rageChange',
        'markAdd',
        'markUpdate',
        'markExpire',
        'markCleanup',
        'statStageChange',
        'switchOut',
        'switchIn',
        'petDefeated',
        'forcedSwitch',
        'faintSwitch',
        'battleEnd',
      ]),
    )
    expect(result.triggers).toEqual(
      expect.arrayContaining([
        'OnBattleStart',
        'TurnStart',
        'BeforeUseSkillCheck',
        'OnHit',
        'OnDamage',
        'OnMarkCreated',
        'OnMarkDurationEnd',
        'OnSwitchOut',
        'OnSwitchIn',
        'OnDefeat',
        'TurnEnd',
      ]),
    )
    expect(result.final.players[1].pets.every(pet => !pet.alive && pet.hp === 0)).toBe(true)
    // Fresh worlds generate different instance IDs; normalization must preserve replay equivalence.
    expect(await runGoldenBattle(repo, scenario)).toEqual(result)
    await expect(JSON.stringify(result, null, 2) + '\n').toMatchFileSnapshot(
      './fixtures/baseline/official-switch.golden.json',
    )
  })
})
