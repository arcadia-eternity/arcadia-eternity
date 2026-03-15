import { beforeAll, describe, expect, test } from 'vitest'
import { Gender, Nature } from '@arcadia-eternity/const'
import { createBattleFromConfig } from '../data/battle-factory.js'
import type { TeamConfig } from '../data/team-config.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import {
  findSkillInstanceIdByBaseId,
  getBattlePlayerIds,
  getTestRepository,
  makeUseSkillContextFromSkill,
} from './helpers/regression-helpers.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

function createSinglePetTeam(name: string, skills: string[], maxHp?: number): TeamConfig {
  return {
    name,
    team: [
      {
        name: `${name}-pet`,
        species: 'pet_huanli',
        level: 100,
        evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
        nature: Nature.Hardy,
        skills,
        gender: Gender.Male,
        maxHp,
      },
    ],
  }
}

describe('v2 multihit regressions', () => {
  test('single-hit skill triggers OnHit once and applies one stack batch', async () => {
    const battle = createBattleFromConfig(
      createSinglePetTeam('A', ['skill_paoxiaodan']),
      createSinglePetTeam('B', ['skill_chongfeng'], 9999),
      repo,
      { seed: 'regression-single-hit' },
    )
    const { world, playerSystem, skillSystem, phaseManager, eventBus, markSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_paoxiaodan',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )

    const ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'single-hit-phase',
    })
    playerSystem.setRage(world, playerAId, 100)
    ctx.accuracy = 100
    ctx.petAccuracy = 100
    ctx.evasion = 0

    await phaseManager.execute(world, 'skill', eventBus, { context: ctx })

    const damageEvents = world.eventLog.filter(e => e.type === 'damage')
    const yinbo = markSystem.findByBaseId(world, petB.id, 'mark_yinbo')

    expect(ctx.hitResult).toBe(true)
    expect(ctx.multihitResult).toBe(1)
    expect(damageEvents.length).toBe(1)
    expect(yinbo).toBeDefined()
    expect(markSystem.getStack(world, yinbo!.id)).toBe(30)
  })

  test('multihit skill triggers OnHit per hit and accumulates mark stacks', async () => {
    const battle = createBattleFromConfig(
      createSinglePetTeam('A', ['skill_yinbofeidan']),
      createSinglePetTeam('B', ['skill_chongfeng'], 9999),
      repo,
      { seed: 'regression-multihit-4' },
    )
    const { world, playerSystem, skillSystem, phaseManager, eventBus, markSystem } = battle
    const { playerAId, playerBId } = getBattlePlayerIds(world)
    const petA = playerSystem.getActivePet(world, playerAId)
    const petB = playerSystem.getActivePet(world, playerBId)
    const skillId = findSkillInstanceIdByBaseId(
      petA.skillIds,
      'skill_yinbofeidan',
      sid => skillSystem.get(world, sid)?.baseSkillId,
    )

    const ctx = makeUseSkillContextFromSkill({
      battle,
      petId: petA.id,
      skillId,
      originPlayerId: playerAId,
      fallbackTargetId: petB.id,
      parentId: 'multihit-phase',
    })
    playerSystem.setRage(world, playerAId, 100)
    ctx.accuracy = 100
    ctx.petAccuracy = 100
    ctx.evasion = 0

    await phaseManager.execute(world, 'skill', eventBus, { context: ctx })

    const damageEvents = world.eventLog.filter(e => e.type === 'damage')
    const yinbo = markSystem.findByBaseId(world, petB.id, 'mark_yinbo')

    expect(ctx.hitResult).toBe(true)
    expect(ctx.multihitResult).toBe(4)
    expect(damageEvents.length).toBe(4)
    expect(yinbo).toBeDefined()
    expect(markSystem.getStack(world, yinbo!.id)).toBe(40)
  })
})
