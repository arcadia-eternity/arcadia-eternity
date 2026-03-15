import { beforeAll, describe, expect, test } from 'vitest'
import { Gender } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import {
  findSkillInstanceIdByBaseId,
  getBattlePlayerIds,
  getTestRepository,
  makeTeamConfig,
  makeUseSkillContextFromSkill,
} from './helpers/regression-helpers.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

describe('v2 stat-stage regressions', () => {
  test('stage add clamps to [-6, 6]', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      repo,
      { seed: 'regression-stage-clamp' },
    )
    const { world, phaseManager, eventBus, statStageSystem, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'add',
      entityId: petA.id,
      stat: 'atk',
      delta: 10,
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(6)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'add',
      entityId: petA.id,
      stat: 'atk',
      delta: -20,
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(-6)
  })

  test('stage delta crossing zero works: -1 +2 => +1, +1 -2 => -1', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      repo,
      { seed: 'regression-stage-cross-zero' },
    )
    const { world, phaseManager, eventBus, statStageSystem, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'atk',
      value: -1,
    })
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'add',
      entityId: petA.id,
      stat: 'atk',
      delta: 2,
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(1)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'atk',
      value: 1,
    })
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'add',
      entityId: petA.id,
      stat: 'atk',
      delta: -2,
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(-1)
  })

  test('stage delta to zero works: -1 +1 => 0, +1 -1 => 0', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      repo,
      { seed: 'regression-stage-to-zero' },
    )
    const { world, phaseManager, eventBus, statStageSystem, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'spa',
      value: -1,
    })
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'add',
      entityId: petA.id,
      stat: 'spa',
      delta: 1,
    })
    expect(statStageSystem.getStage(world, petA.id, 'spa')).toBe(0)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'spa',
      value: 1,
    })
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'add',
      entityId: petA.id,
      stat: 'spa',
      delta: -1,
    })
    expect(statStageSystem.getStage(world, petA.id, 'spa')).toBe(0)
  })

  test('clear stat stage respects positive/negative/all strategy', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      repo,
      { seed: 'regression-stage-clear' },
    )
    const { world, phaseManager, eventBus, statStageSystem, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'atk',
      value: 3,
    })
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'def',
      value: -2,
    })

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'clear',
      entityId: petA.id,
      stats: ['atk', 'def'],
      cleanStageStrategy: 'positive',
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(0)
    expect(statStageSystem.getStage(world, petA.id, 'def')).toBe(-2)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'clear',
      entityId: petA.id,
      stats: ['atk', 'def'],
      cleanStageStrategy: 'negative',
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(0)
    expect(statStageSystem.getStage(world, petA.id, 'def')).toBe(0)
  })

  test('reverse stat stage respects positive/negative/all strategy', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      repo,
      { seed: 'regression-stage-reverse' },
    )
    const { world, phaseManager, eventBus, statStageSystem, playerSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'atk',
      value: 2,
    })
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'def',
      value: -3,
    })

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'reverse',
      entityId: petA.id,
      stats: ['atk', 'def'],
      cleanStageStrategy: 'positive',
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(-2)
    expect(statStageSystem.getStage(world, petA.id, 'def')).toBe(-3)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'reverse',
      entityId: petA.id,
      stats: ['atk', 'def'],
      cleanStageStrategy: 'negative',
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(2)
    expect(statStageSystem.getStage(world, petA.id, 'def')).toBe(3)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'reverse',
      entityId: petA.id,
      stats: ['atk', 'def'],
      cleanStageStrategy: 'all',
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(-2)
    expect(statStageSystem.getStage(world, petA.id, 'def')).toBe(-3)
  })

  test('transfer stat stage respects strategy and moves stages between pets', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_huanli', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-stage-transfer' },
    )
    const { world, phaseManager, eventBus, statStageSystem, playerSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'atk',
      value: -3,
    })
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'def',
      value: 2,
    })

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'transfer',
      sourceEntityId: petA.id,
      targetEntityId: petB.id,
      cleanStageStrategy: 'negative',
      stats: ['atk', 'def'],
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(0)
    expect(statStageSystem.getStage(world, petA.id, 'def')).toBe(2)
    expect(statStageSystem.getStage(world, petB.id, 'atk')).toBe(-3)
    expect(statStageSystem.getStage(world, petB.id, 'def')).toBe(0)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'transfer',
      sourceEntityId: petA.id,
      targetEntityId: petB.id,
      cleanStageStrategy: 'all',
      stats: ['atk', 'def'],
    })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(0)
    expect(statStageSystem.getStage(world, petA.id, 'def')).toBe(0)
    expect(statStageSystem.getStage(world, petB.id, 'atk')).toBe(-3)
    expect(statStageSystem.getStage(world, petB.id, 'def')).toBe(2)
  })

  test('doubled stage debuff can be reversed to doubled buff', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_huanli', ['skill_hunzhuoshuiyu', 'skill_wanyouyinli'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-stage-double-then-reverse' },
    )
    const { world, playerSystem, skillSystem, phaseManager, eventBus, markSystem, statStageSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)

    const muddySkillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_hunzhuoshuiyu',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const debuffSkillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_wanyouyinli',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )

    const muddyCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: muddySkillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'muddy-field-phase',
    })
    await phaseManager.execute(world, 'skill', eventBus, { context: muddyCtx })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_hunzhuoshuiyu')).toBeDefined()

    playerSystem.setRage(world, playerAId, 100)
    const debuffCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: debuffSkillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'double-debuff-phase',
    })
    await phaseManager.execute(world, 'skill', eventBus, { context: debuffCtx })
    expect(statStageSystem.getStage(world, petB.id, 'spe')).toBe(-2)

    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'reverse',
      entityId: petB.id,
      cleanStageStrategy: 'negative',
      stats: ['spe'],
    })
    expect(statStageSystem.getStage(world, petB.id, 'spe')).toBe(2)
  })
})
