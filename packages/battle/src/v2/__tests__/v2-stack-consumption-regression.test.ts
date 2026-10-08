import { beforeAll, describe, expect, test } from 'vitest'
import { BattleMessageType, EffectTrigger, Gender } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import { MessageBridge } from '../systems/message-bridge.js'
import {
  getBattlePlayerIds,
  getTestRepository,
  makeTeamConfig,
  makeUseSkillContextFromSkill,
} from './helpers/regression-helpers.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

describe('v2 stack consumption regressions', () => {
  test('busi protects against only one lethal hit', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_xiuluosi', ['skill_bumiezhixin'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_chongfeng'], Gender.Male),
      repo,
      { seed: 'stack-consumption-busi' },
    )
    const { world, playerSystem, phaseManager, eventBus, markSystem, petSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    playerSystem.setRage(world, playerAId, 100)
    const skill = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: petA.skillIds[0],
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    expect((await phaseManager.execute(world, 'skill', eventBus, { context: skill })).success).toBe(true)
    const mark = markSystem.findByBaseId(world, petA.id, 'mark_busi')!
    expect(mark).toBeDefined()
    const bridge = new MessageBridge(world, eventBus, battle, true)
    const consumedMarks: string[] = []
    bridge.subscribe(msg => {
      if (msg.type === BattleMessageType.MarkDestroy) consumedMarks.push(msg.data.mark)
    })
    for (const expectedHp of [1, 0]) {
      const result = await phaseManager.execute(world, 'damage', eventBus, {
        context: {
          type: 'damage',
          parentId: 'test-phase',
          sourceId: petB.id,
          targetId: petA.id,
          baseDamage: 99999,
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
      expect(result.success).toBe(true)
      expect(petSystem.getCurrentHp(world, petA.id)).toBe(expectedHp)
      expect(markSystem.getStack(world, mark.id)).toBe(0)
      expect(markSystem.isActive(world, mark.id)).toBe(false)
    }
    expect(consumedMarks).toEqual([mark.id])
    bridge.cleanup()
  })

  test('qiliuyongdong consumes one stack per qualifying skill and expires at zero', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_paida'], Gender.Male),
      repo,
      { seed: 'stack-consumption' },
    )
    const { world, playerSystem, phaseManager, eventBus, markSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const basePower = battle.skillSystem.getPower(world, petA.skillIds[0])
    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_qiliuyongdong',
        stack: 2,
        duration: -1,
        creatorId: petA.id,
        available: true,
      },
    })
    const mark = markSystem.findByBaseId(world, petA.id, 'mark_qiliuyongdong')!
    expect(battle.skillSystem.getPower(world, petA.skillIds[0])).toBe(basePower * 2)
    playerSystem.setRage(world, playerAId, 100)
    const updates: number[] = []
    const bridge = new MessageBridge(world, eventBus, battle, true)
    bridge.subscribe(msg => {
      if (msg.type === BattleMessageType.MarkUpdate && msg.data.mark.id === mark.id) {
        updates.push(msg.data.mark.stack)
      }
    })
    for (const expected of [1, 0]) {
      const ctx = makeUseSkillContextFromSkill({
        battle,
        petId: petA.id,
        skillId: petA.skillIds[0],
        originPlayerId: playerAId,
        fallbackTargetId: petB.id,
      })
      ctx.accuracy = 100
      expect((await phaseManager.execute(world, 'skill', eventBus, { context: ctx })).success).toBe(true)
      expect(markSystem.getStack(world, mark.id)).toBe(expected)
    }
    expect(updates).toEqual([1])
    expect(markSystem.isActive(world, mark.id)).toBe(false)
    expect(battle.skillSystem.getPower(world, petA.skillIds[0])).toBe(basePower)
    bridge.cleanup()
  })

  test('qiliuyongdong consumes a stack even when the skill misses', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_paida'], Gender.Male),
      repo,
      { seed: 'stack-consumption-miss' },
    )
    const { world, playerSystem, phaseManager, eventBus, markSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    await phaseManager.execute(world, 'addMark', eventBus, {
      context: {
        type: 'add-mark',
        parentId: 'test-phase',
        targetId: petA.id,
        baseMarkId: 'mark_qiliuyongdong',
        stack: 2,
        duration: -1,
        creatorId: petA.id,
        available: true,
      },
    })
    const mark = markSystem.findByBaseId(world, petA.id, 'mark_qiliuyongdong')!
    const ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: petA.skillIds[0],
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    ctx.accuracy = 0
    expect((await phaseManager.execute(world, 'skill', eventBus, { context: ctx })).success).toBe(true)
    expect(ctx.hitResult).toBe(false)
    expect(markSystem.getStack(world, mark.id)).toBe(1)
  })

  test('a consumed mark cannot execute other effects already collected for the same trigger', async () => {
    const battle = createBattleFromConfig(
      makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
      makeTeamConfig('B', 'pet_dilan', ['skill_paida'], Gender.Male),
      repo,
    )
    const { world, playerSystem, markSystem, effectPipeline } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const mark = markSystem.createFromBase(world, repo.getMark('mark_busi'))
    markSystem.attach(world, mark.id, petA.id, 'pet')
    for (const [priority, value] of [
      [1, 1],
      [0, 100],
    ]) {
      effectPipeline.attachEffect(world, mark.id, {
        id: `test_consumable_${priority}`,
        triggers: [EffectTrigger.OnHit],
        priority,
        apply: { type: 'addPower', target: 'useSkillContext', value },
        consumesStacks: 1,
      })
    }
    const ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId: petA.skillIds[0],
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
    })
    const before = ctx.power
    await effectPipeline.fire(world, EffectTrigger.OnHit, {
      trigger: EffectTrigger.OnHit,
      sourceEntityId: petA.id,
      context: ctx,
    })
    expect(ctx.power).toBe(before + 1)
    expect(markSystem.get(world, mark.id)).toBeUndefined()
  })

  test.each(['automatic', 'operator'] as const)(
    '%s consumption respects protection and fires destroy effects',
    async mode => {
      const battle = createBattleFromConfig(
        makeTeamConfig('A', 'pet_dilan', ['skill_paida'], Gender.Male),
        makeTeamConfig('B', 'pet_dilan', ['skill_paida'], Gender.Male),
        repo,
      )
      const { world, playerSystem, phaseManager, eventBus, markSystem, effectPipeline } = battle
      const { playerAId, playerBId } = getBattlePlayerIds(world)
      const petA = playerSystem.getActivePet(world, playerAId)
      const petB = playerSystem.getActivePet(world, playerBId)
      for (const baseMarkId of ['mark_huanxiang', 'mark_zhenshihuanxiang']) {
        await phaseManager.execute(world, 'addMark', eventBus, {
          context: {
            type: 'add-mark',
            parentId: 'test-phase',
            targetId: petA.id,
            baseMarkId,
            stack: 1,
            duration: 4,
            creatorId: petA.id,
            available: true,
          },
        })
      }
      const mark = markSystem.findByBaseId(world, petA.id, 'mark_huanxiang')!
      const protection = markSystem.findByBaseId(world, petA.id, 'mark_zhenshihuanxiang')!
      effectPipeline.attachEffect(world, mode === 'automatic' ? mark.id : petA.skillIds[0], {
        id: 'test_consume_huanxiang',
        triggers: [EffectTrigger.OnHit],
        priority: 0,
        apply:
          mode === 'automatic'
            ? { type: 'TODO' }
            : {
                type: 'consumeStacks',
                target: {
                  base: 'selfMarks',
                  chain: [
                    {
                      type: 'whereAttr',
                      extractor: { type: 'base', arg: 'baseId' },
                      evaluator: { type: 'same', value: 'mark_huanxiang' },
                    },
                  ],
                },
                value: 1,
              },
        consumesStacks: mode === 'automatic' ? 1 : undefined,
      })
      effectPipeline.attachEffect(world, mark.id, {
        id: 'test_consume_destroy_reward',
        triggers: [EffectTrigger.OnMarkDestroy],
        priority: 0,
        apply: { type: 'addRage', target: 'self', value: 7 },
      })
      const ctx = makeUseSkillContextFromSkill({
        battle,
        petId: petA.id,
        skillId: petA.skillIds[0],
        originPlayerId: playerAId,
        fallbackTargetId: petB.id,
      })
      const fire = () =>
        effectPipeline.fire(world, EffectTrigger.OnHit, {
          trigger: EffectTrigger.OnHit,
          sourceEntityId: petA.id,
          context: ctx,
        })
      playerSystem.setRage(world, playerAId, 0)
      await fire()
      expect(markSystem.getStack(world, mark.id)).toBe(1)
      expect(markSystem.isActive(world, mark.id)).toBe(true)
      expect(playerSystem.getRage(world, playerAId)).toBe(0)
      markSystem.destroy(world, protection.id)
      await fire()
      expect(markSystem.get(world, mark.id)).toBeUndefined()
      expect(playerSystem.getRage(world, playerAId)).toBe(7)
    },
  )
})
