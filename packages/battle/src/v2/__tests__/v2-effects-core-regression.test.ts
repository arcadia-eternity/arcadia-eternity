import { beforeAll, describe, expect, test } from 'vitest'
import { EffectTrigger, Gender, IgnoreStageStrategy } from '@arcadia-eternity/const'
import type { PhaseDef } from '@arcadia-eternity/engine'
import { GameRng } from '@arcadia-eternity/engine'
import { createBattleFromConfig } from '../data/battle-factory.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import {
  findSkillInstanceIdByBaseId,
  getBattlePlayerIds,
  getTestRepository,
  makeTeamConfig,
  makeUseSkillContext,
  makeUseSkillContextFromSkill,
} from './helpers/regression-helpers.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

function withTurnPhase(
  world: { phaseStack: PhaseDef[] },
  phaseId: string,
  plannedSkillPetIds: string[],
  executedSkillPetIds: string[],
  run: () => Promise<void>,
): Promise<void> {
  const phase: PhaseDef = {
    id: phaseId,
    type: 'turn',
    state: 'executing',
    data: {
      plannedSkillPetIds,
      executedSkillPetIds,
      context: { type: 'turn', parentId: 'test-phase' },
    },
  }
  world.phaseStack.push(phase)
  return run().finally(() => {
    const idx = world.phaseStack.lastIndexOf(phase)
    if (idx >= 0) world.phaseStack.splice(idx, 1)
  })
}

