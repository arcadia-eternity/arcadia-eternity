import { test } from '@japa/runner'
import {
  Gender,
  Nature,
  BattlePhase,
  type BattleTeamSelection,
  type TeamSelectionAction,
} from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { Battle } from '../src/battle'
import { Player } from '../src/player'
import { Pet } from '../src/pet'

// Create test pet data
function createTestPet(overrides: Partial<PetSchemaType> = {}): PetSchemaType {
  return {
    id: `test-pet-${Math.random().toString(36).substr(2, 9)}`,
    name: '测试精灵',
    species: 'test_species',
    level: 50,
    evs: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 10 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    skills: ['skill_1', 'skill_2', 'skill_3', 'skill_4'],
    gender: Gender.Male,
    nature: Nature.Hardy,
    ability: 'test_ability',
    emblem: 'test_emblem',
    height: 100,
    weight: 50,
    ...overrides,
  }
}

// Create test team
function createTestTeam(size: number = 6): Pet[] {
  return Array.from({ length: size }, (_, i) => {
    const petData = createTestPet({
      id: `pet-${i + 1}`,
      name: `精灵${i + 1}`,
    })
    return new Pet(petData)
  })
}

// Test data setup
let battle: Battle
let playerA: Player
let playerB: Player
let teamA: Pet[]
let teamB: Pet[]

function setupTestData() {
  teamA = createTestTeam(6)
  teamB = createTestTeam(6)

  playerA = new Player('Player A', 'player-a', teamA)
  playerB = new Player('Player B', 'player-b', teamB)

  battle = new Battle('test-battle', playerA, playerB)
}

test('should initialize players with full team as battle team', ({ expect }) => {
  setupTestData()

  expect(playerA.fullTeam).toHaveLength(6)
  expect(playerA.battleTeam).toHaveLength(6)
  expect(playerA.effectiveTeam).toHaveLength(6)
  expect(playerA.hasTeamSelection).toBe(false)

  // Battle team should be the same as full team initially
  expect(playerA.battleTeam.map(p => p.id)).toEqual(playerA.fullTeam.map(p => p.id))
})

test('should apply team selection correctly', ({ expect }) => {
  setupTestData()

  const selection: BattleTeamSelection = {
    selectedPets: ['pet-1', 'pet-3', 'pet-5'],
    starterPetId: 'pet-3',
  }

  playerA.applyTeamSelection(selection)

  expect(playerA.hasTeamSelection).toBe(true)
  expect(playerA.teamSelection).toEqual(selection)
  expect(playerA.battleTeam).toHaveLength(3)
  expect(playerA.battleTeam.map(p => p.id)).toEqual(['pet-1', 'pet-3', 'pet-5'])
  expect(playerA.activePet.id).toBe('pet-3')
})

test('should validate correct team selection', ({ expect }) => {
  setupTestData()

  const selection: BattleTeamSelection = {
    selectedPets: ['pet-1', 'pet-2', 'pet-3'],
    starterPetId: 'pet-1',
  }

  const result = battle.validateTeamSelection('player-a', selection)
  expect(result.isValid).toBe(true)
  expect(result.errors).toHaveLength(0)
})

test('should reject team selection with invalid pets', ({ expect }) => {
  setupTestData()

  const selection: BattleTeamSelection = {
    selectedPets: ['pet-1', 'invalid-pet', 'pet-3'],
    starterPetId: 'pet-1',
  }

  const result = battle.validateTeamSelection('player-a', selection)
  expect(result.isValid).toBe(false)
  expect(result.errors.some(e => e.includes('invalid-pet'))).toBe(true)
})

test('should maintain backward compatibility', ({ expect }) => {
  setupTestData()

  // Without team selection, everything should work as before
  expect(playerA.effectiveTeam).toEqual(playerA.team)
  expect(playerA.getAvailableSwitch()).toHaveLength(5) // 6 pets - 1 active

  // Active pet should be the first pet
  expect(playerA.activePet).toBe(teamA[0])
})
