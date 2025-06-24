import { DataRepository } from '@arcadia-eternity/data-repository'
import type {
  ValidationError,
  ValidationWarning,
  ValidationResult,
  DataValidationOptions,
  NormalizedData,
} from './types'

/**
 * CLI数据验证器
 * 提供类似webui的数据完整性检查功能
 */
export class CLIDataValidator {
  private dataRepo: DataRepository
  private options: Required<DataValidationOptions>

  constructor(options: DataValidationOptions = {}) {
    this.dataRepo = DataRepository.getInstance()
    this.options = {
      validateCrossReferences: true,
      validateIdFormat: true,
      checkDuplicateIds: true,
      continueOnError: false,
      verbose: false,
      ...options,
    }
  }

  /**
   * 验证游戏数据完整性
   */
  async validateGameData(): Promise<ValidationResult> {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []

    if (this.options.verbose) {
      console.log('[🔍] 开始数据完整性验证...')
    }

    try {
      // 1. 基本数据完整性检查
      this.validateBasicDataIntegrity(errors)

      // 2. ID格式验证
      if (this.options.validateIdFormat) {
        this.validateIdFormats(errors)
      }

      // 3. 重复ID检查
      if (this.options.checkDuplicateIds) {
        this.validateDuplicateIds(errors)
      }

      // 4. 交叉引用验证
      if (this.options.validateCrossReferences) {
        this.validateCrossReferences(errors)
      }

      const isValid = errors.length === 0

      if (this.options.verbose) {
        if (isValid) {
          console.log('[✅] 数据验证通过')
        } else {
          console.log(`[❌] 数据验证失败，发现 ${errors.length} 个错误`)
        }
      }

      return {
        isValid,
        errors,
        warnings,
      }
    } catch (error) {
      const validationError: ValidationError = {
        type: 'invalid_format',
        category: 'system',
        message: `数据验证过程中发生错误: ${error instanceof Error ? error.message : error}`,
      }

      return {
        isValid: false,
        errors: [validationError],
        warnings,
      }
    }
  }

  /**
   * 基本数据完整性检查
   */
  private validateBasicDataIntegrity(errors: ValidationError[]) {
    // 检查各类数据是否存在
    const dataTypes = [
      { name: 'species', data: this.dataRepo.species, displayName: '物种' },
      { name: 'skills', data: this.dataRepo.skills, displayName: '技能' },
      { name: 'marks', data: this.dataRepo.marks, displayName: '标记' },
      { name: 'effects', data: this.dataRepo.effects, displayName: '效果' },
    ]

    for (const { name, data, displayName } of dataTypes) {
      if (data.size === 0) {
        errors.push({
          type: 'missing_id',
          category: name,
          message: `${displayName}数据为空，请检查数据加载是否正确`,
        })
      }
    }
  }

  /**
   * ID格式验证
   */
  private validateIdFormats(errors: ValidationError[]) {
    // 验证物种ID格式 (应该以pet_开头)
    for (const [id, species] of this.dataRepo.species) {
      if (!id.startsWith('pet_')) {
        errors.push({
          type: 'invalid_format',
          category: 'species',
          itemId: id,
          message: `物种ID "${id}" 格式不正确，应该以 "pet_" 开头`,
        })
      }
    }

    // 验证技能ID格式 (应该以skill_开头)
    for (const [id] of this.dataRepo.skills) {
      if (!id.startsWith('skill_')) {
        errors.push({
          type: 'invalid_format',
          category: 'skill',
          itemId: id,
          message: `技能ID "${id}" 格式不正确，应该以 "skill_" 开头`,
        })
      }
    }

    // 验证标记ID格式 (应该以mark_开头)
    for (const [id] of this.dataRepo.marks) {
      if (!id.startsWith('mark_')) {
        errors.push({
          type: 'invalid_format',
          category: 'mark',
          itemId: id,
          message: `标记ID "${id}" 格式不正确，应该以 "mark_" 开头`,
        })
      }
    }

    // 验证效果ID格式 (应该以effect_开头)
    for (const [id] of this.dataRepo.effects) {
      if (!id.startsWith('effect_')) {
        errors.push({
          type: 'invalid_format',
          category: 'effect',
          itemId: id,
          message: `效果ID "${id}" 格式不正确，应该以 "effect_" 开头`,
        })
      }
    }
  }

  /**
   * 重复ID检查
   */
  private validateDuplicateIds(errors: ValidationError[]) {
    // 检查是否有跨类型的重复ID
    const allIds = new Set<string>()
    const duplicates = new Set<string>()

    const checkIds = (dataMap: Map<string, any>, category: string) => {
      for (const id of dataMap.keys()) {
        if (allIds.has(id)) {
          duplicates.add(id)
        } else {
          allIds.add(id)
        }
      }
    }

    checkIds(this.dataRepo.species, 'species')
    checkIds(this.dataRepo.skills, 'skills')
    checkIds(this.dataRepo.marks, 'marks')
    checkIds(this.dataRepo.effects, 'effects')

    for (const duplicateId of duplicates) {
      errors.push({
        type: 'duplicate_id',
        category: 'system',
        itemId: duplicateId,
        message: `发现重复ID "${duplicateId}"，请确保所有ID在全局范围内唯一`,
      })
    }
  }

