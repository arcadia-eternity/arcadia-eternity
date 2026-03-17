import { beforeAll, describe, expect, test } from 'vitest'
import { EffectTrigger, Gender } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import type { TeamConfig } from '../data/team-config.js'
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

describe('v2 mark/stat effect regressions', () => {
  test('dianhe emblem updates per-stack crit bonus dynamically (2 => 57, 3 => 82)', async () => {
    const teamA: TeamConfig = {
      name: 'A',
      team: [
        {
          name: 'A-pet',
          species: 'pet_leiyi',
          level: 100,
          evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
          nature: 'Hardy',
          skills: ['skill_jidiantushan'],
          gender: Gender.Male,
          emblem: 'mark_emblem_dianhe',
        },
      ],
    }
    const battle = createBattleFromConfig(
      teamA,
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-dianhe-emblem' },
    )
    const { world, playerSystem, phaseManager, eventBus, markSystem, effectPipeline, petSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    await effectPipeline.fire(world, EffectTrigger.OnBattleStart, {
      trigger: EffectTrigger.OnBattleStart,
      sourceEntityId: '',
      playerAId,
      playerBId,
    })
    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_dianhe',
        stack: 2,
        duration: 999,
        creatorId: petA.id,
        available: true,
      },
    })

    const chargeMark = markSystem.findByBaseId(world, petA.id, 'mark_dianhe')
    if (!chargeMark) throw new Error('mark_dianhe should exist')
    expect(markSystem.getStack(world, chargeMark.id)).toBe(2)
    expect(petSystem.getStatValue(world, petA.id, 'critRate')).toBe(57)
    markSystem.setStack(world, chargeMark.id, 3)
    expect(petSystem.getStatValue(world, petA.id, 'critRate')).toBe(82)
  })

  test('stat-stage raise and sand-poison heal reduction', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_huanli', ['skill_qili', 'skill_lingcaiguangxian'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-stage-sand' },
    )
    const { world, playerSystem, skillSystem, phaseManager, eventBus, statStageSystem, markSystem, petSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)

    const stageSkillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_qili',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const beforeAtk = petSystem.getStatValue(world, petA.id, 'atk')
    const stageCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: stageSkillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'stage-skill-phase',
    })
    await phaseManager.execute(world, 'skill', eventBus, { context: stageCtx })
    expect(statStageSystem.getStage(world, petA.id, 'atk')).toBe(1)
    expect(petSystem.getStatValue(world, petA.id, 'atk')).toBeGreaterThan(beforeAtk)

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_shadu',
        stack: 1,
        duration: 999,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_shadu')).toBeDefined()

    const hpBeforeHeal = petSystem.getCurrentHp(world, petA.id)
    petSystem.setCurrentHp(world, petA.id, hpBeforeHeal - 100)
    const hpMissingState = petSystem.getCurrentHp(world, petA.id)
    await phaseManager.execute(world, 'heal', eventBus, {
      context: {
        type: 'heal',
        parentId: 'sand-heal-phase',
        sourceId: petA.id,
        targetId: petA.id,
        baseHeal: 100,
        ignoreEffect: false,
        modified: [0, 0],
        healResult: 0,
        available: true,
      },
    })
    expect(petSystem.getCurrentHp(world, petA.id)).toBe(hpMissingState + 50)
  })

  test('heal phase does not heal defeated pet', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_huanli', ['skill_qili'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-heal-defeated-target' },
    )
    const { world, playerSystem, phaseManager, eventBus, petSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    petSystem.setCurrentHp(world, petA.id, 0)
    expect(petSystem.isAlive(world, petA.id)).toBe(false)

    await phaseManager.execute(world, 'heal', eventBus, {
      context: {
        type: 'heal',
        parentId: 'heal-dead-target-phase',
        sourceId: petA.id,
        targetId: petA.id,
        baseHeal: 999,
        ignoreEffect: false,
        modified: [0, 0],
        healResult: 0,
        available: true,
      },
    })

    expect(petSystem.getCurrentHp(world, petA.id)).toBe(0)
    expect(petSystem.isAlive(world, petA.id)).toBe(false)
  })

  test('guangyinghuanxiang applies random weather mark on hit', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_guangyite', ['skill_guangyinghuanxiang'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-guangyinghuanxiang-weather' },
    )
    const { world, playerSystem, skillSystem, phaseManager, eventBus, markSystem, effectPipeline } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_guangyinghuanxiang',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    expect(
      effectPipeline.getEffectsForTrigger(world, skillId, EffectTrigger.OnHit)
        .some(effect => effect.id === 'effect_skill_set_field_qingtian_or_yemu'),
    ).toBe(true)

    playerSystem.setRage(world, playerAId, 100)
    const ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'guangyinghuanxiang-phase',
    })
    await phaseManager.execute(world, 'skill', eventBus, { context: ctx })

    expect(ctx.hitResult).toBe(true)
    const qingtian = markSystem.findByBaseId(world, 'battle', 'mark_global_qingtian')
    const yemu = markSystem.findByBaseId(world, 'battle', 'mark_global_yemu')
    expect(Boolean(qingtian) || Boolean(yemu)).toBe(true)
  })

  test('guangyinghuanxiang weather effect triggers only on first hit', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_guangyite', ['skill_guangyinghuanxiang'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-guangyinghuanxiang-first-hit-only' },
    )
    const { world, playerSystem, skillSystem, effectPipeline, markSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_guangyinghuanxiang',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )

    const ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'guangyinghuanxiang-onhit-phase',
    })

    ctx.currentHitCount = 2
    await effectPipeline.fire(world, EffectTrigger.OnHit, {
      trigger: EffectTrigger.OnHit,
      sourceEntityId: petA.id,
      context: ctx,
    })
    expect(markSystem.findByBaseId(world, 'battle', 'mark_global_qingtian')).toBeUndefined()
    expect(markSystem.findByBaseId(world, 'battle', 'mark_global_yemu')).toBeUndefined()

    ctx.currentHitCount = 1
    await effectPipeline.fire(world, EffectTrigger.OnHit, {
      trigger: EffectTrigger.OnHit,
      sourceEntityId: petA.id,
      context: ctx,
    })
    const qingtian = markSystem.findByBaseId(world, 'battle', 'mark_global_qingtian')
    const yemu = markSystem.findByBaseId(world, 'battle', 'mark_global_yemu')
    expect(Boolean(qingtian) || Boolean(yemu)).toBe(true)
  })

  test('hunnzhuoshuiyu doubles opponent debuff stage application', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_huanli', ['skill_hunzhuoshuiyu', 'skill_wanyouyinli'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-hunzhuoshuiyu-double-debuff' },
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
    expect(statStageSystem.getStage(world, petB.id, 'spe')).toBe(0)

    const debuffCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: debuffSkillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'double-debuff-phase',
    })
    await phaseManager.execute(world, 'skill', eventBus, { context: debuffCtx })

    expect(debuffCtx.hitResult).toBe(true)
    expect(statStageSystem.getStage(world, petB.id, 'spe')).toBe(-2)
  })

  test('bumiezhixin keeps hp at 1 on lethal damage', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_xiuluosi', ['skill_bumiezhixin'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-bumiezhixin' },
    )
    const { world, playerSystem, skillSystem, phaseManager, eventBus, markSystem, petSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)

    const guardSkillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_bumiezhixin',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    playerSystem.setRage(world, playerAId, 100)
    const useGuardCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: guardSkillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'bumie-guard-phase',
    })
    await phaseManager.execute(world, 'skill', eventBus, { context: useGuardCtx })

    const busiMark = markSystem.findByBaseId(world, petA.id, 'mark_busi')
    expect(busiMark).toBeDefined()

    const hpBefore = petSystem.getCurrentHp(world, petA.id)
    await phaseManager.execute(world, 'damage', eventBus, {
      context: {
        type: 'damage',
        parentId: 'lethal-hit-phase',
        sourceId: petB.id,
        targetId: petA.id,
        baseDamage: hpBefore + 500,
        damageType: 'effect',
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

    expect(petSystem.getCurrentHp(world, petA.id)).toBe(1)
    expect(petSystem.isAlive(world, petA.id)).toBe(true)
  })

  test('yanggong mark amplifies next non-yanggong skill and consumes itself', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_xiuyier', ['skill_yanggong', 'skill_fenlitupo'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-yanggong-consume' },
    )
    const { world, playerSystem, skillSystem, phaseManager, eventBus, markSystem, effectPipeline } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_yanggong',
        stack: 1,
        duration: 999,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_yanggong')).toBeDefined()

    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_fenlitupo',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )
    const basePower = skillSystem.getPower(world, skillId)
    const ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'yanggong-check-phase',
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: ctx,
    })

    expect(ctx.power).toBe(basePower + 50)
    expect(markSystem.findByBaseId(world, petA.id, 'mark_yanggong')).toBeUndefined()
  })

  test('mark_mianyibuliang blocks status marks but allows exceptional marks', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      repo,
      { seed: 'regression-immune-status' },
    )
    const { world, playerSystem, phaseManager, eventBus, markSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_mianyibuliang',
        stack: 1,
        duration: 5,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_mianyibuliang')).toBeDefined()

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_shaoshang',
        stack: 1,
        duration: 3,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_shaoshang')).toBeUndefined()

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_meihuo',
        stack: 1,
        duration: 3,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_meihuo')).toBeDefined()
  })

  test('mark_mianyiyichang blocks exceptional marks but allows status marks', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_shuipao'], Gender.Male),
      repo,
      { seed: 'regression-immune-exceptional' },
    )
    const { world, playerSystem, phaseManager, eventBus, markSystem } = battle
    const { playerAId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_mianyiyichang',
        stack: 1,
        duration: 5,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_mianyiyichang')).toBeDefined()

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_meihuo',
        stack: 1,
        duration: 3,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_meihuo')).toBeUndefined()

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_shaoshang',
        stack: 1,
        duration: 3,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_shaoshang')).toBeDefined()
  })

  test('xingzhili does not boost common skill effect probability, while xingzhihui does', async () => {
    const runTrials = async (seed: string, markBaseId?: string, stack = 1): Promise<number> => {
      const battle = createBattleFromConfig(
        makeTeamConfig('A', 'pet_dilan', ['skill_zhuixingquan'], Gender.Male),
        makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
        repo,
        { seed },
      )
      const { world, playerSystem, skillSystem, effectPipeline, phaseManager, eventBus } = battle
      const { playerAId, playerBId } = getBattlePlayerIds(world)
      const petA = playerSystem.getActivePet(world, playerAId)
      const petB = playerSystem.getActivePet(world, playerBId)
      const skillId = findSkillInstanceIdByBaseId(
        petA.skillIds,
        'skill_zhuixingquan',
        sid => skillSystem.get(world, sid)?.baseSkillId,
      )

      if (markBaseId) {
        await phaseManager.execute(world, 'addMark', eventBus, {
          context: {
            type: 'add-mark',
            parentId: 'test-phase',
            targetId: petA.id,
            baseMarkId: markBaseId,
            stack,
            duration: 999,
            creatorId: petA.id,
            available: true,
          },
        })
      }

      const trials = 300
      let triggered = 0
      for (let i = 0; i < trials; i++) {
        const ctx = makeUseSkillContextFromSkill({
          battle,
          petId: petA.id,
          skillId,
          originPlayerId: playerAId,
          fallbackTargetId: petB.id,
        })
        await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
          trigger: EffectTrigger.AfterUseSkillCheck,
          sourceEntityId: petA.id,
          context: ctx,
        })
        if (ctx.multihitResult === 4) triggered++
      }
      return triggered
    }

    const baseline = await runTrials('regression-xingzhi-rate')
    const withXingzhili = await runTrials('regression-xingzhi-rate', 'mark_xingzhili', 1)
    const withXingzhihui = await runTrials('regression-xingzhi-rate', 'mark_xingzhihui', 50)

    expect(withXingzhili).toBe(baseline)
    expect(withXingzhihui).toBeGreaterThan(baseline + 80)
  })

  test('xingzhili disables xingzhili-tagged skill side effect', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_lanmiao', ['skill_quanlichongzhuang'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'regression-xingzhili-sideeffect-disable' },
    )
    const { world, playerSystem, skillSystem, effectPipeline, phaseManager, eventBus, markSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_quanlichongzhuang',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )

    // Simulate consecutive use to make the tagged side effect produce -10 power.
    petA.lastSkillUsedTimes = 2
    const basePower = skillSystem.getPower(world, skillId)

    const withoutMarkCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: withoutMarkCtx,
    })
    expect(withoutMarkCtx.power).toBe(basePower - 10)

    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_xingzhili',
        stack: 1,
        duration: 5,
        creatorId: petA.id,
        available: true,
      },
    })
    expect(markSystem.findByBaseId(world, petA.id, 'mark_xingzhili')).toBeDefined()
    const xingzhiliMarkId = markSystem.findByBaseId(world, petA.id, 'mark_xingzhili')?.id
    expect(xingzhiliMarkId).toBeDefined()
    expect(
      effectPipeline.getEffectsForTrigger(world, xingzhiliMarkId as string, EffectTrigger.BeforeEffect),
    ).toHaveLength(1)

    const withMarkCtx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    await effectPipeline.fire(world, EffectTrigger.AfterUseSkillCheck, {
      trigger: EffectTrigger.AfterUseSkillCheck,
      sourceEntityId: petA.id,
      context: withMarkCtx,
    })
    expect(withMarkCtx.power).toBe(basePower)
  })
})
