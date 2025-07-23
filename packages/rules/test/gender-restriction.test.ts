import { describe, it, expect, beforeEach } from 'vitest'
import { Gender, Nature } from '@arcadia-eternity/const'
import type { PetSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'
import { GenderRestrictionRule, type SpeciesDataProvider } from '../src/rules/basic/GenderRestrictionRule'

// 创建测试用的精灵数据
function createTestPet(overrides: Partial<PetSchemaType> = {}): PetSchemaType {
  return {
    id: 'test-pet-1',
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

// 创建测试用的种族数据
function createTestSpecies(overrides: Partial<SpeciesSchemaType> = {}): SpeciesSchemaType {
  return {
    id: 'test_species',
    num: 1,
    element: 'Normal' as any,
    baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    genderRatio: [0.5, 0.5], // 50% 雌性, 50% 雄性
    heightRange: [90, 110],
    weightRange: [40, 60],
    learnable_skills: [],
    ability: ['test_ability'],
    emblem: ['test_emblem'],
    ...overrides,
  }
}

// 模拟种族数据提供者
class MockSpeciesDataProvider implements SpeciesDataProvider {
  private speciesData: Map<string, SpeciesSchemaType> = new Map()

  addSpecies(species: SpeciesSchemaType): void {
    this.speciesData.set(species.id, species)
  }

  getSpeciesById(speciesId: string): SpeciesSchemaType | undefined {
    return this.speciesData.get(speciesId)
  }

  clear(): void {
    this.speciesData.clear()
  }
}

describe('性别限制规则测试', () => {
  let rule: GenderRestrictionRule
  let speciesProvider: MockSpeciesDataProvider

  beforeEach(() => {
    speciesProvider = new MockSpeciesDataProvider()
    rule = new GenderRestrictionRule('test_gender_restriction', '测试性别限制', speciesProvider)
  })

  describe('基本功能测试', () => {
    it('应该正确创建规则实例', () => {
      expect(rule.id).toBe('test_gender_restriction')
      expect(rule.name).toBe('测试性别限制')
      expect(rule.enabled).toBe(true)
      expect(rule.hasTag('gender')).toBe(true)
    })

    it('没有种族数据提供者时应该跳过验证', () => {
      const ruleWithoutProvider = new GenderRestrictionRule()
      const pet = createTestPet()
      const result = ruleWithoutProvider.validatePet(pet)

      expect(result.isValid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('性别验证测试', () => {
    it('应该允许符合种族性别比例的精灵', () => {
      // 创建允许雄性和雌性的种族
      const species = createTestSpecies({
        id: 'normal_species',
        genderRatio: [0.5, 0.5], // 50% 雌性, 50% 雄性
      })
      speciesProvider.addSpecies(species)

      // 测试雄性精灵
      const malePet = createTestPet({
        species: 'normal_species',
        gender: Gender.Male,
      })
      const maleResult = rule.validatePet(malePet)
      expect(maleResult.isValid).toBe(true)

      // 测试雌性精灵
      const femalePet = createTestPet({
        species: 'normal_species',
        gender: Gender.Female,
      })
      const femaleResult = rule.validatePet(femalePet)
      expect(femaleResult.isValid).toBe(true)
    })

    it('应该拒绝不符合种族性别比例的精灵', () => {
      // 创建只允许雄性的种族
      const species = createTestSpecies({
        id: 'male_only_species',
        genderRatio: [0, 1], // 0% 雌性, 100% 雄性
      })
      speciesProvider.addSpecies(species)

      // 测试雌性精灵（应该被拒绝）
      const femalePet = createTestPet({
        species: 'male_only_species',
        gender: Gender.Female,
      })
      const result = rule.validatePet(femalePet)

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].code).toBe('INVALID_GENDER')
      expect(result.errors[0].message).toContain('不被允许')
    })

    it('应该正确处理无性别精灵', () => {
      // 创建无性别种族
      const species = createTestSpecies({
        id: 'genderless_species',
        genderRatio: [0, 0], // 0% 雌性, 0% 雄性 = 无性别
      })
      speciesProvider.addSpecies(species)

      // 测试无性别精灵
      const genderlessPet = createTestPet({
        species: 'genderless_species',
        gender: Gender.NoGender,
      })
      const result = rule.validatePet(genderlessPet)
      expect(result.isValid).toBe(true)

      // 测试有性别精灵（应该被拒绝）
      const malePet = createTestPet({
        species: 'genderless_species',
        gender: Gender.Male,
      })
      const maleResult = rule.validatePet(malePet)
      expect(maleResult.isValid).toBe(false)
    })

    it('应该要求必须设置性别的精灵设置性别', () => {
      // 创建有性别的种族
      const species = createTestSpecies({
        id: 'gendered_species',
        genderRatio: [0.5, 0.5],
      })
      speciesProvider.addSpecies(species)

      // 测试未设置性别的精灵
      const pet = createTestPet({
        species: 'gendered_species',
        gender: undefined,
      })
      const result = rule.validatePet(pet)

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].code).toBe('GENDER_REQUIRED')
    })

    it('应该处理种族不存在的情况', () => {
      const pet = createTestPet({
        species: 'nonexistent_species',
      })
      const result = rule.validatePet(pet)

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].code).toBe('SPECIES_NOT_FOUND')
    })
  })

  describe('辅助方法测试', () => {
    it('应该正确获取种族允许的性别', () => {
      const species = createTestSpecies({
        id: 'test_species',
        genderRatio: [0, 1], // 只允许雄性
      })
      speciesProvider.addSpecies(species)

      const allowedGenders = rule.getAllowedGendersForSpecies('test_species')
      expect(allowedGenders).toEqual([Gender.Male])
    })

    it('应该正确检查性别是否被允许', () => {
      const species = createTestSpecies({
        id: 'test_species',
        genderRatio: [0.5, 0.5],
      })
      speciesProvider.addSpecies(species)

      expect(rule.isGenderAllowedForSpecies('test_species', Gender.Male)).toBe(true)
      expect(rule.isGenderAllowedForSpecies('test_species', Gender.Female)).toBe(true)
      expect(rule.isGenderAllowedForSpecies('test_species', Gender.NoGender)).toBe(false)
    })
  })

  describe('队伍验证测试', () => {
    it('应该验证整个队伍的性别限制', () => {
      const species = createTestSpecies({
        id: 'male_only_species',
        genderRatio: [1, 0],
      })
      speciesProvider.addSpecies(species)

      const team = [
        createTestPet({ species: 'male_only_species', gender: Gender.Male }),
        createTestPet({ species: 'male_only_species', gender: Gender.Female }), // 无效
      ]

      const result = rule.validateTeam(team)
      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(1)
    })
  })
})
