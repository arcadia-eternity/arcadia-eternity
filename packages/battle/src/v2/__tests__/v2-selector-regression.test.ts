import { beforeAll, describe, expect, test } from 'vitest'
import { Gender } from '@arcadia-eternity/const'
import type { SelectorDSL } from '@arcadia-eternity/schema'
import { createBattleFromConfig } from '../data/battle-factory.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import { resolveSelector } from '../systems/interpreter/selector.js'
import type { InterpreterContext } from '../systems/interpreter/context.js'
import {
  getBattlePlayerIds,
  getTestRepository,
  makeTeamConfig,
} from './helpers/regression-helpers.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

function makeCtx(sourceEntityId: string, battle: ReturnType<typeof createBattleFromConfig>): InterpreterContext {
  return {
    world: battle.world,
    systems: battle.world.systems as unknown as InterpreterContext['systems'],
    fireCtx: {
      trigger: 'selector-test',
      sourceEntityId,
    },
  }
}

describe('v2 selector regressions', () => {
  test('dataMarks selector supports whereAttr(tags) and returns base mark ids', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng'], Gender.Female),
      repo,
      { seed: 'selector-data-marks' },
    )
    const { world, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const sourcePet = playerSystem.getActivePet(world, playerAId)
    const ctx = makeCtx(sourcePet.id, battle)

    const selector: SelectorDSL = {
      base: 'dataMarks',
      chain: [
        {
          type: 'whereAttr',
          extractor: { type: 'base', arg: 'tags' },
          evaluator: { type: 'contain', tag: 'status' },
        },
        { type: 'limit', arg: 5 },
      ],
    }

    const result = resolveSelector(ctx, selector) as string[]
    expect(result.length).toBeGreaterThan(0)
    for (const baseMarkId of result) {
      const mark = repo.findMark(baseMarkId)
      expect(mark).toBeDefined()
      expect(mark?.tags.includes('status')).toBe(true)
    }
  })

  test('opponentSkills selector returns opponent active pet skill ids', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng', 'skill_huoqiu'], Gender.Female),
      repo,
      { seed: 'selector-opponent-skills' },
    )
    const { world, playerSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const sourcePet = playerSystem.getActivePet(world, playerAId)
    const opponentPet = playerSystem.getActivePet(world, playerBId)
    const ctx = makeCtx(sourcePet.id, battle)

    const result = resolveSelector(ctx, 'opponentSkills') as string[]
    expect([...result].sort()).toEqual([...opponentPet.skillIds].sort())
  })

  test('opponentAvailableSkills returns empty when opponent active pet is missing', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng'], Gender.Female),
      repo,
      { seed: 'selector-opponent-available-skills' },
    )
    const { world, playerSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const sourcePet = playerSystem.getActivePet(world, playerAId)
    const opponentPlayer = playerSystem.get(world, playerBId)
    if (!opponentPlayer) throw new Error('opponent player missing in test setup')
    opponentPlayer.activePetId = ''
    const ctx = makeCtx(sourcePet.id, battle)

    expect(() => resolveSelector(ctx, 'opponentAvailableSkills')).not.toThrow()
    expect(resolveSelector(ctx, 'opponentAvailableSkills')).toEqual([])
  })
})
