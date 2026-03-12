// battle/src/v2/__tests__/v2-smoke.ts
// Standalone smoke test — run with: npx tsx packages/battle/src/v2/__tests__/v2-smoke.ts

import {
  Nature,
  Element,
  Category,
  AttackTargetOpinion,
  IgnoreStageStrategy,
  BattleMessageType,
  BattleStatus,
  type BattleMessage,
  type playerId,
} from '@arcadia-eternity/const'
import { createEntity, setComponent } from '@arcadia-eternity/engine'
import { createBattle } from '../game.js'
import { LocalBattleSystemV2 } from '../local-battle.js'
import { createBattleState } from '../types/battle-state.js'
import type { SpeciesData } from '../schemas/species.schema.js'
import type { BaseSkillData } from '../schemas/skill.schema.js'

function makeSpecies(overrides: Partial<SpeciesData> = {}): SpeciesData {
  return {
    type: 'species',
    id: 'species_test',
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
    id: 'baseSkill_test',
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

async function main() {
  console.log('=== V2 Battle Smoke Test ===\n')

  const battle = createBattle()
  const { world, petSystem, skillSystem, playerSystem } = battle

  // Species
  const speciesA = makeSpecies({ id: 'species_a', element: Element.Fire })
  const speciesB = makeSpecies({ id: 'species_b', element: Element.Water })
  createEntity(world, speciesA.id, ['species'])
  setComponent(world, speciesA.id, 'species', speciesA)
  createEntity(world, speciesB.id, ['species'])
  setComponent(world, speciesB.id, 'species', speciesB)

  // Base skills
  const baseSkillA = makeBaseSkill({ id: 'skill_a', element: Element.Fire, power: 80, rage: 0, sureHit: true })
  const baseSkillB = makeBaseSkill({ id: 'skill_b', element: Element.Water, power: 80, rage: 0, sureHit: true })
  createEntity(world, baseSkillA.id, ['baseSkill'])
  setComponent(world, baseSkillA.id, 'baseSkill', baseSkillA)
  createEntity(world, baseSkillB.id, ['baseSkill'])
  setComponent(world, baseSkillB.id, 'baseSkill', baseSkillB)

  // Pets
  const petA = petSystem.create(world, speciesA, {
    name: 'FirePet', speciesId: speciesA.id, level: 50,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: Nature.Hardy, baseSkillIds: [],
  })
  const petB = petSystem.create(world, speciesB, {
    name: 'WaterPet', speciesId: speciesB.id, level: 50,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: Nature.Hardy, baseSkillIds: [],
  })

  // Skills
  const skillA = skillSystem.createFromBase(world, baseSkillA, petA.id)
  petA.skillIds.push(skillA.id)
  const skillB = skillSystem.createFromBase(world, baseSkillB, petB.id)
  petB.skillIds.push(skillB.id)

  // Players
  const playerA = playerSystem.create(world, 'PlayerA', [petA.id])
  const playerB = playerSystem.create(world, 'PlayerB', [petB.id])

  world.state = createBattleState(playerA.id, playerB.id) as unknown as Record<string, unknown>
  world.state.allowFaintSwitch = false

  console.log(`PetA HP: ${petA.currentHp}, PetB HP: ${petB.currentHp}`)
  console.log(`SkillA: ${skillA.id}, SkillB: ${skillB.id}\n`)

  // Create system
  const system = new LocalBattleSystemV2(battle)

  const messages: BattleMessage[] = []
  system.BattleEvent((msg) => {
    messages.push(msg)
    console.log(`  [MSG] ${msg.type}`, JSON.stringify((msg as any).data).slice(0, 120))
  })

  // Start battle
  console.log('--- Starting battle ---')
  await system.ready()
  await sleep(50)

  let turn = 0
  const maxTurns = 30

  while (turn < maxTurns) {
    const state = await system.getState()
    if (state.status === BattleStatus.Ended) {
      console.log(`\nBattle ended after ${turn} turns`)
      break
    }

    turn++
    console.log(`\n--- Turn ${turn} ---`)

    // Get selections
    const selA = await system.getAvailableSelection(playerA.id as unknown as playerId)
    const selB = await system.getAvailableSelection(playerB.id as unknown as playerId)

    const skillSelA = selA.find(s => s.type === 'use-skill')
    const skillSelB = selB.find(s => s.type === 'use-skill')

    if (!skillSelA && !skillSelB) {
      console.log('No skills available for either player, submitting do-nothing')
      const doNothingA = selA.find(s => s.type === 'do-nothing')
      const doNothingB = selB.find(s => s.type === 'do-nothing')
      if (doNothingA) await system.submitAction(doNothingA)
      if (doNothingB) await system.submitAction(doNothingB)
    } else {
      if (skillSelA) await system.submitAction(skillSelA)
      else {
        const fallback = selA.find(s => s.type === 'do-nothing') ?? selA[0]
        if (fallback) await system.submitAction(fallback)
      }
      if (skillSelB) await system.submitAction(skillSelB)
      else {
        const fallback = selB.find(s => s.type === 'do-nothing') ?? selB[0]
        if (fallback) await system.submitAction(fallback)
      }
    }

    await sleep(100)

    // Print HP
    const hpA = petSystem.getCurrentHp(world, petA.id)
    const hpB = petSystem.getCurrentHp(world, petB.id)
    console.log(`  PetA HP: ${hpA}, PetB HP: ${hpB}`)
  }

  // Final state
  const finalState = await system.getState()
  console.log(`\n=== Final State ===`)
  console.log(`Status: ${finalState.status === BattleStatus.Ended ? 'Ended' : 'Active'}`)
  console.log(`Victor: ${(world.state.victor as string | undefined) ?? 'none'}`)
  console.log(`Reason: ${(world.state.endReason as string | undefined) ?? 'none'}`)
  console.log(`Total messages: ${messages.length}`)

  const msgTypes = new Map<string, number>()
  for (const m of messages) {
    msgTypes.set(m.type, (msgTypes.get(m.type) ?? 0) + 1)
  }
  console.log('Message counts:', Object.fromEntries(msgTypes))

  // Assertions
  let passed = 0
  let failed = 0

  function assert(condition: boolean, msg: string) {
    if (condition) { passed++; console.log(`  ✓ ${msg}`) }
    else { failed++; console.error(`  ✗ ${msg}`) }
  }

  console.log('\n=== Assertions ===')
  assert(finalState.status === BattleStatus.Ended, 'Battle ended')
  assert(world.state.victor !== undefined, 'Has a victor')
  assert(messages.some(m => m.type === BattleMessageType.BattleStart), 'BattleStart message emitted')
  assert(messages.some(m => m.type === BattleMessageType.Damage), 'Damage messages emitted')
  assert(messages.some(m => m.type === BattleMessageType.BattleEnd), 'BattleEnd message emitted')
  assert(messages.some(m => m.type === BattleMessageType.SkillUse), 'SkillUse messages emitted')
  assert(messages.some(m => m.type === BattleMessageType.RageChange), 'RageChange messages emitted')
  assert(messages.some(m => m.type === BattleMessageType.PetDefeated), 'PetDefeated message emitted')
  assert(turn > 0, `Battle lasted ${turn} turns`)

  console.log(`\n${passed} passed, ${failed} failed`)

  await system.cleanup()
  process.exit(failed > 0 ? 1 : 0)
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

main().catch(e => { console.error(e); process.exit(1) })
