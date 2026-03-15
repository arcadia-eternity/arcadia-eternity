// battle/src/v2/__tests__/v2-battle-integration.test.ts
// Minimal integration test: two players, one pet each, one skill, full battle.

import { describe, test, expect } from 'vitest'
import {
  Nature,
  Element,
  Category,
  AttackTargetOpinion,
  IgnoreStageStrategy,
  type BattleMessage,
  BattleMessageType,
  BattleStatus,
  type playerId,
} from '@arcadia-eternity/const'
import { createEntity, setComponent } from '@arcadia-eternity/engine'
import { createBattle } from '../game.js'
import { LocalBattleSystemV2 } from '../local-battle.js'
import type { SpeciesData } from '../schemas/species.schema.js'
import type { BaseSkillData } from '../schemas/skill.schema.js'

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeSpecies(overrides: Partial<SpeciesData> = {}): SpeciesData {
  return {
    type: 'species',
    id: `species_${Math.random().toString(36).slice(2, 8)}`,
    num: 1,
    element: Element.Fire,
    baseStats: { hp: 80, atk: 100, def: 80, spa: 60, spd: 60, spe: 90 },
    genderRatio: [50, 50],
    heightRange: [50, 100],
    weightRange: [20, 40],
    abilityIds: [],
    emblemIds: [],
    ...overrides,
  }
}

