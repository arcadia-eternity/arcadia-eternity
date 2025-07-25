import { describe, it, expect, beforeEach } from 'vitest'
import { Gender, Nature } from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { BattleTeamSelection, TeamSelectionConfig } from '@arcadia-eternity/const'
import {
  TeamSelectionRule,
  createViewOnlyRule,
  createStarterSelectionRule,
  createCompetitive6v3Rule,
  createCasual6v4Rule,
} from '../src/rules/special/TeamSelectionRule'

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
function createTestTeam(size: number = 6): PetSchemaType[] {
  return Array.from({ length: size }, (_, i) =>
    createTestPet({
      id: `pet-${i + 1}`,
      name: `精灵${i + 1}`,
    }),
  )
}

describe('TeamSelectionRule', () => {
  let testTeam: PetSchemaType[]

  beforeEach(() => {
    testTeam = createTestTeam(6)
  })

  describe('Constructor and Configuration', () => {
    it('should create rule with valid configuration', () => {
      const config: TeamSelectionConfig = {
        mode: 'TEAM_SELECTION',
        maxTeamSize: 3,
        minTeamSize: 3,
        allowStarterSelection: true,
        showOpponentTeam: false,
        teamInfoVisibility: 'HIDDEN',
        timeLimit: 60,
      }

      const rule = new TeamSelectionRule('test_rule', '测试规则', config)

      expect(rule.id).toBe('test_rule')
      expect(rule.name).toBe('测试规则')
      expect(rule.getConfig()).toEqual(config)
      expect(rule.requiresTeamSelection()).toBe(true)
      expect(rule.allowsStarterSelection()).toBe(true)
    })

    it('should throw error for invalid configuration', () => {
      expect(() => {
        new TeamSelectionRule('test_rule', '测试规则', {
          mode: 'TEAM_SELECTION',
          maxTeamSize: 0,
          minTeamSize: 1,
          allowStarterSelection: true,
          showOpponentTeam: false,
          teamInfoVisibility: 'HIDDEN',
        })
      }).toThrow('maxTeamSize must be at least 1')

      expect(() => {
        new TeamSelectionRule('test_rule', '测试规则', {
          mode: 'TEAM_SELECTION',
          maxTeamSize: 2,
          minTeamSize: 3,
          allowStarterSelection: true,
          showOpponentTeam: false,
          teamInfoVisibility: 'HIDDEN',
        })
      }).toThrow('minTeamSize cannot be greater than maxTeamSize')

      expect(() => {
        new TeamSelectionRule('test_rule', '测试规则', {
          mode: 'TEAM_SELECTION',
          maxTeamSize: 3,
          minTeamSize: 3,
          allowStarterSelection: true,
          showOpponentTeam: false,
          teamInfoVisibility: 'HIDDEN',
          timeLimit: 0,
        })
      }).toThrow('timeLimit must be at least 1 second')
    })
  })

  describe('Team Selection Validation', () => {
    let rule: TeamSelectionRule

    beforeEach(() => {
      rule = new TeamSelectionRule('test_rule', '测试规则', {
        mode: 'TEAM_SELECTION',
        maxTeamSize: 3,
        minTeamSize: 3,
        allowStarterSelection: true,
        showOpponentTeam: false,
        teamInfoVisibility: 'HIDDEN',
      })
    })

    it('should validate correct team selection', () => {
      const selection: BattleTeamSelection = {
        selectedPets: ['pet-1', 'pet-2', 'pet-3'],
        starterPetId: 'pet-1',
      }

      const result = rule.validateTeamSelection(selection, testTeam)
      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject team selection with too many pets', () => {
      const selection: BattleTeamSelection = {
        selectedPets: ['pet-1', 'pet-2', 'pet-3', 'pet-4'],
        starterPetId: 'pet-1',
      }

      const result = rule.validateTeamSelection(selection, testTeam)
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'TOO_MANY_SELECTED_PETS')).toBe(true)
    })

    it('should reject team selection with too few pets', () => {
      const selection: BattleTeamSelection = {
        selectedPets: ['pet-1', 'pet-2'],
        starterPetId: 'pet-1',
      }

      const result = rule.validateTeamSelection(selection, testTeam)
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'TOO_FEW_SELECTED_PETS')).toBe(true)
    })

    it('should reject invalid starter pet', () => {
      const selection: BattleTeamSelection = {
        selectedPets: ['pet-1', 'pet-2', 'pet-3'],
        starterPetId: 'pet-4',
      }

      const result = rule.validateTeamSelection(selection, testTeam)
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_STARTER_PET')).toBe(true)
    })

    it('should reject pets not in full team', () => {
      const selection: BattleTeamSelection = {
        selectedPets: ['pet-1', 'pet-2', 'invalid-pet'],
        starterPetId: 'pet-1',
      }

      const result = rule.validateTeamSelection(selection, testTeam)
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'INVALID_SELECTED_PET')).toBe(true)
    })

    it('should reject duplicate pet selections', () => {
      const selection: BattleTeamSelection = {
        selectedPets: ['pet-1', 'pet-2', 'pet-1'],
        starterPetId: 'pet-1',
      }

      const result = rule.validateTeamSelection(selection, testTeam)
      expect(result.isValid).toBe(false)
      expect(result.errors.some(e => e.code === 'DUPLICATE_SELECTED_PETS')).toBe(true)
    })
  })

  describe('Default Team Selection', () => {
    it('should generate default selection for TEAM_SELECTION mode', () => {
      const rule = new TeamSelectionRule('test_rule', '测试规则', {
        mode: 'TEAM_SELECTION',
        maxTeamSize: 3,
        minTeamSize: 3,
        allowStarterSelection: true,
        showOpponentTeam: false,
        teamInfoVisibility: 'HIDDEN',
      })

      const defaultSelection = rule.getDefaultTeamSelection(testTeam)
      expect(defaultSelection.selectedPets).toHaveLength(3)
      expect(defaultSelection.selectedPets).toEqual(['pet-1', 'pet-2', 'pet-3'])
      expect(defaultSelection.starterPetId).toBe('pet-1')
    })

    it('should generate default selection for FULL_TEAM mode', () => {
      const rule = new TeamSelectionRule('test_rule', '测试规则', {
        mode: 'FULL_TEAM',
        allowStarterSelection: true,
        showOpponentTeam: true,
        teamInfoVisibility: 'BASIC',
      })

      const defaultSelection = rule.getDefaultTeamSelection(testTeam)
      expect(defaultSelection.selectedPets).toHaveLength(6)
      expect(defaultSelection.selectedPets).toEqual(['pet-1', 'pet-2', 'pet-3', 'pet-4', 'pet-5', 'pet-6'])
      expect(defaultSelection.starterPetId).toBe('pet-1')
    })
  })

  describe('Configuration Updates', () => {
    it('should update configuration correctly', () => {
      const rule = new TeamSelectionRule('test_rule', '测试规则', {
        mode: 'TEAM_SELECTION',
        maxTeamSize: 3,
        minTeamSize: 3,
        allowStarterSelection: true,
        showOpponentTeam: false,
        teamInfoVisibility: 'HIDDEN',
      })

      rule.updateConfig({
        showOpponentTeam: true,
        teamInfoVisibility: 'BASIC',
        timeLimit: 45,
      })

      const config = rule.getConfig()
      expect(config.showOpponentTeam).toBe(true)
      expect(config.teamInfoVisibility).toBe('BASIC')
      expect(config.timeLimit).toBe(45)
      expect(config.maxTeamSize).toBe(3) // Should preserve existing values
    })
  })

  describe('Predefined Rule Creators', () => {
    it('should create view-only rule correctly', () => {
      const rule = createViewOnlyRule(15)
      const config = rule.getConfig()

      expect(config.mode).toBe('VIEW_ONLY')
      expect(config.allowStarterSelection).toBe(false)
      expect(config.showOpponentTeam).toBe(true)
      expect(config.teamInfoVisibility).toBe('BASIC')
      expect(config.timeLimit).toBe(15)
    })

    it('should create starter selection rule correctly', () => {
      const rule = createStarterSelectionRule(25)
      const config = rule.getConfig()

      expect(config.mode).toBe('FULL_TEAM')
      expect(config.allowStarterSelection).toBe(true)
      expect(config.showOpponentTeam).toBe(true)
      expect(config.teamInfoVisibility).toBe('BASIC')
      expect(config.timeLimit).toBe(25)
    })

    it('should create competitive 6v3 rule correctly', () => {
      const rule = createCompetitive6v3Rule(50)
      const config = rule.getConfig()

      expect(config.mode).toBe('TEAM_SELECTION')
      expect(config.maxTeamSize).toBe(3)
      expect(config.minTeamSize).toBe(3)
      expect(config.allowStarterSelection).toBe(true)
      expect(config.showOpponentTeam).toBe(false)
      expect(config.teamInfoVisibility).toBe('HIDDEN')
      expect(config.timeLimit).toBe(50)
    })

    it('should create casual 6v4 rule correctly', () => {
      const rule = createCasual6v4Rule(80)
      const config = rule.getConfig()

      expect(config.mode).toBe('TEAM_SELECTION')
      expect(config.maxTeamSize).toBe(4)
      expect(config.minTeamSize).toBe(4)
      expect(config.allowStarterSelection).toBe(true)
      expect(config.showOpponentTeam).toBe(true)
      expect(config.teamInfoVisibility).toBe('FULL')
      expect(config.timeLimit).toBe(80)
    })
  })
})
