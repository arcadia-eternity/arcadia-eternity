import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Team, RuleContext } from '../../interfaces/Rule'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../../interfaces/ValidationResult'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * 等级限制规则
 * 限制精灵的等级范围
 */
export class LevelLimitRule extends AbstractRule {
  private minLevel: number
  private maxLevel: number

  constructor(
    id: string = 'level_limit_rule',
    name: string = '等级限制',
    minLevel: number = 1,
    maxLevel: number = 100,
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
    } = {},
  ) {
    super(id, name, {
      description: options.description ?? `限制精灵等级在 ${minLevel}-${maxLevel} 级之间`,
      ...options,
      tags: ['basic', 'level', 'pet', ...(options.tags ?? [])],
    })

    this.minLevel = minLevel
    this.maxLevel = maxLevel
  }

  /**
   * 验证队伍中所有精灵的等级
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
   * 验证单个精灵的等级
   */
  validatePet(pet: PetSchemaType, _context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()
    const level = pet.level

    if (level < this.minLevel) {
      builder.addError(
        ValidationErrorType.PET_VALIDATION,
        'LEVEL_TOO_LOW',
        `精灵 "${pet.name}" 等级过低，最低等级为 ${this.minLevel}，当前等级为 ${level}`,
        pet.id,
        'pet',
        { minLevel: this.minLevel, currentLevel: level, petName: pet.name },
      )
    }

    if (level > this.maxLevel) {
      builder.addError(
        ValidationErrorType.PET_VALIDATION,
        'LEVEL_TOO_HIGH',
        `精灵 "${pet.name}" 等级过高，最高等级为 ${this.maxLevel}，当前等级为 ${level}`,
        pet.id,
        'pet',
        { maxLevel: this.maxLevel, currentLevel: level, petName: pet.name },
      )
    }

    return builder.build()
  }

  /**
   * 修改精灵等级（如果超出范围则调整到边界值）
   */
  modifyPet(pet: PetSchemaType, _context?: RuleContext): void {
    if (pet.level < this.minLevel) {
      pet.level = this.minLevel
    } else if (pet.level > this.maxLevel) {
      pet.level = this.maxLevel
    }
  }

  /**
   * 获取最低等级
   */
  getMinLevel(): number {
    return this.minLevel
  }

  /**
   * 获取最高等级
   */
  getMaxLevel(): number {
    return this.maxLevel
  }

  /**
   * 设置等级限制
   */
  setLevelLimit(minLevel: number, maxLevel: number): void {
    if (minLevel < 1) {
      throw new Error('Minimum level cannot be less than 1')
    }
    if (maxLevel < minLevel) {
      throw new Error('Maximum level cannot be less than minimum level')
    }

    this.minLevel = minLevel
    this.maxLevel = maxLevel
  }
}

/**
 * 创建标准等级限制规则（1-100级）
 */
export function createStandardLevelLimitRule(): LevelLimitRule {
  return new LevelLimitRule('standard_level_limit', '标准等级限制', 1, 100, {
    description: '标准游戏模式的等级限制（1-100级）',
    tags: ['standard', 'basic'],
  })
}

/**
 * 创建竞技等级限制规则（100级）
 */
export function createCompetitiveLevelLimitRule(): LevelLimitRule {
  return new LevelLimitRule('competitive_level_limit', '竞技等级限制', 100, 100, {
    description: '竞技模式的等级限制（必须100级）',
    tags: ['competitive', 'strict'],
  })
}

/**
 * 创建低级别战斗等级限制规则（1-50级）
 */
export function createLowLevelBattleLimitRule(): LevelLimitRule {
  return new LevelLimitRule('low_level_battle_limit', '低级别战斗等级限制', 1, 50, {
    description: '低级别战斗模式的等级限制（1-50级）',
    tags: ['low-level', 'casual'],
  })
}

/**
 * 创建中级别战斗等级限制规则（51-80级）
 */
export function createMidLevelBattleLimitRule(): LevelLimitRule {
  return new LevelLimitRule('mid_level_battle_limit', '中级别战斗等级限制', 51, 80, {
    description: '中级别战斗模式的等级限制（51-80级）',
    tags: ['mid-level', 'intermediate'],
  })
}
