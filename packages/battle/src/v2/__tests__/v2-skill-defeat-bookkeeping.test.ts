import { describe, expect, test } from 'vitest'
import {
  AttackTargetOpinion,
  Category,
  Element,
  Gender,
  IgnoreStageStrategy,
  Nature,
} from '@arcadia-eternity/const'
import { createEntity, setComponent } from '@arcadia-eternity/engine'
import { createBattle } from '../game.js'
import type { SpeciesData } from '../schemas/species.schema.js'
import type { BaseSkillData } from '../schemas/skill.schema.js'
import type { UseSkillContextData } from '../schemas/context.schema.js'

function makeSpecies(id: string): SpeciesData {
  return {
    type: 'species',
    id,
    num: 1,
    element: Element.Fire,
    baseStats: { hp: 80, atk: 100, def: 80, spa: 60, spd: 60, spe: 90 },
    genderRatio: [50, 50],
    heightRange: [50, 100],
    weightRange: [20, 40],
    abilityIds: [],
    emblemIds: [],
  }
}

function makeBaseSkill(id: string, accuracy: number): BaseSkillData {
  return {
    type: 'baseSkill',
    id,
    category: Category.Physical,
    element: Element.Fire,
    power: 80,
    accuracy,
    rage: 0,
    priority: 0,
    target: AttackTargetOpinion.opponent,
    multihit: 1,
    sureHit: false,
    sureCrit: false,
    ignoreShield: false,
    ignoreOpponentStageStrategy: IgnoreStageStrategy.none,
    tags: [],
    effectIds: [],
  }
}

describe('v2 skill defeat bookkeeping', () => {
  test('OnMiss kill still records defeat bookkeeping', async () => {
    const battle = createBattle()
    const { world, petSystem, skillSystem, playerSystem, phaseManager, eventBus, effectPipeline } = battle

    const speciesA = makeSpecies('species_a')
    const speciesB = makeSpecies('species_b')
    createEntity(world, speciesA.id, ['species'])
    setComponent(world, speciesA.id, 'species', speciesA)
    createEntity(world, speciesB.id, ['species'])
    setComponent(world, speciesB.id, 'species', speciesB)

    const baseSkill = makeBaseSkill('skill_miss_execute', 0)
    createEntity(world, baseSkill.id, ['baseSkill'])
    setComponent(world, baseSkill.id, 'baseSkill', baseSkill)

    const petA = petSystem.create(world, speciesA, {
      name: 'A',
      speciesId: speciesA.id,
      level: 50,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      nature: Nature.Hardy,
      baseSkillIds: [],
      gender: Gender.Male,
    })
    const petB = petSystem.create(world, speciesB, {
      name: 'B',
      speciesId: speciesB.id,
      level: 50,
      evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      nature: Nature.Hardy,
      baseSkillIds: [],
      gender: Gender.Male,
      overrideMaxHp: 10,
    })

    const skill = skillSystem.createFromBase(world, baseSkill, petA.id)
    petA.skillIds.push(skill.id)

    const playerA = playerSystem.create(world, 'A', [petA.id], 'playerA')
    const playerB = playerSystem.create(world, 'B', [petB.id], 'playerB')
    world.state.playerAId = playerA.id
    world.state.playerBId = playerB.id
    world.state.allowFaintSwitch = true

    effectPipeline.attachEffect(world, skill.id, {
      id: 'effect_execute_on_miss',
      triggers: ['OnMiss'],
      priority: 0,
      apply: {
        type: 'executeKill',
        target: 'opponent',
      },
    })

    const defeatedEvents: Array<{ petId: string; killerId: string }> = []
    eventBus.on('petDefeated', evt => {
      defeatedEvents.push({
        petId: String(evt.data.petId),
        killerId: String(evt.data.killerId),
      })
    })

    const ctx: UseSkillContextData = {
      type: 'use-skill',
      parentId: 'test-phase',
      petId: petA.id,
      skillId: skill.id,
      originPlayerId: playerA.id,
      selectTarget: AttackTargetOpinion.opponent,
      priority: 0,
      category: Category.Physical,
      element: Element.Fire,
      power: 80,
      accuracy: 0,
      petAccuracy: 100,
      rage: 0,
      evasion: 0,
      critRate: 0,
      ignoreShield: false,
      ignoreStageStrategy: IgnoreStageStrategy.none,
      multihit: 1,
      available: true,
      actualTargetId: petB.id,
      hitResult: false,
      crit: false,
      multihitResult: 1,
      currentHitCount: 1,
      damageType: 'physical',
      typeMultiplier: 1,
      stabMultiplier: 1,
      critMultiplier: 2,
      baseDamage: 0,
      randomFactor: 1,
      defeated: false,
    }

    await phaseManager.execute(world, 'skill', eventBus, { context: ctx })

    expect(petSystem.isAlive(world, petB.id)).toBe(false)
    expect(world.state.lastKillerId).toBe(petA.id)
    expect(ctx.defeated).toBe(true)
    expect(defeatedEvents).toEqual([{ petId: petB.id, killerId: petA.id }])
  })
})

