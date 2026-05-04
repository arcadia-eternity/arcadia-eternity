import type { PetSchemaType, LearnableSkill } from '@arcadia-eternity/schema'
import type { RuleContext, Team } from '../../interfaces/Rule'
import { RulePriority } from '../../interfaces/Rule'
import { AbstractRule } from '../../core/AbstractRule'
import { ValidationResultBuilder, ValidationErrorType } from '../../interfaces/ValidationResult'
import type { ValidationResult } from '../../interfaces/ValidationResult'
import type { SpeciesDataProvider } from '../../interfaces/SpeciesDataProvider'

/**
 * 技能可用性验证规则
 * 确保精灵只能选择他们可以学习的技能（包括原始技能和规则系统提供的额外技能）
 */
export class SkillAvailabilityRule extends AbstractRule {
  private speciesDataProvider?: SpeciesDataProvider

  constructor(
    id: string = 'skill_availability_rule',
    name: string = '技能可用性验证规则',
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
      speciesDataProvider?: SpeciesDataProvider
    } = {},
  ) {
    super(id, name, {
      description: options.description || '确保精灵只能选择他们可以学习的技能',
      priority: options.priority ?? RulePriority.HIGH, // 高优先级，确保基础验证
      version: options.version ?? '1.0.0',
      author: options.author,
      tags: options.tags ?? ['basic', 'skill', 'validation'],
      enabled: options.enabled ?? true,
    })

    this.speciesDataProvider = options.speciesDataProvider
  }

  /**
   * 设置种族数据提供者
   * @param provider 种族数据提供者
   */
  setSpeciesDataProvider(provider: SpeciesDataProvider): void {
    this.speciesDataProvider = provider
  }

  /**
   * 验证整个队伍的技能选择
   * @param team 队伍数据
   * @param context 规则上下文
   * @returns 验证结果
   */
  validateTeam(team: Team, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    // 遍历队伍中的每个精灵进行验证
    for (const pet of team) {
      const petResult = this.validatePet(pet, context)
      builder.merge(petResult)
    }

    return builder.build()
  }

  /**
   * 验证精灵的技能选择
   * @param pet 精灵数据
   * @param context 规则上下文
   * @returns 验证结果
   */
  validatePet(pet: PetSchemaType, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    // 如果精灵没有技能，跳过验证
    if (!pet.skills || pet.skills.length === 0) {
      return builder.build()
    }

    // 获取精灵的可学习技能列表
    const availableSkills = this.getAvailableSkillsForPet(pet, context)

    // 如果没有可学习技能（可能是数据未加载），跳过验证
    if (availableSkills.length === 0 && !this.speciesDataProvider) {
      return builder.build() // 返回空的验证结果，不报错
    }

    const availableSkillIds = new Set(availableSkills.map(skill => skill.skill_id))

    // 验证每个技能
    for (const skillId of pet.skills) {
      if (!skillId) continue // 跳过空技能槽

      if (!availableSkillIds.has(skillId)) {
        builder.addError(
          ValidationErrorType.PET_VALIDATION,
          'SKILL_NOT_AVAILABLE',
          `精灵 "${pet.name}" 无法学习技能 "${skillId}"`,
          pet.id,
          'pet',
          {
            petId: pet.id,
            petName: pet.name,
            species: pet.species,
            skillId: skillId,
            availableSkillCount: availableSkills.length,
          },
        )
      }
    }

    // 检查技能等级要求
    for (const skillId of pet.skills) {
      if (!skillId) continue

      const learnableSkill = availableSkills.find(skill => skill.skill_id === skillId)
      if (learnableSkill && pet.level < learnableSkill.level) {
        builder.addError(
          ValidationErrorType.PET_VALIDATION,
          'SKILL_LEVEL_TOO_LOW',
          `精灵 "${pet.name}" 等级不足，无法学习技能 "${skillId}"（需要等级 ${learnableSkill.level}，当前等级 ${pet.level}）`,
          pet.id,
          'pet',
          {
            petId: pet.id,
            petName: pet.name,
            skillId: skillId,
            requiredLevel: learnableSkill.level,
            currentLevel: pet.level,
          },
        )
      }
    }

    return builder.build()
  }

  /**
   * 获取精灵的所有可学习技能（包括原始技能和额外技能）
   * @param pet 精灵数据
   * @param context 规则上下文
   * @returns 可学习技能列表
   */
  private getAvailableSkillsForPet(pet: PetSchemaType, context?: RuleContext): LearnableSkill[] {
    // 检查种族数据提供者是否可用
    if (!this.speciesDataProvider) {
      // 返回空数组，但不报错，因为数据可能还在加载中
      return []
    }

    // 获取种族数据
    let speciesData = this.speciesDataProvider.getSpeciesById(pet.species)

    // 如果没有提供者，尝试从上下文获取
    if (!speciesData && context?.data?.speciesData) {
      speciesData = context.data.speciesData[pet.species]
    }

    if (!speciesData) {
      // 如果无法获取种族数据，返回空数组
      // 这种情况通常发生在数据还在加载时
      return []
    }

    // 获取原始可学习技能
    const originalSkills: LearnableSkill[] = speciesData.learnable_skills || []

    // 获取规则系统提供的额外技能
    const extraSkills: LearnableSkill[] = []
    if (context?.data?.ruleSystem) {
      try {
        const ruleSystemExtraSkills = context.data.ruleSystem.getSpeciesExtraLearnableSkills(pet.species, context)
        extraSkills.push(...ruleSystemExtraSkills)
      } catch (error) {
        // 忽略获取额外技能时的错误
      }
    }

    // 合并并去重
    const allSkills = [...originalSkills, ...extraSkills]
    const uniqueSkills = allSkills.filter(
      (skill, index, array) => array.findIndex(s => s.skill_id === skill.skill_id) === index,
    )

    return uniqueSkills
  }

  /**
   * 检查技能是否对精灵可用
   * @param pet 精灵数据
   * @param skillId 技能ID
   * @param context 规则上下文
   * @returns 是否可用
   */
  isSkillAvailableForPet(pet: PetSchemaType, skillId: string, context?: RuleContext): boolean {
    const availableSkills = this.getAvailableSkillsForPet(pet, context)
    const skill = availableSkills.find(s => s.skill_id === skillId)

    if (!skill) return false

    // 检查等级要求
    return pet.level >= skill.level
  }

  /**
   * 获取精灵在指定等级下可学习的技能
   * @param pet 精灵数据
   * @param level 等级
   * @param context 规则上下文
   * @returns 可学习技能列表
   */
  getAvailableSkillsAtLevel(pet: PetSchemaType, level: number, context?: RuleContext): LearnableSkill[] {
    const allSkills = this.getAvailableSkillsForPet(pet, context)
    return allSkills.filter(skill => level >= skill.level)
  }

  /**
   * 获取规则的配置信息
   * @returns 配置信息
   */
  getConfigInfo(): {
    description: string
    validationTypes: string[]
    priority: number
  } {
    return {
      description: '验证精灵技能选择的合法性，确保只能选择可学习的技能',
      validationTypes: ['skill_availability', 'skill_level_requirement'],
      priority: this.priority,
    }
  }
}

