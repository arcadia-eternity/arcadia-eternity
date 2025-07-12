import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { Team, RuleContext } from '../../interfaces/Rule'
import { ValidationResultBuilder, ValidationErrorType, type ValidationResult } from '../../interfaces/ValidationResult'
import { AbstractRule } from '../../core/AbstractRule'

/**
 * 精灵种族唯一性规则
 * 确保队伍中的每只精灵都有唯一的种族（species），不允许相同种族的精灵
 */
export class PetSpeciesUniqueRule extends AbstractRule {
  constructor(
    id: string = 'pet_species_unique_rule',
    name: string = '精灵种族唯一性',
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
      description: options.description ?? '确保队伍中的每只精灵都有唯一的种族，不允许相同种族的精灵',
      ...options,
      tags: ['competitive', 'validation', 'unique', 'species', ...(options.tags ?? [])],
    })
  }

  /**
   * 验证队伍中精灵种族的唯一性
   */
  validateTeam(team: Team, context?: RuleContext): ValidationResult {
    const builder = new ValidationResultBuilder()
    const speciesMap = new Map<string, PetSchemaType[]>() // species -> 拥有该种族的精灵列表

    // 收集所有精灵的种族
    for (const pet of team) {
      if (!speciesMap.has(pet.species)) {
        speciesMap.set(pet.species, [])
      }
      speciesMap.get(pet.species)!.push(pet)
    }

    // 检查重复的种族
    for (const [species, pets] of speciesMap) {
      if (pets.length > 1) {
        // 生成包含精灵名称的错误信息
        const petNames = pets.map(p => p.name).join('、')
        builder.addError(
          ValidationErrorType.TEAM_VALIDATION,
          'DUPLICATE_PET_SPECIES',
          `队伍中存在相同种族的精灵：${petNames} (种族: ${species})。竞技模式不允许使用相同种族的精灵`,
          undefined,
          'team',
          {
            duplicateSpecies: species,
            petNames: pets.map(p => p.name),
            petCount: pets.length,
            affectedPets: pets.map(p => ({ id: p.id, name: p.name, species: p.species })),
          },
        )
      }
    }

    return builder.build()
  }
}

/**
 * 创建竞技模式精灵种族唯一性规则
 */
export function createCompetitivePetSpeciesUniqueRule(): PetSpeciesUniqueRule {
  return new PetSpeciesUniqueRule('competitive_pet_species_unique', '精灵种族唯一性', {
    description: '确保队伍中每只精灵都有唯一的种族',
    tags: ['competitive', 'strict'],
  })
}