  /**
   * 交叉引用验证
   */
  private validateCrossReferences(errors: ValidationError[]) {
    // 验证技能引用的效果
    for (const [skillId, skill] of this.dataRepo.skills) {
      if (skill.effects && skill.effects.length > 0) {
        for (const effect of skill.effects) {
          if (!this.dataRepo.effects.has(effect.id)) {
            errors.push({
              type: 'missing_reference',
              category: 'skill',
              itemId: skillId,
              referencedId: effect.id,
              referencedType: 'effect',
              message: `技能 "${skillId}" 引用了不存在的效果 "${effect.id}"`,
            })
          }
        }
      }
    }

    // 验证标记引用的效果
    for (const [markId, mark] of this.dataRepo.marks) {
      if (mark.effects && mark.effects.length > 0) {
        for (const effect of mark.effects) {
          if (!this.dataRepo.effects.has(effect.id)) {
            errors.push({
              type: 'missing_reference',
              category: 'mark',
              itemId: markId,
              referencedId: effect.id,
              referencedType: 'effect',
              message: `标记 "${markId}" 引用了不存在的效果 "${effect.id}"`,
            })
          }
        }
      }
    }

    // 验证物种引用的技能和标记
    for (const [speciesId, species] of this.dataRepo.species) {
      // 注意：Species接口中的ability和emblem是BaseMark[]类型，不是string[]
      // 这里我们跳过交叉引用验证，因为DataRepository已经处理了这些引用
      // 如果需要验证，应该在数据加载阶段进行

      // 验证能力标记（如果存在且为数组）
      if (species.ability && Array.isArray(species.ability)) {
        for (const abilityMark of species.ability) {
          // abilityMark是BaseMark对象，检查其ID是否在marks中存在
          if (typeof abilityMark === 'object' && abilityMark.id) {
            if (!this.dataRepo.marks.has(abilityMark.id)) {
              errors.push({
                type: 'missing_reference',
                category: 'species',
                itemId: speciesId,
                referencedId: abilityMark.id,
                referencedType: 'mark',
                message: `物种 "${speciesId}" 引用了不存在的能力标记 "${abilityMark.id}"`,
              })
            }
          }
        }
      }

      // 验证徽章标记（如果存在且为数组）
      if (species.emblem && Array.isArray(species.emblem)) {
        for (const emblemMark of species.emblem) {
          // emblemMark是BaseMark对象，检查其ID是否在marks中存在
          if (typeof emblemMark === 'object' && emblemMark.id) {
            if (!this.dataRepo.marks.has(emblemMark.id)) {
              errors.push({
                type: 'missing_reference',
                category: 'species',
                itemId: speciesId,
                referencedId: emblemMark.id,
                referencedType: 'mark',
                message: `物种 "${speciesId}" 引用了不存在的徽章标记 "${emblemMark.id}"`,
              })
            }
          }
        }
      }
    }
  }

  /**
   * 打印验证结果
   */
  static printValidationResult(result: ValidationResult) {
    if (result.isValid) {
      console.log('[✅] 数据验证通过')
      return
    }

    console.log(`[❌] 数据验证失败，发现 ${result.errors.length} 个错误`)

    // 按类型分组显示错误
    const errorsByType = result.errors.reduce(
      (acc, error) => {
        if (!acc[error.type]) {
          acc[error.type] = []
        }
        acc[error.type].push(error)
        return acc
      },
      {} as Record<string, ValidationError[]>,
    )

    for (const [type, errors] of Object.entries(errorsByType)) {
      console.log(`\n[${type.toUpperCase()}] ${errors.length} 个错误:`)
      for (const error of errors) {
        console.log(`  - ${error.message}`)
      }
    }

    if (result.warnings.length > 0) {
      console.log(`\n[⚠️] ${result.warnings.length} 个警告:`)
      for (const warning of result.warnings) {
        console.log(`  - ${warning.message}`)
      }
    }
  }
}

/**
 * 便捷函数：验证游戏数据
 */
export async function validateGameData(options?: DataValidationOptions): Promise<ValidationResult> {
  const validator = new CLIDataValidator(options)
  return await validator.validateGameData()
}

/**
 * 便捷函数：验证并打印结果
 */
export async function validateAndPrintGameData(options?: DataValidationOptions): Promise<boolean> {
  const result = await validateGameData(options)
  CLIDataValidator.printValidationResult(result)
  return result.isValid
}