function makeBaseSkill(overrides: Partial<BaseSkillData> = {}): BaseSkillData {
  return {
    type: 'baseSkill',
    id: `baseSkill_${Math.random().toString(36).slice(2, 8)}`,
    category: Category.Physical,
    element: Element.Fire,
    power: 80,
    accuracy: 100,
    rage: 0,
    priority: 0,
    target: AttackTargetOpinion.opponent,
    multihit: 1,
    sureHit: true,
    sureCrit: false,
    ignoreShield: false,
    ignoreOpponentStageStrategy: IgnoreStageStrategy.none,
    tags: [],
    effectIds: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper: set up a battle with two players, each having one pet + one skill
// ---------------------------------------------------------------------------

function setupSimpleBattle() {
  const battle = createBattle()
  const { world, petSystem, skillSystem, playerSystem } = battle

  // Species
  const speciesA = makeSpecies({ id: 'species_a', element: Element.Fire })
  const speciesB = makeSpecies({ id: 'species_b', element: Element.Water })

  // Register species as components so they can be looked up
  createEntity(world, speciesA.id, ['species'])
  setComponent(world, speciesA.id, 'species', speciesA)
  createEntity(world, speciesB.id, ['species'])
  setComponent(world, speciesB.id, 'species', speciesB)

  // Base skills
  const baseSkillA = makeBaseSkill({
    id: 'skill_a',
    element: Element.Fire,
    power: 80,
    rage: 0,
    sureHit: true,
  })
  const baseSkillB = makeBaseSkill({
    id: 'skill_b',
    element: Element.Water,
    power: 80,
    rage: 0,
    sureHit: true,
  })

  // Register base skills
  createEntity(world, baseSkillA.id, ['baseSkill'])
  setComponent(world, baseSkillA.id, 'baseSkill', baseSkillA)
  createEntity(world, baseSkillB.id, ['baseSkill'])
  setComponent(world, baseSkillB.id, 'baseSkill', baseSkillB)

  // Create pets
  const petA = petSystem.create(world, speciesA, {
    name: 'FirePet',
    speciesId: speciesA.id,
    level: 50,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: Nature.Hardy,
    baseSkillIds: [],
  })

  const petB = petSystem.create(world, speciesB, {
    name: 'WaterPet',
    speciesId: speciesB.id,
    level: 50,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: Nature.Hardy,
    baseSkillIds: [],
  })

  // Create skills and assign to pets
  const skillA = skillSystem.createFromBase(world, baseSkillA, petA.id)
  petA.skillIds.push(skillA.id)

  const skillB = skillSystem.createFromBase(world, baseSkillB, petB.id)
  petB.skillIds.push(skillB.id)

  // Create players
  const playerA = playerSystem.create(world, 'PlayerA', [petA.id])
  const playerB = playerSystem.create(world, 'PlayerB', [petB.id])

  // Set state
  world.state.playerAId = playerA.id
  world.state.playerBId = playerB.id
  world.state.allowFaintSwitch = false

  return { battle, playerA, playerB, petA, petB, skillA, skillB }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('V2 Battle Integration', () => {
  test('full battle runs to completion', async () => {
    const { battle, playerA, playerB } = setupSimpleBattle()
    const system = new LocalBattleSystemV2(battle)

    const messages: BattleMessage[] = []
    system.BattleEvent((msg) => messages.push(msg))

    // Start battle
    await system.ready()

    // Wait a tick for the orchestrator to reach selection phase
    await new Promise(r => setTimeout(r, 50))

    // Battle should be active
    const state = await system.getState()
    expect(state.status).toBe(BattleStatus.OnBattle)

    // Get available selections for playerA
    const selectionsA = await system.getAvailableSelection(playerA.id as unknown as playerId)
    expect(selectionsA.length).toBeGreaterThan(0)
    const skillSelA = selectionsA.find(s => s.type === 'use-skill')
    expect(skillSelA).toBeDefined()

    // Get available selections for playerB
    const selectionsB = await system.getAvailableSelection(playerB.id as unknown as playerId)
    const skillSelB = selectionsB.find(s => s.type === 'use-skill')
    expect(skillSelB).toBeDefined()

    // Submit actions — both use their skill
    await system.submitAction(skillSelA!)
    await system.submitAction(skillSelB!)

    // Wait for turn to execute
    await new Promise(r => setTimeout(r, 100))

    // Check that damage messages were emitted
    const damageMessages = messages.filter(m => m.type === BattleMessageType.Damage)
    expect(damageMessages.length).toBeGreaterThan(0)

    // Keep fighting until battle ends
    let maxTurns = 50
    while (maxTurns-- > 0) {
      const currentState = await system.getState()
      if (currentState.status === BattleStatus.Ended) break

      await new Promise(r => setTimeout(r, 50))

      const aSelections = await system.getAvailableSelection(playerA.id as unknown as playerId)
      const bSelections = await system.getAvailableSelection(playerB.id as unknown as playerId)

      const aSkill = aSelections.find(s => s.type === 'use-skill')
      const bSkill = bSelections.find(s => s.type === 'use-skill')

      if (aSkill) await system.submitAction(aSkill)
      if (bSkill) await system.submitAction(bSkill)

      await new Promise(r => setTimeout(r, 100))
    }

    // Battle should have ended
    const finalState = await system.getState()
    expect(finalState.status).toBe(BattleStatus.Ended)

    // Should have a winner
    expect(battle.world.state.victor).toBeDefined()

    // Should have battle end message
    const endMsg = messages.find(m => m.type === BattleMessageType.BattleEnd)
    expect(endMsg).toBeDefined()

    await system.cleanup()
  })

  test('getState returns correct player info', async () => {
    const { battle } = setupSimpleBattle()
    const system = new LocalBattleSystemV2(battle)

    const state = await system.getState()
    expect(state.players).toHaveLength(2)
    expect(state.players[0].name).toBe('PlayerA')
    expect(state.players[1].name).toBe('PlayerB')
    expect(state.players[0].teamAlives).toBe(1)
    expect(state.players[1].teamAlives).toBe(1)

    await system.cleanup()
  })

  test('surrender ends battle immediately', async () => {
    const { battle, playerA, playerB, skillA } = setupSimpleBattle()
    const system = new LocalBattleSystemV2(battle)

    const messages: BattleMessage[] = []
    system.BattleEvent((msg) => messages.push(msg))

    await system.ready()
    await new Promise(r => setTimeout(r, 50))

    // PlayerA surrenders, PlayerB uses skill
    await system.submitAction({
      player: playerA.id as any,
      type: 'surrender',
    })
    await system.submitAction({
      player: playerB.id as any,
      type: 'use-skill',
      skill: skillA.id as any,
      target: AttackTargetOpinion.opponent,
    })

    await new Promise(r => setTimeout(r, 100))

    // Battle should have ended with playerB as victor
    expect(battle.world.state.victor).toBe(playerB.id)
    expect(battle.world.state.endReason).toBe('surrender')

    await system.cleanup()
  })
})