describe('v2 core effect regressions', () => {
  test('female-only skill effect increases power (skill_qinangdan)', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_huanli', ['skill_qinangdan'], Gender.Female),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-gender' },
    )
    const { world, playerSystem, petSystem, skillSystem, effectPipeline } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_qinangdan',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )

    const basePower = skillSystem.getPower(world, skillId)
    const ctx = makeUseSkillContext({
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      targetId: petB.id,
      power: basePower,
      element: skillSystem.getElement(world, skillId),
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: ctx,
    })

    expect(petSystem.getGender(world, petA.id)).toBe(Gender.Female)
    expect(basePower).toBe(70)
    expect(ctx.power).toBe(100)
  })

  test('global weather mark amplifies electric power by 35% (mark_global_leibaotian)', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_huanli', ['skill_shanguangji'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-weather' },
    )
    const { world, phaseManager, eventBus, playerSystem, skillSystem, effectPipeline, markSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const electricSkillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_shanguangji',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const basePower = skillSystem.getPower(world, electricSkillId)

    const noWeatherCtx = makeUseSkillContext({
      petId: petA.id,
      skillId: electricSkillId,
      originPlayerId: playerAId,
      targetId: petB.id,
      power: basePower,
      element: skillSystem.getElement(world, electricSkillId),
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: noWeatherCtx,
    })
    expect(noWeatherCtx.power).toBe(basePower)

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: 'battle',
        baseMarkId: 'mark_global_leibaotian',
        stack: 1,
        duration: 999,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, 'battle', 'mark_global_leibaotian')).toBeDefined()

    const weatherCtx = makeUseSkillContext({
      petId: petA.id,
      skillId: electricSkillId,
      originPlayerId: playerAId,
      targetId: petB.id,
      power: basePower,
      element: skillSystem.getElement(world, electricSkillId),
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: weatherCtx,
    })

    expect(basePower).toBe(60)
    expect(weatherCtx.power).toBeCloseTo(81, 6)
  })

  test('memory replay transforms to last used skill and resets after using itself', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_huanli', ['skill_huiyizhongxian', 'skill_zhongji'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-memory-replay' },
    )
    const { world, playerSystem, skillSystem, effectPipeline } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const replaySkillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_huiyizhongxian',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const normalSkillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_zhongji',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )

    expect(skillSystem.get(world, replaySkillId)?.baseSkillId).toBe('skill_huiyizhongxian')
    const usingNormalCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: normalSkillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: usingNormalCtx,
    })
    expect(skillSystem.get(world, replaySkillId)?.baseSkillId).toBe('skill_zhongji')

    const usingReplayCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: replaySkillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    await effectPipeline.fire(world, EffectTrigger.SkillUseEnd, {
      trigger: EffectTrigger.SkillUseEnd,
      sourceEntityId: petA.id,
      context: usingReplayCtx,
    })
    expect(skillSystem.get(world, replaySkillId)?.baseSkillId).toBe('skill_huiyizhongxian')
  })

  test('badetouchou doubles power only on first round', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_xiuyier', ['skill_badetouchou'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-badetouchou-round1' },
    )
    const { world, playerSystem, skillSystem, effectPipeline } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_badetouchou',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const basePower = skillSystem.getPower(world, skillId)

    world.state.currentTurn = 1
    const turn1Ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: turn1Ctx,
    })
    expect(turn1Ctx.power).toBe(basePower * 2)

    world.state.currentTurn = 2
    const turn2Ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: turn2Ctx,
    })
    expect(turn2Ctx.power).toBe(basePower)
  })

  test('baoya doubles power when acting first in the turn', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_xiuyier', ['skill_baoya'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-baoya-first' },
    )
    const { world, playerSystem, skillSystem, effectPipeline } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_baoya',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const basePower = skillSystem.getPower(world, skillId)
    const turnPhaseId = 'turn-phase-baoya'

    await withTurnPhase(world, turnPhaseId, [petA.id, petB.id], [petA.id, petB.id], async () => {
      const firstCtx = makeUseSkillContextFromSkill({
        battle,
        petId: petA.id,
        skillId,
        originPlayerId: playerAId,
        fallbackTargetId: petB.id,
        parentId: turnPhaseId,
      })
      await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
        trigger: EffectTrigger.AfterUseSkillCheck,
        sourceEntityId: petA.id,
        context: firstCtx,
      })
      expect(firstCtx.power).toBe(basePower * 2)
    })

    await withTurnPhase(world, turnPhaseId, [petB.id, petA.id], [petB.id, petA.id], async () => {
      const secondCtx = makeUseSkillContextFromSkill({
        battle,
        petId: petA.id,
        skillId,
        originPlayerId: playerAId,
        fallbackTargetId: petB.id,
        parentId: turnPhaseId,
      })
      await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
        trigger: EffectTrigger.AfterUseSkillCheck,
        sourceEntityId: petA.id,
        context: secondCtx,
      })
      expect(secondCtx.power).toBe(basePower)
    })
  })

  test('bairen doubles power when acting last in the turn', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_bairen'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-bairen-last' },
    )
    const { world, playerSystem, skillSystem, effectPipeline } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_bairen',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const basePower = skillSystem.getPower(world, skillId)
    const turnPhaseId = 'turn-phase-bairen'

    await withTurnPhase(world, turnPhaseId, [petB.id, petA.id], [petB.id, petA.id], async () => {
      const lastCtx = makeUseSkillContextFromSkill({
        battle,
        petId: petA.id,
        skillId,
        originPlayerId: playerAId,
        fallbackTargetId: petB.id,
        parentId: turnPhaseId,
      })
      await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
        trigger: EffectTrigger.AfterUseSkillCheck,
        sourceEntityId: petA.id,
        context: lastCtx,
      })
      expect(lastCtx.power).toBe(basePower * 2)
    })

    await withTurnPhase(world, turnPhaseId, [petA.id, petB.id], [petA.id, petB.id], async () => {
      const notLastCtx = makeUseSkillContextFromSkill({
        battle,
        petId: petA.id,
        skillId,
        originPlayerId: playerAId,
        fallbackTargetId: petB.id,
        parentId: turnPhaseId,
      })
      await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
        trigger: EffectTrigger.AfterUseSkillCheck,
        sourceEntityId: petA.id,
        context: notLastCtx,
      })
      expect(notLastCtx.power).toBe(basePower)
    })
  })

  test('shanguangqie first-turn power boost increases actual damage output', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_guangyite', ['skill_shanguangqie'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-shanguangqie-first-damage' },
    )
    const { world, playerSystem, petSystem, skillSystem, phaseManager, eventBus, attrSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_shanguangqie',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const basePower = skillSystem.getPower(world, skillId)
    const initialRngState = ((world.systems as { rng: GameRng }).rng).getState()
    const maxHp = petSystem.getStatValue(world, petB.id, 'maxHp')

    // Keep runs deterministic and avoid crit noise.
    attrSystem.setBaseValue(world, petA.id, 'critRate', 0)

    const runDamage = async (
      phaseId: string,
      plannedSkillPetIds: string[],
      executedSkillPetIds: string[],
    ): Promise<{ power: number; damage: number }> => {
      ;(world.systems as { rng: GameRng }).rng = GameRng.fromState(initialRngState)
      petSystem.setCurrentHp(world, petB.id, maxHp)

      const ctx = makeUseSkillContextFromSkill({
        battle,
        petId: petA.id,
        skillId,
        originPlayerId: playerAId,
        fallbackTargetId: petB.id,
        parentId: phaseId,
      })
      ctx.accuracy = 100
      ctx.petAccuracy = 100
      ctx.evasion = 0

      await withTurnPhase(world, phaseId, plannedSkillPetIds, executedSkillPetIds, async () => {
        await phaseManager.execute(world, 'skill', eventBus, { context: ctx })
      })

      expect(ctx.hitResult).toBe(true)
      return {
        power: ctx.power,
        damage: maxHp - petSystem.getCurrentHp(world, petB.id),
      }
    }

    const first = await runDamage(
      'turn-phase-shanguangqie-first',
      [petA.id, petB.id],
      [petA.id, petB.id],
    )
    const notFirst = await runDamage(
      'turn-phase-shanguangqie-not-first',
      [petB.id, petA.id],
      [petB.id, petA.id],
    )

    expect(first.power).toBe(basePower * 2)
    expect(notFirst.power).toBe(basePower)
    expect(first.damage).toBeGreaterThan(notFirst.damage)
  })

  test('ignore stage strategy all ignores both sides stage effects in damage calculation', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-ignore-stage-all' },
    )
    const { world, playerSystem, skillSystem, phaseManager, eventBus, statStageSystem, petSystem, attrSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_shuipao',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )

    attrSystem.setBaseValue(world, petA.id, 'critRate', 0)
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petA.id,
      stat: 'spa',
      value: -6,
    })
    await phaseManager.execute(world, 'statStage', eventBus, {
      operation: 'set',
      entityId: petB.id,
      stat: 'spd',
      value: 6,
    })
    expect(statStageSystem.getStage(world, petA.id, 'spa')).toBe(-6)
    expect(statStageSystem.getStage(world, petB.id, 'spd')).toBe(6)

    const initialRngState = ((world.systems as { rng: GameRng }).rng).getState()
    const maxHp = petSystem.getStatValue(world, petB.id, 'maxHp')

    const runWithStrategy = async (strategy: IgnoreStageStrategy): Promise<number> => {
      ;(world.systems as { rng: GameRng }).rng = GameRng.fromState(initialRngState)
      petSystem.setCurrentHp(world, petB.id, maxHp)
      const ctx = makeUseSkillContextFromSkill({
        battle,
        petId: petA.id,
        skillId,
        originPlayerId: playerAId,
        fallbackTargetId: petB.id,
      })
      ctx.ignoreStageStrategy = strategy
      await phaseManager.execute(world, 'skill', eventBus, { context: ctx })
      expect(ctx.hitResult).toBe(true)
      return maxHp - petSystem.getCurrentHp(world, petB.id)
    }

    const damageWithStage = await runWithStrategy(IgnoreStageStrategy.none)
    const damageIgnoreAll = await runWithStrategy(IgnoreStageStrategy.all)
    expect(damageIgnoreAll).toBeGreaterThan(damageWithStage)
  })

  test('ignoreShield bypasses shield mark consumption and applies full hp damage', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-ignore-shield' },
    )
    const { world, playerSystem, phaseManager, eventBus, markSystem, petSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petB.id,
        baseMarkId: 'mark_zhifanghudun',
        stack: 100,
        duration: 999,
        creatorId: petB.id,
        available: true,
      },
    })
    const shield = markSystem.findByBaseId(world, petB.id, 'mark_zhifanghudun')
    if (!shield) throw new Error('shield mark should exist')
    const maxHp = petSystem.getStatValue(world, petB.id, 'maxHp')

    petSystem.setCurrentHp(world, petB.id, maxHp)
    markSystem.setStack(world, shield.id, 100)
    await phaseManager.execute(world, 'damage', eventBus, {
      context: {
        type: 'damage',
        parentId: 'shield-check-normal',
        sourceId: petA.id,
        targetId: petB.id,
        baseDamage: 80,
        damageType: 'physical',
        crit: false,
        effectiveness: 1,
        ignoreShield: false,
        randomFactor: 1,
        modified: [0, 0],
        minThreshold: 0,
        maxThreshold: Number.MAX_SAFE_INTEGER,
        damageResult: 0,
        available: true,
        element: 'Normal',
      },
    })
    expect(petSystem.getCurrentHp(world, petB.id)).toBe(maxHp)
    expect(markSystem.getStack(world, shield.id)).toBe(20)

    petSystem.setCurrentHp(world, petB.id, maxHp)
    markSystem.setStack(world, shield.id, 100)
    await phaseManager.execute(world, 'damage', eventBus, {
      context: {
        type: 'damage',
        parentId: 'shield-check-ignore',
        sourceId: petA.id,
        targetId: petB.id,
        baseDamage: 80,
        damageType: 'physical',
        crit: false,
        effectiveness: 1,
        ignoreShield: true,
        randomFactor: 1,
        modified: [0, 0],
        minThreshold: 0,
        maxThreshold: Number.MAX_SAFE_INTEGER,
        damageResult: 0,
        available: true,
        element: 'Normal',
      },
    })
    expect(petSystem.getCurrentHp(world, petB.id)).toBe(maxHp - 80)
    expect(markSystem.getStack(world, shield.id)).toBe(100)
  })
})