/**
 * 创建标准技能可用性验证规则
 */
export function createStandardSkillAvailabilityRule(speciesDataProvider?: SpeciesDataProvider): SkillAvailabilityRule {
  // 如果没有提供数据提供者，尝试获取全局提供者
  let provider = speciesDataProvider
  if (!provider) {
    try {
      // 动态导入以避免循环依赖
      const { getGlobalClientSpeciesDataProvider } = require('../../providers/ClientSpeciesDataProvider')
      provider = getGlobalClientSpeciesDataProvider()
    } catch (error) {
      // 如果客户端提供者不可用，尝试服务端提供者
      try {
        const { getGlobalServerSpeciesDataProvider } = require('../../providers/ServerSpeciesDataProvider')
        provider = getGlobalServerSpeciesDataProvider()
      } catch (serverError) {
        console.warn('No species data provider available for skill availability rule')
      }
    }
  }

  return new SkillAvailabilityRule('standard_skill_availability', '标准技能可用性验证', {
    description: '验证精灵只能选择他们可以学习的技能（包括规则系统提供的额外技能）',
    tags: ['standard', 'basic', 'skill'],
    speciesDataProvider: provider,
  })
}

/**
 * 创建竞技技能可用性验证规则
 */
export function createCompetitiveSkillAvailabilityRule(
  speciesDataProvider?: SpeciesDataProvider,
): SkillAvailabilityRule {
  // 如果没有提供数据提供者，尝试获取全局提供者
  let provider = speciesDataProvider
  if (!provider) {
    try {
      // 动态导入以避免循环依赖
      const { getGlobalClientSpeciesDataProvider } = require('../../providers/ClientSpeciesDataProvider')
      provider = getGlobalClientSpeciesDataProvider()
    } catch (error) {
      // 如果客户端提供者不可用，尝试服务端提供者
      try {
        const { getGlobalServerSpeciesDataProvider } = require('../../providers/ServerSpeciesDataProvider')
        provider = getGlobalServerSpeciesDataProvider()
      } catch (serverError) {
        console.warn('No species data provider available for competitive skill availability rule')
      }
    }
  }

  return new SkillAvailabilityRule('competitive_skill_availability', '竞技技能可用性验证', {
    description: '严格验证精灵技能选择的合法性，确保竞技环境的公平性',
    tags: ['competitive', 'strict', 'skill'],
    priority: RulePriority.HIGHEST, // 竞技模式下优先级更高
    speciesDataProvider: provider,
  })
}
