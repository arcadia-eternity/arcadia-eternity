// battle/src/v2/data/battle-factory.ts
// Factory functions to create BattleInstance from TeamConfig + V2DataRepository.

import {
  createEntity,
  setComponent,
  type World,
} from '@arcadia-eternity/engine'
import { createBattle, type BattleConfig, type BattleInstance } from '../game.js'
import { createBattleState } from '../types/battle-state.js'
import { V2DataRepository } from './v2-data-repository.js'
import type { TeamConfig } from './team-config.js'

/**
 * Create a BattleInstance from two team configurations and a data repository.
 *
 * Flow:
 * 1. Create empty battle
 * 2. Register all base data (species, skills, marks) as entities
 * 3. Create pet entities for each player
 * 4. Create skill instances and attach to pets
 * 5. Create mark instances (ability/emblem) and attach to pets
 * 6. Create player entities
 * 7. Attach effects to skill/mark instances
 * 8. Return BattleInstance
 */
export function createBattleFromConfig(
  playerAConfig: TeamConfig,
  playerBConfig: TeamConfig,
  repo: V2DataRepository,
  battleConfig?: BattleConfig,
): BattleInstance {
  const battle = createBattle(battleConfig)
  const { world, petSystem, skillSystem, markSystem, playerSystem, effectPipeline } = battle

  // Step 1: Register all base data as entities
  registerBaseData(world, repo)
  world.meta.dataRepository = repo

  // Step 2: Create pets for each player
  const playerAPetIds: string[] = []
  for (const petConfig of playerAConfig.team) {
    const species = repo.getSpecies(petConfig.species)
    const pet = petSystem.create(world, species, {
      name: petConfig.name,
      speciesId: species.id,
      level: petConfig.level,
      evs: petConfig.evs,
      ivs: petConfig.ivs,
      nature: petConfig.nature as any,
      baseSkillIds: petConfig.skills,
      abilityId: petConfig.ability,
      emblemId: petConfig.emblem,
      gender: petConfig.gender as any,
      weight: petConfig.weight,
      height: petConfig.height,
      overrideMaxHp: petConfig.maxHp,
    })

    // Create skill instances
    for (const skillId of petConfig.skills) {
      const baseSkill = repo.getSkill(skillId)
      const skill = skillSystem.createFromBase(world, baseSkill, pet.id)
      pet.skillIds.push(skill.id)

      // Attach effects to skill instance
      for (const effectId of baseSkill.effectIds) {
        const effectDef = repo.getEffect(effectId)
        effectPipeline.attachEffect(world, skill.id, effectDef)
      }
    }

    // Create ability mark if specified
    if (petConfig.ability) {
      const baseMark = repo.getMark(petConfig.ability)
      const mark = markSystem.createFromBase(world, baseMark)
      markSystem.attach(world, mark.id, pet.id, 'pet')
      pet.abilityId = mark.id

      // Attach effects to mark instance
      for (const effectId of baseMark.effectIds) {
        const effectDef = repo.getEffect(effectId)
        effectPipeline.attachEffect(world, mark.id, effectDef)
      }
    }

    // Create emblem mark if specified
    if (petConfig.emblem) {
      const baseMark = repo.getMark(petConfig.emblem)
      const mark = markSystem.createFromBase(world, baseMark)
      markSystem.attach(world, mark.id, pet.id, 'pet')
      pet.emblemId = mark.id

      // Attach effects to mark instance
      for (const effectId of baseMark.effectIds) {
        const effectDef = repo.getEffect(effectId)
        effectPipeline.attachEffect(world, mark.id, effectDef)
      }
    }

    playerAPetIds.push(pet.id)
  }

  const playerBPetIds: string[] = []
  for (const petConfig of playerBConfig.team) {
    const species = repo.getSpecies(petConfig.species)
    const pet = petSystem.create(world, species, {
      name: petConfig.name,
      speciesId: species.id,
      level: petConfig.level,
      evs: petConfig.evs,
      ivs: petConfig.ivs,
      nature: petConfig.nature as any,
      baseSkillIds: petConfig.skills,
      abilityId: petConfig.ability,
      emblemId: petConfig.emblem,
      gender: petConfig.gender as any,
      weight: petConfig.weight,
      height: petConfig.height,
      overrideMaxHp: petConfig.maxHp,
    })

    // Create skill instances
    for (const skillId of petConfig.skills) {
      const baseSkill = repo.getSkill(skillId)
      const skill = skillSystem.createFromBase(world, baseSkill, pet.id)
      pet.skillIds.push(skill.id)

      // Attach effects to skill instance
      for (const effectId of baseSkill.effectIds) {
        const effectDef = repo.getEffect(effectId)
        effectPipeline.attachEffect(world, skill.id, effectDef)
      }
    }

    // Create ability mark if specified
    if (petConfig.ability) {
      const baseMark = repo.getMark(petConfig.ability)
      const mark = markSystem.createFromBase(world, baseMark)
      markSystem.attach(world, mark.id, pet.id, 'pet')
      pet.abilityId = mark.id

      // Attach effects to mark instance
      for (const effectId of baseMark.effectIds) {
        const effectDef = repo.getEffect(effectId)
        effectPipeline.attachEffect(world, mark.id, effectDef)
      }
    }

    // Create emblem mark if specified
    if (petConfig.emblem) {
      const baseMark = repo.getMark(petConfig.emblem)
      const mark = markSystem.createFromBase(world, baseMark)
      markSystem.attach(world, mark.id, pet.id, 'pet')
      pet.emblemId = mark.id

      // Attach effects to mark instance
      for (const effectId of baseMark.effectIds) {
        const effectDef = repo.getEffect(effectId)
        effectPipeline.attachEffect(world, mark.id, effectDef)
      }
    }

    playerBPetIds.push(pet.id)
  }

  // Step 3: Create players
  const playerA = playerSystem.create(world, playerAConfig.name, playerAPetIds, playerAConfig.id)
  const playerB = playerSystem.create(world, playerBConfig.name, playerBPetIds, playerBConfig.id)

  // Step 4: Initialize world.state
  const battleState = createBattleState(playerA.id, playerB.id, {
    allowFaintSwitch: battleConfig?.allowFaintSwitch,
  })
  world.state = battleState as unknown as Record<string, unknown>
  if (battleConfig?.customConfig !== undefined) {
    world.state.customConfig = battleConfig.customConfig
  }

  return battle
}

/**
 * Register all base data (species, skills, marks) as entities in the world.
 * This allows them to be looked up by ID during battle.
 */
function registerBaseData(world: World, repo: V2DataRepository): void {
  // Register species
  for (const species of repo.allSpecies()) {
    createEntity(world, species.id, ['species'])
    setComponent(world, species.id, 'species', species)
  }

  // Register base skills
  for (const skill of repo.allSkills()) {
    createEntity(world, skill.id, ['baseSkill'])
    setComponent(world, skill.id, 'baseSkill', skill)
  }

  // Register base marks
  for (const mark of repo.allMarks()) {
    createEntity(world, mark.id, ['baseMark'])
    setComponent(world, mark.id, 'baseMark', mark)
  }
}
