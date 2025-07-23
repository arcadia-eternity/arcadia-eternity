import { describe, it, expect, beforeEach } from 'vitest'
import { Gender, Nature } from '@arcadia-eternity/const'
import type { PetSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'
import { createRuleSystemWithDefaults, GenderRestrictionRule, type SpeciesDataProvider } from '../src'

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
    genderRatio: [0.5, 0.5], // 50% 雄性, 50% 雌性
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

describe('性别限制规则集成测试', () => {
  let speciesProvider: MockSpeciesDataProvider
  let ruleSystem: any
  let registry: any

  beforeEach(() => {
    speciesProvider = new MockSpeciesDataProvider()

    // 只在第一次创建规则系统，避免重复注册
    if (!ruleSystem) {
      const result = createRuleSystemWithDefaults()
      ruleSystem = result.ruleSystem
      registry = result.registry
    }
  })

  describe('规则系统集成测试', () => {
    it('应该能够在规则系统中找到性别限制规则', () => {
      // 检查标准性别限制规则是否已注册
      const standardRule = registry.getRule('standard_gender_restriction')
      expect(standardRule).toBeDefined()
      expect(standardRule?.name).toBe('标准性别限制')
    })

    it('应该能够在休闲规则集中使用性别限制规则', () => {
      // 激活休闲规则集
      ruleSystem.activateRuleSet('casual_standard_ruleset')

      // 获取性别限制规则并设置种族数据提供者
      const genderRule = registry.getRule('standard_gender_restriction') as GenderRestrictionRule
      expect(genderRule).toBeDefined()

      if (genderRule) {
        genderRule.setSpeciesDataProvider(speciesProvider)

        // 添加测试种族数据
        const species = createTestSpecies({
          id: 'male_only_species',
          genderRatio: [1, 0], // 只允许雄性
        })
        speciesProvider.addSpecies(species)

        // 创建测试队伍
        const team = [
          createTestPet({ species: 'male_only_species', gender: Gender.Male }), // 有效
          createTestPet({ species: 'male_only_species', gender: Gender.Female }), // 无效
        ]

        // 验证队伍
        const result = ruleSystem.validateTeam(team)
        expect(result.isValid).toBe(false)
        expect(result.errors.some(e => e.code === 'INVALID_GENDER')).toBe(true)
      }
    })

    it('应该能够在竞技规则集中使用性别限制规则', () => {
      // 激活竞技规则集
      ruleSystem.activateRuleSet('competitive_ruleset')

      // 获取性别限制规则并设置种族数据提供者
      const genderRule = registry.getRule('standard_gender_restriction') as GenderRestrictionRule
      expect(genderRule).toBeDefined()

      if (genderRule) {
        genderRule.setSpeciesDataProvider(speciesProvider)

        // 添加测试种族数据
        const species = createTestSpecies({
          id: 'genderless_species',
          genderRatio: [0, 0], // 无性别
        })
        speciesProvider.addSpecies(species)

        // 创建测试队伍（竞技模式需要6只精灵，但这里只测试性别限制）
        const team = [
          createTestPet({ species: 'genderless_species', gender: Gender.NoGender, level: 100 }),
          createTestPet({ species: 'genderless_species', gender: Gender.Male, level: 100 }), // 无效
          createTestPet({ species: 'genderless_species', gender: Gender.NoGender, level: 100 }),
          createTestPet({ species: 'genderless_species', gender: Gender.NoGender, level: 100 }),
          createTestPet({ species: 'genderless_species', gender: Gender.NoGender, level: 100 }),
          createTestPet({ species: 'genderless_species', gender: Gender.NoGender, level: 100 }),
        ]

        // 验证队伍
        const result = ruleSystem.validateTeam(team)
        expect(result.isValid).toBe(false)
        expect(result.errors.some(e => e.code === 'INVALID_GENDER')).toBe(true)
      }
    })

    it('应该能够获取种族允许的性别用于编辑器显示', () => {
      const genderRule = registry.getRule('standard_gender_restriction') as GenderRestrictionRule
      expect(genderRule).toBeDefined()

      if (genderRule) {
        genderRule.setSpeciesDataProvider(speciesProvider)

        // 添加不同性别限制的种族
        speciesProvider.addSpecies(
          createTestSpecies({
            id: 'normal_species',
            genderRatio: [0.5, 0.5], // 雄性和雌性
          }),
        )

        speciesProvider.addSpecies(
          createTestSpecies({
            id: 'male_only_species',
            genderRatio: [0, 1], // 只允许雄性 (0% 雌性, 100% 雄性)
          }),
        )

        speciesProvider.addSpecies(
          createTestSpecies({
            id: 'female_only_species',
            genderRatio: [1, 0], // 只允许雌性 (100% 雌性, 0% 雄性)
          }),
        )

        speciesProvider.addSpecies(
          createTestSpecies({
            id: 'genderless_species',
            genderRatio: [0, 0], // 无性别
          }),
        )

        // 测试获取允许的性别（现在是雌性在前，雄性在后）
        expect(genderRule.getAllowedGendersForSpecies('normal_species')).toEqual([Gender.Female, Gender.Male])
        expect(genderRule.getAllowedGendersForSpecies('male_only_species')).toEqual([Gender.Male])
        expect(genderRule.getAllowedGendersForSpecies('female_only_species')).toEqual([Gender.Female])
        expect(genderRule.getAllowedGendersForSpecies('genderless_species')).toEqual([Gender.NoGender])

        // 测试检查性别是否被允许
        expect(genderRule.isGenderAllowedForSpecies('normal_species', Gender.Male)).toBe(true)
        expect(genderRule.isGenderAllowedForSpecies('normal_species', Gender.Female)).toBe(true)
        expect(genderRule.isGenderAllowedForSpecies('normal_species', Gender.NoGender)).toBe(false)

        expect(genderRule.isGenderAllowedForSpecies('male_only_species', Gender.Male)).toBe(true)
        expect(genderRule.isGenderAllowedForSpecies('male_only_species', Gender.Female)).toBe(false)

        expect(genderRule.isGenderAllowedForSpecies('genderless_species', Gender.NoGender)).toBe(true)
        expect(genderRule.isGenderAllowedForSpecies('genderless_species', Gender.Male)).toBe(false)
      }
    })
  })
})
