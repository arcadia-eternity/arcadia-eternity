import { beforeAll, describe, expect, test } from 'vitest'
import { Gender } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import { resolveSelector } from '../systems/interpreter/selector.js'
import type { BattleWorld } from '../types/battle-world.js'
import { BATTLE_OWNER_ID } from '../systems/mark.system.js'
import { getBattlePlayerIds, getTestRepository, makeTeamConfig } from './helpers/regression-helpers.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

describe('selector entity-navigation', () => {
  test('resolveSelector(world, systems, entityId, "self") returns [entityId]', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng'], Gender.Female),
      repo,
      { seed: 'entity-nav-self' },
    )
    const { world, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const sourcePet = playerSystem.getActivePet(world, playerAId)
    const systems = (world as BattleWorld).systems

    const result = resolveSelector(world, systems, sourcePet.id, 'self') as string[]
    expect(result).toEqual([sourcePet.id])
  })

  test('resolveSelector(world, systems, entityId, "opponent") returns opponent active pet', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng'], Gender.Female),
      repo,
      { seed: 'entity-nav-opponent' },
    )
    const { world, playerSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const sourcePet = playerSystem.getActivePet(world, playerAId)
    const opponentPet = playerSystem.getActivePet(world, playerBId)
    const systems = (world as BattleWorld).systems

    const result = resolveSelector(world, systems, sourcePet.id, 'opponent') as string[]
    expect(result).toEqual([opponentPet.id])
  })

  test('resolveSelector(world, systems, entityId, "selfMarks") returns marks on source pet', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng'], Gender.Female),
      repo,
      { seed: 'entity-nav-selfMarks' },
    )
    const { world, playerSystem, markSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const sourcePet = playerSystem.getActivePet(world, playerAId)
    const systems = (world as BattleWorld).systems

    const firstMark = repo.allMarks().next().value
    if (!firstMark) throw new Error('no marks in repo')
    const createdMark = markSystem.createFromBase(world, firstMark)
    markSystem.attach(world, createdMark.id, sourcePet.id, 'pet')

    const expectedMarkIds = markSystem.getMarksOnEntity(world, sourcePet.id).map(m => m.id)
    expect(expectedMarkIds.length).toBeGreaterThan(0)

    const result = resolveSelector(world, systems, sourcePet.id, 'selfMarks') as string[]
    expect(result.sort()).toEqual(expectedMarkIds.sort())
  })

  test('resolveSelector(world, systems, entityId, "battle") returns [BATTLE_OWNER_ID]', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng'], Gender.Female),
      repo,
      { seed: 'entity-nav-battle' },
    )
    const { world, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const sourcePet = playerSystem.getActivePet(world, playerAId)
    const systems = (world as BattleWorld).systems

    const result = resolveSelector(world, systems, sourcePet.id, 'battle') as string[]
    expect(result).toEqual([BATTLE_OWNER_ID])
  })

  test('context selector via entity navigation reads from world.currentContextEntityId', () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng'], Gender.Female),
      repo,
      { seed: 'entity-nav-context' },
    )
    const { world, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const sourcePet = playerSystem.getActivePet(world, playerAId)
    const systems = (world as BattleWorld).systems

    const fakeContextEntityId = 'ctx_fake_use_skill'
    world.currentContextEntityId = fakeContextEntityId

    const result = resolveSelector(world, systems, sourcePet.id, 'useSkillContext') as Array<{ type: string }>
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].type).toBe('use-skill')
  })
})
