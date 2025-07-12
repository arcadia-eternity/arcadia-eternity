import type { baseSkillId, baseMarkId, speciesId } from '@arcadia-eternity/const'
import type { BaseSkill, BaseMark } from '@arcadia-eternity/battle'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Team, RuleContext } from '../../interfaces/Rule'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../../interfaces/ValidationResult'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * 禁用规则
 * 禁用特定的精灵、技能或印记
 */
export class BanRule extends AbstractRule {
  private bannedSpecies: Set<speciesId>
  private bannedSkills: Set<baseSkillId>
  private bannedMarks: Set<baseMarkId>

  constructor(
    id: string = 'ban_rule',
    name: string = '禁用规则',
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
      bannedSpecies?: speciesId[]
      bannedSkills?: baseSkillId[]
      bannedMarks?: baseMarkId[]
    } = {}
  ) {
    super(id, name, {
      description: options.description ?? '禁用特定的精灵、技能或印记',
      ...options,
      tags: ['basic', 'ban', 'restriction', ...(options.tags ?? [])],
    })
    
    this.bannedSpecies = new Set(options.bannedSpecies ?? [])
    this.bannedSkills = new Set(options.bannedSkills ?? [])
    this.bannedMarks = new Set(options.bannedMarks ?? [])
  }

  /**
   * 验证队伍中是否包含被禁用的内容
   */
  validateTeam(team: Team, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    for (const pet of team) {
      const petResult = this.validatePet(pet, context)
      builder.merge(petResult)
    }

    return builder.build()
  }

  /**
   * 验证精灵是否被禁用
   */
  validatePet(pet: PetSchemaType, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    // 检查精灵种族是否被禁用
    if (this.bannedSpecies.has(pet.species as speciesId)) {
      builder.addError(
        ValidationErrorType.PET_VALIDATION,
        'BANNED_SPECIES',
        `精灵 "${pet.name}" 的种族 "${pet.species}" 已被禁用`,
        pet.id,
        'pet',
        { species: pet.species, petName: pet.name }
      )
    }

    // 检查技能是否被禁用
    for (const skillId of pet.skills) {
      if (this.bannedSkills.has(skillId as baseSkillId)) {
        builder.addError(
          ValidationErrorType.SKILL_VALIDATION,
          'BANNED_SKILL',
          `精灵 "${pet.name}" 的技能 "${skillId}" 已被禁用`,
          pet.id,
          'skill',
          { skillId, petName: pet.name }
        )
      }
    }

    // 检查特性是否被禁用
    if (pet.ability && this.bannedMarks.has(pet.ability as baseMarkId)) {
      builder.addError(
        ValidationErrorType.MARK_VALIDATION,
        'BANNED_ABILITY',
        `精灵 "${pet.name}" 的特性 "${pet.ability}" 已被禁用`,
        pet.id,
        'mark',
        { markId: pet.ability, petName: pet.name }
      )
    }

    // 检查徽章是否被禁用
    if (pet.emblem && this.bannedMarks.has(pet.emblem as baseMarkId)) {
      builder.addError(
        ValidationErrorType.MARK_VALIDATION,
        'BANNED_EMBLEM',
        `精灵 "${pet.name}" 的徽章 "${pet.emblem}" 已被禁用`,
        pet.id,
        'mark',
        { markId: pet.emblem, petName: pet.name }
      )
    }

    return builder.build()
  }

  /**
   * 验证技能是否被禁用
   */
  validateSkill(pet: PetSchemaType, skill: BaseSkill, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    if (this.bannedSkills.has(skill.id)) {
      builder.addError(
        ValidationErrorType.SKILL_VALIDATION,
        'BANNED_SKILL',
        `技能 "${skill.id}" 已被禁用`,
        skill.id,
        'skill',
        { skillId: skill.id }
      )
    }

    return builder.build()
  }

  /**
   * 验证印记是否被禁用
   */
  validateMark(pet: PetSchemaType, mark: BaseMark, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    if (this.bannedMarks.has(mark.id)) {
      builder.addError(
        ValidationErrorType.MARK_VALIDATION,
        'BANNED_MARK',
        `印记 "${mark.id}" 已被禁用`,
        mark.id,
        'mark',
        { markId: mark.id }
      )
    }

    return builder.build()
  }

  /**
   * 添加被禁用的精灵种族
   */
  banSpecies(...speciesIds: speciesId[]): void {
    for (const id of speciesIds) {
      this.bannedSpecies.add(id)
    }
  }

  /**
   * 添加被禁用的技能
   */
  banSkills(...skillIds: baseSkillId[]): void {
    for (const id of skillIds) {
      this.bannedSkills.add(id)
    }
  }

  /**
   * 添加被禁用的印记
   */
  banMarks(...markIds: baseMarkId[]): void {
    for (const id of markIds) {
      this.bannedMarks.add(id)
    }
  }

  /**
   * 移除被禁用的精灵种族
   */
  unbanSpecies(...speciesIds: speciesId[]): void {
    for (const id of speciesIds) {
      this.bannedSpecies.delete(id)
    }
  }

  /**
   * 移除被禁用的技能
   */
  unbanSkills(...skillIds: baseSkillId[]): void {
    for (const id of skillIds) {
      this.bannedSkills.delete(id)
    }
  }

  /**
   * 移除被禁用的印记
   */
  unbanMarks(...markIds: baseMarkId[]): void {
    for (const id of markIds) {
      this.bannedMarks.delete(id)
    }
  }

  /**
   * 检查精灵种族是否被禁用
   */
  isSpeciesBanned(speciesId: speciesId): boolean {
    return this.bannedSpecies.has(speciesId)
  }

  /**
   * 检查技能是否被禁用
   */
  isSkillBanned(skillId: baseSkillId): boolean {
    return this.bannedSkills.has(skillId)
  }

  /**
   * 检查印记是否被禁用
   */
  isMarkBanned(markId: baseMarkId): boolean {
    return this.bannedMarks.has(markId)
  }

  /**
   * 获取所有被禁用的精灵种族
   */
  getBannedSpecies(): speciesId[] {
    return Array.from(this.bannedSpecies)
  }

  /**
   * 获取所有被禁用的技能
   */
  getBannedSkills(): baseSkillId[] {
    return Array.from(this.bannedSkills)
  }

  /**
   * 获取所有被禁用的印记
   */
  getBannedMarks(): baseMarkId[] {
    return Array.from(this.bannedMarks)
  }

  /**
   * 清空所有禁用列表
   */
  clearAllBans(): void {
    this.bannedSpecies.clear()
    this.bannedSkills.clear()
    this.bannedMarks.clear()
  }
}
