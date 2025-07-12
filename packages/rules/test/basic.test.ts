import { describe, it, expect, beforeEach } from 'vitest'
import { Gender, Nature } from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import {
  createRuleSystemWithDefaults,
  getAvailableRuleSets,
  TeamSizeRule,
  LevelLimitRule,
  EVLimitRule,
  BanRule,
  RuleSetImpl,
} from '../src'

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

describe('规则系统基础测试', () => {
  let ruleSystem: any
  let registry: any

  beforeEach(() => {
    const result = createRuleSystemWithDefaults(false) // 不自动注册默认规则
    ruleSystem = result.ruleSystem
    registry = result.registry
  })

  describe('TeamSizeRule', () => {
    it('应该验证队伍大小', () => {
      const rule = new TeamSizeRule('test_team_size', '测试队伍大小', 2, 4)

      // 测试队伍过小
      const smallTeam = [createTestPet()]
      const smallResult = rule.validateTeam(smallTeam)
      expect(smallResult.isValid).toBe(false)
      expect(smallResult.errors).toHaveLength(1)
      expect(smallResult.errors[0].code).toBe('TEAM_TOO_SMALL')

      // 测试队伍过大
      const largeTeam = Array(5)
        .fill(null)
        .map((_, i) => createTestPet({ id: `pet-${i}` }))
      const largeResult = rule.validateTeam(largeTeam)
      expect(largeResult.isValid).toBe(false)
      expect(largeResult.errors).toHaveLength(1)
      expect(largeResult.errors[0].code).toBe('TEAM_TOO_LARGE')

      // 测试正确大小
      const validTeam = Array(3)
        .fill(null)
        .map((_, i) => createTestPet({ id: `pet-${i}` }))
      const validResult = rule.validateTeam(validTeam)
      expect(validResult.isValid).toBe(true)
      expect(validResult.errors).toHaveLength(0)
    })
  })

  describe('LevelLimitRule', () => {
    it('应该验证精灵等级', () => {
      const rule = new LevelLimitRule('test_level', '测试等级', 10, 90)

      // 测试等级过低
      const lowLevelPet = createTestPet({ level: 5 })
      const lowResult = rule.validatePet(lowLevelPet)
      expect(lowResult.isValid).toBe(false)
      expect(lowResult.errors[0].code).toBe('LEVEL_TOO_LOW')

      // 测试等级过高
      const highLevelPet = createTestPet({ level: 95 })
      const highResult = rule.validatePet(highLevelPet)
      expect(highResult.isValid).toBe(false)
      expect(highResult.errors[0].code).toBe('LEVEL_TOO_HIGH')

      // 测试正确等级
      const validPet = createTestPet({ level: 50 })
      const validResult = rule.validatePet(validPet)
      expect(validResult.isValid).toBe(true)
    })

    it('应该修改精灵等级', () => {
      const rule = new LevelLimitRule('test_level', '测试等级', 10, 90)

      const pet = createTestPet({ level: 5 })
      rule.modifyPet(pet)
      expect(pet.level).toBe(10)

      const pet2 = createTestPet({ level: 95 })
      rule.modifyPet(pet2)
      expect(pet2.level).toBe(90)
    })
  })

  describe('EVLimitRule', () => {
    it('应该验证学习力', () => {
      const rule = new EVLimitRule('test_ev', '测试学习力', 510, 252)

      // 测试学习力总和超限
      const overTotalPet = createTestPet({
        evs: { hp: 252, atk: 252, def: 252, spa: 0, spd: 0, spe: 0 },
      })
      const overTotalResult = rule.validatePet(overTotalPet)
      expect(overTotalResult.isValid).toBe(false)
      expect(overTotalResult.errors.some(e => e.code === 'EV_TOTAL_EXCEEDED')).toBe(true)

      // 测试单项学习力超限
      const overSinglePet = createTestPet({
        evs: { hp: 300, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      })
      const overSingleResult = rule.validatePet(overSinglePet)
      expect(overSingleResult.isValid).toBe(false)
      expect(overSingleResult.errors.some(e => e.code === 'EV_SINGLE_EXCEEDED')).toBe(true)

      // 测试正确学习力
      const validPet = createTestPet({
        evs: { hp: 252, atk: 252, def: 6, spa: 0, spd: 0, spe: 0 },
      })
      const validResult = rule.validatePet(validPet)
      expect(validResult.isValid).toBe(true)
    })
  })

  describe('BanRule', () => {
    it('应该禁用指定内容', () => {
      const rule = new BanRule('test_ban', '测试禁用', {
        bannedSpecies: ['banned_species'],
        bannedSkills: ['banned_skill'],
        bannedMarks: ['banned_mark'],
      })

      // 测试禁用种族
      const bannedSpeciesPet = createTestPet({ species: 'banned_species' })
      const speciesResult = rule.validatePet(bannedSpeciesPet)
      expect(speciesResult.isValid).toBe(false)
      expect(speciesResult.errors[0].code).toBe('BANNED_SPECIES')

      // 测试禁用技能
      const bannedSkillPet = createTestPet({ skills: ['banned_skill', 'normal_skill'] })
      const skillResult = rule.validatePet(bannedSkillPet)
      expect(skillResult.isValid).toBe(false)
      expect(skillResult.errors[0].code).toBe('BANNED_SKILL')

      // 测试禁用特性
      const bannedAbilityPet = createTestPet({ ability: 'banned_mark' })
      const abilityResult = rule.validatePet(bannedAbilityPet)
      expect(abilityResult.isValid).toBe(false)
      expect(abilityResult.errors[0].code).toBe('BANNED_ABILITY')
    })
  })

  describe('RuleSet', () => {
    it('应该组合多个规则', () => {
      const ruleSet = new RuleSetImpl('test_ruleset', '测试规则集')

      const teamSizeRule = new TeamSizeRule('team_size', '队伍大小', 1, 3)
      const levelRule = new LevelLimitRule('level', '等级限制', 50, 100)

      ruleSet.addRule(teamSizeRule)
      ruleSet.addRule(levelRule)

      // 测试违反多个规则
      const invalidTeam = [
        createTestPet({ id: 'pet1', level: 30 }), // 等级过低
        createTestPet({ id: 'pet2', level: 30 }), // 等级过低
        createTestPet({ id: 'pet3', level: 30 }), // 等级过低
        createTestPet({ id: 'pet4', level: 30 }), // 等级过低 + 队伍过大
      ]

      const result = ruleSet.validateTeam(invalidTeam)
      expect(result.isValid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(1)
      expect(result.errors.some(e => e.code === 'TEAM_TOO_LARGE')).toBe(true)
      expect(result.errors.some(e => e.code === 'LEVEL_TOO_LOW')).toBe(true)
    })
  })

  describe('RuleSystem', () => {
    it('应该管理规则集的激活', () => {
      const teamSizeRule = new TeamSizeRule('team_size', '队伍大小', 1, 2)
      const ruleSet = new RuleSetImpl('test_ruleset', '测试规则集')

      // 先注册规则，再添加到规则集
      registry.registerRule(teamSizeRule)
      ruleSet.addRule(teamSizeRule)
      registry.registerRuleSet(ruleSet)

      // 激活规则集
      ruleSystem.activateRuleSet('test_ruleset')
      expect(ruleSystem.isRuleSetActive('test_ruleset')).toBe(true)

      // 测试验证
      const team = Array(3)
        .fill(null)
        .map((_, i) => createTestPet({ id: `pet-${i}` }))
      const result = ruleSystem.validateTeam(team)
      expect(result.isValid).toBe(false)
      expect(result.errors[0].code).toBe('TEAM_TOO_LARGE')

      // 停用规则集
      ruleSystem.deactivateRuleSet('test_ruleset')
      expect(ruleSystem.isRuleSetActive('test_ruleset')).toBe(false)
    })
  })

  describe('可用规则集', () => {
    it('应该返回所有可用的规则集', () => {
      const available = getAvailableRuleSets()
      expect(available).toContain('competitive_ruleset')
      expect(available).toContain('casual_standard_ruleset')
      expect(available).toHaveLength(2)
    })
  })
})
