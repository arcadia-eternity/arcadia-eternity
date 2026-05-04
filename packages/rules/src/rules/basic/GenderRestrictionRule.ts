import { Gender } from '@arcadia-eternity/const'
import type { PetSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'
import type { Team, RuleContext } from '../../interfaces/Rule'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../../interfaces/ValidationResult'
import { AbstractRule } from '../../core/AbstractRule'
import type { SpeciesDataProvider } from '../../interfaces/SpeciesDataProvider'

/**
 * 性别限制规则
 * 根据精灵种族的性别比例限制精灵的性别选择
 */
export class GenderRestrictionRule extends AbstractRule {
  private speciesDataProvider?: SpeciesDataProvider

  constructor(
    id: string = 'gender_restriction_rule',
    name: string = '性别限制',
    speciesDataProvider?: SpeciesDataProvider,
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
      description: options.description ?? '根据精灵种族限制可选择的性别',
      ...options,
      tags: ['basic', 'gender', 'pet', 'species', ...(options.tags ?? [])],
    })

    this.speciesDataProvider = speciesDataProvider
  }

  /**
   * 设置种族数据提供者
   */
  setSpeciesDataProvider(provider: SpeciesDataProvider): void {
    this.speciesDataProvider = provider
  }

  /**
   * 验证队伍中所有精灵的性别
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
   * 验证单个精灵的性别
   */
  validatePet(pet: PetSchemaType, _context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()

    // 如果没有种族数据提供者，跳过验证
    if (!this.speciesDataProvider) {
      return builder.build()
    }

    // 获取种族数据
    const speciesData = this.speciesDataProvider.getSpeciesById(pet.species)
    if (!speciesData) {
      builder.addError(
        ValidationErrorType.PET_VALIDATION,
        'SPECIES_NOT_FOUND',
        `精灵 "${pet.name}" 的种族 "${pet.species}" 未找到`,
        pet.id,
        'pet',
        { speciesId: pet.species, petName: pet.name },
      )
      return builder.build()
    }

    // 检查性别限制
    const allowedGenders = this.getAllowedGenders(speciesData)
    const petGender = pet.gender

    // 如果精灵没有设置性别，但种族有性别限制
    if (!petGender && allowedGenders.length > 0 && !allowedGenders.includes(Gender.NoGender)) {
      builder.addError(
        ValidationErrorType.PET_VALIDATION,
        'GENDER_REQUIRED',
        `精灵 "${pet.name}" 必须设置性别，可选性别：${this.formatGenderList(allowedGenders)}`,
        pet.id,
        'pet',
        { allowedGenders, petName: pet.name, speciesId: pet.species },
      )
      return builder.build()
    }

    // 如果精灵设置了性别，检查是否在允许范围内
    if (petGender && !allowedGenders.includes(petGender)) {
      builder.addError(
        ValidationErrorType.PET_VALIDATION,
        'INVALID_GENDER',
        `精灵 "${pet.name}" 的性别 "${this.formatGender(petGender)}" 不被允许，可选性别：${this.formatGenderList(allowedGenders)}`,
        pet.id,
        'pet',
        {
          currentGender: petGender,
          allowedGenders,
          petName: pet.name,
          speciesId: pet.species,
        },
      )
    }

    return builder.build()
  }

  /**
   * 根据种族数据获取允许的性别列表
   */
  private getAllowedGenders(speciesData: SpeciesSchemaType): Gender[] {
    const genderRatio = speciesData.genderRatio

    // 如果没有性别比例数据，默认允许所有性别
    if (!genderRatio) {
      return [Gender.Male, Gender.Female, Gender.NoGender]
    }

    const allowedGenders: Gender[] = []

    // genderRatio 是 [female_ratio, male_ratio] 的格式
    const [femaleRatio, maleRatio] = genderRatio

    // 如果雌性比例大于0，允许雌性
    if (femaleRatio > 0) {
      allowedGenders.push(Gender.Female)
    }

    // 如果雄性比例大于0，允许雄性
    if (maleRatio > 0) {
      allowedGenders.push(Gender.Male)
    }

    // 如果雌性和雄性比例都为0，则为无性别
    if (femaleRatio === 0 && maleRatio === 0) {
      allowedGenders.push(Gender.NoGender)
    }

    return allowedGenders
  }

  /**
   * 格式化性别显示
   */
  private formatGender(gender: Gender): string {
    switch (gender) {
      case Gender.Male:
        return '雄性'
      case Gender.Female:
        return '雌性'
      case Gender.NoGender:
        return '无性别'
      default:
        return gender
    }
  }

  /**
   * 格式化性别列表显示
   */
  private formatGenderList(genders: Gender[]): string {
    return genders.map(g => this.formatGender(g)).join('、')
  }

  /**
   * 获取精灵种族的允许性别（用于编辑器显示）
   */
  getAllowedGendersForSpecies(speciesId: string): Gender[] {
    if (!this.speciesDataProvider) {
      return [Gender.Male, Gender.Female, Gender.NoGender]
    }

    const speciesData = this.speciesDataProvider.getSpeciesById(speciesId)
    if (!speciesData) {
      return []
    }

    return this.getAllowedGenders(speciesData)
  }

  /**
   * 检查指定性别是否被种族允许
   */
  isGenderAllowedForSpecies(speciesId: string, gender: Gender): boolean {
    const allowedGenders = this.getAllowedGendersForSpecies(speciesId)
    return allowedGenders.includes(gender)
  }
}

/**
 * 创建标准性别限制规则
 */
export function createStandardGenderRestrictionRule(speciesDataProvider?: SpeciesDataProvider): GenderRestrictionRule {
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
        console.warn('No species data provider available for gender restriction rule')
      }
    }
  }

  return new GenderRestrictionRule('standard_gender_restriction', '标准性别限制', provider, {
    description: '根据精灵种族的性别比例限制可选择的性别',
    tags: ['standard', 'basic'],
  })
}
