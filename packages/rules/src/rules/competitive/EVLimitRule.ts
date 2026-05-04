import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Team, RuleContext } from '../../interfaces/Rule'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../../interfaces/ValidationResult'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * 学习力限制规则
 * 限制精灵的学习力分配
 */
export class EVLimitRule extends AbstractRule {
  private maxTotalEV: number
  private maxSingleEV: number

  constructor(
    id: string = 'ev_limit_rule',
    name: string = '学习力限制',
    maxTotalEV: number = 510,
    maxSingleEV: number = 252,
    options: {
      description?: string
      priority?: number
      version?: string
      author?: string
      tags?: string[]
      enabled?: boolean
    } = {}
  ) {
    super(id, name, {
      description: options.description ?? `限制学习力总和不超过 ${maxTotalEV}，单项不超过 ${maxSingleEV}`,
      ...options,
      tags: ['competitive', 'ev', 'stats', ...(options.tags ?? [])],
    })
    
    this.maxTotalEV = maxTotalEV
    this.maxSingleEV = maxSingleEV
  }

  /**
   * 验证队伍中所有精灵的学习力
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
   * 验证单个精灵的学习力
   */
  validatePet(pet: PetSchemaType, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()
    const evs = pet.evs

    // 计算学习力总和
    const totalEV = evs.hp + evs.atk + evs.def + evs.spa + evs.spd + evs.spe

    if (totalEV > this.maxTotalEV) {
      builder.addError(
        ValidationErrorType.PET_VALIDATION,
        'EV_TOTAL_EXCEEDED',
        `精灵 "${pet.name}" 学习力总和超限，最大允许 ${this.maxTotalEV}，当前为 ${totalEV}`,
        pet.id,
        'pet',
        { maxTotalEV: this.maxTotalEV, currentTotalEV: totalEV, petName: pet.name }
      )
    }

    // 检查单项学习力
    const evStats = [
      { name: 'HP', value: evs.hp },
      { name: '攻击', value: evs.atk },
      { name: '防御', value: evs.def },
      { name: '特攻', value: evs.spa },
      { name: '特防', value: evs.spd },
      { name: '速度', value: evs.spe },
    ]

    for (const stat of evStats) {
      if (stat.value > this.maxSingleEV) {
        builder.addError(
          ValidationErrorType.PET_VALIDATION,
          'EV_SINGLE_EXCEEDED',
          `精灵 "${pet.name}" 的 ${stat.name} 学习力超限，最大允许 ${this.maxSingleEV}，当前为 ${stat.value}`,
          pet.id,
          'pet',
          { 
            maxSingleEV: this.maxSingleEV, 
            currentEV: stat.value, 
            statName: stat.name, 
            petName: pet.name 
          }
        )
      }

      if (stat.value < 0) {
        builder.addError(
          ValidationErrorType.PET_VALIDATION,
          'EV_NEGATIVE',
          `精灵 "${pet.name}" 的 ${stat.name} 学习力不能为负数，当前为 ${stat.value}`,
          pet.id,
          'pet',
          { currentEV: stat.value, statName: stat.name, petName: pet.name }
        )
      }
    }

    return builder.build()
  }

  /**
   * 修改精灵学习力（调整到合法范围）
   */
  modifyPet(pet: PetSchemaType, context?: RuleContext): void {
    const evs = pet.evs

    // 确保所有学习力不为负数
    evs.hp = Math.max(0, evs.hp)
    evs.atk = Math.max(0, evs.atk)
    evs.def = Math.max(0, evs.def)
    evs.spa = Math.max(0, evs.spa)
    evs.spd = Math.max(0, evs.spd)
    evs.spe = Math.max(0, evs.spe)

    // 限制单项学习力
    evs.hp = Math.min(this.maxSingleEV, evs.hp)
    evs.atk = Math.min(this.maxSingleEV, evs.atk)
    evs.def = Math.min(this.maxSingleEV, evs.def)
    evs.spa = Math.min(this.maxSingleEV, evs.spa)
    evs.spd = Math.min(this.maxSingleEV, evs.spd)
    evs.spe = Math.min(this.maxSingleEV, evs.spe)

    // 如果总学习力超限，按比例缩减
    const totalEV = evs.hp + evs.atk + evs.def + evs.spa + evs.spd + evs.spe
    if (totalEV > this.maxTotalEV) {
      const ratio = this.maxTotalEV / totalEV
      evs.hp = Math.floor(evs.hp * ratio)
      evs.atk = Math.floor(evs.atk * ratio)
      evs.def = Math.floor(evs.def * ratio)
      evs.spa = Math.floor(evs.spa * ratio)
      evs.spd = Math.floor(evs.spd * ratio)
      evs.spe = Math.floor(evs.spe * ratio)
    }
  }

  /**
   * 获取最大学习力总和
   */
  getMaxTotalEV(): number {
    return this.maxTotalEV
  }

  /**
   * 获取最大单项学习力
   */
  getMaxSingleEV(): number {
    return this.maxSingleEV
  }

  /**
   * 设置学习力限制
   */
  setEVLimits(maxTotalEV: number, maxSingleEV: number): void {
    if (maxTotalEV < 0) {
      throw new Error('Maximum total EV cannot be negative')
    }
    if (maxSingleEV < 0) {
      throw new Error('Maximum single EV cannot be negative')
    }
    if (maxSingleEV * 6 < maxTotalEV) {
      throw new Error('Maximum single EV * 6 should be at least equal to maximum total EV')
    }
    
    this.maxTotalEV = maxTotalEV
    this.maxSingleEV = maxSingleEV
  }
}

/**
 * 创建标准学习力限制规则
 */
export function createStandardEVLimitRule(): EVLimitRule {
  return new EVLimitRule(
    'standard_ev_limit',
    '标准学习力限制',
    510,
    252,
    {
      description: '标准游戏模式的学习力限制（总和510，单项252）',
      tags: ['standard', 'competitive'],
    }
  )
}

/**
 * 创建宽松学习力限制规则
 */
export function createRelaxedEVLimitRule(): EVLimitRule {
  return new EVLimitRule(
    'relaxed_ev_limit',
    '宽松学习力限制',
    600,
    300,
    {
      description: '宽松模式的学习力限制（总和600，单项300）',
      tags: ['casual', 'relaxed'],
    }
  )
}

/**
 * 创建严格学习力限制规则
 */
export function createStrictEVLimitRule(): EVLimitRule {
  return new EVLimitRule(
    'strict_ev_limit',
    '严格学习力限制',
    400,
    200,
    {
      description: '严格模式的学习力限制（总和400，单项200）',
      tags: ['strict', 'limited'],
    }
  )
}
