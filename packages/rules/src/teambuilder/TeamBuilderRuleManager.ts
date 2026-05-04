import type { PetSchemaType, LearnableSkill } from '@arcadia-eternity/schema'
import { RuleSystem } from '../core/RuleSystem'
import { RuleRegistry } from '../core/RuleRegistry'
import { TeamBuilderIntegration } from '../integration/TeamBuilderIntegration'
import type { Team } from '../interfaces/Rule'
import type { ValidationResult } from '../interfaces/ValidationResult'

/**
 * 队伍构建器规则管理器
 * 专门用于队伍构建时的规则验证和建议
 */
export class TeamBuilderRuleManager {
  private ruleSystem: RuleSystem
  private teamBuilderIntegration: TeamBuilderIntegration
  private currentRuleSetIds: string[]

  constructor(ruleSetIds?: string[], registry?: RuleRegistry) {
    // 使用全局注册表
    const ruleRegistry = registry || RuleRegistry.getInstance()

    this.ruleSystem = new RuleSystem(ruleRegistry)
    this.teamBuilderIntegration = new TeamBuilderIntegration(this.ruleSystem, ruleRegistry)

    // 如果没有指定规则集，使用默认的休闲规则集
    this.currentRuleSetIds = ruleSetIds || ['casual_standard_ruleset']
  }

  /**
   * 设置规则集
   */
  setRuleSetIds(ruleSetIds: string[]): void {
    this.currentRuleSetIds = ruleSetIds
  }

  /**
   * 验证完整队伍
   */
  validateTeam(team: Team): ValidationResult {
    return this.teamBuilderIntegration.validateTeam(team, this.currentRuleSetIds)
  }

  /**
   * 验证单个精灵
   */
  validatePet(pet: PetSchemaType, team: Team): ValidationResult {
    return this.teamBuilderIntegration.validatePet(pet, team, this.currentRuleSetIds)
  }

  /**
   * 获取队伍构建建议
   */
  getTeamBuildingSuggestions(team: Team) {
    return this.teamBuilderIntegration.getTeamBuildingSuggestions(team, this.currentRuleSetIds)
  }

  /**
   * 自动修复队伍
   */
  autoFixTeam(team: Team) {
    return this.teamBuilderIntegration.autoFixTeam(team, this.currentRuleSetIds)
  }

  /**
   * 获取规则限制信息
   */
  getRuleLimitations() {
    return this.teamBuilderIntegration.getRuleLimitations(this.currentRuleSetIds)
  }

  /**
   * 检查队伍是否可以添加更多精灵
   */
  canAddMorePets(team: Team): boolean {
    const limitations = this.getRuleLimitations()
    return team.length < limitations.teamSize.max
  }

  /**
   * 获取推荐的队伍大小
   */
  getRecommendedTeamSize(): { min: number; max: number } {
    const limitations = this.getRuleLimitations()
    return limitations.teamSize
  }

  /**
   * 获取等级限制
   */
  getLevelLimits(): { min: number; max: number } {
    const limitations = this.getRuleLimitations()
    return limitations.levelRange
  }

  /**
   * 获取学习力限制
   */
  getEVLimits(): { totalMax: number; singleMax: number } {
    const limitations = this.getRuleLimitations()
    return limitations.evLimits
  }

  /**
   * 获取禁用内容列表
   */
  getBannedContent() {
    const limitations = this.getRuleLimitations()
    return limitations.bannedContent
  }

  /**
   * 检查精灵种族是否被禁用
   */
  isSpeciesBanned(speciesId: string): boolean {
    const banned = this.getBannedContent()
    return banned.species.includes(speciesId)
  }

  /**
   * 检查技能是否被禁用
   */
  isSkillBanned(skillId: string): boolean {
    const banned = this.getBannedContent()
    return banned.skills.includes(skillId)
  }

  /**
   * 检查印记是否被禁用
   */
  isMarkBanned(markId: string): boolean {
    const banned = this.getBannedContent()
    return banned.marks.includes(markId)
  }

  /**
   * 获取当前规则集ID列表
   */
  getCurrentRuleSetIds(): string[] {
    return [...this.currentRuleSetIds]
  }

  /**
   * 获取特定种族的额外可学习技能（仅在队伍构建验证过程中生效）
   * @param speciesId 种族ID
   * @returns 额外可学习技能列表
   */
  getSpeciesExtraLearnableSkills(speciesId: string): LearnableSkill[] {
    // 激活当前规则集
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of this.currentRuleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        // 忽略无法激活的规则集
        continue
      }
    }

    return this.ruleSystem.getSpeciesExtraLearnableSkills(speciesId)
  }

  /**
   * 获取精灵种族允许的性别列表
   * @param speciesId 种族ID
   * @returns 允许的性别列表
   */
  getAllowedGendersForSpecies(speciesId: string): string[] {
    // 激活当前规则集
    this.ruleSystem.clearActiveRuleSets()
    for (const ruleSetId of this.currentRuleSetIds) {
      try {
        this.ruleSystem.activateRuleSet(ruleSetId)
      } catch (error) {
        // 忽略无法激活的规则集
        continue
      }
    }

    // 获取性别限制规则
    const genderRule = this.ruleSystem.getActiveRules().find(rule => rule.id === 'standard_gender_restriction')
    if (!genderRule || !('getAllowedGendersForSpecies' in genderRule)) {
      // 如果没有性别限制规则，返回所有性别
      return ['Male', 'Female', 'NoGender']
    }

    try {
      return (genderRule as any).getAllowedGendersForSpecies(speciesId)
    } catch (error) {
      console.warn('获取性别限制失败:', error)
      return ['Male', 'Female', 'NoGender']
    }
  }

  /**
   * 检查指定性别是否被种族允许
   * @param speciesId 种族ID
   * @param gender 性别
   * @returns 是否允许
   */
  isGenderAllowedForSpecies(speciesId: string, gender: string): boolean {
    const allowedGenders = this.getAllowedGendersForSpecies(speciesId)
    return allowedGenders.includes(gender)
  }

  /**
   * 获取管理器状态
   */
  getStatus() {
    return {
      ruleSetIds: this.currentRuleSetIds,
      limitations: this.getRuleLimitations(),
    }
  }
}
